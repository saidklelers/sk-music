import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { getPref, setPref, type Track } from '@/db';
import { artworkUri, trackUri } from '@/downloads/storage';

import { buildOrder, findPlayable, removeFromOrder, step, toggleShuffleOrder } from './queue';

export type RepeatMode = 'off' | 'all' | 'one';

type PlayerContextValue = {
  current: Track | null;
  queue: Track[];
  isPlaying: boolean;
  isBuffering: boolean;
  /** Segundos transcurridos. */
  position: number;
  /** Duración real del archivo; cae a la guardada en BD mientras carga. */
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  hasNext: boolean;
  hasPrev: boolean;

  /**
   * Reproduce `tracks` desde `startIndex`. `options.shuffle` fuerza el modo
   * aleatorio (y lo deja fijado); sin él se respeta el que haya.
   */
  play: (tracks: Track[], startIndex?: number, options?: { shuffle?: boolean }) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (seconds: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  stop: () => void;
  /** Saca una canción de la cola si se borró de la biblioteca. */
  removeFromQueue: (trackId: string) => void;
  /** Actualiza título/artista de una canción que esté en la cola. */
  updateInQueue: (track: Track) => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

const REPEAT_MODES: RepeatMode[] = ['off', 'all', 'one'];

/** ¿Sigue en disco el archivo de esta canción? */
const onDisk = (track: Track | undefined) => !!track && !!trackUri(track.file_name);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const database = useSQLiteContext();
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);

  const [queue, setQueue] = useState<Track[]>([]);
  /** Orden de reproducción: índices sobre `queue`. Cambia al activar aleatorio. */
  const [order, setOrder] = useState<number[]>([]);
  const [pos, setPos] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');

  const current = useMemo(() => {
    const idx = order[pos];
    return idx == null ? null : (queue[idx] ?? null);
  }, [queue, order, pos]);

  /* Sesión de audio: sonar con el switch en silencio y seguir en segundo plano. */
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => {
      // Si falla, la reproducción en primer plano sigue funcionando.
    });
  }, []);

  /* Aleatorio y repetición se recuerdan entre sesiones. */
  useEffect(() => {
    let cancelled = false;
    Promise.all([getPref(database, 'player.shuffle'), getPref(database, 'player.repeat')])
      .then(([savedShuffle, savedRepeat]) => {
        if (cancelled) return;
        if (savedShuffle != null) setShuffle(savedShuffle === '1');
        if (REPEAT_MODES.includes(savedRepeat as RepeatMode)) setRepeat(savedRepeat as RepeatMode);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [database]);

  const saveShuffle = useCallback(
    (on: boolean) => {
      setShuffle(on);
      setPref(database, 'player.shuffle', on ? '1' : '0').catch(() => {});
    },
    [database],
  );

  /**
   * Carga la pista actual en el reproductor.
   *
   * Se compara contra `loadedIdRef` para no recargar (y reiniciar) el audio en
   * cada render: sólo cuando cambia realmente la canción.
   */
  const loadedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!current) {
      if (loadedIdRef.current !== null) {
        loadedIdRef.current = null;
        player.pause();
        player.clearLockScreenControls();
      }
      return;
    }
    if (loadedIdRef.current === current.id) return;

    // play/next/prev ya filtran las pistas sin archivo, así que esto sólo salta
    // si el archivo desaparece justo entre la selección y la carga.
    const uri = trackUri(current.file_name);
    if (!uri) return;

    loadedIdRef.current = current.id;
    player.replace({ uri });
    player.play();

    player.setActiveForLockScreen(
      true,
      {
        title: current.title,
        artist: current.artist,
        artworkUrl: artworkUri(current.artwork_name) ?? undefined,
      },
      { showSeekBackward: true, showSeekForward: true, isLiveStream: false },
    );
  }, [current, player]);

  /* Metadata de pantalla bloqueada cuando se renombra la canción sonando. */
  useEffect(() => {
    if (!current || loadedIdRef.current !== current.id) return;
    player.updateLockScreenMetadata({ title: current.title, artist: current.artist });
  }, [current, player]);

  /** Vuelve a empezar la canción cargada. */
  const restart = useCallback(() => {
    player.seekTo(0);
    player.play();
  }, [player]);

  /**
   * Salta a la siguiente/anterior canción reproducible.
   *
   * Si el salto cae en la misma posición (una cola de una sola canción con
   * "repetir todo"), cambiar `pos` no cambiaría nada y el audio se quedaría
   * parado al final: hay que reiniciarla a mano.
   *
   * Devuelve false si no había adónde ir.
   */
  const skip = useCallback(
    (direction: 1 | -1): boolean => {
      const target = step(order.length, pos, direction, repeat === 'all', (p) =>
        onDisk(queue[order[p]]),
      );
      if (target === null) return false;
      if (target === pos) restart();
      else setPos(target);
      return true;
    },
    [queue, order, pos, repeat, restart],
  );

  /**
   * Avance automático al terminar.
   *
   * Va por `addListener` y no por un efecto sobre `status.didJustFinish`: el
   * reproductor es un sistema externo, y reaccionar a él desde un callback de
   * suscripción es el patrón correcto.
   *
   * Se suscribe UNA vez y lee el estado vigente por ref. Resuscribirse en cada
   * cambio de canción reiniciaba el `handled` que evita el doble salto
   * —didJustFinish sigue en true durante varias actualizaciones de status—
   * justo en el momento en que más falta hacía.
   */
  const onFinishRef = useRef<() => void>(() => {});
  useEffect(() => {
    onFinishRef.current = () => {
      if (repeat === 'one') {
        restart();
        return;
      }
      if (!skip(1)) {
        // Fin de la cola: queda la última canción cargada y en pausa al inicio.
        player.pause();
        player.seekTo(0);
      }
    };
  }, [repeat, restart, skip, player]);

  useEffect(() => {
    let handled = false;
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (!s.didJustFinish) {
        handled = false;
        return;
      }
      if (handled) return;
      handled = true;
      onFinishRef.current();
    });
    return () => sub.remove();
  }, [player]);

  const play = useCallback(
    (tracks: Track[], startIndex = 0, options?: { shuffle?: boolean }) => {
      if (!tracks.length) return;
      const useShuffle = options?.shuffle ?? shuffle;
      if (useShuffle !== shuffle) saveShuffle(useShuffle);

      const built = buildOrder(tracks.length, startIndex, useShuffle);
      const startPos =
        findPlayable(built.order.length, built.pos, 1, (p) => onDisk(tracks[built.order[p]])) ??
        built.pos;

      setQueue(tracks);
      setOrder(built.order);
      setPos(startPos);

      // Tocar la canción que ya está cargada no cambia `current`, así que el
      // efecto de carga no hace nada: si estaba en pausa (o terminada) hay que
      // reanudarla aquí, o el toque no produce ningún sonido.
      const chosen = tracks[built.order[startPos]];
      if (chosen && chosen.id === loadedIdRef.current && !status.playing) {
        if (status.duration > 0 && status.currentTime >= status.duration - 0.5) player.seekTo(0);
        player.play();
      }
    },
    [shuffle, saveShuffle, status.playing, status.currentTime, status.duration, player],
  );

  const toggle = useCallback(() => {
    if (!current) return;
    if (status.playing) player.pause();
    else player.play();
  }, [current, status.playing, player]);

  const next = useCallback(() => {
    skip(1);
  }, [skip]);

  /** Antes de 4 s vuelve al inicio de la canción; después salta a la anterior. */
  const prev = useCallback(() => {
    if (status.currentTime > 4 || !skip(-1)) player.seekTo(0);
  }, [status.currentTime, player, skip]);

  const seekTo = useCallback(
    (seconds: number) => {
      player.seekTo(Math.max(0, seconds));
    },
    [player],
  );

  const toggleShuffle = useCallback(() => {
    const turningOn = !shuffle;
    saveShuffle(turningOn);
    if (!order.length) return;
    const reordered = toggleShuffleOrder(order, pos, turningOn);
    setOrder(reordered.order);
    setPos(reordered.pos);
  }, [shuffle, saveShuffle, order, pos]);

  const cycleRepeat = useCallback(() => {
    const nextMode = REPEAT_MODES[(REPEAT_MODES.indexOf(repeat) + 1) % REPEAT_MODES.length];
    setRepeat(nextMode);
    setPref(database, 'player.repeat', nextMode).catch(() => {});
  }, [repeat, database]);

  const stop = useCallback(() => {
    player.pause();
    player.clearLockScreenControls();
    loadedIdRef.current = null;
    setQueue([]);
    setOrder([]);
    setPos(0);
  }, [player]);

  const removeFromQueue = useCallback(
    (trackId: string) => {
      const removedIdx = queue.findIndex((t) => t.id === trackId);
      if (removedIdx === -1) return;

      const reordered = removeFromOrder(order, pos, removedIdx);
      setQueue(queue.filter((t) => t.id !== trackId));
      setOrder(reordered.order);
      setPos(reordered.pos);
    },
    [queue, order, pos],
  );

  /**
   * Refleja en la cola un cambio de título/artista, para que el mini
   * reproductor y la pantalla bloqueada no sigan mostrando el nombre viejo.
   */
  const updateInQueue = useCallback((track: Track) => {
    setQueue((q) =>
      q.some((t) => t.id === track.id) ? q.map((t) => (t.id === track.id ? track : t)) : q,
    );
  }, []);

  const value = useMemo<PlayerContextValue>(
    () => ({
      current,
      queue,
      isPlaying: status.playing,
      isBuffering: status.isBuffering,
      position: status.currentTime ?? 0,
      duration: status.duration || current?.duration || 0,
      shuffle,
      repeat,
      hasNext: pos + 1 < order.length || (repeat === 'all' && order.length > 0),
      hasPrev: pos > 0 || (repeat === 'all' && order.length > 1),
      play,
      toggle,
      next,
      prev,
      seekTo,
      toggleShuffle,
      cycleRepeat,
      stop,
      removeFromQueue,
      updateInQueue,
    }),
    [
      current, queue, status.playing, status.isBuffering, status.currentTime, status.duration,
      shuffle, repeat, pos, order.length,
      play, toggle, next, prev, seekTo, toggleShuffle, cycleRepeat, stop, removeFromQueue,
      updateInQueue,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer debe usarse dentro de <PlayerProvider>');
  return ctx;
}
