/// <reference types="vite/client" />

interface Window {
  api: {
    // DB generic
    dbQuery: (sql: string, params?: unknown[]) => Promise<{ data: unknown[]; error: string | null }>
    dbRun: (sql: string, params?: unknown[]) => Promise<{ data: unknown; error: string | null }>
    dbGet: (sql: string, params?: unknown[]) => Promise<{ data: unknown; error: string | null }>

    // App
    appVersion: () => Promise<string>
    factoryReset?: () => Promise<{ success?: boolean; error?: string; deferred?: boolean }>
    resetDiagnostics?: () => Promise<Record<string, unknown>>
    importDefaultCatalog?: () => Promise<{ success?: boolean; count?: number; error?: string }>
    updateCheck?: (manual?: boolean) => Promise<{ ok?: boolean; reason?: string }>
    updateInstall?: () => Promise<void>
    onUpdateStatus?: (callback: (status: unknown) => void) => () => void

    // Operateurs
    operateursList: () => Promise<unknown[]>
    operateursUpsert: (op: unknown) => Promise<unknown>

    // Shifts
    shiftsOpen: (shift: unknown) => Promise<unknown>
    shiftsClose: (id: string, data: unknown) => Promise<unknown>
    shiftsGetActive: () => Promise<unknown>
    shiftsGetToday: () => Promise<unknown[]>
    shiftsGetSummary: (shiftId: string) => Promise<unknown>
    shiftsCountClosedToday?: () => Promise<number>

    // Services POS
    servicesPosList: () => Promise<unknown[]>
    servicesPosFind: (code: string) => Promise<unknown>
    transactionsServicesCreate: (t: unknown) => Promise<unknown>
    transactionsServicesList: (shiftId?: string) => Promise<unknown[]>

    // Catégories
    categoriesList: () => Promise<unknown[]>
    categoriesCreate: (cat: { id: string; nom: string; icone?: string }) => Promise<unknown>

    // Produits
    produitsList: (filters?: unknown) => Promise<unknown[]>
    produitsCheckBarcodeUnique: (code: string, excludeId?: string) => Promise<{ unique: boolean }>
    produitsFindByBarcode: (code: string) => Promise<unknown>
    produitsGet: (id: string) => Promise<unknown>
    produitsCreate: (p: unknown) => Promise<unknown>
    produitsUpdate: (id: string, p: unknown) => Promise<unknown>
    produitsDelete: (id: string) => Promise<unknown>
    produitsAdjustStock: (id: string, delta: number) => Promise<unknown>
    produitsBulkInsert: (produits: unknown[]) => Promise<unknown>
    produitsBulkImport: (payload: {
      produits: unknown[]
      options?: { onDuplicate?: 'update' | 'skip'; matchBy?: 'reference' | 'code_barre' }
    }) => Promise<{ success?: boolean; inserted?: number; updated?: number; skipped?: number }>

    // Serial Numbers
    serialNumbersGetByProduit: (produitId: string) => Promise<unknown[]>
    serialNumbersBulkSet: (produitId: string, snList: string[]) => Promise<unknown>
    serialNumbersMarkSold: (produitId: string, venteId: string) => Promise<unknown>

    // Ventes
    ventesCreate: (vente: unknown, lignes: unknown[]) => Promise<unknown>
    ventesList: (filters?: unknown) => Promise<unknown[]>
    ventesGetLignes: (venteId: string) => Promise<unknown[]>
    ventesGetLastNumber: (prefix: string) => Promise<number>

    // Factures clients
    facturesClientsList: (filters?: unknown) => Promise<unknown[]>
    facturesClientsCreate: (facture: unknown, lignes: unknown[]) => Promise<unknown>
    facturesClientsGetLastNumber: (prefix: string) => Promise<number>

    // Réparations
    reparationsCreate: (rep: unknown, pieces: unknown[]) => Promise<unknown>
    reparationsList: (filters?: unknown) => Promise<unknown[]>
    reparationsUpdateStatut: (id: string, statut: string) => Promise<unknown>
    reparationsGetPieces: (repId: string) => Promise<unknown[]>
    reparationsGetLastNumber: (prefix: string) => Promise<number>
    reparationsGetBeneficeStats: (mois?: string) => Promise<unknown>

    // Sorties caisse
    sortiesCreate: (s: unknown) => Promise<unknown>
    sortiesList: (shiftId?: string) => Promise<unknown[]>
    sortiesRecentNotes: () => Promise<string[]>

    // Fournisseurs
    fournisseursList: (filters?: unknown) => Promise<unknown[]>
    fournisseursGet: (id: string) => Promise<unknown>
    fournisseursCreate: (f: unknown) => Promise<unknown>
    fournisseursUpdate: (id: string, f: unknown) => Promise<unknown>

    // Factures fournisseurs
    facturesFournisseursList: (filters?: unknown) => Promise<unknown[]>
    facturesFournisseursCreate: (facture: unknown, lignes: unknown[]) => Promise<unknown>
    facturesFournisseursGetLastNumber: (fournisseurId: string) => Promise<number>
    facturesFournisseursGet?: (factureId: string) => Promise<Record<string, unknown>>
    facturesFournisseursGetLignes?: (factureId: string) => Promise<Record<string, unknown>[]>
    facturesFournisseursListDrafts: () => Promise<unknown[]>
    facturesFournisseursGetDraft: (draftId: string) => Promise<unknown>
    facturesFournisseursSaveDraft: (payload: unknown) => Promise<{ success?: boolean; draftId?: string; updated_at?: string }>
    facturesFournisseursDeleteDraft: (draftId: string) => Promise<{ success?: boolean }>
    facturesFournisseursMarquerRecu: (factureId: string) => Promise<unknown>
    facturesFournisseursAnnuler?: (factureId: string) => Promise<{ success?: boolean }>
    facturesFournisseursUpdate?: (id: string, data: unknown) => Promise<{ success?: boolean; error?: string }>
    facturesFournisseursReplaceLignes?: (factureId: string, lignes: unknown[], totals: unknown) => Promise<{ success?: boolean; error?: string }>
    paiementsFournisseursCreate: (p: unknown) => Promise<unknown>

    // Caisse interne
    caisseInterneGetToday: () => Promise<unknown>
    caisseInterneMouvementsList: (filters?: unknown) => Promise<unknown[]>
    caisseInterneGetStats: (dateFrom: string, dateTo: string) => Promise<unknown>
    caisseInterneAddMouvement: (m: unknown) => Promise<unknown>
    caisseInterneTransferShift: (shiftId: string) => Promise<unknown>

    // Logs
    logsAdd: (log: unknown) => Promise<unknown>
    logsList: (filters?: unknown) => Promise<unknown[]>

    // Stats
    statsToday: () => Promise<unknown>
    statsByDate: (from: string, to: string) => Promise<unknown>
    statsDashboard: () => Promise<unknown>

    // Ventes en Ligne
    ventesLigneList: (filters?: unknown) => Promise<unknown[]>
    ventesLigneCreate: (cmd: unknown) => Promise<unknown>
    ventesLigneUpdateStatut: (id: string, statut: string, extra?: unknown) => Promise<unknown>
    ventesLigneGetLastNumber: (prefix: string) => Promise<number>

    // Clients
    clientsList: (filters?: unknown) => Promise<unknown[]>
    clientsCreate: (c: unknown) => Promise<unknown>
    clientsUpdate: (id: string, data: unknown) => Promise<unknown>

    // Crédits Clients
    creditsList: (clientId?: string) => Promise<unknown[]>
    creditsCreate: (credit: unknown) => Promise<unknown>

    // Retours
    retoursCreate: (r: unknown) => Promise<unknown>
    retoursList: (filters?: unknown) => Promise<unknown[]>
    retoursUpdateStatut: (id: string, statut: string, extra?: unknown) => Promise<unknown>

    // Ventes: Annulation
    ventesAnnuler: (id: string, data: unknown) => Promise<unknown>

    // Organisations
    organisationsList: () => Promise<unknown[]>
    organisationsCreate: (org: unknown) => Promise<unknown>
    organisationsUpdate: (id: string, data: unknown) => Promise<unknown>
    organisationsDelete: (id: string) => Promise<unknown>

    // Personnels
    personnelsList: () => Promise<unknown[]>
    personnelsCreate: (p: unknown) => Promise<unknown>
    personnelsUpdate: (id: string, data: unknown) => Promise<unknown>
    personnelsDelete: (id: string) => Promise<unknown>
    mouvementsPersonnelsList: (filters?: unknown) => Promise<unknown[]>
    mouvementsPersonnelsCreate: (m: unknown) => Promise<unknown>

    // Documents (Facture/Devis/BL)
    documentsList: (filters?: unknown) => Promise<unknown[]>
    documentsListAll?: (filters?: unknown) => Promise<unknown[]>
    documentsGet?: (id: string) => Promise<Record<string, unknown> | null | undefined>
    documentsCreate: (doc: unknown, lignes: unknown[]) => Promise<unknown>
    documentsCreateDailyFactureF?: () => Promise<{ success?: boolean; skipped?: boolean; numero?: string; lineCount?: number; reason?: string; error?: string }>
    documentsUpdate: (id: string, data: unknown) => Promise<{ success?: boolean; error?: string }>
    documentsRevoquer?: (id: string, motif: string, par: string) => Promise<{ success?: boolean }>
    documentsAnnulerAvecAvoir?: (id: string, motif?: string) => Promise<{ success?: boolean; error?: string; avoir?: { id: string; numero: string } }>
    documentsGetLignes: (documentId: string) => Promise<unknown[]>
    documentsReplaceLignes?: (documentId: string, lignes: unknown[], totals: Record<string, unknown>) => Promise<{ success?: boolean; error?: string }>
    documentsGetLastNumber: (prefix: string) => Promise<number>

    // Paramètres App
    settingsGetAll: () => Promise<Record<string, string>>
    settingsGet: (key: string) => Promise<string | null>
    settingsSet: (key: string, value: string) => Promise<unknown>
    settingsSetMany: (data: Record<string, string>) => Promise<unknown>
    authVerifyCaissePin?: (pin: string) => Promise<{ valid?: boolean }>

    backupDiscover?: () => Promise<{
      success?: boolean
      activeCount?: number
      activeDbPath?: string
      candidates?: { path: string; productCount: number; size: number; mtime: number; source: string }[]
      error?: string
    }>
    backupRestore?: (backupPath: string) => Promise<{ success?: boolean; error?: string }>
    backupList?: () => Promise<{ name: string; size: number; time: number; path: string }[]>
    backupGetStats?: () => Promise<{ count: number; lastTime: number | null; totalSize: number; dbSize: number; dbPath: string; backupDir: string }>
    backupCreate?: () => Promise<{ success: boolean; filename?: string; external?: boolean }>
    backupOpenFolder?: () => Promise<void>
    backupChooseExternalFolder?: () => Promise<{ canceled?: boolean; path?: string }>

    // Cloud backup (R2)
    r2GetStatus?: () => Promise<{
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
    }>
    r2ListSnapshots?: () => Promise<{
      key: string
      size: number
      lastModified: number
      machineId: string
      label: string
    }[]>
    r2TestConnection?: () => Promise<{ ok: boolean; error?: string }>
    r2UploadNow?: () => Promise<{ success: boolean; key?: string; skipped?: boolean; error?: string }>
    r2Restore?: (key: string) => Promise<{ success: boolean; error?: string }>

    // Sync Queue
    syncQueueGetPending: () => Promise<unknown[]>
    syncQueueMarkSynced: (id: string) => Promise<unknown>
    syncQueueMarkFailed: (id: string, errorMsg: string) => Promise<unknown>
    syncQueueCleanup: () => Promise<unknown>
    syncQueuePendingCount: () => Promise<number>
    syncQueuePurgeTables?: (tables: string[]) => Promise<{ deleted?: number }>
    syncQueueDedupe?: () => Promise<{ deleted?: number }>
    syncBootstrapTableData: (tableName: string, onlyActive?: boolean) => Promise<unknown[]>
    syncPullApplyRows: (tableName: string, rows: Record<string, unknown>[]) => Promise<{ applied: number; skipped: number; error: string | null }>
    syncLocalTableCount: (tableName: string) => Promise<number>

    // Print
    printLabel?: (html: string) => Promise<boolean>
    getPrinters?: () => Promise<{ name: string; isDefault?: boolean; displayName?: string }[]>
    printContent?: (
      html: string,
      printerName: string,
      options?: Record<string, unknown>,
    ) => Promise<{ success: boolean; error?: string }>
    gainschaIsAvailable?: () => Promise<boolean>
    gainschaDetectUsb?: () => Promise<{ success: boolean; devices?: string[]; error?: string }>
    gainschaVersion?: () => Promise<{ success: boolean; version?: string; error?: string }>
    gainschaPrintLabel?: (job: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>

    // Window
    windowMinimize: () => Promise<void>
    windowMaximize: () => Promise<void>
    windowClose: () => Promise<void>
  }
}
