import { File } from 'expo-file-system';

import type { Track } from '@/db';
import { refreshStreamUrl, resolveTrack, stageLabel, type ResolvedTrack } from '@/youtube/resolve';

import { artworkFile, ensureDirs, trackFile } from './storage';

export type JobStatus = 'resolving' | 'downloading' | 'done' | 'error' | 'cancelled';

export type DownloadJob = {
  /** ID del video; también sirve para evitar descargas duplicadas. */
  id: string;
  title: string;
  artist: string;
  thumbnailUrl: string | null;
  status: JobStatus;
  /** 0..1, o null mientras no se conozca el tamaño total. */
  progress: number | null;
  error: string | null;
  /**
   * Detalle de en qué punto de la resolución va. Se muestra en la UI para que
   * un fallo sea diagnosticable en vez de un "Resolviendo" eterno.
   */
  stage: string | null;
  /**
   * Estrategia de descarga que acabó funcionando. Se muestra al terminar para
   * saber cuál sirvió sin tener que conectar el teléfono a un depurador.
   */
  via: string | null;
};

type Listener = () => void;

/**
 * Cabecera de cliente iOS de YouTube. Las URLs de googlevideo obtenidas con el
 * cliente IOS a veces exigen que el User-Agent coincida, y a veces rechazan uno
 * que no reconocen. Como no se puede saber de antemano cuál es el caso, se
 * prueban ambas variantes.
 */
const IOS_UA =
  'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)';

/**
 * Cabecera imprescindible: sin ella googlevideo responde 403.
 *
 * Se descubrió comparando dos peticiones a la MISMA URL: la comprobación previa,
 * que pedía `bytes=0-0`, pasaba sin problema, mientras que la descarga real —que
 * pedía el archivo entero sin `Range`— recibía 403 por las dos vías, nativa y
 * por fetch. Es el comportamiento habitual de las URLs de formato adaptativo
 * cuando quien las pide no es un navegador: exigen una petición por rango.
 *
 * `bytes=0-` pide desde el primer byte hasta el final, así que se descarga el
 * archivo completo en una sola respuesta 206.
 */
const RANGE_HEADER = { Range: 'bytes=0-' };

/** Una forma concreta de pedir el archivo, con su etiqueta para el informe. */
type Strategy = { label: string; headers: Record<string, string> };

/**
 * Formas de pedir el audio, en orden de preferencia.
 *
 * Se probó en dispositivo que googlevideo acepta las cuatro combinaciones de
 * rango y User-Agent sobre una URL recién obtenida (200 y 206 respectivamente),
 * y aun así la descarga fallaba con 403. La diferencia estaba en que la
 * comprobación previa y la descarga hacían peticiones DISTINTAS, de modo que el
 * éxito de una no predecía nada sobre la otra.
 *
 * Se abandona esa separación: ahora se intenta la descarga de verdad con cada
 * forma, en orden, y se usa la primera que funcione. La primera de la lista es
 * exactamente la que el diagnóstico demostró que pasa.
 */
function strategies(sizeHint: number | null): Strategy[] {
  const list: Strategy[] = [{ label: 'rango abierto', headers: { ...RANGE_HEADER } }];

  // Algunas URLs rechazan el rango abierto pero aceptan uno acotado, que es
  // como descarga yt-dlp.
  if (sizeHint && sizeHint > 0) {
    list.push({ label: 'rango acotado', headers: { Range: `bytes=0-${sizeHint - 1}` } });
  }

  // Las peticiones sin rango van al final, y no primero como estaban. Medido en
  // dispositivo sobre un video real: con rango responde 206, sin rango responde
  // 403. El video de referencia aceptaba las cuatro formas, y eso fue lo que
  // hizo descartar la pista correcta durante varias rondas.
  list.push(
    { label: 'sin rango + UA', headers: { 'User-Agent': IOS_UA } },
    { label: 'sin rango', headers: {} },
  );
  return list;
}

/**
 * Descarga de respaldo, escribiendo los bytes desde JavaScript.
 *
 * El descargador nativo usa OkHttp, con cabeceras por defecto distintas a las
 * del `fetch` de React Native, así que puede ser rechazado por googlevideo
 * aunque la comprobación previa haya pasado — que es justo el punto ciego de
 * `preflight`. Esta vía usa exactamente el mismo cliente HTTP que sí funcionó.
 *
 * A cambio se pierde el progreso granular (`arrayBuffer()` es todo o nada) y el
 * archivo pasa entero por memoria. Para pistas de audio de unos pocos MB es
 * perfectamente asumible; por eso es el respaldo y no la vía principal.
 */
async function downloadViaFetch(
  url: string,
  headers: Record<string, string>,
  dest: File,
): Promise<number> {
  const res = await fetch(url, { headers });
  // 206 (contenido parcial) es la respuesta esperada a una petición por rango.
  if (!res.ok && res.status !== 206) {
    throw new Error(`HTTP ${res.status}`);
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength === 0) throw new Error('archivo vacío');

  if (dest.exists) dest.delete();
  dest.create({ intermediates: true });
  dest.write(new Uint8Array(buffer));
  return buffer.byteLength;
}

/**
 * Descarga el audio probando cada estrategia hasta que una funcione.
 *
 * Devuelve la etiqueta de la que sirvió, para poder saber cuál fue sin tener que
 * conectar el teléfono a un depurador. Si fallan todas, el error enumera qué
 * respondió cada una: es la única forma de distinguir "YouTube rechaza todo" de
 * "YouTube rechaza esta forma concreta de pedirlo".
 */
async function downloadAudio(
  url: string,
  dest: File,
  sizeHint: number | null,
  onAttempt: (label: string) => void,
  refreshUrl: () => Promise<string>,
): Promise<string> {
  const failures: string[] = [];
  let current = url;

  const list = strategies(sizeHint);

  for (let i = 0; i < list.length; i++) {
    const { label, headers } = list[i];

    // Tras un rechazo se pide una URL nueva antes de volver a intentar.
    // googlevideo invalida la URL después de rechazarla, así que reutilizarla
    // hace que los intentos siguientes fallen aunque su forma fuese correcta
    // — que es exactamente lo que enmascaró el problema en la ronda anterior.
    if (i > 0) {
      onAttempt('renovando enlace');
      try {
        current = await refreshUrl();
      } catch {
        // Si no se puede renovar, se prueba igual con la que ya se tenía.
      }
    }

    onAttempt(label);
    try {
      await downloadViaFetch(current, headers, dest);
      return label;
    } catch (err) {
      failures.push(`${label}: ${err instanceof Error ? err.message : 'error'}`);
    }
  }

  throw new Error(`Ninguna vía funcionó — ${failures.join(' · ')}`);
}

/**
 * Cola de descargas.
 *
 * Es un singleton fuera de React: las descargas tienen que sobrevivir a que se
 * desmonte la pantalla que las inició. Los componentes se suscriben con
 * `subscribe()` y reciben una copia del estado en cada cambio.
 *
 * Se descarga de a una. En móvil, varias descargas en paralelo sobre la misma
 * conexión no van más rápido y sí hacen el progreso menos legible.
 */
class DownloadManager {
  private jobs = new Map<string, DownloadJob>();
  private listeners = new Set<Listener>();
  private queue: string[] = [];
  private running = false;
  private cancelled = new Set<string>();
  private pendingResolved = new Map<string, ResolvedTrack>();

  /** Se inyecta desde el proveedor de React para persistir al terminar. */
  onComplete: ((track: Track) => Promise<void>) | null = null;

  /**
   * Instantánea inmutable cacheada.
   *
   * `useSyncExternalStore` compara la referencia devuelta por getSnapshot en
   * cada render: si construyéramos un array nuevo cada vez, React entraría en
   * un bucle infinito de re-renders. Sólo se regenera dentro de `emit()`.
   */
  private cachedSnapshot: DownloadJob[] = [];

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): DownloadJob[] => this.cachedSnapshot;

  private emit() {
    this.cachedSnapshot = Array.from(this.jobs.values());
    this.listeners.forEach((l) => l());
  }

  private patch(id: string, changes: Partial<DownloadJob>) {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.set(id, { ...job, ...changes });
    this.emit();
  }

  isActive(id: string): boolean {
    const s = this.jobs.get(id)?.status;
    return s === 'resolving' || s === 'downloading';
  }

  /**
   * Encola una descarga. Si ya hay una activa para ese video, no hace nada.
   * `seed` permite pintar título y carátula de inmediato cuando vienen de una
   * búsqueda, en vez de esperar a que resuelva.
   */
  enqueue(idOrUrl: string, seed?: Partial<DownloadJob> & { id: string }) {
    const id = seed?.id ?? idOrUrl;
    if (this.isActive(id)) return;

    this.cancelled.delete(id);
    this.jobs.set(id, {
      id,
      title: seed?.title ?? 'Resolviendo…',
      artist: seed?.artist ?? '',
      thumbnailUrl: seed?.thumbnailUrl ?? null,
      status: 'resolving',
      progress: null,
      error: null,
      stage: null,
      via: null,
      // `idOrUrl` se conserva aparte porque puede ser una URL completa.
    });
    this.pendingInput.set(id, idOrUrl);
    this.queue.push(id);
    this.emit();
    void this.pump();
  }

  private pendingInput = new Map<string, string>();

  cancel(id: string) {
    this.cancelled.add(id);
    this.queue = this.queue.filter((q) => q !== id);
    if (this.jobs.has(id)) this.patch(id, { status: 'cancelled' });
  }

  /** Quita una tarjeta ya terminada de la lista. */
  dismiss(id: string) {
    this.jobs.delete(id);
    this.pendingInput.delete(id);
    this.pendingResolved.delete(id);
    this.emit();
  }

  clearFinished() {
    for (const [id, job] of this.jobs) {
      if (job.status !== 'resolving' && job.status !== 'downloading') {
        this.jobs.delete(id);
        this.pendingInput.delete(id);
      }
    }
    this.emit();
  }

  retry(id: string) {
    const input = this.pendingInput.get(id) ?? id;
    this.jobs.delete(id);
    this.enqueue(input);
  }

  private async pump() {
    if (this.running) return;
    this.running = true;

    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        if (this.cancelled.has(id)) continue;
        await this.run(id);
      }
    } finally {
      this.running = false;
    }
  }

  private async run(id: string) {
    const input = this.pendingInput.get(id) ?? id;

    try {
      ensureDirs();

      /* 1. Resolver metadatos + URL de stream. */
      this.patch(id, { status: 'resolving', progress: null, stage: null });
      const resolved = await resolveTrack(input, (stage) =>
        this.patch(id, { stage: stageLabel(stage) }),
      );
      if (this.cancelled.has(id)) return;

      this.patch(id, {
        title: resolved.title,
        artist: resolved.artist,
        thumbnailUrl: resolved.thumbnailUrl,
        status: 'downloading',
        progress: 0,
        stage: null,
      });

      /* 2. Bajar el audio con progreso. */
      const fileName = `${resolved.id}.${resolved.ext}`;
      const dest = trackFile(fileName);
      if (dest.exists) dest.delete(); // reintento limpio

      // Se descarga con `fetch`, no con el descargador nativo, porque es el
      // cliente HTTP que el diagnóstico demostró que googlevideo acepta y
      // porque permite controlar las cabeceras exactas de cada intento. El
      // precio es perder el progreso granular: `arrayBuffer()` es todo o nada,
      // así que la barra queda indeterminada.
      this.patch(id, { progress: null });
      const winner = await downloadAudio(
        resolved.streamUrl,
        dest,
        resolved.approxBytes,
        (label) => this.patch(id, { stage: `Descargando (${label})…` }),
        () => refreshStreamUrl(resolved.id),
      );
      this.patch(id, { stage: null, progress: 1, via: winner });

      if (this.cancelled.has(id)) {
        if (dest.exists) dest.delete();
        return;
      }
      if (!dest.exists || (dest.size ?? 0) === 0) {
        throw new Error('El archivo descargado quedó vacío.');
      }

      /* 3. Carátula. Si falla, la canción sigue siendo válida. */
      let artworkName: string | null = null;
      if (resolved.thumbnailUrl) {
        try {
          const artFile = artworkFile(`${resolved.id}.jpg`);
          if (artFile.exists) artFile.delete();
          await File.downloadFileAsync(resolved.thumbnailUrl, artFile);
          if (artFile.exists) artworkName = artFile.name;
        } catch {
          artworkName = null;
        }
      }

      /* 4. Persistir. */
      const track: Track = {
        id: resolved.id,
        title: resolved.title,
        artist: resolved.artist,
        duration: resolved.duration,
        file_name: fileName,
        artwork_name: artworkName,
        size: dest.size ?? 0,
        added_at: Date.now(),
      };
      await this.onComplete?.(track);

      this.patch(id, { status: 'done', progress: 1, error: null });
    } catch (err) {
      if (this.cancelled.has(id)) return;
      const message =
        err instanceof Error ? err.message : 'Algo salió mal durante la descarga.';
      this.patch(id, { status: 'error', error: message, progress: null });
    }
  }
}

export const downloads = new DownloadManager();
