/**
 * Tokens de diseño para apps/client (React Native).
 *
 * Alineados al contrato canónico: docs/design/client-design-contract.md
 * Fuente canónica RN: apps/client/tailwind.config.js (F4).
 *
 * Este módulo es un reflejo en TS del tailwind config para consumidores que
 * necesitan los valores en JS (ej. estilos inline, animaciones). NativeWind
 * consume directamente tailwind.config.js; este archivo NO es la fuente de
 * verdad de las clases CSS.
 */
export const colors = {
  primary: {
    50: '#f5f3ff',
    100: '#ede9fe',
    200: '#ddd6fe',
    300: '#c4b5fd',
    400: '#a78bfa',
    500: '#8b5cf6',
    600: '#7c3aed',
    700: '#5b21b6',
    800: '#4c1d95',
    900: '#3b0764',
    DEFAULT: '#5b21b6',
  },
  retail: {
    blue: '#0284c7',
    deep: '#0369a1',
    cyan: '#06b6d4',
    mist: '#f0f9ff',
    star: '#f59e0b',
    lagoon: '#00687a',
  },
  membership: {
    active: '#0073ff',
    pendingStart: '#475569',
    pendingEnd: '#334155',
    expiredStart: '#64748b',
    expiredEnd: '#475569',
    expiredStatus: '#ba1a1a',
    expiredStatusBorder: 'rgba(186, 26, 26, 0.3)',
    expiredStatusSurface: 'rgba(186, 26, 26, 0.25)',
    sheenShadow: 'rgba(0, 0, 0, 0.5)',
    sheenHighlight: 'rgba(255, 255, 255, 0.5)',
    iconMuted: 'rgba(255, 255, 255, 0.72)',
    iconSubtle: 'rgba(255, 255, 255, 0.5)',
  },
  vibe: {
    violet: '#7c3aed',
    deep: '#5b21b6',
    ink: '#630ed4',
    cobalt: '#2563eb',
    lavanda: '#dce9ff',
    niebla: '#e5eeff',
    borde: '#e0e7ff',
    chip: '#ddd6fe',
    fondo: '#f8f9ff',
    celeste: '#c7d2fe',
    sky: '#38bdf8',
    aqua: '#67e8f9',
  },
  category: {
    amber: '#f59e0b',
    orange: '#f97316',
    emerald: '#10b981',
    teal: '#14b8a6',
    cyan: '#06b6d4',
    sky: '#0ea5e9',
    indigo: '#6366f1',
    blue: '#3b82f6',
    pink: '#ec4899',
    rose: '#f43f5e',
  },
  categoryText: {
    orange: '#c2410c',
    teal: '#0f766e',
    sky: '#0369a1',
    blue: '#1d4ed8',
    rose: '#be123c',
  },
  state: {
    success: '#00864d',
    warning: '#ab6300',
    danger: '#e7000b',
    info: '#00809b',
  },
  surface: {
    background: '#ffffff',
    card: '#ffffff',
    foreground: '#111827',
    muted: '#f3f4f6',
    mutedForeground: '#4b5563',
    border: '#e5e7eb',
    input: '#e5e7eb',
    ring: '#5b21b6',
  },
  overlay: {
    transparent: 'transparent',
    heroMid: 'rgba(30, 27, 75, 0.5)',
    heroDeep: '#0b0f19',
    whiteTransparent: 'rgba(255, 255, 255, 0)',
  },
  gradient: {
    primary: ['#5b21b6', '#7c3aed', '#2563eb', '#06b6d4'] as const,
    premium: ['#5b21b6', '#2563eb', '#06b6d4'] as const,
    categories: [
      ['#7c3aed', '#2563eb'],
      ['#f59e0b', '#f97316'],
      ['#10b981', '#14b8a6'],
      ['#06b6d4', '#0ea5e9'],
      ['#6366f1', '#3b82f6'],
      ['#ec4899', '#f43f5e'],
    ] as const,
  },
} as const;

export const walletCard = {
  grid: {
    maxWidth: 1200,
    maxCardWidth: 420,
    twoColumnBreakpoint: 704,
    threeColumnBreakpoint: 992,
    gap: 16,
  },
  geometry: {
    width: 300,
    aspectRatio: 1.5,
    radius: 19,
    inset: 26,
    contentPaddingY: 20,
    logoSize: 27,
    progressHeight: 5,
    controlSize: 28,
  },
  typography: {
    company: { fontSize: 12, lineHeight: 15 },
    meta: { fontSize: 8, lineHeight: 10 },
    mark: { fontSize: 9, lineHeight: 12 },
    overline: { fontSize: 8, lineHeight: 10, letterSpacing: 2 },
    plan: { fontSize: 20, lineHeight: 24, letterSpacing: 1.4 },
    planLong: { fontSize: 16, lineHeight: 20, letterSpacing: 0.8 },
    usage: { fontSize: 9, lineHeight: 12 },
    expiry: { fontSize: 8, lineHeight: 11 },
    state: { fontSize: 14, lineHeight: 18 },
    caption: { fontSize: 10, lineHeight: 12 },
  },
  gradient: {
    pending: [colors.membership.pendingStart, colors.membership.pendingEnd],
    expired: [colors.membership.expiredStart, colors.membership.expiredEnd],
    sheen: [
      colors.membership.sheenShadow,
      colors.membership.sheenHighlight,
      colors.membership.sheenShadow,
    ],
    sheenLocations: [0.19153, 0.62308, 1],
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
  },
  iconColor: {
    muted: colors.membership.iconMuted,
    subtle: colors.membership.iconSubtle,
  },
  iconSize: {
    shield: 11,
    qr: 20,
    clock: 9,
    flip: 15,
    details: 14,
  },
  qr: {
    foreground: colors.surface.foreground,
    size: 108,
  },
  blurIntensity: 44,
  iconStrokeWidth: 1.7,
  perspective: 1400,
  flipDuration: 350,
} as const;

export const radii = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
  '2xl': 20,
  pill: 999,
} as const;
