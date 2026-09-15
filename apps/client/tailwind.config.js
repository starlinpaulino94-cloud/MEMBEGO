/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // ── Primary scale (existing — preserved) ──────────────────────
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
          foreground: '#ffffff',
        },

        // ── Retail palette (from @theme in globals.css) ───────────────
        retail: {
          blue: '#0284c7',
          deep: '#0369a1',
          cyan: '#06b6d4',
          mist: '#f0f9ff',
          star: '#f59e0b',
          lagoon: '#00687a',
        },

        // ── Vibe (existing — preserved) ───────────────────────────────
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

        // ── Surfaces (aligned to .retail scope in globals.css) ────────
        background: '#ffffff',
        foreground: '#111827',
        card: {
          DEFAULT: '#ffffff',
          foreground: '#111827',
        },
        muted: {
          DEFAULT: '#f3f4f6',
          foreground: '#4b5563',
        },
        secondary: {
          DEFAULT: '#f3f4f6',
          foreground: '#111827',
        },
        border: '#e5e7eb',
        input: '#e5e7eb',
        ring: '#0284c7',

        // ── Semantic states (hex from oklch in :root) ─────────────────
        success: {
          DEFAULT: '#00864d',
          foreground: '#fcfcfc',
        },
        warning: {
          DEFAULT: '#ab6300',
          foreground: '#fcfcfc',
        },
        destructive: {
          DEFAULT: '#e7000b',
          foreground: '#fcfcfc',
        },
        info: {
          DEFAULT: '#00809b',
          foreground: '#fcfcfc',
        },
        // Legacy alias kept for backwards compat with existing RN screens
        danger: '#e7000b',

        // ── Brand aliases (from DS 2.0 alias block) ───────────────────
        brand: {
          'primary-soft': '#ddecff',
          'primary-hover': '#0059ce',
        },
      },

      // ── Box shadows (from @layer utilities in globals.css) ──────────
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
        premium:
          '0 1px 2px rgb(15 23 42 / 0.04), 0 4px 12px -2px rgb(15 23 42 / 0.06), 0 12px 32px -8px rgb(15 23 42 / 0.08)',
        'premium-lg':
          '0 2px 4px rgb(15 23 42 / 0.04), 0 8px 24px -4px rgb(15 23 42 / 0.08), 0 24px 56px -12px rgb(15 23 42 / 0.14)',
        glow: '0 8px 30px -6px rgb(59 130 246 / 0.45)',
        'glow-strong': '0 12px 40px -4px rgb(59 130 246 / 0.6)',
        hero: '0 2px 6px rgb(15 23 42 / 0.05), 0 16px 40px -8px rgb(15 23 42 / 0.14), 0 32px 80px -16px rgb(15 23 42 / 0.18)',
        floating:
          '0 4px 12px rgb(15 23 42 / 0.10), 0 12px 40px -8px rgb(15 23 42 / 0.22)',
      },

      // ── Typography scale (from @layer utilities in globals.css) ─────
      // RN does not support clamp(); use the max (desktop) value.
      // letterSpacing in px (RN accepts px strings).
      fontSize: {
        h1: [32, { lineHeight: 1.15, letterSpacing: -0.64, fontWeight: '800' }],
        h2: [24, { lineHeight: 1.25, letterSpacing: -0.36, fontWeight: '700' }],
        h3: [17, { lineHeight: 1.3, letterSpacing: -0.17, fontWeight: '700' }],
        h4: [15, { lineHeight: 1.35, fontWeight: '600' }],
        body: [16, { lineHeight: 1.6 }],
        small: [14, { lineHeight: 1.5 }],
        caption: [12.5, { lineHeight: 1.45 }],
        overline: [12, { lineHeight: 1.4, letterSpacing: 0.96, fontWeight: '600' }],
        'label-sm': [12, { lineHeight: 14, fontWeight: '500' }],
        'label-md': [12, { lineHeight: 16, fontWeight: '500' }],
        'label-lg': [14, { lineHeight: 18, fontWeight: '600' }],
        'price-sm': [13, { lineHeight: 16, fontWeight: '600' }],
        'price-lg': [20, { lineHeight: 24, letterSpacing: -0.2, fontWeight: '700' }],
      },

      // ── Border radius (existing — preserved) ───────────────────────
      borderRadius: {
        '2xl': '20px',
        xl: '14px',
        lg: '12px',
        md: '10px',
        sm: '8px',
      },

      // ── Font family (Inter loaded in _layout.tsx) ──────────────────
      // font-sans (default) → Inter Regular
      // Use font-inter-* classes for specific weights (RN fontWeight doesn't switch families)
      fontFamily: {
        sans: ['Inter_400Regular', 'System'],
        'inter-medium': ['Inter_500Medium'],
        'inter-semibold': ['Inter_600SemiBold'],
        'inter-bold': ['Inter_700Bold'],
        'inter-extrabold': ['Inter_800ExtraBold'],
      },
    },
  },
  plugins: [],
};
