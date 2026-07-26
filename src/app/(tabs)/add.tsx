import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Artwork } from '@/components/Artwork';
import { Check, Download, Link, Search, X } from '@/components/Icons';
import { Button, ScreenHeader, SectionLabel } from '@/components/Primitives';
import { downloads, type DownloadJob } from '@/downloads/manager';
import { useLibrary } from '@/library/LibraryProvider';
import { formatDuration } from '@/lib/format';
import { colors, layout, radius, space, type } from '@/theme';
import { parseVideoId, searchTracks, type SearchResult } from '@/youtube/resolve';

export default function AddScreen() {
  const insets = useSafeAreaInsets();
  const { jobs, downloadedIds } = useLibrary();

  const [input, setInput] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Un link se descarga directo; cualquier otra cosa se trata como búsqueda.
  const looksLikeLink = !!parseVideoId(input);
  const canSubmit = input.trim().length > 0;

  const submit = useCallback(async () => {
    const value = input.trim();
    if (!value) return;

    if (parseVideoId(value)) {
      downloads.enqueue(value);
      setInput('');
      setResults([]);
      setSearchError(null);
      return;
    }

    setSearching(true);
    setSearchError(null);
    try {
      setResults(await searchTracks(value));
    } catch (err) {
      setResults([]);
      setSearchError(err instanceof Error ? err.message : 'La búsqueda falló.');
    } finally {
      setSearching(false);
    }
  }, [input]);

  const activeJobs = jobs.filter((j) => j.status === 'resolving' || j.status === 'downloading');
  const finishedJobs = jobs.filter((j) => j.status !== 'resolving' && j.status !== 'downloading');

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="Agregar" subtitle="Pega un link de YouTube o busca por nombre" />

      <View style={styles.inputWrap}>
        {looksLikeLink ? (
          <Link size={18} color={colors.accent} />
        ) : (
          <Search size={18} color={colors.textFaint} />
        )}
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="youtube.com/watch?v=… o el nombre"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType={looksLikeLink ? 'go' : 'search'}
          onSubmitEditing={() => void submit()}
        />
        {!!input && (
          <Pressable onPress={() => setInput('')} hitSlop={10}>
            <X size={16} color={colors.textFaint} />
          </Pressable>
        )}
      </View>

      <Button
        label={looksLikeLink ? 'Descargar' : 'Buscar'}
        onPress={() => void submit()}
        disabled={!canSubmit}
        loading={searching}
        icon={
          looksLikeLink ? (
            <Download size={18} color={colors.onAccent} />
          ) : (
            <Search size={18} color={colors.onAccent} />
          )
        }
        style={styles.submit}
      />

      <FlatList
        data={results}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: layout.miniPlayerHeight + space.xxl }}
        ListHeaderComponent={
          <View>
            {!!searchError && <Text style={styles.error}>{searchError}</Text>}

            {activeJobs.length > 0 && (
              <>
                <SectionLabel>Descargando</SectionLabel>
                {activeJobs.map((job) => (
                  <JobRow key={job.id} job={job} />
                ))}
              </>
            )}

            {finishedJobs.length > 0 && (
              <>
                <View style={styles.finishedHead}>
                  <SectionLabel>Recientes</SectionLabel>
                  <Pressable onPress={() => downloads.clearFinished()} hitSlop={10}>
                    <Text style={styles.clearText}>Limpiar</Text>
                  </Pressable>
                </View>
                {finishedJobs.map((job) => (
                  <JobRow key={job.id} job={job} />
                ))}
              </>
            )}

            {results.length > 0 && <SectionLabel>Resultados</SectionLabel>}
          </View>
        }
        renderItem={({ item }) => {
          const alreadySaved = downloadedIds.has(item.id);
          const busy = downloads.isActive(item.id);
          return (
            <View style={styles.resultRow}>
              <Artwork uri={item.thumbnailUrl} size={46} />
              <View style={styles.resultMeta}>
                <Text style={styles.resultTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.resultArtist} numberOfLines={1}>
                  {item.artist}
                  {item.duration > 0 ? ` · ${formatDuration(item.duration)}` : ''}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  downloads.enqueue(item.id, {
                    id: item.id,
                    title: item.title,
                    artist: item.artist,
                    thumbnailUrl: item.thumbnailUrl,
                  })
                }
                disabled={alreadySaved || busy}
                hitSlop={10}
                style={({ pressed }) => [styles.resultAction, pressed && { opacity: 0.6 }]}>
                {alreadySaved ? (
                  <Check size={20} color={colors.accent} />
                ) : busy ? (
                  <ActivityIndicator size="small" color={colors.textMuted} />
                ) : (
                  <Download size={20} color={colors.textMuted} />
                )}
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={
          jobs.length === 0 && !searching && !searchError ? (
            <View style={styles.hint}>
              <Text style={styles.hintTitle}>Cómo funciona</Text>
              <Text style={styles.hintBody}>
                Copia el link de un video en YouTube y pégalo arriba. La app extrae solo el audio,
                lo guarda en el dispositivo y desde ese momento suena sin conexión.
              </Text>
              <Text style={styles.hintNote}>
                Descarga únicamente contenido sobre el que tengas derechos.
              </Text>
            </View>
          ) : null
        }
      />
    </KeyboardAvoidingView>
  );
}

/** Tarjeta de una descarga en curso o terminada. */
function JobRow({ job }: { job: DownloadJob }) {
  const pct = job.progress != null ? Math.round(job.progress * 100) : null;
  const active = job.status === 'resolving' || job.status === 'downloading';

  return (
    <View style={styles.jobRow}>
      <Artwork uri={job.thumbnailUrl} size={46} />

      <View style={styles.jobMeta}>
        <Text style={styles.jobTitle} numberOfLines={1}>
          {job.title}
        </Text>

        {job.status === 'error' ? (
          // Los mensajes de error son justo los que hay que poder leer
          // completos, y son largos: 4 líneas y seleccionable para copiarlo.
          <Text style={styles.jobError} numberOfLines={4} selectable>
            {job.error}
          </Text>
        ) : (
          <Text style={styles.jobStatus} numberOfLines={1}>
            {job.status === 'resolving' && (job.stage ?? 'Resolviendo…')}
            {job.status === 'downloading' && (pct != null ? `${pct} %` : 'Descargando…')}
            {job.status === 'done' && 'Listo'}
            {job.status === 'cancelled' && 'Cancelada'}
          </Text>
        )}

        {job.status === 'downloading' && (
          <View style={styles.jobTrack}>
            <View
              style={[
                styles.jobFill,
                job.progress != null
                  ? { width: `${job.progress * 100}%` }
                  : // Sin tamaño total conocido dejamos una barra corta fija: es
                    // más honesto que una animación que insinúa un progreso real.
                    { width: '15%', opacity: 0.5 },
              ]}
            />
          </View>
        )}
      </View>

      {job.status === 'error' ? (
        <Pressable onPress={() => downloads.retry(job.id)} hitSlop={10}>
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      ) : job.status === 'done' ? (
        <Check size={20} color={colors.accent} />
      ) : active ? (
        <Pressable onPress={() => downloads.cancel(job.id)} hitSlop={10}>
          <X size={18} color={colors.textFaint} />
        </Pressable>
      ) : (
        <Pressable onPress={() => downloads.dismiss(job.id)} hitSlop={10}>
          <X size={18} color={colors.textFaint} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    paddingHorizontal: space.md,
    height: 50,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  input: { flex: 1, ...type.body, color: colors.text, padding: 0 },
  submit: { marginHorizontal: space.lg, marginTop: space.md },

  error: {
    ...type.small,
    color: colors.danger,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    lineHeight: 19,
  },

  finishedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: space.lg,
  },
  clearText: { ...type.small, color: colors.textMuted },

  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.sm,
    minHeight: layout.rowHeight,
  },
  jobMeta: { flex: 1, gap: 4 },
  jobTitle: { ...type.body, color: colors.text },
  jobStatus: { ...type.small, color: colors.textMuted },
  jobError: { ...type.small, color: colors.danger, lineHeight: 17 },
  jobTrack: {
    height: 3,
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    marginTop: 2,
    overflow: 'hidden',
  },
  jobFill: { height: '100%', backgroundColor: colors.accent, borderRadius: radius.pill },
  retryText: { ...type.small, color: colors.accent, fontWeight: '700' },

  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: layout.screenPadding,
    height: layout.rowHeight,
  },
  resultMeta: { flex: 1, gap: 3 },
  resultTitle: { ...type.body, color: colors.text },
  resultArtist: { ...type.small, color: colors.textMuted },
  resultAction: { width: 28, alignItems: 'center' },

  hint: {
    paddingHorizontal: space.xl,
    paddingTop: space.xxxl,
    gap: space.sm,
  },
  hintTitle: { ...type.heading, color: colors.text },
  hintBody: { ...type.body, color: colors.textMuted, lineHeight: 22 },
  hintNote: { ...type.small, color: colors.textFaint, marginTop: space.sm, lineHeight: 18 },
});
