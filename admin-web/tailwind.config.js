/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#0f172a',
        panel: '#111827',
        border: '#1f2937',
      },
    },
  },
  plugins: [],
};
