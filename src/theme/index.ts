import type { TextStyle } from 'react-native';

/**
 * Sistema de diseño de SK Music.
 *
 * La app es dark-only a propósito: es lo estándar en reproductores de música y
 * deja que el magenta funcione como único acento sin competir con nada.
 * La paleta de marca se usa con cuentagotas — acento, progreso, estado activo —
 * y el resto es escala de grises con tinte púrpura.
 */

/** Paleta de marca, tal cual fue definida. */
export const brand = {
  magenta: '#E60FFC',
  orchid: '#BB34C9',
  mauve: '#8E4596',
  plum: '#604263',
  ink: '#322C33',
} as const;

/**
 * Neutros derivados del `ink` de la paleta: mantienen el tinte púrpura en vez
 * de ser grises puros, así los fondos se sienten parte de la misma familia.
 */
export const colors = {
  bg: '#131116',
  surface: '#1B1820',
  surfaceHi: '#242029',
  border: 'rgba(255, 255, 255, 0.07)',
  borderStrong: 'rgba(255, 255, 255, 0.13)',

  text: '#F4F1F6',
  textMuted: '#9A92A2',
  textFaint: '#655D6D',

  accent: brand.magenta,
  accentSoft: brand.orchid,
  accentDim: brand.mauve,
  onAccent: '#12060F',

  danger: '#FF5B7A',
  scrim: 'rgba(10, 8, 12, 0.72)',
  ...brand,
} as const;

/** Degradado de marca. Se usa en el logo, carátulas vacías y el botón principal. */
export const gradient = {
  brand: [brand.magenta, brand.mauve] as const,
  brandSoft: [brand.orchid, brand.plum] as const,
  /** Para difuminar la parte baja del reproductor sobre la carátula. */
  fadeDown: ['transparent', 'rgba(19, 17, 22, 0.85)', '#131116'] as const,
};

/** Escala de espaciado de 4pt. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/**
 * Tipografía: pesos altos y tracking negativo en los títulos, tracking positivo
 * y mayúsculas en las etiquetas pequeñas. Ese contraste es lo que sostiene la
 * estética minimalista sin necesidad de bordes ni cajas.
 *
 * Va con `satisfies` y no con `as const`: necesitamos que TS valide cada entrada
 * contra TextStyle, pero `as const` congelaría `fontVariant` como tupla de sólo
 * lectura y dejaría de ser asignable al `FontVariant[]` mutable que pide RN.
 */
export const type = {
  display: { fontSize: 30, fontWeight: '700', letterSpacing: -0.7 },
  title: { fontSize: 21, fontWeight: '700', letterSpacing: -0.4 },
  heading: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '500', letterSpacing: -0.1 },
  small: { fontSize: 13, fontWeight: '500' },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' },
  mono: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;

export const layout = {
  screenPadding: space.lg,
  rowHeight: 60,
  miniPlayerHeight: 62,
  tabBarHeight: 58,
} as const;
