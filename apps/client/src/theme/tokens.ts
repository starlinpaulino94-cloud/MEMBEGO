/**
 * Tokens de diseño para NativeWind en apps/client
 * Sincronizados exactamente con packages/ui/src/tokens.ts
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
    DEFAULT: '#006bed',
  },
  vibe: {
    purple: '#7c3aed',
    headerPurple: '#5b21b6',
    blue: '#2563eb',
    cyan: '#06b6d4',
    fondo: '#0b0f19',
    card: '#131927',
    cardBorder: 'rgba(255, 255, 255, 0.1)',
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
