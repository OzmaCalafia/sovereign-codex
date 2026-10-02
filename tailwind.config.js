/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        codex: {
          bg: '#090a0f',
          panel: '#12141d',
          border: '#2a2e3d',
          text: '#e2e8f0',
          accent: '#38bdf8'
        }
      },
      fontFamily: {
        sans: ['Ubuntu', 'sans-serif'],
        mono: ['Ubuntu', 'sans-serif']
      }
    },
  },
  plugins: [],
}
