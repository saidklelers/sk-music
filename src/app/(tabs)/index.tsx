import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

import {
  Check,
  ChevronRight,
  Edit,
  Music,
  Play,
  Plus,
  Search,
  Shuffle,
  Sort,
  Trash,
  X,
} from '@/components/Icons';
import { EmptyState, ScreenHeader } from '@/components/Primitives';
import { PromptSheet } from '@/components/PromptSheet';
import { Sheet, SheetItem } from '@/components/Sheet';
import { TrackRow } from '@/components/TrackRow';
import { getPref, setPref, type Playlist, type Track } from '@/db';
import { useLibrary } from '@/library/LibraryProvider';
import { formatBytes, pluralTracks } from '@/lib/format';
import { SORT_LABEL, SORT_MODES, sortTracks, type SortMode } from '@/lib/sort';
import { usePlayer } from '@/player/PlayerProvider';
import { colors, layout, radius, space, type } from '@/theme';

type Tab = 'songs' | 'lists';

export default function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const database = useSQLiteContext();
  const {
    tracks,
    playlists,
    librarySize,
    removeTrack,
    rename,
    newPlaylist,
    renamePlaylist,
    removePlaylist,
    addTrackToPlaylist,
    playlistsWithTrack,
  } = useLibrary();
  const { play, current } = usePlayer();

  const [tab, setTab] = useState<Tab>('songs');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('recent');
  const [sortOpen, setSortOpen] = useState(false);

  const [menuTrack, setMenuTrack] = useState<Track | null>(null);
  const [editTrack, setEditTrack] = useState<Track | null>(null);
  const [playlistPickerFor, setPlaylistPickerFor] = useState<Track | null>(null);
  const [memberOf, setMemberOf] = useState<number[]>([]);

  /**
   * Crear lista. Si se abre desde el selector, recuerda qué canción había que
   * meter: el selector se cierra antes de abrir esta hoja, porque dos Modal
   * hermanos visibles a la vez no se presentan en iOS.
   */
  const [creating, setCreating] = useState<{ addTrack: Track | null } | null>(null);
  const [menuPlaylist, setMenuPlaylist] = useState<Playlist | null>(null);
  const [renaming, setRenaming] = useState<Playlist | null>(null);

  /* El orden elegido se recuerda entre sesiones. */
  useEffect(() => {
    let cancelled = false;
    getPref(database, 'library.sort')
      .then((saved) => {
        if (!cancelled && SORT_MODES.includes(saved as SortMode)) setSort(saved as SortMode);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [database]);

  const chooseSort = useCallback(
    (mode: SortMode) => {
      setSort(mode);
      setSortOpen(false);
      setPref(database, 'library.sort', mode).catch(() => {});
    },
    [database],
  );

  // Filtrado y orden en memoria: con bibliotecas de este tamaño ir a SQLite en
  // cada tecla sólo agrega latencia.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? tracks.filter(
          (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
        )
      : tracks;
    return sortTracks(filtered, sort);
  }, [tracks, query, sort]);

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
    (playlist: Playlist) => {
      setMenuPlaylist(null);
      Alert.alert('Eliminar lista', `Se borrará "${playlist.name}". Las canciones se conservan.`, [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => void removePlaylist(playlist.id),
        },
      ]);
    },
    [removePlaylist],
  );

  const createPlaylist = useCallback(
    async ({ name }: Record<string, string>) => {
      const id = await newPlaylist(name);
      // Si veníamos de "agregar a lista", metemos la canción de una vez.
      if (creating?.addTrack) await addTrackToPlaylist(id, creating.addTrack.id);
    },
    [newPlaylist, addTrackToPlaylist, creating],
  );

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
        right={
          tab === 'songs' && tracks.length > 1 ? (
            <Pressable
              onPress={() => setSortOpen(true)}
              hitSlop={10}
              accessibilityLabel={`Ordenar: ${SORT_LABEL[sort]}`}
              style={({ pressed }) => [styles.sortBtn, pressed && { opacity: 0.6 }]}>
              <Sort size={18} color={colors.textMuted} />
              <Text style={styles.sortText}>{SORT_LABEL[sort]}</Text>
            </Pressable>
          ) : undefined
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
            data={visible}
            keyExtractor={(t) => t.id}
            contentContainerStyle={{ paddingBottom: bottomPad }}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              visible.length > 1 ? (
                <View style={styles.playRow}>
                  <Pressable
                    onPress={() => play(visible, 0, { shuffle: false })}
                    style={({ pressed }) => [
                      styles.playBtn,
                      styles.playBtnPrimary,
                      pressed && { opacity: 0.8 },
                    ]}>
                    <Play size={16} color={colors.onAccent} />
                    <Text style={[styles.playBtnText, { color: colors.onAccent }]}>
                      Reproducir
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      play(visible, Math.floor(Math.random() * visible.length), {
                        shuffle: true,
                      })
                    }
                    style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.8 }]}>
                    <Shuffle size={16} color={colors.text} />
                    <Text style={styles.playBtnText}>Aleatorio</Text>
                  </Pressable>
                </View>
              ) : null
            }
            renderItem={({ item, index }) => (
              <TrackRow
                track={item}
                active={current?.id === item.id}
                onPress={() => play(visible, index)}
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
              onPress={() => setCreating({ addTrack: null })}
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
              onLongPress={() => setMenuPlaylist(item)}
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

      {/* Orden */}
      <Sheet visible={sortOpen} onClose={() => setSortOpen(false)} title="Ordenar por">
        {SORT_MODES.map((mode) => (
          <SheetItem
            key={mode}
            label={SORT_LABEL[mode]}
            trailing={sort === mode ? <Check size={18} color={colors.accent} /> : undefined}
            onPress={() => chooseSort(mode)}
          />
        ))}
      </Sheet>

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
              label="Editar título y artista"
              icon={<Edit size={20} color={colors.textMuted} />}
              onPress={() => {
                setMenuTrack(null);
                setEditTrack(menuTrack);
              }}
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

      {/* Editar canción */}
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

      {/* Selector de lista */}
      <Sheet
        visible={!!playlistPickerFor}
        onClose={() => setPlaylistPickerFor(null)}
        title="Agregar a una lista"
        subtitle={playlistPickerFor?.title}>
        <SheetItem
          label="Nueva lista"
          icon={<Plus size={20} color={colors.accent} />}
          onPress={() => {
            setCreating({ addTrack: playlistPickerFor });
            setPlaylistPickerFor(null);
          }}
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
      <PromptSheet
        visible={!!creating}
        onClose={() => setCreating(null)}
        title="Nueva lista"
        subtitle={creating?.addTrack ? `Con “${creating.addTrack.title}”` : undefined}
        confirmLabel="Crear"
        fields={[{ key: 'name', placeholder: 'Nombre de la lista', required: true }]}
        onSubmit={createPlaylist}
      />

      {/* Menú de lista */}
      <Sheet
        visible={!!menuPlaylist}
        onClose={() => setMenuPlaylist(null)}
        title={menuPlaylist?.name}
        subtitle={menuPlaylist ? pluralTracks(menuPlaylist.track_count) : undefined}>
        {menuPlaylist && (
          <>
            <SheetItem
              label="Renombrar"
              icon={<Edit size={20} color={colors.textMuted} />}
              onPress={() => {
                setMenuPlaylist(null);
                setRenaming(menuPlaylist);
              }}
            />
            <SheetItem
              label="Eliminar lista"
              icon={<Trash size={20} color={colors.danger} />}
              danger
              onPress={() => confirmDeletePlaylist(menuPlaylist)}
            />
          </>
        )}
      </Sheet>

      {/* Renombrar lista */}
      <PromptSheet
        visible={!!renaming}
        onClose={() => setRenaming(null)}
        title="Renombrar lista"
        confirmLabel="Guardar"
        fields={[{ key: 'name', initial: renaming?.name, required: true }]}
        onSubmit={async ({ name }) => {
          if (renaming) await renamePlaylist(renaming.id, name);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingBottom: 4,
  },
  sortText: { ...type.small, color: colors.textMuted },

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

  playRow: {
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  playBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHi,
  },
  playBtnPrimary: { backgroundColor: colors.accent },
  playBtnText: { ...type.heading, color: colors.text, fontSize: 14 },

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
});
