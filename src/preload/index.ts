import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // DB generic
  dbQuery: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query', sql, params),
  dbRun: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:run', sql, params),
  dbGet: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:get', sql, params),

  // App
  appVersion: () => ipcRenderer.invoke('app:version'),
  appHealth: () => ipcRenderer.invoke('app:health'),
  factoryReset: () => ipcRenderer.invoke('app:factoryReset'),
  resetDiagnostics: () => ipcRenderer.invoke('app:resetDiagnostics'),
  importDefaultCatalog: () => ipcRenderer.invoke('app:importDefaultCatalog'),

  // Auto-update (GitHub Releases + NSIS)
  updateCheck: (manual = false) => ipcRenderer.invoke('update:check', { manual }),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback: (status: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status)
    ipcRenderer.on('update:status', handler)
    return () => ipcRenderer.removeListener('update:status', handler)
  },

  // Operateurs
  operateursList: () => ipcRenderer.invoke('operateurs:list'),
  operateursUpsert: (op: unknown) => ipcRenderer.invoke('operateurs:upsert', op),

  // Shifts
  shiftsOpen: (shift: unknown) => ipcRenderer.invoke('shifts:open', shift),
  shiftsClose: (id: string, data: unknown) => ipcRenderer.invoke('shifts:close', id, data),
  shiftsGetActive: () => ipcRenderer.invoke('shifts:getActive'),
  shiftsGetToday: () => ipcRenderer.invoke('shifts:getToday'),
  shiftsGetSummary: (shiftId: string) => ipcRenderer.invoke('shifts:getSummary', shiftId),
  shiftsCountClosedToday: () => ipcRenderer.invoke('shifts:countClosedToday'),

  // Services POS
  servicesPosList: () => ipcRenderer.invoke('servicesPOS:list'),
  servicesPosFind: (code: string) => ipcRenderer.invoke('servicesPOS:find', code),
  transactionsServicesCreate: (t: unknown) => ipcRenderer.invoke('transactionsServices:create', t),
  transactionsServicesList: (shiftId?: string) => ipcRenderer.invoke('transactionsServices:list', shiftId),

  // Produits
  produitsList: (filters?: unknown) => ipcRenderer.invoke('produits:list', filters),
  produitsGetSourceTags: () => ipcRenderer.invoke('produits:getSourceTags'),
  produitsCheckBarcodeUnique: (code: string, excludeId?: string) => ipcRenderer.invoke('produits:checkBarcodeUnique', code, excludeId),
  produitsFindByBarcode: (code: string) => ipcRenderer.invoke('produits:findByBarcode', code),
  produitsGet: (id: string) => ipcRenderer.invoke('produits:get', id),
  produitsCreate: (p: unknown) => ipcRenderer.invoke('produits:create', p),
  produitsUpdate: (id: string, p: unknown) => ipcRenderer.invoke('produits:update', id, p),
  produitsDelete: (id: string) => ipcRenderer.invoke('produits:delete', id),
  produitsAdjustStock: (id: string, delta: number) => ipcRenderer.invoke('produits:adjustStock', id, delta),
  produitsBulkInsert: (produits: unknown[]) => ipcRenderer.invoke('produits:bulkInsert', produits),
  produitsBulkImport: (payload: unknown) => ipcRenderer.invoke('produits:bulkImport', payload),

  // Catégories
  categoriesList: () => ipcRenderer.invoke('categories:list'),
  categoriesCreate: (cat: { id: string; nom: string; icone?: string }) => ipcRenderer.invoke('categories:create', cat),

  // Serial Numbers
  serialNumbersGetByProduit: (produitId: string) => ipcRenderer.invoke('serialNumbers:getByProduit', produitId),
  serialNumbersBulkSet: (produitId: string, snList: string[]) => ipcRenderer.invoke('serialNumbers:bulkSet', produitId, snList),
  serialNumbersMarkSold: (produitId: string, venteId: string) => ipcRenderer.invoke('serialNumbers:markSold', produitId, venteId),

  // Ventes
  ventesCreate: (vente: unknown, lignes: unknown[]) => ipcRenderer.invoke('ventes:create', vente, lignes),
  ventesList: (filters?: unknown) => ipcRenderer.invoke('ventes:list', filters),
  ventesGetLignes: (venteId: string) => ipcRenderer.invoke('ventes:getLignes', venteId),
  ventesGetLastNumber: (prefix: string) => ipcRenderer.invoke('ventes:getLastNumber', prefix),

  // Factures clients
  facturesClientsList: (filters?: unknown) => ipcRenderer.invoke('facturesClients:list', filters),
  facturesClientsCreate: (facture: unknown, lignes: unknown[]) => ipcRenderer.invoke('facturesClients:create', facture, lignes),
  facturesClientsGetLastNumber: (prefix: string) => ipcRenderer.invoke('facturesClients:getLastNumber', prefix),

  // Réparations
  reparationsCreate: (rep: unknown, pieces: unknown[]) => ipcRenderer.invoke('reparations:create', rep, pieces),
  reparationsApplyDegatPrices: (repId: string, updates: { id: string; prix_achat: number }[]) =>
    ipcRenderer.invoke('reparations:applyDegatPrices', repId, updates),
  reparationsList: (filters?: unknown) => ipcRenderer.invoke('reparations:list', filters),
  reparationsUpdateStatut: (id: string, statut: string) => ipcRenderer.invoke('reparations:updateStatut', id, statut),
  reparationsGetPieces: (repId: string) => ipcRenderer.invoke('reparations:getPieces', repId),
  reparationsGetLastNumber: (prefix: string) => ipcRenderer.invoke('reparations:getLastNumber', prefix),
  reparationsGetBeneficeStats: (mois?: string) => ipcRenderer.invoke('reparations:getBeneficeStats', mois),

  // Sorties caisse
  sortiesCreate: (s: unknown) => ipcRenderer.invoke('sorties:create', s),
  sortiesList: (shiftId?: string) => ipcRenderer.invoke('sorties:list', shiftId),
  sortiesRecentNotes: () => ipcRenderer.invoke('sorties:recentNotes'),

  // Fournisseurs
  fournisseursList: (filters?: unknown) => ipcRenderer.invoke('fournisseurs:list', filters),
  fournisseursGet: (id: string) => ipcRenderer.invoke('fournisseurs:get', id),
  fournisseursCreate: (f: unknown) => ipcRenderer.invoke('fournisseurs:create', f),
  fournisseursUpdate: (id: string, f: unknown) => ipcRenderer.invoke('fournisseurs:update', id, f),

  // Fournisseur Commerciaux
  fournisseurCommerciauxGetByFournisseur: (fournisseurId: string) => ipcRenderer.invoke('fournisseurCommerciaux:getByFournisseur', fournisseurId),
  fournisseurCommerciauxCreate: (c: unknown) => ipcRenderer.invoke('fournisseurCommerciaux:create', c),
  fournisseurCommerciauxBulkCreate: (commerciaux: unknown[]) => ipcRenderer.invoke('fournisseurCommerciaux:bulkCreate', commerciaux),

  // Factures fournisseurs
  facturesFournisseursList: (filters?: unknown) => ipcRenderer.invoke('facturesFournisseurs:list', filters),
  facturesFournisseursCreate: (facture: unknown, lignes: unknown[]) => ipcRenderer.invoke('facturesFournisseurs:create', facture, lignes),
  facturesFournisseursGetLastNumber: (fournisseurId: string) => ipcRenderer.invoke('facturesFournisseurs:getLastNumber', fournisseurId),
  facturesFournisseursGet: (factureId: string) => ipcRenderer.invoke('facturesFournisseurs:get', factureId),
  facturesFournisseursGetLignes: (factureId: string) => ipcRenderer.invoke('facturesFournisseurs:getLignes', factureId),
  facturesFournisseursListDrafts: () => ipcRenderer.invoke('facturesFournisseurs:listDrafts'),
  facturesFournisseursGetDraft: (draftId: string) => ipcRenderer.invoke('facturesFournisseurs:getDraft', draftId),
  facturesFournisseursSaveDraft: (payload: unknown) => ipcRenderer.invoke('facturesFournisseurs:saveDraft', payload),
  facturesFournisseursDeleteDraft: (draftId: string) => ipcRenderer.invoke('facturesFournisseurs:deleteDraft', draftId),
  facturesFournisseursMarquerRecu: (factureId: string) => ipcRenderer.invoke('facturesFournisseurs:marquerRecu', factureId),
  facturesFournisseursAnnuler: (factureId: string) => ipcRenderer.invoke('facturesFournisseurs:annuler', factureId),
  facturesFournisseursUpdate: (id: string, data: unknown) => ipcRenderer.invoke('facturesFournisseurs:update', id, data),
  facturesFournisseursReplaceLignes: (factureId: string, lignes: unknown[], totals: unknown) =>
    ipcRenderer.invoke('facturesFournisseurs:replaceLignes', factureId, lignes, totals),
  paiementsFournisseursCreate: (p: unknown) => ipcRenderer.invoke('paiementsFournisseurs:create', p),

  // Caisse interne
  caisseInterneGetToday: () => ipcRenderer.invoke('caisseInterne:getToday'),
  caisseInterneMouvementsList: (filters?: unknown) => ipcRenderer.invoke('caisseInterne:mouvementsList', filters),
  caisseInterneGetStats: (dateFrom: string, dateTo: string) => ipcRenderer.invoke('caisseInterne:getStats', dateFrom, dateTo),
  caisseInterneAddMouvement: (m: unknown) => ipcRenderer.invoke('caisseInterne:addMouvement', m),
  caisseInterneTransferShift: (shiftId: string) => ipcRenderer.invoke('caisseInterne:transferShift', shiftId),

  // Logs
  logsAdd: (log: unknown) => ipcRenderer.invoke('logs:add', log),
  logsList: (filters?: unknown) => ipcRenderer.invoke('logs:list', filters),

  // Stats
  statsToday: () => ipcRenderer.invoke('stats:today'),
  statsByDate: (from: string, to: string) => ipcRenderer.invoke('stats:byDate', from, to),
  statsDashboard: () => ipcRenderer.invoke('stats:dashboard'),

  // Ventes en Ligne
  ventesLigneList: (filters?: unknown) => ipcRenderer.invoke('ventesLigne:list', filters),
  ventesLigneCreate: (cmd: unknown) => ipcRenderer.invoke('ventesLigne:create', cmd),
  ventesLigneUpdateStatut: (id: string, statut: string, extra?: unknown) => ipcRenderer.invoke('ventesLigne:updateStatut', id, statut, extra),
  ventesLigneGetLastNumber: (prefix: string) => ipcRenderer.invoke('ventesLigne:getLastNumber', prefix),

  // Clients
  clientsList: (filters?: unknown) => ipcRenderer.invoke('clients:list', filters),
  clientsCreate: (c: unknown) => ipcRenderer.invoke('clients:create', c),
  clientsUpdate: (id: string, data: unknown) => ipcRenderer.invoke('clients:update', id, data),

  // Crédits Clients
  creditsList: (clientId?: string) => ipcRenderer.invoke('credits:list', clientId),
  creditsCreate: (credit: unknown) => ipcRenderer.invoke('credits:create', credit),

  // Retours
  retoursCreate: (r: unknown) => ipcRenderer.invoke('retours:create', r),
  retoursList: (filters?: unknown) => ipcRenderer.invoke('retours:list', filters),
  retoursUpdateStatut: (id: string, statut: string, extra?: unknown) => ipcRenderer.invoke('retours:updateStatut', id, statut, extra),

  // Ventes: Annulation
  ventesAnnuler: (id: string, data: unknown) => ipcRenderer.invoke('ventes:annuler', id, data),

  // Organisations
  organisationsList: () => ipcRenderer.invoke('organisations:list'),
  organisationsCreate: (org: unknown) => ipcRenderer.invoke('organisations:create', org),
  organisationsUpdate: (id: string, data: unknown) => ipcRenderer.invoke('organisations:update', id, data),
  organisationsDelete: (id: string) => ipcRenderer.invoke('organisations:delete', id),

  // Personnels
  personnelsList: () => ipcRenderer.invoke('personnels:list'),
  personnelsCreate: (p: unknown) => ipcRenderer.invoke('personnels:create', p),
  personnelsUpdate: (id: string, data: unknown) => ipcRenderer.invoke('personnels:update', id, data),
  personnelsDelete: (id: string) => ipcRenderer.invoke('personnels:delete', id),
  mouvementsPersonnelsList: (filters?: unknown) => ipcRenderer.invoke('mouvementsPersonnels:list', filters),
  mouvementsPersonnelsCreate: (m: unknown) => ipcRenderer.invoke('mouvementsPersonnels:create', m),

  // Documents (Facture/Devis/BL)
  documentsList: (filters?: unknown) => ipcRenderer.invoke('documents:list', filters),
  documentsListAll: (filters?: unknown) => ipcRenderer.invoke('documents:listAll', filters),
  documentsGet: (id: string) => ipcRenderer.invoke('documents:get', id),
  documentsCreate: (doc: unknown, lignes: unknown[]) => ipcRenderer.invoke('documents:create', doc, lignes),
  documentsCreateDailyFactureF: () => ipcRenderer.invoke('documents:createDailyFactureF'),
  documentsUpdate: (id: string, data: unknown) => ipcRenderer.invoke('documents:update', id, data),
  documentsRevoquer: (id: string, motif: string, par: string) => ipcRenderer.invoke('documents:revoquer', id, motif, par),
  documentsAnnulerAvecAvoir: (id: string, motif?: string) => ipcRenderer.invoke('documents:annulerAvecAvoir', id, motif),
  documentsGetLignes: (documentId: string) => ipcRenderer.invoke('documents:getLignes', documentId),
  documentsReplaceLignes: (documentId: string, lignes: unknown[], totals: unknown) =>
    ipcRenderer.invoke('documents:replaceLignes', documentId, lignes, totals),
  documentsGetLastNumber: (prefix: string) => ipcRenderer.invoke('documents:getLastNumber', prefix),
  facturesCountBLPending: () => ipcRenderer.invoke('factures:countBLPending'),
  facturesListBLPending: () => ipcRenderer.invoke('factures:listBLPending'),

  // Paramètres App
  settingsGetAll: () => ipcRenderer.invoke('settings:getAll'),
  settingsGet: (key: string) => ipcRenderer.invoke('settings:get', key),
  settingsSet: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  settingsSetMany: (data: Record<string, string>) => ipcRenderer.invoke('settings:setMany', data),
  authVerifyCaissePin: (pin: string) => ipcRenderer.invoke('auth:verifyCaissePin', pin),

  // Sync Queue (production-safe — no raw SQL)
  syncQueueGetPending: () => ipcRenderer.invoke('sync:queue:getPending'),
  syncQueueMarkSynced: (id: string) => ipcRenderer.invoke('sync:queue:markSynced', id),
  syncQueueMarkFailed: (id: string, errorMsg: string) => ipcRenderer.invoke('sync:queue:markFailed', id, errorMsg),
  syncQueueCleanup: () => ipcRenderer.invoke('sync:queue:cleanup'),
  syncQueuePendingCount: () => ipcRenderer.invoke('sync:queue:pendingCount'),
  syncQueueFailedCount: () => ipcRenderer.invoke('sync:queue:failedCount'),
  syncQueuePurgeAllFailed: () => ipcRenderer.invoke('sync:queue:purgeAllFailed'),
  syncQueueResetAllFailed: () => ipcRenderer.invoke('sync:queue:resetAllFailed'),
  syncQueueGetErrors: () => ipcRenderer.invoke('sync:queue:getErrors'),
  syncQueuePurgeAll: () => ipcRenderer.invoke('sync:queue:purgeAll'),
  syncQueuePurgeTables: (tables: string[]) => ipcRenderer.invoke('sync:queue:purgeTables', tables),
  syncQueueDedupe: () => ipcRenderer.invoke('sync:queue:dedupe'),
  syncBootstrapTableData: (tableName: string, onlyActive?: boolean) => ipcRenderer.invoke('sync:bootstrap:tableData', tableName, onlyActive),
  syncPullApplyRows: (tableName: string, rows: Record<string, unknown>[]) => ipcRenderer.invoke('sync:pull:applyRows', tableName, rows),
  syncLocalTableCount: (tableName: string) => ipcRenderer.invoke('sync:local:tableCount', tableName),
  syncShiftsGetFondDeCaisse: (shiftId: string) => ipcRenderer.invoke('sync:shifts:getFondDeCaisse', shiftId),

  // Window
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),

  // Print
  printLabel: (html: string) => ipcRenderer.invoke('print:label', html),
  getPrinters: () => ipcRenderer.invoke('print:getPrinters'),
  printContent: (html: string, printerName: string, options?: Record<string, unknown>) => ipcRenderer.invoke('print:printContent', html, printerName, options ?? {}),
  gainschaIsAvailable: () => ipcRenderer.invoke('gainscha:isAvailable') as Promise<boolean>,
  gainschaDetectUsb: () => ipcRenderer.invoke('gainscha:detectUsb') as Promise<{ success: boolean; devices?: string[]; error?: string }>,
  gainschaVersion: () => ipcRenderer.invoke('gainscha:version') as Promise<{ success: boolean; version?: string; error?: string }>,
  gainschaPrintLabel: (job: Record<string, unknown>) => ipcRenderer.invoke('gainscha:printLabel', job) as Promise<{ success: boolean; error?: string }>,

  // Backup
  backupCreate: () => ipcRenderer.invoke('backup:create'),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupGetStats: () => ipcRenderer.invoke('backup:getStats'),
  backupOpenFolder: () => ipcRenderer.invoke('backup:openFolder'),
  backupChooseExternalFolder: () => ipcRenderer.invoke('backup:chooseExternalFolder'),
  backupRestore: (backupPath: string) => ipcRenderer.invoke('backup:restore', backupPath),
  backupDiscover: () => ipcRenderer.invoke('backup:discover'),

  // Cloud backup (R2)
  r2GetStatus: () => ipcRenderer.invoke('r2:getStatus'),
  r2ListSnapshots: () => ipcRenderer.invoke('r2:listSnapshots'),
  r2TestConnection: () => ipcRenderer.invoke('r2:testConnection'),
  r2UploadNow: () => ipcRenderer.invoke('r2:uploadNow'),
  r2Restore: (key: string) => ipcRenderer.invoke('r2:restore', key),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
