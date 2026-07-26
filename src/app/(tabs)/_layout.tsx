import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Download, Library, Settings } from '@/components/Icons';
import { MiniPlayer } from '@/components/MiniPlayer';
import { colors, layout, type } from '@/theme';

/**
 * El mini reproductor se monta como hermano de las pestañas (`tabBar` de
 * expo-router sólo pinta la barra), así sobrevive a los cambios de pestaña y no
 * se reinicia el audio al navegar.
 */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <Tabs
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: colors.bg },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textFaint,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
            height: layout.tabBarHeight + insets.bottom,
            paddingTop: 6,
            paddingBottom: insets.bottom,
          },
          tabBarLabelStyle: { ...type.label, fontSize: 10, letterSpacing: 0.6 },
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Biblioteca',
            // `color` llega como ColorValue (admite PlatformColor); nuestros
            // iconos tipan string, y react-native-svg resuelve ambos igual.
            tabBarIcon: ({ color }) => <Library size={21} color={color as string} />,
          }}
        />
        <Tabs.Screen
          name="add"
          options={{
            title: 'Agregar',
            tabBarIcon: ({ color }) => <Download size={21} color={color as string} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Ajustes',
            tabBarIcon: ({ color }) => <Settings size={21} color={color as string} />,
          }}
        />
      </Tabs>

      <View style={[styles.mini, { bottom: layout.tabBarHeight + insets.bottom }]}>
        <MiniPlayer />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  mini: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});
