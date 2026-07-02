import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { app } from 'electron'
import { createReadStream, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { hostname } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { getDb } from './db'
import { createProtectedBackup, resolveLiveDbPath } from './backupService'

const RETENTION_DAYS = 30
const UPLOAD_INTERVAL_MS = 60 * 60 * 1000
const R2_PREFIX = 'snapshots'

/** Built-in R2 defaults — used when env/settings are empty (works out of the box). */
const R2_BUILT_IN = {
  endpoint: 'https://f41f0491f27adcea5c38afd25e244765.r2.cloudflarestorage.com',
  bucket: 'smlpos',
  accessKeyId: '053d5f9c1dc031fed95ded144c57eba3',
  secretAccessKey: 'c2f3cc80323c8e51d69a895c7a779620db84cf97b4414fe43a21630259c0d641',
} as const

export type R2Snapshot = {
  key: string
  size: number
  lastModified: number
  machineId: string
  label: string
}

export type R2Status = {
  configured: boolean
  enabled: boolean
  machineId: string
  bucket: string
  endpoint: string
  lastUploadAt: number | null
  lastUploadKey: string | null
  lastError: string | null
  snapshotCount: number
  nextUploadInMs: number | null
}

type R2Config = {
  enabled: boolean
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

function loadEnvFile(name: string): Record<string, string> {
  try {
    const root = app.getAppPath()
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
  } catch {
    return {}
  }
}

function getSetting(key: string): string {
  try {
    const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value?: string } | undefined
    return row?.value?.trim() ?? ''
  } catch {
    return ''
  }
}

function setSetting(key: string, value: string): void {
  getDb().prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value)
}

function getR2Config(): R2Config | null {
  const env = { ...loadEnvFile('.env'), ...loadEnvFile('.env.local'), ...process.env }

  const endpoint = (env.R2_ENDPOINT || getSetting('r2_endpoint') || R2_BUILT_IN.endpoint).trim()
  const bucket = (env.R2_BUCKET || getSetting('r2_bucket') || R2_BUILT_IN.bucket).trim()
  const accessKeyId = (env.R2_ACCESS_KEY_ID || getSetting('r2_access_key_id') || R2_BUILT_IN.accessKeyId).trim()
  const secretAccessKey = (env.R2_SECRET_ACCESS_KEY || getSetting('r2_secret_access_key') || R2_BUILT_IN.secretAccessKey).trim()
  const enabledRaw = env.R2_ENABLED ?? getSetting('r2_enabled')
  const enabled = enabledRaw !== 'false' && enabledRaw !== '0'

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null
  return { enabled, endpoint, bucket, accessKeyId, secretAccessKey }
}

export function getOrCreateMachineId(): string {
  let id = getSetting('r2_machine_id')
  if (id) return id
  const host = hostname().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32) || 'pc'
  id = `${host}-${randomUUID().slice(0, 8)}`
  setSetting('r2_machine_id', id)
  return id
}

function createClient(config: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

function hourSlug(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  return `${y}-${m}-${day}/${h}-00`
}

function snapshotKey(machineId: string, d = new Date()): string {
  return `${R2_PREFIX}/${machineId}/${hourSlug(d)}/smlpos.db`
}

function parseSnapshotKey(key: string): { machineId: string; label: string } | null {
  const m = key.match(/^snapshots\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/(\d{2})-00\/smlpos\.db$/)
  if (!m) return null
  return {
    machineId: m[1],
    label: `${m[2]} ${m[3]}:00`,
  }
}

function getLastUploadMeta(): { at: number | null; key: string | null; error: string | null } {
  const atRaw = getSetting('r2_last_upload_at')
  const at = atRaw ? Number(atRaw) : null
  return {
    at: at != null && Number.isFinite(at) ? at : null,
    key: getSetting('r2_last_upload_key') || null,
    error: getSetting('r2_last_upload_error') || null,
  }
}

function recordUploadSuccess(key: string): void {
  setSetting('r2_last_upload_at', String(Date.now()))
  setSetting('r2_last_upload_key', key)
  setSetting('r2_last_upload_error', '')
}

function recordUploadError(message: string): void {
  setSetting('r2_last_upload_error', message.slice(0, 500))
}

export function isR2Configured(): boolean {
  return getR2Config() != null
}

export async function getR2Status(): Promise<R2Status> {
  const config = getR2Config()
  const machineId = getOrCreateMachineId()
  const meta = getLastUploadMeta()

  if (!config) {
    return {
      configured: false,
      enabled: false,
      machineId,
      bucket: '',
      endpoint: '',
      lastUploadAt: meta.at,
      lastUploadKey: meta.key,
      lastError: meta.error,
      snapshotCount: 0,
      nextUploadInMs: null,
    }
  }

  let snapshotCount = 0
  try {
    const snaps = await listR2Snapshots({ machineId, maxDays: RETENTION_DAYS })
    snapshotCount = snaps.length
  } catch {
    // ignore list errors for status banner
  }

  const elapsed = meta.at ? Date.now() - meta.at : null
  const nextUploadInMs = elapsed == null ? 0 : Math.max(0, UPLOAD_INTERVAL_MS - elapsed)

  return {
    configured: true,
    enabled: config.enabled,
    machineId,
    bucket: config.bucket,
    endpoint: config.endpoint,
    lastUploadAt: meta.at,
    lastUploadKey: meta.key,
    lastError: meta.error,
    snapshotCount,
    nextUploadInMs,
  }
}

export async function testR2Connection(): Promise<{ ok: boolean; error?: string }> {
  const config = getR2Config()
  if (!config) return { ok: false, error: 'R2 non configuré (endpoint, bucket, clés manquants)' }
  try {
    const client = createClient(config)
    await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: `${R2_PREFIX}/`,
      MaxKeys: 1,
    }))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function listR2Snapshots(opts?: {
  machineId?: string
  maxDays?: number
}): Promise<R2Snapshot[]> {
  const config = getR2Config()
  if (!config) return []

  const machineId = opts?.machineId ?? getOrCreateMachineId()
  const maxDays = opts?.maxDays ?? RETENTION_DAYS
  const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000
  const client = createClient(config)
  const prefix = `${R2_PREFIX}/${machineId}/`

  const out: R2Snapshot[] = []
  let token: string | undefined

  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: prefix,
      ContinuationToken: token,
    }))
    for (const obj of res.Contents ?? []) {
      if (!obj.Key || !obj.LastModified) continue
      const ts = obj.LastModified.getTime()
      if (ts < cutoff) continue
      const parsed = parseSnapshotKey(obj.Key)
      out.push({
        key: obj.Key,
        size: obj.Size ?? 0,
        lastModified: ts,
        machineId: parsed?.machineId ?? machineId,
        label: parsed?.label ?? obj.Key.split('/').slice(-3, -1).join(' '),
      })
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)

  return out.sort((a, b) => b.lastModified - a.lastModified)
}

async function pruneOldSnapshots(client: S3Client, config: R2Config, machineId: string): Promise<number> {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  const prefix = `${R2_PREFIX}/${machineId}/`
  const toDelete: { Key: string }[] = []
  let token: string | undefined

  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: prefix,
      ContinuationToken: token,
    }))
    for (const obj of res.Contents ?? []) {
      if (!obj.Key || !obj.LastModified) continue
      if (obj.LastModified.getTime() < cutoff) toDelete.push({ Key: obj.Key })
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined
  } while (token)

  if (!toDelete.length) return 0

  for (let i = 0; i < toDelete.length; i += 1000) {
    await client.send(new DeleteObjectsCommand({
      Bucket: config.bucket,
      Delete: { Objects: toDelete.slice(i, i + 1000) },
    }))
  }
  return toDelete.length
}

export async function uploadR2Snapshot(force = false): Promise<{
  success: boolean
  key?: string
  skipped?: boolean
  error?: string
}> {
  const config = getR2Config()
  if (!config) return { success: false, error: 'R2 non configuré' }
  if (!config.enabled) return { success: false, error: 'Sauvegarde cloud désactivée' }

  const meta = getLastUploadMeta()
  if (!force && meta.at && Date.now() - meta.at < UPLOAD_INTERVAL_MS) {
    return { success: true, skipped: true, key: meta.key ?? undefined }
  }

  try {
    const backup = createProtectedBackup('scheduled')
    const dbPath = backup?.archivePath ?? resolveLiveDbPath()
    if (!existsSync(dbPath)) return { success: false, error: 'Base de données introuvable' }

    const machineId = getOrCreateMachineId()
    const key = snapshotKey(machineId)
    const client = createClient(config)

    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: createReadStream(dbPath),
      ContentType: 'application/x-sqlite3',
      Metadata: {
        machine_id: machineId,
        app_version: app.getVersion(),
      },
    }))

    const pruned = await pruneOldSnapshots(client, config, machineId)
    recordUploadSuccess(key)
    console.log(`[r2] Snapshot uploaded: ${key}${pruned ? ` (pruned ${pruned})` : ''}`)
    return { success: true, key }
  } catch (e) {
    const msg = String(e)
    recordUploadError(msg)
    console.warn('[r2] Upload failed:', e)
    return { success: false, error: msg }
  }
}

export async function downloadR2Snapshot(key: string): Promise<{ success: boolean; path?: string; error?: string }> {
  const config = getR2Config()
  if (!config) return { success: false, error: 'R2 non configuré' }

  try {
    const client = createClient(config)
    const got = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
    const body = got.Body
    if (!body) return { success: false, error: 'Fichier vide' }

    const tmpDir = join(app.getPath('temp'), 'smlpos-r2')
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
    const localPath = join(tmpDir, `restore_${Date.now()}.db`)

    const chunks: Buffer[] = []
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk))
    }
    writeFileSync(localPath, Buffer.concat(chunks))
    return { success: true, path: localPath }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

export function cleanupDownloadedSnapshot(path: string): void {
  try {
    if (path.includes('smlpos-r2') && existsSync(path)) unlinkSync(path)
  } catch { /* ignore */ }
}

let _r2Timer: ReturnType<typeof setInterval> | null = null

export function startR2BackupScheduler(): void {
  if (_r2Timer) return

  const tick = () => {
    if (!isR2Configured()) return
    void uploadR2Snapshot(false)
  }

  setTimeout(tick, 15_000)
  _r2Timer = setInterval(tick, 5 * 60 * 1000)
}

export function stopR2BackupScheduler(): void {
  if (_r2Timer) {
    clearInterval(_r2Timer)
    _r2Timer = null
  }
}
