import type { Config } from 'tailwindcss';
import { fontFamily } from 'tailwindcss/defaultTheme';
import animatePlugin from 'tailwindcss-animate';

const config: Config = {
  content: [
    './src/pages/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}'
  ],
  darkMode: 'selector',
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', ...fontFamily.sans],
        display: ['var(--font-display)', ...fontFamily.sans],
        manrope: ['var(--font-manrope)', ...fontFamily.sans],
        mono: ['var(--font-mono)', ...fontFamily.mono]
      },
      colors: {
        // Legacy brand token kept for backwards compatibility with any
        // component that still references `bg-brand` / `text-brand`.
        brand: {
          DEFAULT: '#0F172A',
          light: '#24304C',
          dark: '#04070E'
        },
        // Navy (matching the sidebar) gives interactive work a consistent signal.
        // `hover` and `active` lift rather than darken — near-black has nowhere
        // darker to go, so the usual 600→700 step reads as no feedback at all.
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          hover: 'hsl(var(--primary-hover) / <alpha-value>)',
          active: 'hsl(var(--primary-active) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
          soft: 'hsl(var(--primary-soft) / <alpha-value>)'
        },
        signal: {
          DEFAULT: 'hsl(var(--signal) / <alpha-value>)',
          foreground: 'hsl(var(--signal-foreground) / <alpha-value>)',
          soft: 'hsl(var(--signal-soft) / <alpha-value>)',
          dark: '#B9472E'
        },
        // Semantic tokens backed by CSS variables declared in globals.css.
        surface: {
          DEFAULT: 'hsl(var(--surface) / <alpha-value>)',
          muted: 'hsl(var(--surface-muted) / <alpha-value>)',
          raised: 'hsl(var(--surface-raised) / <alpha-value>)',
          subtle: 'hsl(var(--surface-subtle) / <alpha-value>)'
        },
        border: {
          DEFAULT: 'hsl(var(--border) / <alpha-value>)',
          strong: 'hsl(var(--border-strong) / <alpha-value>)'
        },
        foreground: {
          DEFAULT: 'hsl(var(--text) / <alpha-value>)',
          muted: 'hsl(var(--text-muted) / <alpha-value>)',
          subtle: 'hsl(var(--text-subtle) / <alpha-value>)'
        },
        ring: 'hsl(var(--ring) / <alpha-value>)',
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          foreground: 'hsl(var(--success-foreground) / <alpha-value>)',
          soft: 'hsl(var(--success-soft) / <alpha-value>)'
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
          foreground: 'hsl(var(--warning-foreground) / <alpha-value>)',
          soft: 'hsl(var(--warning-soft) / <alpha-value>)'
        },
        danger: {
          DEFAULT: 'hsl(var(--danger) / <alpha-value>)',
          foreground: 'hsl(var(--danger-foreground) / <alpha-value>)',
          soft: 'hsl(var(--danger-soft) / <alpha-value>)'
        },
        info: {
          DEFAULT: 'hsl(var(--info) / <alpha-value>)',
          foreground: 'hsl(var(--info-foreground) / <alpha-value>)',
          soft: 'hsl(var(--info-soft) / <alpha-value>)'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
          soft: 'hsl(var(--accent-soft) / <alpha-value>)'
        }
      },
      borderRadius: {
        // Softened to match the 16px card radius without touching the ~300
        // existing `rounded-md` / `rounded-lg` call sites.
        md: '8px',
        lg: '10px',
        card: '16px',
        pill: '9999px'
      },
      boxShadow: {
        card: '0 1px 2px rgba(20, 20, 60, 0.04), 0 10px 30px -14px rgba(20, 20, 60, 0.14)',
        raised: '0 4px 14px rgba(20, 20, 60, 0.06), 0 24px 48px -18px rgba(20, 20, 60, 0.20)',
        focus: '0 0 0 4px hsl(var(--ring) / 0.22)'
      },
      fontSize: {
        eyebrow: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.18em', fontWeight: '600' }],
        display: ['2rem', { lineHeight: '2.3rem', letterSpacing: '-0.035em', fontWeight: '650' }],
        title: ['1.25rem', { lineHeight: '1.6rem', letterSpacing: '-0.01em', fontWeight: '600' }]
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' }
        },
        'slide-out-right': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(100%)' }
        }
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-in-right': 'slide-in-right 200ms ease-out',
        'slide-out-right': 'slide-out-right 200ms ease-in'
      }
    }
  },
  plugins: [animatePlugin]
};

export default config;
