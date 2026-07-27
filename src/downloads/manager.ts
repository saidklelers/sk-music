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

      const task = File.createDownloadTask(resolved.streamUrl, dest, {
        // En iOS esto usa URLSessionConfiguration.background: la descarga
        // sobrevive a que la app pase a segundo plano e incluso a que se cierre.
        // En Android el módulo hace una llamada OkHttp dentro del proceso, así
        // que sigue mientras el sistema no lo mate — ver README.
        sessionType: 'background',
        headers: {
          // googlevideo responde 403 a peticiones sin UA reconocible.
          'User-Agent':
            'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)',
        },
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (this.cancelled.has(id)) {
            task.cancel();
            return;
          }
          const total = totalBytes || resolved.approxBytes || 0;
          this.patch(id, { progress: total > 0 ? Math.min(bytesWritten / total, 1) : null });
        },
      });

      await task.downloadAsync();

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
