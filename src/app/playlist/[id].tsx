import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronLeft, Edit, MoreVertical, Play, Shuffle, Trash } from '@/components/Icons';
import { EmptyState } from '@/components/Primitives';
import { PromptSheet } from '@/components/PromptSheet';
import { Sheet, SheetItem } from '@/components/Sheet';
import { TrackRow } from '@/components/TrackRow';
import type { Track } from '@/db';
import { getPlaylist } from '@/db';
import { useLibrary } from '@/library/LibraryProvider';
import { pluralTracks } from '@/lib/format';
import { usePlayer } from '@/player/PlayerProvider';
import { colors, layout, radius, space, type } from '@/theme';

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const playlistId = Number(id);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const database = useSQLiteContext();

  const {
    tracks: library,
    tracksOfPlaylist,
    removeTrackFromPlaylist,
    renamePlaylist,
    removePlaylist,
    rename,
    playlists,
  } = useLibrary();
  const { play, current } = usePlayer();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [name, setName] = useState('');
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const [editTrack, setEditTrack] = useState<Track | null>(null);
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  /**
   * Recarga los datos de la lista.
   *
   * El estado se fija dentro del `.then` y no tras un `await` en el cuerpo del
   * efecto: así nunca hay un setState sincrónico al montar, y el flag `cancelled`
   * evita escribir sobre un componente ya desmontado si la consulta llega tarde.
   * `reloadKey` es el disparador manual tras quitar una canción; `playlists` y
   * `library` cubren los cambios hechos desde otra pantalla (renombrar, borrar).
   */
  useEffect(() => {
    if (!Number.isFinite(playlistId)) return;
    let cancelled = false;

    Promise.all([tracksOfPlaylist(playlistId), getPlaylist(database, playlistId)])
      .then(([list, meta]) => {
        if (cancelled) return;
        if (!meta) {
          // La lista ya no existe (se borró): no hay nada que mostrar aquí.
          router.back();
          return;
        }
        setTracks(list);
        setName(meta.name);
      })
      .catch(() => {
        if (!cancelled) setTracks([]);
      });

    return () => {
      cancelled = true;
    };
  }, [playlistId, tracksOfPlaylist, database, playlists, library, reloadKey, router]);

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

  const confirmDeleteList = useCallback(() => {
    setListMenuOpen(false);
    Alert.alert('Eliminar lista', `Se borrará "${name}". Las canciones se conservan.`, [
      { text: 'Cancelar', style: 'cancel' },
      // No se navega aquí: al refrescarse, el efecto de carga ve que la lista
      // ya no existe y vuelve atrás. Hacerlo en los dos sitios retrocedía dos
      // pantallas.
      { text: 'Eliminar', style: 'destructive', onPress: () => void removePlaylist(playlistId) },
    ]);
  }, [name, playlistId, removePlaylist]);

  /**
   * "Reproducir" va en orden y "Aleatorio" revuelto, fijando el modo en ambos
   * casos. Antes "Aleatorio" activaba el modo y llamaba a `play` en el mismo
   * render, así que `play` aún veía el aleatorio apagado y sonaba en orden.
   */
  const playAll = useCallback(
    (shuffled: boolean) => {
      if (!tracks.length) return;
      play(tracks, shuffled ? Math.floor(Math.random() * tracks.length) : 0, {
        shuffle: shuffled,
      });
    },
    [tracks, play],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityLabel="Volver"
          style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <ChevronLeft size={24} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={() => setListMenuOpen(true)}
          hitSlop={12}
          accessibilityLabel="Opciones de la lista"
          style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <MoreVertical size={22} color={colors.textMuted} />
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
          <>
            <SheetItem
              label="Editar título y artista"
              icon={<Edit size={20} color={colors.textMuted} />}
              onPress={() => {
                setMenuTrack(null);
                setEditTrack(menuTrack);
              }}
            />
            <SheetItem
              label="Quitar de esta lista"
              icon={<Trash size={20} color={colors.danger} />}
              danger
              onPress={() => removeFromList(menuTrack)}
            />
          </>
        )}
      </Sheet>

      <PromptSheet
        visible={!!editTrack}
        onClose={() => setEditTrack(null)}
        title="Editar canción"
        confirmLabel="Guardar"
        fields={[
          { key: 'title', label: 'Título', initial: editTrack?.title, required: true },
          { key: 'artist', label: 'Artista', initial: editTrack?.artist },
        ]}
        onSubmit={async ({ title, artist }) => {
          if (editTrack) await rename(editTrack.id, title, artist);
        }}
      />

      <Sheet
        visible={listMenuOpen}
        onClose={() => setListMenuOpen(false)}
        title={name}
        subtitle={pluralTracks(tracks.length)}>
        <SheetItem
          label="Renombrar"
          icon={<Edit size={20} color={colors.textMuted} />}
          onPress={() => {
            setListMenuOpen(false);
            setRenaming(true);
          }}
        />
        <SheetItem
          label="Eliminar lista"
          icon={<Trash size={20} color={colors.danger} />}
          danger
          onPress={confirmDeleteList}
        />
      </Sheet>

      <PromptSheet
        visible={renaming}
        onClose={() => setRenaming(false)}
        title="Renombrar lista"
        confirmLabel="Guardar"
        fields={[{ key: 'name', initial: name, required: true }]}
        onSubmit={({ name: next }) => renamePlaylist(playlistId, next)}
      />
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
    paddingBottom: space.sm,
  },
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
