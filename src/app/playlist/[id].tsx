import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeft, Play, Shuffle, Trash } from '@/components/Icons';
import { EmptyState } from '@/components/Primitives';
import { Sheet, SheetItem } from '@/components/Sheet';
import { TrackRow } from '@/components/TrackRow';
import type { Track } from '@/db';
import { getPlaylist } from '@/db';
import { useLibrary } from '@/library/LibraryProvider';
import { pluralTracks } from '@/lib/format';
import { usePlayer } from '@/player/PlayerProvider';
import { colors, layout, radius, space, type } from '@/theme';
import { useSQLiteContext } from 'expo-sqlite';

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlistId = Number(id);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const database = useSQLiteContext();

  const { tracksOfPlaylist, removeTrackFromPlaylist, playlists } = useLibrary();
  const { play, current, toggleShuffle, shuffle } = usePlayer();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [name, setName] = useState('');
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  /**
   * Recarga los datos de la lista.
   *
   * El estado se fija dentro del `.then` y no tras un `await` en el cuerpo del
   * efecto: así nunca hay un setState sincrónico al montar, y el flag `cancelled`
   * evita escribir sobre un componente ya desmontado si la consulta llega tarde.
   * `reloadKey` es el disparador manual tras quitar una canción; `playlists`
   * cubre los cambios hechos desde otra pantalla.
   */
  useEffect(() => {
    if (!Number.isFinite(playlistId)) return;
    let cancelled = false;

    Promise.all([tracksOfPlaylist(playlistId), getPlaylist(database, playlistId)])
      .then(([list, meta]) => {
        if (cancelled) return;
        setTracks(list);
        setName(meta?.name ?? 'Lista');
      })
      .catch(() => {
        if (!cancelled) setTracks([]);
      });

    return () => {
      cancelled = true;
    };
  }, [playlistId, tracksOfPlaylist, database, playlists, reloadKey]);

  const removeFromList = useCallback(
    (track: Track) => {
      setMenuTrack(null);
      Alert.alert('Quitar de la lista', `"${track.title}" seguirá en tu biblioteca.`, [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Quitar',
          style: 'destructive',
          onPress: async () => {
            await removeTrackFromPlaylist(playlistId, track.id);
            setReloadKey((k) => k + 1);
          },
        },
      ]);
    },
    [playlistId, removeTrackFromPlaylist],
  );

  const playAll = useCallback(
    (shuffled: boolean) => {
      if (!tracks.length) return;
      if (shuffled && !shuffle) toggleShuffle();
      play(tracks, shuffled ? Math.floor(Math.random() * tracks.length) : 0);
    },
    [tracks, play, shuffle, toggleShuffle],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <ChevronLeft size={24} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.head}>
        <Text style={styles.title} numberOfLines={2}>
          {name}
        </Text>
        <Text style={styles.count}>{pluralTracks(tracks.length)}</Text>
      </View>

      {tracks.length > 0 && (
        <View style={styles.actions}>
          <Pressable
            onPress={() => playAll(false)}
            style={({ pressed }) => [styles.action, styles.actionPrimary, pressed && { opacity: 0.8 }]}>
            <Play size={17} color={colors.onAccent} />
            <Text style={[styles.actionText, { color: colors.onAccent }]}>Reproducir</Text>
          </Pressable>
          <Pressable
            onPress={() => playAll(true)}
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.8 }]}>
            <Shuffle size={17} color={colors.text} />
            <Text style={styles.actionText}>Aleatorio</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={tracks}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingBottom: layout.miniPlayerHeight + space.xxl }}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            active={current?.id === item.id}
            onPress={() => play(tracks, index)}
            onLongPress={() => setMenuTrack(item)}
            onMenu={() => setMenuTrack(item)}
          />
        )}
        ListEmptyComponent={
          <View style={{ height: 380 }}>
            <EmptyState
              title="Lista vacía"
              message="Abre el menú de cualquier canción en tu biblioteca y agrégala a esta lista."
            />
          </View>
        }
      />

      <Sheet
        visible={!!menuTrack}
        onClose={() => setMenuTrack(null)}
        title={menuTrack?.title}
        subtitle={menuTrack?.artist}>
        {menuTrack && (
          <SheetItem
            label="Quitar de esta lista"
            icon={<Trash size={20} color={colors.danger} />}
            danger
            onPress={() => removeFromList(menuTrack)}
          />
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  head: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.xs },
  title: { ...type.display, color: colors.text },
  count: { ...type.small, color: colors.textMuted },

  actions: {
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHi,
  },
  actionPrimary: { backgroundColor: colors.accent },
  actionText: { ...type.heading, color: colors.text, fontSize: 15 },
});
