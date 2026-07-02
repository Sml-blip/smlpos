import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const root = join(dirname(fileURLToPath(import.meta.url)))

function loadEnvFile(name: string): Record<string, string> {
  const path = join(root, name)
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...loadEnvFile('.env'), ...loadEnvFile('.env.local'), ...process.env }
const supabaseUrl = env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY ?? ''

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __SML_SUPABASE_URL__: JSON.stringify(supabaseUrl),
      __SML_SUPABASE_ANON_KEY__: JSON.stringify(supabaseAnonKey),
    },
    build: {
      rollupOptions: {
        external: ['better-sqlite3']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    css: {
      postcss: './postcss.config.js'
    }
  }
})
