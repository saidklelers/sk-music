import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import * as db from '@/db';
import type { Playlist, Track } from '@/db';
import { downloads, type DownloadJob } from '@/downloads/manager';
import { deleteTrackFiles, ensureDirs } from '@/downloads/storage';
import { usePlayer } from '@/player/PlayerProvider';

type LibraryContextValue = {
  tracks: Track[];
  playlists: Playlist[];
  jobs: DownloadJob[];
  loading: boolean;
  /** IDs ya en biblioteca, para marcar resultados de búsqueda. */
  downloadedIds: Set<string>;

  refresh: () => Promise<void>;
  removeTrack: (track: Track) => Promise<void>;
  rename: (id: string, title: string, artist: string) => Promise<void>;

  newPlaylist: (name: string) => Promise<number>;
  removePlaylist: (id: number) => Promise<void>;
  addTrackToPlaylist: (playlistId: number, trackId: string) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: number, trackId: string) => Promise<void>;
  tracksOfPlaylist: (playlistId: number) => Promise<Track[]>;
  playlistsWithTrack: (trackId: string) => Promise<number[]>;

  librarySize: number;
};

const LibraryContext = createContext<LibraryContextValue | null>(null);

/**
 * Fuente de verdad de la biblioteca.
 *
 * Mantiene en memoria la lista completa de canciones (son cientos como mucho,
 * no vale la pena paginar) y es quien conecta el gestor de descargas con
 * SQLite: cuando una descarga termina, aquí se inserta y se refresca la vista.
 */
export function LibraryProvider({ children }: { children: ReactNode }) {
  const database = useSQLiteContext();
  const { removeFromQueue } = usePlayer();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [librarySize, setLibrarySize] = useState(0);
  const [loading, setLoading] = useState(true);

  // El gestor de descargas es un store externo a React: useSyncExternalStore es
  // la vía correcta para leerlo, y evita el setState sincrónico dentro de un
  // efecto que provocaba una suscripción manual.
  const jobs = useSyncExternalStore(downloads.subscribe, downloads.getSnapshot);

  const refresh = useCallback(async () => {
    const [t, p, size] = await Promise.all([
      db.listTracks(database),
      db.listPlaylists(database),
      db.totalLibrarySize(database),
    ]);
    setTracks(t);
    setPlaylists(p);
    setLibrarySize(size);
    setLoading(false);
  }, [database]);

  /**
   * Carga inicial.
   *
   * No llama a `refresh()` directamente: aunque sea async, la regla de hooks
   * marca cualquier ruta que lleve a setState desde el cuerpo de un efecto.
   * Encadenando el `.then` el estado se fija en un callback, y el flag
   * `cancelled` evita escribir si el proveedor se desmonta antes.
   */
  useEffect(() => {
    ensureDirs();
    let cancelled = false;

    Promise.all([
      db.listTracks(database),
      db.listPlaylists(database),
      db.totalLibrarySize(database),
    ])
      .then(([t, p, size]) => {
        if (cancelled) return;
        setTracks(t);
        setPlaylists(p);
        setLibrarySize(size);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [database]);

  /* El gestor de descargas vive fuera de React; aquí le damos el callback de
     persistencia y escuchamos su estado. */
  useEffect(() => {
    downloads.onComplete = async (track) => {
      await db.insertTrack(database, track);
      await refresh();
    };
    return () => {
      downloads.onComplete = null;
    };
  }, [database, refresh]);

  const downloadedIds = useMemo(() => new Set(tracks.map((t) => t.id)), [tracks]);

  const removeTrack = useCallback(
    async (track: Track) => {
      removeFromQueue(track.id);
      await db.deleteTrack(database, track.id);
      deleteTrackFiles(track.file_name, track.artwork_name);
      await refresh();
    },
    [database, refresh, removeFromQueue],
  );

  const rename = useCallback(
    async (id: string, title: string, artist: string) => {
      await db.renameTrack(database, id, title.trim() || 'Sin título', artist.trim() || 'Desconocido');
      await refresh();
    },
    [database, refresh],
  );

  const newPlaylist = useCallback(
    async (name: string) => {
      const id = await db.createPlaylist(database, name);
      await refresh();
      return id;
    },
    [database, refresh],
  );

  const removePlaylist = useCallback(
    async (id: number) => {
      await db.deletePlaylist(database, id);
      await refresh();
    },
    [database, refresh],
  );

  const addTrackToPlaylist = useCallback(
    async (playlistId: number, trackId: string) => {
      await db.addToPlaylist(database, playlistId, trackId);
      await refresh();
    },
    [database, refresh],
  );

  const removeTrackFromPlaylist = useCallback(
    async (playlistId: number, trackId: string) => {
      await db.removeFromPlaylist(database, playlistId, trackId);
      await refresh();
    },
    [database, refresh],
  );

  const tracksOfPlaylist = useCallback(
    (playlistId: number) => db.playlistTracks(database, playlistId),
    [database],
  );

  const playlistsWithTrack = useCallback(
    async (trackId: string) => {
      const rows = await db.playlistsContaining(database, trackId);
      return rows.map((r) => r.playlist_id);
    },
    [database],
  );

  const value = useMemo<LibraryContextValue>(
    () => ({
      tracks,
      playlists,
      jobs,
      loading,
      downloadedIds,
      librarySize,
      refresh,
      removeTrack,
      rename,
      newPlaylist,
      removePlaylist,
      addTrackToPlaylist,
      removeTrackFromPlaylist,
      tracksOfPlaylist,
      playlistsWithTrack,
    }),
    [
      tracks, playlists, jobs, loading, downloadedIds, librarySize, refresh,
      removeTrack, rename, newPlaylist, removePlaylist, addTrackToPlaylist,
      removeTrackFromPlaylist, tracksOfPlaylist, playlistsWithTrack,
    ],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary debe usarse dentro de <LibraryProvider>');
  return ctx;
}
