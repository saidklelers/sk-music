import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { colors, gradient, radius } from '@/theme';

import { Logo } from './Logo';

type Props = {
  /** URI local o remota. Si es null se pinta el respaldo de marca. */
  uri?: string | null;
  size: number;
  rounded?: number;
};

/**
 * Carátula con respaldo de marca.
 *
 * Cuando no hay imagen no dejamos un hueco gris: se pinta el degradado de la
 * paleta con el monograma encima. Así una biblioteca sin carátulas sigue
 * viéndose intencional en vez de rota.
 */
export function Artwork({ uri, size, rounded }: Props) {
  const borderRadius = rounded ?? (size > 120 ? radius.xl : radius.md);

  if (!uri) {
    return (
      <LinearGradient
        colors={[colors.surfaceHi, colors.plum]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.fallback, { width: size, height: size, borderRadius }]}>
        <Logo size={size * 0.5} variant="gradient" weight={8} />
      </LinearGradient>
    );
  }

  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius }]}>
      <Image
        source={{ uri }}
        style={{ width: size, height: size }}
        contentFit="cover"
        transition={180}
        cachePolicy="memory-disk"
      />
    </View>
  );
}

/** Variante decorativa grande, para estados vacíos. */
export function ArtworkGhost({ size }: { size: number }) {
  return (
    <LinearGradient
      colors={gradient.brandSoft}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.fallback, { width: size, height: size, borderRadius: radius.xl, opacity: 0.13 }]}
    />
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: colors.surfaceHi,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
