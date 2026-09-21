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
  state: {
    success: '#00864d',
    warning: '#ab6300',
    danger: '#e7000b',
    info: '#00809b',
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
