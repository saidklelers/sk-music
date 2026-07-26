import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
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

import type { Track } from '@/db';
import { artworkUri, trackUri } from '@/downloads/storage';

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

  play: (tracks: Track[], startIndex?: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seekTo: (seconds: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  stop: () => void;
  /** Saca una canción de la cola si se borró de la biblioteca. */
  removeFromQueue: (trackId: string) => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

/** Fisher–Yates sobre una copia. */
function shuffled(indices: number[]): number[] {
  const out = [...indices];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Primera posición desde `from` (avanzando en `direction`) cuyo archivo siga en
 * disco. Devuelve null si no queda ninguna reproducible.
 *
 * Esta comprobación vive acá —y no en el efecto que carga el audio— a propósito:
 * saltar una pista implica cambiar estado, y hacerlo dentro de un efecto dispara
 * renders en cascada. Llamándola desde play/next/prev, que son manejadores de
 * eventos, el salto ocurre donde corresponde.
 */
function findPlayable(
  queue: Track[],
  order: number[],
  from: number,
  direction: 1 | -1,
): number | null {
  for (let p = from; p >= 0 && p < order.length; p += direction) {
    const track = queue[order[p]];
    if (track && trackUri(track.file_name)) return p;
  }
  return null;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
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

  const advance = useCallback(
    (direction: 1 | -1) => {
      setPos((p) => {
        let target = p + direction;
        if (target < 0) return 0;
        if (target >= order.length) {
          if (repeat !== 'all') return p;
          target = 0;
        }
        return findPlayable(queue, order, target, direction) ?? p;
      });
    },
    [queue, order, repeat],
  );

  /**
   * Avance automático al terminar.
   *
   * Va por `addListener` y no por un efecto sobre `status.didJustFinish`: el
   * reproductor es un sistema externo, y reaccionar a él desde un callback de
   * suscripción es el patrón correcto. `handled` evita el doble salto, porque
   * didJustFinish sigue en true durante varias actualizaciones de status.
   */
  useEffect(() => {
    let handled = false;

    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (!s.didJustFinish) {
        handled = false;
        return;
      }
      if (handled) return;
      handled = true;

      if (repeat === 'one') {
        player.seekTo(0);
        player.play();
        return;
      }
      if (pos + 1 >= order.length && repeat !== 'all') {
        player.pause();
        player.seekTo(0);
        return;
      }
      advance(1);
    });

    return () => sub.remove();
  }, [player, repeat, pos, order.length, advance]);

  const play = useCallback(
    (tracks: Track[], startIndex = 0) => {
      if (!tracks.length) return;
      const indices = tracks.map((_, i) => i);

      const nextOrder = shuffle
        ? // La elegida arranca primero; el resto va revuelto detrás.
          [startIndex, ...shuffled(indices.filter((i) => i !== startIndex))]
        : indices;
      const startPos = shuffle ? 0 : startIndex;

      setQueue(tracks);
      setOrder(nextOrder);
      setPos(findPlayable(tracks, nextOrder, startPos, 1) ?? startPos);
    },
    [shuffle],
  );

  const toggle = useCallback(() => {
    if (!current) return;
    if (status.playing) player.pause();
    else player.play();
  }, [current, status.playing, player]);

  const next = useCallback(() => advance(1), [advance]);

  /** Antes de 4 s vuelve al inicio de la canción; después salta a la anterior. */
  const prev = useCallback(() => {
    if (status.currentTime > 4) {
      player.seekTo(0);
      return;
    }
    advance(-1);
  }, [status.currentTime, player, advance]);

  const seekTo = useCallback(
    (seconds: number) => {
      player.seekTo(Math.max(0, seconds));
    },
    [player],
  );

  const toggleShuffle = useCallback(() => {
    const turningOn = !shuffle;
    setShuffle(turningOn);

    if (!order.length) return;
    const currentIdx = order[pos];

    if (turningOn) {
      setOrder([currentIdx, ...shuffled(order.filter((i) => i !== currentIdx))]);
      setPos(0);
    } else {
      // Al desactivar volvemos al orden natural, sin perder dónde vamos.
      const natural = [...order].sort((a, b) => a - b);
      setOrder(natural);
      setPos(natural.indexOf(currentIdx));
    }
  }, [shuffle, order, pos]);

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'));
  }, []);

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

      const currentIdx = order[pos];
      // Reindexamos: los índices por encima del borrado se corren uno abajo.
      const nextOrder = order
        .filter((i) => i !== removedIdx)
        .map((i) => (i > removedIdx ? i - 1 : i));

      setQueue(queue.filter((t) => t.id !== trackId));
      setOrder(nextOrder);

      if (currentIdx === removedIdx) {
        setPos(Math.min(pos, Math.max(0, nextOrder.length - 1)));
      } else {
        const adjusted = currentIdx > removedIdx ? currentIdx - 1 : currentIdx;
        setPos(Math.max(0, nextOrder.indexOf(adjusted)));
      }
    },
    [queue, order, pos],
  );

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
      hasNext: pos + 1 < order.length || repeat === 'all',
      hasPrev: pos > 0,
      play,
      toggle,
      next,
      prev,
      seekTo,
      toggleShuffle,
      cycleRepeat,
      stop,
      removeFromQueue,
    }),
    [
      current, queue, status.playing, status.isBuffering, status.currentTime, status.duration,
      shuffle, repeat, pos, order.length,
      play, toggle, next, prev, seekTo, toggleShuffle, cycleRepeat, stop, removeFromQueue,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer debe usarse dentro de <PlayerProvider>');
  return ctx;
}
