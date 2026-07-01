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
    facturesFournisseursMarquerRecu: (factureId: string) => Promise<unknown>
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
    documentsCreate: (doc: unknown, lignes: unknown[]) => Promise<unknown>
    documentsUpdate: (id: string, data: unknown) => Promise<unknown>
    documentsGetLignes: (documentId: string) => Promise<unknown[]>
    documentsReplaceLignes?: (documentId: string, lignes: unknown[], totals: { total_ht: number; total_tva: number; total_ttc: number }) => Promise<{ success?: boolean }>
    documentsGetLastNumber: (prefix: string) => Promise<number>

    // Paramètres App
    settingsGetAll: () => Promise<Record<string, string>>
    settingsGet: (key: string) => Promise<string | null>
    settingsSet: (key: string, value: string) => Promise<unknown>
    settingsSetMany: (data: Record<string, string>) => Promise<unknown>

    // Sync Queue
    syncQueueGetPending: () => Promise<unknown[]>
    syncQueueMarkSynced: (id: string) => Promise<unknown>
    syncQueueMarkFailed: (id: string, errorMsg: string) => Promise<unknown>
    syncQueueCleanup: () => Promise<unknown>
    syncQueuePendingCount: () => Promise<number>
    syncBootstrapTableData: (tableName: string, onlyActive?: boolean) => Promise<unknown[]>

    // Print
    printLabel?: (html: string) => Promise<boolean>
    getPrinters?: () => Promise<{ name: string; isDefault?: boolean; displayName?: string }[]>
    printContent?: (
      html: string,
      printerName: string,
      options?: Record<string, unknown>,
    ) => Promise<{ success: boolean; error?: string }>

    // Window
    windowMinimize: () => Promise<void>
    windowMaximize: () => Promise<void>
    windowClose: () => Promise<void>
  }
}
