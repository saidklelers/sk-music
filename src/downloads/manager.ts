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
 * Tamaño de trozo para la descarga.
 *
 * googlevideo no rechaza por *si* la petición lleva `Range`, sino por CUÁNTO
 * pide. Medido en dispositivo sobre el mismo video con tres minutos de
 * diferencia: `bytes=0-0` (un byte) devuelve 206, mientras que pedir el archivo
 * entero devuelve 403 tanto con rango abierto (`bytes=0-`) como acotado
 * (`bytes=0-<final>`) o sin rango. El diagnóstico sólo probaba un byte, así que
 * daba por buena una forma de pedir que la descarga real nunca usaba.
 *
 * Por eso yt-dlp descarga googlevideo por trozos, y por eso lo hacemos aquí.
 * 1 MiB es un compromiso: pocas peticiones y lejos del umbral que dispara el
 * rechazo.
 */
const CHUNK_SIZE = 1_048_576;

/** Si un trozo es rechazado se reintenta con la mitad, hasta este mínimo. */
const MIN_CHUNK_SIZE = 65_536;

/** Total real del archivo, leído de `Content-Range: bytes 0-1023/5400000`. */
function totalFromContentRange(header: string | null): number {
  const match = header?.match(/\/(\d+)\s*$/);
  return match ? Number(match[1]) : 0;
}

/** Pide un trozo concreto. Devuelve los bytes y el tamaño total del archivo. */
async function fetchChunk(
  url: string,
  headers: Record<string, string>,
  start: number,
  end: number,
): Promise<{ bytes: Uint8Array; total: number }> {
  const res = await fetch(url, {
    headers: { ...headers, Range: `bytes=${start}-${end}` },
  });

  // 206 es la respuesta correcta a un rango. Un 200 significa que el servidor
  // ignoró el rango y mandó el archivo entero, lo cual también sirve.
  if (res.status !== 206 && !res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    total: totalFromContentRange(res.headers.get('content-range')),
  };
}

/**
 * Descarga el audio pidiéndolo por trozos.
 *
 * Cada trozo va con su propio `Range` acotado, que es la forma que googlevideo
 * acepta. Si un trozo es rechazado se parte por la mitad y se reintenta: así el
 * tamaño se ajusta solo al umbral del servidor sin tener que adivinarlo, y de
 * paso el enlace se renueva por si el rechazo vino de que caducó.
 *
 * Los trozos se acumulan en memoria y se escriben de una vez al final. Un
 * archivo de audio típico ronda los 5 MB, así que el coste es asumible y evita
 * depender de escritura por anexado.
 */
async function downloadAudio(
  url: string,
  dest: File,
  sizeHint: number | null,
  onProgress: (ratio: number | null) => void,
  refreshUrl: () => Promise<string>,
): Promise<string> {
  const headers = { 'User-Agent': IOS_UA };
  const parts: Uint8Array[] = [];

  let current = url;
  let offset = 0;
  let total = sizeHint && sizeHint > 0 ? sizeHint : 0;
  let chunkSize = CHUNK_SIZE;
  let lastError = '';

  // Cota de seguridad: con trozos de 64 KiB esto cubre 128 MiB, muy por encima
  // de cualquier pista de audio. Evita un bucle infinito si el servidor
  // devolviera respuestas vacías indefinidamente.
  for (let request = 0; request < 2000; request++) {
    const end = total ? Math.min(offset + chunkSize, total) - 1 : offset + chunkSize - 1;

    try {
      const { bytes, total: reported } = await fetchChunk(current, headers, offset, end);

      if (bytes.byteLength === 0) break;
      if (!total && reported) total = reported;

      parts.push(bytes);
      offset += bytes.byteLength;
      onProgress(total ? Math.min(offset / total, 1) : null);

      if (total && offset >= total) break;
      // Sin total conocido, un trozo más corto de lo pedido significa el final.
      if (!total && bytes.byteLength < chunkSize) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'error';

      if (chunkSize <= MIN_CHUNK_SIZE) {
        throw new Error(
          `Rechazado en el byte ${offset} con trozos de ${Math.round(chunkSize / 1024)} KiB ` +
            `(${lastError}).`,
        );
      }

      // Trozo más pequeño y enlace nuevo antes de reintentar.
      chunkSize = Math.max(Math.floor(chunkSize / 2), MIN_CHUNK_SIZE);
      try {
        current = await refreshUrl();
      } catch {
        // Si no se puede renovar seguimos con la que ya teníamos.
      }
    }
  }

  if (!parts.length) throw new Error(`No se recibió ningún dato (${lastError || 'sin detalle'})`);

  const size = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const merged = new Uint8Array(size);
  let cursor = 0;
  for (const part of parts) {
    merged.set(part, cursor);
    cursor += part.byteLength;
  }

  if (dest.exists) dest.delete();
  dest.create({ intermediates: true });
  dest.write(merged);

  return `${parts.length} trozos de ${Math.round(chunkSize / 1024)} KiB`;
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
      this.patch(id, { progress: 0 });
      const winner = await downloadAudio(
        resolved.streamUrl,
        dest,
        resolved.approxBytes,
        (ratio) => {
          if (!this.cancelled.has(id)) this.patch(id, { progress: ratio });
        },
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
