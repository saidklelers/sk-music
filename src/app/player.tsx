import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Artwork } from '@/components/Artwork';
import {
  ChevronDown,
  Pause,
  Play,
  Repeat,
  RepeatOne,
  Shuffle,
  SkipNext,
  SkipPrev,
} from '@/components/Icons';
import { Seekbar } from '@/components/Seekbar';
import { artworkUri } from '@/downloads/storage';
import { formatDuration } from '@/lib/format';
import { usePlayer } from '@/player/PlayerProvider';
import { colors, radius, space, type } from '@/theme';

export default function PlayerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const {
    current,
    isPlaying,
    isBuffering,
    position,
    duration,
    shuffle,
    repeat,
    hasNext,
    hasPrev,
    toggle,
    next,
    prev,
    seekTo,
    toggleShuffle,
    cycleRepeat,
  } = usePlayer();

  if (!current) {
    // Puede pasar si la canción se borró mientras el modal estaba abierto.
    router.back();
    return null;
  }

  // La carátula se lleva el ancho menos márgenes, con techo para que en
  // tablets no crezca hasta comerse los controles.
  const art = Math.min(width - space.xl * 2, 380);

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <ChevronDown size={26} color={colors.textMuted} />
        </Pressable>
        <Text style={styles.topLabel}>Reproduciendo</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.artWrap}>
        <Artwork uri={artworkUri(current.artwork_name)} size={art} rounded={radius.xl} />
      </View>

      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={2}>
          {current.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {current.artist}
        </Text>
      </View>

      <View style={styles.seekWrap}>
        <Seekbar position={position} duration={duration} onSeek={seekTo} />
        <View style={styles.times}>
          <Text style={styles.time}>{formatDuration(position)}</Text>
          <Text style={styles.time}>{formatDuration(duration)}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={toggleShuffle}
          hitSlop={12}
          style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <Shuffle size={21} color={shuffle ? colors.accent : colors.textFaint} />
        </Pressable>

        <Pressable
          onPress={prev}
          disabled={!hasPrev && position <= 4}
          hitSlop={12}
          style={({ pressed }) => [
            !hasPrev && position <= 4 && { opacity: 0.3 },
            pressed && { opacity: 0.6 },
          ]}>
          <SkipPrev size={30} />
        </Pressable>

        <Pressable
          onPress={toggle}
          style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.85 }]}>
          {isPlaying ? (
            <Pause size={28} color={colors.onAccent} />
          ) : (
            <Play size={28} color={colors.onAccent} />
          )}
        </Pressable>

        <Pressable
          onPress={next}
          disabled={!hasNext}
          hitSlop={12}
          style={({ pressed }) => [!hasNext && { opacity: 0.3 }, pressed && { opacity: 0.6 }]}>
          <SkipNext size={30} />
        </Pressable>

        <Pressable
          onPress={cycleRepeat}
          hitSlop={12}
          style={({ pressed }) => pressed && { opacity: 0.6 }}>
          {repeat === 'one' ? (
            <RepeatOne size={21} color={colors.accent} />
          ) : (
            <Repeat size={21} color={repeat === 'all' ? colors.accent : colors.textFaint} />
          )}
        </Pressable>
      </View>

      <Text style={[styles.footNote, { marginBottom: insets.bottom + space.lg }]}>
        {isBuffering ? 'Cargando…' : 'Sin conexión · guardado en el dispositivo'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
  },
  topLabel: { ...type.label, color: colors.textFaint },

  artWrap: { alignItems: 'center', paddingVertical: space.md },

  meta: {
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    gap: space.xs,
    alignItems: 'center',
  },
  title: { ...type.title, color: colors.text, textAlign: 'center' },
  artist: { ...type.body, color: colors.textMuted },

  seekWrap: { paddingHorizontal: space.xl, marginTop: space.lg },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -space.xs },
  time: { ...type.mono, color: colors.textFaint },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    marginTop: space.lg,
  },
  playBtn: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  footNote: {
    ...type.small,
    color: colors.textFaint,
    textAlign: 'center',
    marginTop: 'auto',
  },
});
