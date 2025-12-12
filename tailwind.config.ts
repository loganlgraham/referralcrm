import type { Config } from 'tailwindcss';
import { fontFamily } from 'tailwindcss/defaultTheme';

const config: Config = {
  content: [
    './src/pages/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}'
  ],
  darkMode: 'media',
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', ...fontFamily.sans]
      },
      colors: {
        brand: {
          DEFAULT: '#1F2937',
          light: '#334155',
          dark: '#0F172A',
          accent: '#4EA66D',
          'accent-dark': '#3b8556'
        }
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
};

export default config;
