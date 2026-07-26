import { useCallback, useState } from 'react';
import {
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import { colors, radius } from '@/theme';

type Props = {
  /** Posición actual en segundos. */
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
  /** Barra fina sin manija, para el mini reproductor. */
  compact?: boolean;
};

/**
 * Barra de progreso arrastrable.
 *
 * Usa el sistema de responders de React Native en vez de gesture-handler +
 * reanimated: para un arrastre en un solo eje no hace falta salir al hilo de UI,
 * y evita que los callbacks del gesto —que se construyen en render— tengan que
 * leer refs.
 *
 * Mientras el dedo está abajo se muestra `dragValue` y se ignora la posición que
 * llega del reproductor; si no, cada actualización de status tiraría la manija
 * de vuelta y el arrastre se sentiría elástico.
 */
export function Seekbar({ position, duration, onSeek, compact = false }: Props) {
  const [width, setWidth] = useState(0);
  const [dragValue, setDragValue] = useState<number | null>(null);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  }, []);

  const toSeconds = useCallback(
    (x: number) => {
      if (width <= 0 || duration <= 0) return 0;
      return Math.min(Math.max(x / width, 0), 1) * duration;
    },
    [width, duration],
  );

  const active = !compact && duration > 0;

  const handleMove = useCallback(
    (e: GestureResponderEvent) => setDragValue(toSeconds(e.nativeEvent.locationX)),
    [toSeconds],
  );

  const handleRelease = useCallback(
    (e: GestureResponderEvent) => {
      onSeek(toSeconds(e.nativeEvent.locationX));
      setDragValue(null);
    },
    [onSeek, toSeconds],
  );

  const shown = dragValue ?? position;
  const ratio = duration > 0 ? Math.min(Math.max(shown / duration, 0), 1) : 0;
  const filled = width * ratio;

  const bar = (
    <View
      onLayout={onLayout}
      style={[styles.track, compact ? styles.trackCompact : styles.trackFull]}>
      <View style={[styles.fill, { width: filled }]} />
      {!compact && width > 0 && (
        <View
          style={[
            styles.knob,
            { left: filled - KNOB / 2 },
            dragValue !== null && styles.knobActive,
          ]}
        />
      )}
    </View>
  );

  if (compact) return bar;

  return (
    // El padding vertical amplía el área táctil sin engordar la barra. Como el
    // responder se toma en el contenedor, locationX ya viene relativo a él y
    // coincide con el ancho medido en onLayout de la barra interna.
    <View
      style={styles.hitArea}
      onStartShouldSetResponder={() => active}
      onMoveShouldSetResponder={() => active}
      onResponderGrant={handleMove}
      onResponderMove={handleMove}
      onResponderRelease={handleRelease}
      onResponderTerminate={() => setDragValue(null)}>
      {bar}
    </View>
  );
}

const KNOB = 13;

const styles = StyleSheet.create({
  hitArea: {
    paddingVertical: 14,
    justifyContent: 'center',
  },
  track: {
    width: '100%',
    backgroundColor: colors.borderStrong,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  trackFull: {
    height: 4,
  },
  trackCompact: {
    height: 2,
  },
  fill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
  },
  knob: {
    position: 'absolute',
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: colors.accent,
  },
  knobActive: {
    transform: [{ scale: 1.35 }],
  },
});
