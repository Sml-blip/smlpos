import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone Vite config for browser preview (no Electron)
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
  plugins: [react()],
  css: {
    postcss: resolve(__dirname, 'postcss.config.js'),
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  // Stub out node-only modules that Electron uses
  define: {
    'process.env.NODE_ENV': '"development"',
  },
})
