import * as Haptics from 'expo-haptics';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Track } from '@/db';
import { artworkUri } from '@/downloads/storage';
import { formatDuration } from '@/lib/format';
import { colors, layout, space, type } from '@/theme';

import { Artwork } from './Artwork';
import { MoreVertical } from './Icons';

type Props = {
  track: Track;
  active?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  onMenu?: () => void;
};

/** Cuatro barras que "suenan" en la fila activa. Estáticas: animarlas en una
 *  lista larga cuesta más de lo que aporta. */
function NowPlayingBars() {
  const heights = [7, 13, 9, 15];
  return (
    <View style={styles.bars}>
      {heights.map((h, i) => (
        <View key={i} style={[styles.bar, { height: h }]} />
      ))}
    </View>
  );
}

export const TrackRow = memo(function TrackRow({
  track,
  active = false,
  onPress,
  onLongPress,
  onMenu,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onLongPress?.();
      }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Artwork uri={artworkUri(track.artwork_name)} size={46} />

      <View style={styles.meta}>
        <Text
          style={[styles.title, active && styles.titleActive]}
          numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {track.artist}
        </Text>
      </View>

      {active ? (
        <NowPlayingBars />
      ) : (
        <Text style={styles.duration}>{formatDuration(track.duration)}</Text>
      )}

      {onMenu && (
        <Pressable
          onPress={onMenu}
          hitSlop={10}
          style={({ pressed }) => [styles.menu, pressed && { opacity: 0.5 }]}>
          <MoreVertical size={18} color={colors.textFaint} />
        </Pressable>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: layout.rowHeight,
    paddingHorizontal: layout.screenPadding,
    gap: space.md,
  },
  pressed: {
    backgroundColor: colors.surface,
  },
  meta: {
    flex: 1,
    gap: 3,
  },
  title: {
    ...type.body,
    color: colors.text,
  },
  titleActive: {
    color: colors.accent,
  },
  artist: {
    ...type.small,
    color: colors.textMuted,
  },
  duration: {
    ...type.mono,
    color: colors.textFaint,
  },
  menu: {
    paddingLeft: space.xs,
    paddingVertical: space.sm,
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2.5,
    height: 15,
  },
  bar: {
    width: 2.5,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
});
