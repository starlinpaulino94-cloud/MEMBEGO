/** @type {import('tailwindcss').Config} */
// Tailwind config is loaded by Tailwind/Metro as CJS; require() is mandatory.
/* eslint-disable @typescript-eslint/no-require-imports */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // ── Primary scale (aligned to the Vibe purple palette) ─────────
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
        membership: {
          active: '#0073ff',
          'pending-start': '#475569',
          'pending-end': '#334155',
          'expired-start': '#64748b',
          'expired-end': '#475569',
          'expired-status': '#ba1a1a',
          'sheen-shadow': 'rgba(0, 0, 0, 0.5)',
          'sheen-highlight': 'rgba(255, 255, 255, 0.5)',
          'icon-muted': 'rgba(255, 255, 255, 0.72)',
          'icon-subtle': 'rgba(255, 255, 255, 0.5)',
        },

        // ── Surfaces (aligned to .retail scope in globals.css) ────────
        background: '#ffffff',
        foreground: '#111827',
        card: {
          DEFAULT: '#ffffff',
          foreground: '#111827',
        },
        surface: {
          card: '#ffffff',
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
        ring: '#5b21b6',

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
          'primary-soft': '#ddd6fe',
          'primary-hover': '#4c1d95',
        },
      },

      spacing: {
        'wallet-card': '420px',
        'wallet-grid': '1200px',
        'wallet-inset': '26px',
        'wallet-content-y': '20px',
        'wallet-logo': '27px',
        'wallet-progress': '5px',
        'wallet-control': '28px',
      },
      aspectRatio: {
        'wallet-card': '1.5',
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
        'label-sm': [12, { lineHeight: 14 / 12, fontWeight: '500' }],
        'label-md': [12, { lineHeight: 16 / 12, fontWeight: '500' }],
        'label-lg': [14, { lineHeight: 18 / 14, fontWeight: '600' }],
        'price-sm': [13, { lineHeight: 16 / 13, fontWeight: '600' }],
        'price-lg': [20, { lineHeight: 24 / 20, letterSpacing: -0.2, fontWeight: '700' }],
        'wallet-company': ['12px', { lineHeight: '15px' }],
        'wallet-meta': ['8px', { lineHeight: '10px' }],
        'wallet-overline': ['8px', { lineHeight: '10px', letterSpacing: '2px' }],
        'wallet-state': ['14px', { lineHeight: '18px' }],
        'wallet-mark': ['9px', { lineHeight: '12px' }],
        'wallet-plan': ['20px', { lineHeight: '24px', letterSpacing: '1.4px' }],
        'wallet-plan-long': ['16px', { lineHeight: '20px', letterSpacing: '0.8px' }],
        'wallet-usage': ['9px', { lineHeight: '12px' }],
        'wallet-expiry': ['8px', { lineHeight: '11px' }],
        'wallet-caption': ['10px', { lineHeight: '12px' }],
      },

      // ── Border radius (existing — preserved) ───────────────────────
      borderRadius: {
        'wallet-card': '19px',
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
