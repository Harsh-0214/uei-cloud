import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: { 950: '#020617' },
      },
    },
  },
};

export default config;
