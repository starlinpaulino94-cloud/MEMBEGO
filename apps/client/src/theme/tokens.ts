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
    50: '#f0f6ff',
    100: '#ddecff',
    200: '#bedcff',
    300: '#92c4ff',
    400: '#52a2ff',
    500: '#0084ff',
    600: '#006bed',
    700: '#0059ce',
    800: '#0049a7',
    900: '#004087',
    DEFAULT: '#0284c7',
  },
  retail: {
    blue: '#0284c7',
    deep: '#0369a1',
    cyan: '#06b6d4',
    mist: '#f0f9ff',
    star: '#f59e0b',
    lagoon: '#00687a',
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
    ring: '#0284c7',
  },
  overlay: {
    transparent: 'transparent',
    heroMid: 'rgba(30, 27, 75, 0.5)',
    heroDeep: '#0b0f19',
    whiteTransparent: 'rgba(255, 255, 255, 0)',
  },
  gradient: {
    primary: ['#006bed', '#06b6d4'] as const,
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

export const radii = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
  '2xl': 20,
  pill: 999,
} as const;
