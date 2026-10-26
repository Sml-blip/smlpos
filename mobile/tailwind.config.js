/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        canvas: '#FDFBF5',
        surface: '#FFFFFF',
        muted: '#F9F6ED',
        ink: '#1A1A1A',
        secondary: '#5C5C5C',
        subtle: '#9E9E9E',
        line: '#E8E2D0',
        brand: '#FFD600',
        'brand-dark': '#F9A825',
        'brand-soft': '#FFFDE7',
        success: '#2E7D32',
        danger: '#C62828',
        info: '#2563EB'
      },
      borderRadius: {
        card: '18px'
      },
      fontFamily: {
        sans: ['PlusJakartaSans']
      }
    }
  },
  plugins: []
}

