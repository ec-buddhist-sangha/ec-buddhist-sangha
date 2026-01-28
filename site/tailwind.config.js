/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./hugo.yaml', './layouts/**/*', './content/**/*', './static/**/*'],
  theme: {
    extend: {
      colors: {
        'sangha-navy': '#1B3B5A',
        'sangha-gold': '#C59D45',
        'sangha-light': '#F5F5F0',
        'sangha-paper': '#FAFAF8',
      },
      fontFamily: {
        serif: ['Merriweather', 'Georgia', 'serif'],
        sans: ['Lato', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
