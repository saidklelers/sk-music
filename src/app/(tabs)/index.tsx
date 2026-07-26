import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Check, ChevronRight, Music, Plus, Search, Trash, X } from '@/components/Icons';
import { EmptyState, ScreenHeader } from '@/components/Primitives';
import { Sheet, SheetItem } from '@/components/Sheet';
import { TrackRow } from '@/components/TrackRow';
import type { Track } from '@/db';
import { useLibrary } from '@/library/LibraryProvider';
import { formatBytes, pluralTracks } from '@/lib/format';
import { usePlayer } from '@/player/PlayerProvider';
import { colors, layout, radius, space, type } from '@/theme';

type Tab = 'songs' | 'lists';

export default function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    tracks,
    playlists,
    librarySize,
    removeTrack,
    newPlaylist,
    removePlaylist,
    addTrackToPlaylist,
    playlistsWithTrack,
  } = useLibrary();
  const { play, current } = usePlayer();

  const [tab, setTab] = useState<Tab>('songs');
  const [query, setQuery] = useState('');
  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const [playlistPickerFor, setPlaylistPickerFor] = useState<Track | null>(null);
  const [memberOf, setMemberOf] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  // Filtrado en memoria: con bibliotecas de este tamaño ir a SQLite en cada
  // tecla sólo agrega latencia.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter(
      (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
    );
  }, [tracks, query]);

  const openPlaylistPicker = useCallback(
    async (track: Track) => {
      setMenuTrack(null);
      setMemberOf(await playlistsWithTrack(track.id));
      setPlaylistPickerFor(track);
    },
    [playlistsWithTrack],
  );

  const confirmDelete = useCallback(
    (track: Track) => {
      setMenuTrack(null);
      Alert.alert(
        'Eliminar canción',
        `Se borrará "${track.title}" del dispositivo. Puedes volver a descargarla después.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Eliminar', style: 'destructive', onPress: () => void removeTrack(track) },
        ],
      );
    },
    [removeTrack],
  );

  const confirmDeletePlaylist = useCallback(
    (id: number, name: string) => {
      Alert.alert('Eliminar lista', `Se borrará "${name}". Las canciones se conservan.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: () => void removePlaylist(id) },
      ]);
    },
    [removePlaylist],
  );

  const createPlaylist = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    const id = await newPlaylist(name);
    setNewName('');
    setCreating(false);
    // Si veníamos de "agregar a lista", metemos la canción de una vez.
    if (playlistPickerFor) {
      await addTrackToPlaylist(id, playlistPickerFor.id);
      setMemberOf((m) => [...m, id]);
    }
  }, [newName, newPlaylist, playlistPickerFor, addTrackToPlaylist]);

  const bottomPad = layout.miniPlayerHeight + space.xl;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Biblioteca"
        subtitle={
          tracks.length
            ? `${pluralTracks(tracks.length)} · ${formatBytes(librarySize)}`
            : 'Todo lo que descargues vive aquí'
        }
      />

      <View style={styles.segmented}>
        {(['songs', 'lists'] as Tab[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[styles.segment, tab === t && styles.segmentActive]}>
            <Text style={[styles.segmentText, tab === t && styles.segmentTextActive]}>
              {t === 'songs' ? 'Canciones' : 'Listas'}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'songs' ? (
        <>
          {tracks.length > 0 && (
            <View style={styles.searchWrap}>
              <Search size={17} color={colors.textFaint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Buscar en tu biblioteca"
                placeholderTextColor={colors.textFaint}
                style={styles.searchInput}
                autoCorrect={false}
                returnKeyType="search"
              />
              {!!query && (
                <Pressable onPress={() => setQuery('')} hitSlop={10}>
                  <X size={16} color={colors.textFaint} />
                </Pressable>
              )}
            </View>
          )}

          <FlatList
            data={filtered}
            keyExtractor={(t) => t.id}
            contentContainerStyle={{ paddingBottom: bottomPad }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item, index }) => (
              <TrackRow
                track={item}
                active={current?.id === item.id}
                onPress={() => play(filtered, index)}
                onLongPress={() => setMenuTrack(item)}
                onMenu={() => setMenuTrack(item)}
              />
            )}
            ListEmptyComponent={
              tracks.length === 0 ? (
                <View style={styles.emptyWrap}>
                  <EmptyState
                    title="Tu biblioteca está vacía"
                    message="Ve a Agregar, pega un link de YouTube y quedará guardado para escuchar sin conexión."
                  />
                </View>
              ) : (
                <Text style={styles.noResults}>Nada coincide con “{query}”.</Text>
              )
            }
          />
        </>
      ) : (
        <FlatList
          data={playlists}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={{ paddingBottom: bottomPad }}
          ListHeaderComponent={
            <Pressable
              onPress={() => setCreating(true)}
              style={({ pressed }) => [styles.newListRow, pressed && { opacity: 0.7 }]}>
              <View style={styles.newListIcon}>
                <Plus size={20} color={colors.accent} />
              </View>
              <Text style={styles.newListText}>Nueva lista</Text>
            </Pressable>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/playlist/${item.id}`)}
              onLongPress={() => confirmDeletePlaylist(item.id, item.name)}
              style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: colors.surface }]}>
              <View style={styles.listIcon}>
                <Music size={20} color={colors.textMuted} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.listName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.listCount}>{pluralTracks(item.track_count)}</Text>
              </View>
              <ChevronRight size={18} color={colors.textFaint} />
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.noResults}>
              Aún no tienes listas. Crea una y organiza lo que descargaste.
            </Text>
          }
        />
      )}

      {/* Menú de canción */}
      <Sheet
        visible={!!menuTrack}
        onClose={() => setMenuTrack(null)}
        title={menuTrack?.title}
        subtitle={menuTrack ? `${menuTrack.artist} · ${formatBytes(menuTrack.size)}` : undefined}>
        {menuTrack && (
          <>
            <SheetItem
              label="Agregar a una lista"
              icon={<Plus size={20} color={colors.textMuted} />}
              onPress={() => void openPlaylistPicker(menuTrack)}
            />
            <SheetItem
              label="Eliminar del dispositivo"
              icon={<Trash size={20} color={colors.danger} />}
              danger
              onPress={() => confirmDelete(menuTrack)}
            />
          </>
        )}
      </Sheet>

      {/* Selector de lista */}
      <Sheet
        visible={!!playlistPickerFor}
        onClose={() => setPlaylistPickerFor(null)}
        title="Agregar a una lista"
        subtitle={playlistPickerFor?.title}>
        <SheetItem
          label="Nueva lista"
          icon={<Plus size={20} color={colors.accent} />}
          onPress={() => setCreating(true)}
        />
        {playlists.map((p) => {
          const already = memberOf.includes(p.id);
          return (
            <SheetItem
              key={p.id}
              label={p.name}
              icon={<Music size={20} color={colors.textMuted} />}
              trailing={already ? <Check size={18} color={colors.accent} /> : undefined}
              onPress={async () => {
                if (already || !playlistPickerFor) return;
                await addTrackToPlaylist(p.id, playlistPickerFor.id);
                setMemberOf((m) => [...m, p.id]);
              }}
            />
          );
        })}
      </Sheet>

      {/* Crear lista */}
      <Sheet visible={creating} onClose={() => setCreating(false)} title="Nueva lista">
        <View style={styles.createBox}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Nombre de la lista"
            placeholderTextColor={colors.textFaint}
            style={styles.createInput}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => void createPlaylist()}
          />
          <Pressable
            onPress={() => void createPlaylist()}
            disabled={!newName.trim()}
            style={({ pressed }) => [
              styles.createBtn,
              !newName.trim() && { opacity: 0.4 },
              pressed && { opacity: 0.7 },
            ]}>
            <Check size={20} color={colors.onAccent} />
          </Pressable>
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  segmented: {
    flexDirection: 'row',
    marginHorizontal: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  segmentActive: { backgroundColor: colors.surfaceHi },
  segmentText: { ...type.small, color: colors.textMuted },
  segmentTextActive: { color: colors.text, fontWeight: '700' },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.md,
    paddingHorizontal: space.md,
    height: 42,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  searchInput: { flex: 1, ...type.body, color: colors.text, padding: 0 },

  emptyWrap: { height: 420 },
  noResults: {
    ...type.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: space.xxl,
    paddingTop: space.xxxl,
    lineHeight: 21,
  },

  newListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    height: layout.rowHeight,
    paddingHorizontal: layout.screenPadding,
    marginTop: space.sm,
  },
  newListIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newListText: { ...type.body, color: colors.accent },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    height: layout.rowHeight,
    paddingHorizontal: layout.screenPadding,
  },
  listIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listName: { ...type.body, color: colors.text },
  listCount: { ...type.small, color: colors.textMuted },

  createBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingBottom: space.lg,
  },
  createInput: {
    flex: 1,
    height: 48,
    backgroundColor: colors.surfaceHi,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    ...type.body,
    color: colors.text,
  },
  createBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
