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
        sans: ['var(--font-sans)', ...fontFamily.sans]
      },
      colors: {
        // Legacy brand token kept for backwards compatibility with any
        // component that still references `bg-brand` / `text-brand`.
        brand: {
          DEFAULT: '#1F2937',
          light: '#334155',
          dark: '#0F172A'
        },
        // Primary = slate brand. primary-600 (#1F2937) matches the original
        // `brand.DEFAULT`; tints above/below are the Tailwind gray scale so
        // `bg-primary-50` / `text-primary-700` read the way the old brand did.
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
          50: '#F9FAFB',
          100: '#F3F4F6',
          200: '#E5E7EB',
          300: '#D1D5DB',
          400: '#9CA3AF',
          500: '#4B5563',
          600: '#1F2937',
          700: '#111827',
          800: '#0B1220',
          900: '#030712'
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
        }
      },
      borderRadius: {
        card: '14px',
        pill: '9999px'
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -12px rgba(15, 23, 42, 0.12)',
        raised: '0 4px 12px rgba(15, 23, 42, 0.06), 0 20px 40px -16px rgba(15, 23, 42, 0.18)',
        focus: '0 0 0 4px hsl(var(--ring) / 0.25)'
      },
      fontSize: {
        eyebrow: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.18em', fontWeight: '600' }],
        display: ['2rem', { lineHeight: '2.4rem', letterSpacing: '-0.02em', fontWeight: '600' }],
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
