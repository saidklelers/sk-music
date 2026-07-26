import type { Innertube } from 'youtubei.js';

import { getInnertube, resetInnertube } from './innertube';

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
 * IOS va primero porque devuelve URLs de audio sin cifrar ni estrangular y sin
 * exigir PoToken, que es justo lo que rompe al cliente WEB. Los demás quedan
 * como respaldo por si YouTube cambia el comportamiento de alguno.
 */
const CLIENTS = ['IOS', 'ANDROID', 'YTMUSIC_ANDROID', 'WEB'] as const;

/** Error con mensaje ya listo para mostrarle al usuario. */
export class ResolveError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ResolveError';
  }
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

/**
 * Elige el mejor stream **solo de audio en m4a/AAC**.
 *
 * El contenedor importa: YouTube sirve la mayoría del audio como webm/opus, que
 * Android reproduce pero iOS no. m4a/AAC lo entienden los dos, así que pedirlo
 * explícitamente nos evita transcodificar con ffmpeg — algo que no existe en el
 * dispositivo. Está disponible prácticamente en todos los videos.
 */
function pickAudioFormat(info: any, yt: Innertube) {
  const format = info.chooseFormat({ type: 'audio', quality: 'best', format: 'mp4' });
  if (!format) return null;

  // Si viene cifrada, decipher() aplica la firma y el descifrado del parámetro
  // `n` (el que estrangula la velocidad a ~50 KB/s si se ignora).
  const url: string | undefined = format.decipher
    ? format.decipher(yt.session.player)
    : format.url;
  if (!url) return null;

  return {
    url,
    bytes: typeof format.content_length === 'number' ? format.content_length : null,
  };
}

/**
 * Resuelve un link/ID a metadatos + URL de stream, probando cada cliente hasta
 * que uno entregue un formato usable.
 */
export async function resolveTrack(input: string): Promise<ResolvedTrack> {
  const id = parseVideoId(input);
  if (!id) {
    throw new ResolveError('Ese link no es de YouTube. Pega la URL del video o su ID.');
  }

  let yt: Innertube;
  try {
    yt = await getInnertube();
  } catch (err) {
    resetInnertube();
    throw new ResolveError('No se pudo conectar con YouTube. Revisa tu conexión.', err);
  }

  let lastError: unknown = null;

  for (const client of CLIENTS) {
    try {
      const info = await yt.getBasicInfo(id, { client });
      const basic = info.basic_info;

      if (info.playability_status?.status === 'LOGIN_REQUIRED') {
        throw new ResolveError('El video tiene restricción de edad y no se puede descargar.');
      }
      if (info.playability_status?.status === 'UNPLAYABLE') {
        throw new ResolveError(
          info.playability_status.reason || 'El video no está disponible para reproducir.',
        );
      }

      const audio = pickAudioFormat(info, yt);
      if (!audio) {
        lastError = new Error(`El cliente ${client} no devolvió audio m4a`);
        continue;
      }

      return {
        id,
        title: basic.title?.trim() || 'Sin título',
        artist: cleanArtist(basic.author),
        duration: basic.duration ?? 0,
        thumbnailUrl: bestThumbnail(basic.thumbnail as any),
        streamUrl: audio.url,
        ext: 'm4a',
        approxBytes: audio.bytes,
      };
    } catch (err) {
      // Un fallo de disponibilidad es definitivo; no tiene sentido reintentar
      // con otro cliente porque el video simplemente no se puede bajar.
      if (err instanceof ResolveError) throw err;
      lastError = err;
    }
  }

  throw new ResolveError(
    'YouTube no entregó un stream de audio utilizable. Puede que hayan cambiado algo: ' +
      'actualiza youtubei.js y vuelve a compilar.',
    lastError,
  );
}

/**
 * Vuelve a pedir sólo la URL de stream. Las URLs de googlevideo caducan en
 * pocas horas, así que una descarga reanudada al día siguiente necesita una nueva.
 */
export async function refreshStreamUrl(id: string): Promise<string> {
  const resolved = await resolveTrack(id);
  return resolved.streamUrl;
}

/** Búsqueda por texto, para no depender de tener el link a mano. */
export async function searchTracks(query: string, limit = 20): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  let yt: Innertube;
  try {
    yt = await getInnertube();
  } catch (err) {
    resetInnertube();
    throw new ResolveError('No se pudo conectar con YouTube. Revisa tu conexión.', err);
  }

  try {
    const search = await yt.search(q, { type: 'video' });
    const out: SearchResult[] = [];

    for (const item of search.results ?? []) {
      const node = item as any;
      const id: string | undefined = node.id ?? node.video_id;
      if (!id || !/^[\w-]{11}$/.test(id)) continue;

      out.push({
        id,
        title: node.title?.text ?? node.title?.toString?.() ?? 'Sin título',
        artist: cleanArtist(node.author?.name),
        duration: node.duration?.seconds ?? 0,
        thumbnailUrl: bestThumbnail(node.thumbnails),
      });
      if (out.length >= limit) break;
    }

    return out;
  } catch (err) {
    throw new ResolveError('La búsqueda falló. Intenta de nuevo.', err);
  }
}
