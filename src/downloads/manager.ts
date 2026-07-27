import { File } from 'expo-file-system';

import type { Track } from '@/db';
import { resolveTrack, stageLabel, type ResolvedTrack } from '@/youtube/resolve';

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

type Preflight = { headers: Record<string, string>; status: number };

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
): Promise<void> {
  const res = await fetch(url, { headers: { ...headers, ...RANGE_HEADER } });
  // 206 (contenido parcial) es la respuesta esperada a una petición por rango.
  if (!res.ok && res.status !== 206) {
    throw new Error(`el servidor respondió HTTP ${res.status}`);
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength === 0) throw new Error('el servidor devolvió un archivo vacío');

  if (!dest.exists) dest.create({ intermediates: true });
  dest.write(new Uint8Array(buffer));
}

/**
 * Comprueba que googlevideo acepte la URL antes de dársela al descargador
 * nativo.
 *
 * Existe por dos razones. La primera es diagnóstica: el módulo nativo envuelve
 * el fallo en "Unable to download a file: HTTP 403" y ese texto llega recortado
 * a la interfaz, así que el dato decisivo —el código de estado— se perdía.
 * La segunda es que permite corregir sobre la marcha: si el User-Agent de iOS
 * es rechazado, se reintenta sin él y se usa la variante que sí pasó.
 *
 * Se pide un solo byte con Range, así que cuesta prácticamente nada.
 */
async function preflight(url: string): Promise<Preflight> {
  const variants: Record<string, string>[] = [{ 'User-Agent': IOS_UA }, {}];
  let lastStatus = 0;

  for (const headers of variants) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { ...headers, Range: 'bytes=0-0' },
      });
      // 206 es lo esperado con Range; 200 significa que lo ignoró y sirve igual.
      if (res.ok || res.status === 206) return { headers, status: res.status };
      lastStatus = res.status;
    } catch {
      lastStatus = -1;
    }
  }

  throw new Error(
    lastStatus === -1
      ? 'No se pudo contactar el servidor de audio de YouTube.'
      : `El servidor de audio rechazó la descarga (HTTP ${lastStatus}). ` +
        'La URL caducó o YouTube la bloqueó; toca reintentar.',
  );
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

      // Comprueba la URL y averigua qué cabeceras acepta antes de entregarla al
      // descargador nativo, cuyo error llega envuelto y recortado.
      this.patch(id, { stage: 'Comprobando el enlace…' });
      const { headers } = await preflight(resolved.streamUrl);
      if (this.cancelled.has(id)) return;
      this.patch(id, { stage: null });

      const task = File.createDownloadTask(resolved.streamUrl, dest, {
        // Sólo tiene efecto en iOS, donde usa URLSessionConfiguration.background
        // y la descarga sobrevive incluso al cierre de la app. En Android el
        // módulo ignora este campo y hace una llamada OkHttp dentro del proceso.
        sessionType: 'background',
        headers: { ...headers, ...RANGE_HEADER },
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (this.cancelled.has(id)) {
            task.cancel();
            return;
          }
          const total = totalBytes || resolved.approxBytes || 0;
          this.patch(id, { progress: total > 0 ? Math.min(bytesWritten / total, 1) : null });
        },
      });

      try {
        await task.downloadAsync();
      } catch (nativeErr) {
        if (this.cancelled.has(id)) return;

        // El descargador nativo falló pero la comprobación previa había pasado,
        // así que la URL sirve y el problema está en cómo pide OkHttp. Se repite
        // con el cliente HTTP de JS, que es el que ya demostró funcionar.
        this.patch(id, { stage: 'Reintentando por otra vía…', progress: null });
        try {
          await downloadViaFetch(resolved.streamUrl, headers, dest);
        } catch (fetchErr) {
          const native = nativeErr instanceof Error ? nativeErr.message : 'error nativo';
          const viaFetch = fetchErr instanceof Error ? fetchErr.message : 'error';
          throw new Error(`Descarga nativa: ${native} — Reintento directo: ${viaFetch}`);
        }
        this.patch(id, { stage: null });
      }

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
