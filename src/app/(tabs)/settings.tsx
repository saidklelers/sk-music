import Constants from 'expo-constants';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Logo } from '@/components/Logo';
import { ScreenHeader, SectionLabel } from '@/components/Primitives';
import { availableSpace, pruneOrphans } from '@/downloads/storage';
import { useLibrary } from '@/library/LibraryProvider';
import { formatBytes, pluralTracks } from '@/lib/format';
import { colors, layout, radius, space, type } from '@/theme';
import { diagnose } from '@/youtube/diagnose';
import { resetInnertube } from '@/youtube/innertube';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { tracks, playlists, librarySize, refresh } = useLibrary();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  /** Prueba la cadena completa y deja el informe en pantalla para copiarlo. */
  const runDiagnosis = useCallback(async () => {
    setDiagnosing(true);
    setReport('Probando…');
    try {
      setReport(await diagnose());
    } catch (err) {
      setReport(`El diagnóstico falló: ${err instanceof Error ? err.message : 'error'}`);
    } finally {
      setDiagnosing(false);
    }
  }, []);

  /** Borra audio y carátulas que quedaron sin registro en la base. */
  const cleanOrphans = useCallback(async () => {
    setBusy(true);
    try {
      const freed = pruneOrphans(
        tracks.map((t) => t.file_name),
        tracks.map((t) => t.artwork_name).filter((n): n is string => !!n),
      );
      await refresh();
      Alert.alert(
        'Limpieza terminada',
        freed > 0
          ? `Se liberaron ${formatBytes(freed)} de descargas incompletas.`
          : 'No había archivos sueltos que borrar.',
      );
    } finally {
      setBusy(false);
    }
  }, [tracks, refresh]);

  const reconnect = useCallback(() => {
    resetInnertube();
    Alert.alert(
      'Sesión reiniciada',
      'La próxima descarga volverá a negociar la conexión con YouTube desde cero.',
    );
  }, []);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{
        paddingTop: insets.top,
        paddingBottom: layout.miniPlayerHeight + space.xxxl,
      }}>
      <ScreenHeader title="Ajustes" />

      <SectionLabel>Almacenamiento</SectionLabel>
      <View style={styles.card}>
        <Row label="Canciones" value={pluralTracks(tracks.length)} />
        <Row label="Listas" value={String(playlists.length)} />
        <Row label="Ocupado" value={formatBytes(librarySize)} />
        <Row label="Libre en el equipo" value={formatBytes(availableSpace())} last />
      </View>

      <SectionLabel>Mantenimiento</SectionLabel>
      <View style={styles.card}>
        <Action
          label="Limpiar archivos sueltos"
          hint="Borra descargas a medias que ya no aparecen en la biblioteca."
          onPress={() => void cleanOrphans()}
          disabled={busy}
        />
        <Action
          label="Reiniciar conexión con YouTube"
          hint="Úsalo si las descargas empiezan a fallar de un momento a otro."
          onPress={reconnect}
        />
        <Action
          label={diagnosing ? 'Probando…' : 'Probar conexión con YouTube'}
          hint="Comprueba red, sesión y cada cliente por separado, con tiempos."
          onPress={() => void runDiagnosis()}
          disabled={diagnosing}
          last
        />
      </View>

      {!!report && (
        <View style={styles.report}>
          <Text style={styles.reportText} selectable>
            {report}
          </Text>
        </View>
      )}

      <SectionLabel>Acerca de</SectionLabel>
      <View style={styles.about}>
        <Logo size={44} />
        <View style={{ gap: 3 }}>
          <Text style={styles.aboutName}>SK Music</Text>
          <Text style={styles.aboutVersion}>
            Versión {Constants.expoConfig?.version ?? '1.0.0'}
          </Text>
        </View>
      </View>

      <Text style={styles.legal}>
        La extracción de audio ocurre por completo en el dispositivo, sin servidores intermedios.
        Descarga únicamente contenido sobre el que tengas derechos.
      </Text>

      <Text style={styles.legal}>
        Si las descargas dejan de funcionar de golpe, casi siempre es porque YouTube cambió algo:
        actualiza la dependencia youtubei.js y vuelve a compilar la app.
      </Text>
    </ScrollView>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function Action({
  label,
  hint,
  onPress,
  disabled,
  last,
}: {
  label: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        !last && styles.rowBorder,
        disabled && { opacity: 0.5 },
        pressed && { backgroundColor: colors.surfaceHi },
      ]}>
      <Text style={styles.actionLabel}>{label}</Text>
      <Text style={styles.actionHint}>{hint}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  card: {
    marginHorizontal: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: 14,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: { ...type.body, color: colors.textMuted },
  rowValue: { ...type.body, color: colors.text },

  report: {
    marginHorizontal: space.lg,
    marginTop: space.md,
    padding: space.md,
    backgroundColor: colors.surfaceHi,
    borderRadius: radius.md,
  },
  reportText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 19,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },

  action: { paddingHorizontal: space.lg, paddingVertical: 14, gap: 4 },
  actionLabel: { ...type.body, color: colors.text },
  actionHint: { ...type.small, color: colors.textFaint, lineHeight: 17 },

  about: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  aboutName: { ...type.heading, color: colors.text },
  aboutVersion: { ...type.small, color: colors.textMuted },

  legal: {
    ...type.small,
    color: colors.textFaint,
    lineHeight: 18,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
});
