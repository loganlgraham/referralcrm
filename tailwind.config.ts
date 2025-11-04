import type { Config } from 'tailwindcss';
import { fontFamily } from 'tailwindcss/defaultTheme';

const config: Config = {
  content: [
    './src/pages/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/app/**/*.{ts,tsx}'
  ],
  darkMode: ['class'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', ...fontFamily.sans]
      },
      colors: {
        brand: {
          DEFAULT: '#0F4C81',
          light: '#2f6aa3',
          dark: '#0b365d'
        }
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
};

export default config;
