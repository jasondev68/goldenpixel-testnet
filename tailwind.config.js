/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        void: '#05050a',
        gold: {
          50: '#fff8e1',
          100: '#fbe8a6',
          200: '#f8d97a',
          300: '#f5c542',
          400: '#e8b032',
          500: '#c99a2e',
          600: '#a67c1d',
          700: '#7a5a12',
        },
        ink: '#f4efe3',
        mist: '#9a9384',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'sans-serif'],
        sans: ['"DM Sans"', 'ui-sans-serif', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
