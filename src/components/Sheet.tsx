import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, space, type } from '@/theme';

type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
};

/**
 * Hoja inferior sobre Modal nativo.
 *
 * Se prefiere esto a `Alert.alert` con botones porque Alert se ve distinto en
 * cada sistema y no admite la paleta. Aquí el aspecto es idéntico en Android e
 * iOS y consistente con el resto de la app.
 *
 * La hoja va dentro de un KeyboardAvoidingView: en iOS el teclado no empuja
 * nada por sí solo y tapaba los campos de texto de las hojas con formulario.
 * En Android la ventana del Modal ya se redimensiona sola.
 */
export function Sheet({ visible, onClose, title, subtitle, children }: SheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.avoider}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}>
          <View style={styles.grabber} />
          {!!title && (
            <View style={styles.head}>
              <Text style={styles.title} numberOfLines={2}>
                {title}
              </Text>
              {!!subtitle && (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              )}
            </View>
          )}
          {/* `handled`: con el teclado abierto, el primer toque en un botón de
              la hoja tiene que pulsarlo, no sólo cerrar el teclado. */}
          <ScrollView bounces={false} keyboardShouldPersistTaps="handled" style={styles.body}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Fila de acción dentro de una hoja. */
export function SheetItem({
  label,
  icon,
  onPress,
  danger = false,
  trailing,
}: {
  label: string;
  icon?: ReactNode;
  onPress: () => void;
  danger?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surfaceHi }]}>
      {icon}
      <Text style={[styles.itemLabel, danger && { color: colors.danger }]} numberOfLines={1}>
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.scrim,
  },
  /* Ocupa toda la pantalla para poder empujar la hoja hacia arriba, pero deja
     pasar los toques del hueco vacío al fondo, que es el que cierra. */
  avoider: {
    flex: 1,
    justifyContent: 'flex-end',
    pointerEvents: 'box-none',
  },
  body: { maxHeight: 420 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: space.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: space.md,
  },
  head: {
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    gap: 3,
  },
  title: {
    ...type.heading,
    color: colors.text,
  },
  subtitle: {
    ...type.small,
    color: colors.textMuted,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 15,
  },
  itemLabel: {
    ...type.body,
    color: colors.text,
    flex: 1,
  },
});
