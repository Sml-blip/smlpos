import type { SeedApi, SeedPanelStatus } from './seedTypes'
const status: SeedPanelStatus = {
  connection: 'online', connectionError: null, baseUrl: 'https://example.invalid', deviceId: 'demo-seed', deviceName: 'PC principal (démo)', sessionPersisted: true,
  live: { prepared: true, enabled: true, joining: false, backend: 'vps', pending: 12, rejected: 1, pullRejected: 1, cursor: 103, serverSeq: 105, lag: 2, lastPush: new Date().toISOString(), lastPull: new Date().toISOString(), pushError: null, pullError: null, retryAt: 0 },
  server: { server_time: new Date().toISOString(), devices: [
    { device_id: 'demo-seed', name: 'PC principal (démo)', platform: 'win32', role: 'seed', last_seen_at: new Date().toISOString(), online: true },
    { device_id: 'demo-2', name: 'PC Caisse 2 (démo)', platform: 'win32', role: 'replica', last_seen_at: new Date().toISOString(), online: true },
  ], seed: { state: 'seeded' } },
  seed: { state: 'done', message: 'Données fictives de prévisualisation', report: null, backup: null, progress: { table: null, tableIndex: 0, tableCount: 0, sent: 0, total: 0, startedAt: null }, ackedRows: 1250, totalRows: 1250, rejectedCount: 0, canApprove: false, canRun: false },
  legacyQueue: { pending: 0, failed: 0 },
}
const ok = async () => ({ ok: true as const, data: undefined })
export const seedMock: SeedApi = {
  sync2PrepareReplica: ok, sync2JoinReplica: ok,
  seedStatus: async () => ({ ok: true, data: status }), seedRegister: ok,
  seedBackupAndCheck: async () => ({ ok: false, error: 'Prévisualisation : aucune base réelle.' }),
  seedRecheck: async () => ({ ok: false, error: 'Prévisualisation : aucune base réelle.' }),
  seedApprove: ok, seedRun: ok, seedPause: ok, seedNewPass: ok,
  seedRejected: async () => ({ ok: true, data: [] }), seedExportReport: async () => ({ ok: true, data: null }),
  sync2Retry: ok, sync2Export: async () => ({ ok: true, data: null }),
  sync2Issues: async () => ({ ok: true, data: [
    { source: 'push', seq: 17, table: 'produits', pk: 'demo-product', reason: 'unique_conflict : référence existante', at: new Date().toISOString() },
    { source: 'pull', seq: 98, table: 'categories', pk: 'demo-category', reason: 'Nom déjà présent — examen requis', at: new Date().toISOString() },
  ] }),
}
