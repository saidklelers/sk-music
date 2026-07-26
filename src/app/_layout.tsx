import '@/lib/polyfills'; // debe evaluarse antes que cualquier cosa que toque youtubei.js

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DB_NAME, migrate } from '@/db';
import { LibraryProvider } from '@/library/LibraryProvider';
import { PlayerProvider } from '@/player/PlayerProvider';
import { colors } from '@/theme';
import { warmUp } from '@/youtube/innertube';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  // El splash se cierra cuando la base ya migró, así la primera pantalla nunca
  // aparece vacía y luego se llena de golpe.
  const onInit = useCallback(async (db: Parameters<typeof migrate>[0]) => {
    await migrate(db);
    await SplashScreen.hideAsync().catch(() => {});
  }, []);

  // La primera conexión a YouTube puede tardar minutos (DNS/IPv6 en frío) y
  // luego milisegundos. Se dispara al abrir la app para que ese coste no caiga
  // sobre la primera descarga.
  useEffect(() => {
    warmUp();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <SQLiteProvider databaseName={DB_NAME} onInit={onInit}>
          {/* PlayerProvider va por fuera: LibraryProvider lo consume para sacar
              de la cola las canciones que se borran. */}
          <PlayerProvider>
            <LibraryProvider>
              <StatusBar style="light" />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.bg },
                }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                  name="player"
                  options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
                />
                <Stack.Screen name="playlist/[id]" options={{ animation: 'slide_from_right' }} />
              </Stack>
            </LibraryProvider>
          </PlayerProvider>
        </SQLiteProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
