import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { artworkUri } from '@/downloads/storage';
import { usePlayer } from '@/player/PlayerProvider';
import { colors, layout, space, type } from '@/theme';

import { Artwork } from './Artwork';
import { Pause, Play, SkipNext } from './Icons';

/**
 * Barra de reproducción persistente, justo encima de las pestañas.
 * Se oculta por completo cuando no hay nada sonando, en vez de dejar un
 * contenedor vacío ocupando espacio.
 */
export function MiniPlayer() {
  const router = useRouter();
  const { current, isPlaying, toggle, next, hasNext, position, duration } = usePlayer();

  if (!current) return null;

  const ratio = duration > 0 ? Math.min(position / duration, 1) : 0;

  return (
    <View style={styles.container}>
      {/* Progreso como una línea de 2px en el borde superior: informa sin pedir
          atención ni ocupar altura. */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${ratio * 100}%` }]} />
      </View>

      <Pressable
        onPress={() => router.push('/player')}
        style={({ pressed }) => [styles.body, pressed && { opacity: 0.75 }]}>
        <Artwork uri={artworkUri(current.artwork_name)} size={40} />

        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={1}>
            {current.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {current.artist}
          </Text>
        </View>

        <Pressable
          onPress={toggle}
          hitSlop={12}
          style={({ pressed }) => pressed && { opacity: 0.6 }}>
          {isPlaying ? <Pause size={22} /> : <Play size={22} />}
        </Pressable>

        <Pressable
          onPress={next}
          disabled={!hasNext}
          hitSlop={12}
          style={({ pressed }) => [!hasNext && { opacity: 0.3 }, pressed && { opacity: 0.6 }]}>
          <SkipNext size={20} />
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: layout.miniPlayerHeight,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  progressTrack: {
    height: 2,
    backgroundColor: colors.border,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding,
    gap: space.md,
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...type.body,
    color: colors.text,
  },
  artist: {
    ...type.small,
    color: colors.textMuted,
  },
});
