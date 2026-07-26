import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, gradient, radius, space, type } from '@/theme';

import { Logo } from './Logo';

/* ------------------------------- encabezado ------------------------------ */

export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.headerSubtitle}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}

/* --------------------------------- botón --------------------------------- */

type ButtonProps = {
  label: string;
  onPress: () => void;
  /** `primary` lleva el degradado de marca; el resto son contenidos. */
  variant?: 'primary' | 'ghost' | 'danger';
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  style,
}: ButtonProps) {
  const inert = disabled || loading;

  const content = (
    <View style={styles.btnContent}>
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? colors.onAccent : colors.text}
        />
      ) : (
        icon
      )}
      <Text
        style={[
          styles.btnLabel,
          variant === 'primary' && { color: colors.onAccent },
          variant === 'danger' && { color: colors.danger },
        ]}>
        {label}
      </Text>
    </View>
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      style={({ pressed }) => [
        styles.btn,
        variant !== 'primary' && styles.btnGhost,
        inert && { opacity: 0.45 },
        pressed && !inert && { opacity: 0.8 },
        style,
      ]}>
      {variant === 'primary' ? (
        <LinearGradient
          colors={gradient.brand}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {content}
    </Pressable>
  );
}

/* ------------------------------ estado vacío ----------------------------- */

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <Logo size={72} variant="gradient" opacity={0.5} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {action}
    </View>
  );
}

/* ------------------------------- etiquetas ------------------------------- */

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.lg,
    gap: space.md,
  },
  headerTitle: {
    ...type.display,
    color: colors.text,
  },
  headerSubtitle: {
    ...type.small,
    color: colors.textMuted,
    marginTop: 3,
  },

  btn: {
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  btnGhost: {
    backgroundColor: colors.surfaceHi,
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  btnLabel: {
    ...type.heading,
    color: colors.text,
  },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxl,
    paddingBottom: space.xxxl,
    gap: space.md,
  },
  emptyTitle: {
    ...type.title,
    color: colors.text,
    marginTop: space.md,
    textAlign: 'center',
  },
  emptyMessage: {
    ...type.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
  },

  sectionLabel: {
    ...type.label,
    color: colors.textFaint,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: space.lg,
  },
});
