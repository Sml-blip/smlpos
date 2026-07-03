#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvFile(name) {
  const path = join(root, name)
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const local = loadEnvFile('.env.local')
for (const [k, v] of Object.entries(local)) {
  if (v) process.env[k] = v
}
if (local.GH_TOKEN) process.env.GH_TOKEN = local.GH_TOKEN
if (local.GITHUB_TOKEN) process.env.GH_TOKEN = process.env.GH_TOKEN || local.GITHUB_TOKEN
if (!process.env.SKIP_SUPABASE_CHECK && !local.VITE_SUPABASE_URL) {
  process.env.SKIP_SUPABASE_CHECK = '1'
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true, env: process.env })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run('npm', ['run', 'prepackage'])
run('npm', ['run', 'build'])
run('npx', ['electron-builder', '--win', 'nsis', '--publish', 'always'])
