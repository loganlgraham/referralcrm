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
          DEFAULT: '#4EA66D',
          light: '#6FBE8B',
          dark: '#3B7E56'
        }
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
};

export default config;
