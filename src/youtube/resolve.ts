import type { Innertube } from 'youtubei.js';

import { getInnertube, resetInnertube } from './innertube';

/** Etapas de la resolución, para poder mostrar en qué punto va o dónde falló. */
export type ResolveStage = 'session' | 'metadata' | 'format';

export const STAGE_LABEL: Record<ResolveStage, string> = {
  session: 'Conectando con YouTube…',
  metadata: 'Leyendo el video…',
  format: 'Buscando el audio…',
};

/** Metadatos + URL de audio lista para descargar. */
export type ResolvedTrack = {
  id: string;
  title: string;
  artist: string;
  duration: number; // segundos
  thumbnailUrl: string | null;
  /** URL directa al stream de audio. Caduca en pocas horas: usar y descartar. */
  streamUrl: string;
  /** Extensión real del contenedor, para nombrar el archivo. */
  ext: 'm4a';
  approxBytes: number | null;
};

export type SearchResult = {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl: string | null;
};

/**
 * Clientes Innertube en orden de preferencia.
 *
 * IOS va primero porque es el único que, medido en dispositivo, entrega la URL
 * de audio ya en claro. ANDROID queda de respaldo: hoy devuelve el formato sin
 * URL directa, pero eso cambia con el tiempo y no cuesta nada intentarlo.
 *
 * Esto importa porque la sesión se crea con `retrieve_player: false` para no
 * bloquear el hilo de JS, así que un formato cifrado no se puede usar.
 *
 * YTMUSIC_ANDROID se quitó: YouTube responde 400 a ese cliente de forma
 * consistente, así que solo añadía ruido al mensaje de error.
 */
const CLIENTS = ['IOS', 'ANDROID'] as const;

/** Tope por etapa. Evita que la UI se quede colgada sin decir nada. */
const STAGE_TIMEOUT_MS = 25_000;

/** Error con mensaje ya listo para mostrarle al usuario. */
export class ResolveError extends Error {
  constructor(
    message: string,
    readonly stage: ResolveStage | null = null,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ResolveError';
  }
}

/**
 * Corta una promesa que tarde demasiado.
 *
 * Ojo con el alcance real de esto: protege contra una petición de red colgada,
 * no contra el hilo de JS bloqueado — si algo se pone a hacer trabajo síncrono
 * pesado, el propio temporizador tampoco corre. Para eso está
 * `retrieve_player: false` en innertube.ts.
 */
function withTimeout<T>(promise: Promise<T>, stage: ResolveStage): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new ResolveError(
          `Se agotó el tiempo de espera (${STAGE_LABEL[stage].replace('…', '').toLowerCase()}). ` +
            'Revisa tu conexión e intenta de nuevo.',
          stage,
        ),
      );
    }, STAGE_TIMEOUT_MS);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Extrae el ID de video de cualquier forma de link de YouTube:
 * youtu.be/ID, /watch?v=ID, /shorts/ID, /embed/ID, /live/ID, music.youtube.com,
 * o directamente un ID de 11 caracteres pegado a mano.
 */
export function parseVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  if (/^[\w-]{11}$/.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');
  const isYouTube =
    host === 'youtu.be' ||
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host.endsWith('.youtube.com');
  if (!isYouTube) return null;

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }

  const v = url.searchParams.get('v');
  if (v && /^[\w-]{11}$/.test(v)) return v;

  const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
  return m ? m[1] : null;
}

/** Toma la miniatura de mayor resolución disponible. */
function bestThumbnail(thumbnails: { url: string; width: number }[] | undefined): string | null {
  if (!thumbnails?.length) return null;
  return thumbnails.reduce((a, b) => (b.width > a.width ? b : a)).url;
}

/**
 * "Artista": YouTube no expone un campo limpio, así que usamos el nombre del
 * canal quitándole el sufijo " - Topic" que traen los canales auto-generados
 * de música (que son justamente los que mejor metadata tienen).
 */
function cleanArtist(author: string | undefined): string {
  return (author ?? 'Desconocido').replace(/\s*-\s*Topic$/i, '').trim() || 'Desconocido';
}

/** Sólo la parte del formato que realmente usamos. */
type AudioFormat = {
  url?: string;
  signature_cipher?: string;
  cipher?: string;
  content_length?: number;
};

/**
 * Elige el mejor stream **solo de audio en m4a/AAC**.
 *
 * El contenedor importa: YouTube sirve la mayoría del audio como webm/opus, que
 * Android reproduce pero iOS no. m4a/AAC lo entienden los dos, así que pedirlo
 * explícitamente nos evita transcodificar con ffmpeg — algo que no existe en el
 * dispositivo. Está disponible prácticamente en todos los videos.
 *
 * Devuelve null si el formato viene cifrado: descifrarlo exigiría el JS player,
 * y cargarlo cuesta más de lo que vale (ver innertube.ts). Con que uno de los
 * clientes de la lista dé una URL en claro, alcanza.
 */
function pickAudioFormat(format: AudioFormat | undefined) {
  if (!format) return null;

  // `format.url` sólo viene cuando YouTube no aplicó firma. Ojo: no sirve
  // preguntar por `format.decipher`, que es un método del prototipo y por tanto
  // siempre existe — ese fue justamente el bug que dejaba la URL sin resolver.
  if (!format.url) return null;
  if (format.signature_cipher || format.cipher) return null;

  return {
    url: format.url,
    bytes: typeof format.content_length === 'number' ? format.content_length : null,
  };
}

/**
 * Resuelve un link/ID a metadatos + URL de stream, probando cada cliente hasta
 * que uno entregue un formato usable.
 */
export async function resolveTrack(
  input: string,
  onStage?: (stage: ResolveStage) => void,
): Promise<ResolvedTrack> {
  const id = parseVideoId(input);
  if (!id) {
    throw new ResolveError('Ese link no es de YouTube. Pega la URL del video o su ID.');
  }

  onStage?.('session');
  let yt: Innertube;
  try {
    yt = await withTimeout(getInnertube(), 'session');
  } catch (err) {
    resetInnertube();
    if (err instanceof ResolveError) throw err;
    throw new ResolveError(
      'No se pudo conectar con YouTube. Revisa tu conexión.',
      'session',
      err,
    );
  }

  const problems: string[] = [];

  for (const client of CLIENTS) {
    try {
      onStage?.('metadata');
      const info = await withTimeout(yt.getBasicInfo(id, { client }), 'metadata');
      const basic = info.basic_info;

      const status = info.playability_status?.status;
      if (status === 'LOGIN_REQUIRED') {
        throw new ResolveError(
          'El video tiene restricción de edad y no se puede descargar.',
          'metadata',
        );
      }
      if (status === 'UNPLAYABLE') {
        throw new ResolveError(
          info.playability_status?.reason || 'El video no está disponible para reproducir.',
          'metadata',
        );
      }

      onStage?.('format');
      const chosen = info.chooseFormat({ type: 'audio', quality: 'best', format: 'mp4' });
      const audio = pickAudioFormat(chosen as AudioFormat | undefined);

      if (!audio) {
        problems.push(`${client}: sin audio m4a en claro`);
        continue;
      }

      return {
        id,
        title: basic.title?.trim() || 'Sin título',
        artist: cleanArtist(basic.author),
        duration: basic.duration ?? 0,
        thumbnailUrl: bestThumbnail(basic.thumbnail as { url: string; width: number }[]),
        streamUrl: audio.url,
        ext: 'm4a',
        approxBytes: audio.bytes,
      };
    } catch (err) {
      // Un fallo de disponibilidad es definitivo; no tiene sentido reintentar
      // con otro cliente porque el video simplemente no se puede bajar.
      if (err instanceof ResolveError && err.stage === 'metadata' && !err.message.startsWith('Se agotó')) {
        throw err;
      }
      problems.push(`${client}: ${err instanceof Error ? err.message : 'error'}`);
    }
  }

  throw new ResolveError(
    `YouTube no entregó un stream de audio utilizable (${problems.join(' · ')}). ` +
      'Si esto pasa con todos los videos, actualiza youtubei.js y vuelve a compilar.',
    'format',
  );
}

/** Búsqueda por texto, para no depender de tener el link a mano. */
export async function searchTracks(query: string, limit = 20): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  let yt: Innertube;
  try {
    yt = await withTimeout(getInnertube(), 'session');
  } catch (err) {
    resetInnertube();
    if (err instanceof ResolveError) throw err;
    throw new ResolveError('No se pudo conectar con YouTube. Revisa tu conexión.', 'session', err);
  }

  try {
    const search = await withTimeout(yt.search(q, { type: 'video' }), 'metadata');
    const out: SearchResult[] = [];

    for (const item of search.results ?? []) {
      const node = item as {
        id?: string;
        video_id?: string;
        title?: { text?: string };
        author?: { name?: string };
        duration?: { seconds?: number };
        thumbnails?: { url: string; width: number }[];
      };
      const videoId = node.id ?? node.video_id;
      if (!videoId || !/^[\w-]{11}$/.test(videoId)) continue;

      out.push({
        id: videoId,
        title: node.title?.text ?? 'Sin título',
        artist: cleanArtist(node.author?.name),
        duration: node.duration?.seconds ?? 0,
        thumbnailUrl: bestThumbnail(node.thumbnails),
      });
      if (out.length >= limit) break;
    }

    return out;
  } catch (err) {
    if (err instanceof ResolveError) throw err;
    throw new ResolveError('La búsqueda falló. Intenta de nuevo.', 'metadata', err);
  }
}
