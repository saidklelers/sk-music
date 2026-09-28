import { File } from 'expo-file-system';

import type { Track } from '@/db';
import { refreshStreamUrl, resolveTrack, stageLabel } from '@/youtube/resolve';
import { parseVideoId } from '@/youtube/videoId';

import { downloadChunked, type ChunkedDownloadResult } from './chunked';
import { artworkFile, ensureDirs, partialFile, trackFile } from './storage';

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
 * cliente IOS a veces exigen que el User-Agent coincida.
 */
const IOS_UA =
  'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)';

const isRunning = (status: JobStatus | undefined) =>
  status === 'resolving' || status === 'downloading';

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
  /** Lo que el usuario pegó (link o ID), para resolver y para reintentar. */
  private inputs = new Map<string, string>();
  /**
   * Un controlador por ejecución. Cancelar lo aborta, y eso corta la petición
   * en vuelo: antes sólo se marcaba la tarjeta y la descarga seguía bajando
   * todos los trozos hasta el final antes de enterarse.
   */
  private controllers = new Map<string, AbortController>();

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
    return isRunning(this.jobs.get(id)?.status);
  }

  /** IDs de las descargas en curso, para no tratar sus archivos como basura. */
  activeIds(): string[] {
    return this.cachedSnapshot.filter((j) => isRunning(j.status)).map((j) => j.id);
  }

  /**
   * Encola una descarga. Si ya hay una activa para ese video, no hace nada.
   * `seed` permite pintar título y carátula de inmediato cuando vienen de una
   * búsqueda, en vez de esperar a que resuelva.
   *
   * La tarjeta se indexa SIEMPRE por el ID del video, también cuando se pega un
   * link: indexarla por la URL rompía la detección de duplicados (el mismo
   * video pegado con dos links distintos, o pegado y luego buscado).
   */
  enqueue(idOrUrl: string, seed?: Partial<DownloadJob> & { id: string }) {
    const id = seed?.id ?? parseVideoId(idOrUrl) ?? idOrUrl;
    if (this.isActive(id)) return;

    this.controllers.get(id)?.abort();
    this.controllers.set(id, new AbortController());
    this.inputs.set(id, idOrUrl);

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
    });
    this.queue.push(id);
    this.emit();
    void this.pump();
  }

  cancel(id: string) {
    this.controllers.get(id)?.abort();
    this.queue = this.queue.filter((q) => q !== id);
    if (this.isActive(id)) this.patch(id, { status: 'cancelled', stage: null });
  }

  /** Quita una tarjeta ya terminada de la lista. */
  dismiss(id: string) {
    if (this.isActive(id)) return;
    this.forget(id);
    this.emit();
  }

  clearFinished() {
    for (const [id, job] of this.jobs) {
      if (!isRunning(job.status)) this.forget(id);
    }
    this.emit();
  }

  private forget(id: string) {
    this.jobs.delete(id);
    this.inputs.delete(id);
    this.controllers.delete(id);
  }

  /** Vuelve a intentar conservando lo que ya se sabía del video. */
  retry(id: string) {
    const job = this.jobs.get(id);
    if (!job || isRunning(job.status)) return;
    const input = this.inputs.get(id) ?? id;
    this.enqueue(input, {
      id,
      title: job.title,
      artist: job.artist,
      thumbnailUrl: job.thumbnailUrl,
    });
  }

  private async pump() {
    if (this.running) return;
    this.running = true;

    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        const controller = this.controllers.get(id);
        if (!controller || controller.signal.aborted) continue;
        await this.run(id, controller.signal);
      }
    } finally {
      this.running = false;
    }
  }

  private async run(id: string, signal: AbortSignal) {
    const input = this.inputs.get(id) ?? id;
    // Toda actualización pasa por aquí: si el usuario canceló (o volvió a
    // encolar el mismo video), esta ejecución ya no es dueña de la tarjeta.
    const update = (changes: Partial<DownloadJob>) => {
      if (!signal.aborted) this.patch(id, changes);
    };

    let part: File | null = null;

    try {
      ensureDirs();

      /* 1. Resolver metadatos + URL de stream. */
      update({ status: 'resolving', progress: null, stage: null });
      const resolved = await resolveTrack(input, (stage) => update({ stage: stageLabel(stage) }));
      if (signal.aborted) return;

      update({
        title: resolved.title,
        artist: resolved.artist,
        thumbnailUrl: resolved.thumbnailUrl,
        status: 'downloading',
        progress: 0,
        stage: null,
      });

      /*
       * 2. Bajar el audio a un archivo temporal, trozo a trozo.
       *
       * Se usa `fetch` y no el descargador nativo porque es el cliente HTTP que
       * el diagnóstico demostró que googlevideo acepta y porque permite
       * controlar las cabeceras exactas de cada intento. Cada trozo se escribe
       * en disco al llegar: acumularlo todo en memoria era viable para una
       * canción de 5 MB, no para una sesión de una hora.
       */
      const fileName = `${resolved.id}.${resolved.ext}`;
      part = partialFile(fileName);
      if (part.exists) part.delete();
      part.create({ intermediates: true });

      const handle = part.open();
      let result: ChunkedDownloadResult;
      try {
        result = await downloadChunked({
          url: resolved.streamUrl,
          sizeHint: resolved.approxBytes,
          sink: { write: (bytes) => handle.writeBytes(bytes) },
          refreshUrl: () => refreshStreamUrl(resolved.id),
          onProgress: (ratio) => update({ progress: ratio }),
          headers: { 'User-Agent': IOS_UA },
          signal,
        });
      } finally {
        handle.close();
      }
      if (signal.aborted) return;

      const written = part.size ?? 0;
      if (written !== result.bytes || written === 0) {
        throw new Error(
          `El archivo en disco no cuadra con lo descargado (${written} de ${result.bytes} bytes).`,
        );
      }

      // Sólo ahora, completo y verificado, toma el nombre definitivo.
      const dest = trackFile(fileName);
      if (dest.exists) dest.delete();
      part.rename(fileName);
      part = null;

      const kib = Math.round(result.chunkSize / 1024);
      update({
        progress: 1,
        via: `${result.chunks} ${result.chunks === 1 ? 'trozo' : 'trozos'} de ${kib} KiB`,
      });

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
      if (signal.aborted) return;

      /* 4. Persistir. */
      const track: Track = {
        id: resolved.id,
        title: resolved.title,
        artist: resolved.artist,
        duration: resolved.duration,
        file_name: fileName,
        artwork_name: artworkName,
        size: trackFile(fileName).size ?? 0,
        added_at: Date.now(),
      };
      await this.onComplete?.(track);

      update({ status: 'done', progress: 1, error: null });
    } catch (err) {
      if (signal.aborted) return;
      const message =
        err instanceof Error ? err.message : 'Algo salió mal durante la descarga.';
      update({ status: 'error', error: message, progress: null, stage: null });
    } finally {
      // Una descarga cancelada o fallida no deja restos en disco.
      if (part?.exists) {
        try {
          part.delete();
        } catch {
          // Si no se puede borrar ahora, "Limpiar archivos sueltos" lo hará.
        }
      }
    }
  }
}

export const downloads = new DownloadManager();
