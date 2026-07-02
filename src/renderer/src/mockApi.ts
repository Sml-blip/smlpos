// Mock window.api for browser preview (no Electron IPC)
// Provides realistic dummy data so all tabs render correctly.
import PRODUITS_SEED from './productsSeed.json'

const OPERATEURS = [
  { id: 'op1', nom: 'Amira', identifiant: 'amira', role: 'superadmin' as const, actif: 1 },
  { id: 'op2', nom: 'Hamdi', identifiant: 'hamdi', role: 'caissier' as const, actif: 1 },
  { id: 'op3', nom: 'Hamma', identifiant: 'hamma', role: 'caissier' as const, actif: 1 },
]

const CATEGORIES = [
  { id: 'cat-01', nom: 'ACCESSOIRE' },
  { id: 'cat-02', nom: 'COMPOSANTS GAMING' },
  { id: 'cat-03', nom: 'ECRAN' },
  { id: 'cat-04', nom: 'ELECTRO' },
  { id: 'cat-05', nom: 'FORNETURE' },
  { id: 'cat-06', nom: 'IMPRIMANTE' },
  { id: 'cat-07', nom: 'PC GAMING' },
  { id: 'cat-08', nom: 'PC PORTABLE' },
  { id: 'cat-09', nom: 'SERVICE' },
  { id: 'cat-10', nom: 'SMARTPHONE' },
  { id: 'cat-11', nom: 'SMARTWATCH' },
  { id: 'cat-12', nom: 'TABLETTE' },
  { id: 'cat-13', nom: 'TELEPHONE PORTABLE' },
  { id: 'cat-14', nom: 'TELEVISION' },
  { id: 'cat-15', nom: 'TROTTINETTE ELECTRIQUE' },
  { id: 'cat-16', nom: 'Général' },
]

const SERVICES_POS = [
  { id: 'svc1', nom: 'Enda Taw', code_barre: '0000000000001', frais_defaut: 2.500, actif: 1, created_at: '2026-01-01T00:00:00' },
  { id: 'svc2', nom: 'Ooredoo', code_barre: '0000000000002', frais_defaut: 2.500, actif: 1, created_at: '2026-01-01T00:00:00' },
  { id: 'svc3', nom: 'Orange', code_barre: '0000000000003', frais_defaut: 2.500, actif: 1, created_at: '2026-01-01T00:00:00' },
]

const FOURNISSEURS = [
  { id: 'f1', nom: 'TechParts SARL', contact_nom: 'Ahmed Belhaj', telephone: '71 234 567', email: 'contact@techparts.tn', adresse: '12 Rue de la Liberté, Tunis', matricule_fiscal: '1234567A/P/M/000', rib: 'TN59 07000000005032425', solde_du: 1850.000, actif: 1, created_at: '2026-01-15T08:00:00' },
  { id: 'f2', nom: 'PowerCell', contact_nom: 'Sami Khelifi', telephone: '72 345 678', email: 'info@powercell.tn', adresse: '45 Avenue Habib Bourguiba, Sfax', matricule_fiscal: '9876543B/P/M/000', rib: '', solde_du: 320.000, actif: 1, created_at: '2026-02-01T08:00:00' },
  { id: 'f3', nom: 'StoreMaster', contact_nom: 'Leila Gharbi', telephone: '73 456 789', email: 'sales@storemaster.tn', adresse: '8 Rue Ibn Khaldoun, Sousse', matricule_fiscal: '5555555C/P/M/000', rib: 'TN59 07000000008877665', solde_du: 0, actif: 1, created_at: '2026-02-10T08:00:00' },
  { id: 'f4', nom: 'ElecParts Tunisia', contact_nom: 'Riadh Mansour', telephone: '74 567 890', email: 'riadh@elecparts.tn', adresse: '22 Zone Industrielle, Nabeul', matricule_fiscal: '3333333D/P/M/000', rib: '', solde_du: 75.500, actif: 1, created_at: '2026-03-01T08:00:00' },
]

const FACTURES_FOURNISSEURS = [
  { id: 'ff1', numero_facture: 'FF-20260401-001', fournisseur_id: 'f1', fournisseur_nom: 'TechParts SARL', date_facture: '2026-04-01', date_echeance: '2026-05-01', montant_ht: 1200.000, montant_tva: 228.000, montant_ttc: 1428.000, montant_paye: 0, statut_paiement: 'EN_ATTENTE' as const, notes: 'Commande écrans + claviers', created_at: '2026-04-01T10:00:00' },
  { id: 'ff2', numero_facture: 'FF-20260410-001', fournisseur_id: 'f1', fournisseur_nom: 'TechParts SARL', date_facture: '2026-04-10', date_echeance: '2026-05-10', montant_ht: 350.000, montant_tva: 66.500, montant_ttc: 416.500, montant_paye: 250.000, statut_paiement: 'PARTIEL' as const, notes: '', created_at: '2026-04-10T10:00:00' },
  { id: 'ff3', numero_facture: 'FF-20260415-001', fournisseur_id: 'f2', fournisseur_nom: 'PowerCell', date_facture: '2026-04-15', date_echeance: '2026-05-05', montant_ht: 320.000, montant_tva: 0, montant_ttc: 320.000, montant_paye: 0, statut_paiement: 'EN_ATTENTE' as const, notes: 'Batteries + chargeurs', created_at: '2026-04-15T10:00:00' },
  { id: 'ff4', numero_facture: 'FF-20260420-001', fournisseur_id: 'f3', fournisseur_nom: 'StoreMaster', date_facture: '2026-04-20', date_echeance: '2026-04-30', montant_ht: 600.000, montant_tva: 114.000, montant_ttc: 714.000, montant_paye: 714.000, statut_paiement: 'PAYE' as const, notes: 'SSD NVMe lot 20', created_at: '2026-04-20T10:00:00' },
  { id: 'ff5', numero_facture: 'FF-20260428-001', fournisseur_id: 'f4', fournisseur_nom: 'ElecParts Tunisia', date_facture: '2026-04-28', date_echeance: '2026-05-07', montant_ht: 75.500, montant_tva: 0, montant_ttc: 75.500, montant_paye: 0, statut_paiement: 'EN_RETARD' as const, notes: 'Connecteurs divers', created_at: '2026-04-28T10:00:00' },
]

const PRODUITS = PRODUITS_SEED as unknown as typeof PRODUITS_SEED

const SHIFT_ACTIVE = {
  id: 'shift1',
  operateur_id: 'op1',
  operateur_nom: 'Amira',
  fond_de_caisse: 200,
  started_at: new Date().toISOString(),
  ended_at: undefined,
  solde_theorique: undefined,
  notes_cloture: undefined,
}

function genDailyVentes(days: number) {
  const result = []
  for (let i = days; i >= 1; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().slice(0, 10)
    const count = Math.floor(Math.random() * 8) + 1
    const total = +(Math.random() * 800 + 100).toFixed(3)
    result.push({ date: dateStr, total, count })
  }
  return result
}

const DAILY_VENTES = genDailyVentes(30)

const VENTES = [
  { id: 'v1', numero: 'VTE-20260501-0001', shift_id: 'shift1', operateur_nom: 'Amira', sous_total: 195, total_remises: 0, total_ttc: 195, mode_paiement: 'ESPECES', montant_recu: 200, monnaie_rendue: 5, type: 'VENTE', created_at: new Date().toISOString() },
  { id: 'v2', numero: 'VTE-20260501-0002', shift_id: 'shift1', operateur_nom: 'Hamdi', sous_total: 154, total_remises: 11, total_ttc: 143, mode_paiement: 'CARTE', montant_recu: 143, monnaie_rendue: 0, type: 'VENTE', created_at: new Date().toISOString() },
  { id: 'v3', numero: 'VTE-20260430-0001', shift_id: 'shift1', operateur_nom: 'Hamma', sous_total: 89, total_remises: 0, total_ttc: 89, mode_paiement: 'ESPECES', montant_recu: 90, monnaie_rendue: 1, type: 'VENTE', created_at: new Date(Date.now() - 86400000).toISOString() },
]

const LIGNES_VENTE: Record<string, unknown[]> = {
  v1: [{ id: 'lv1', vente_id: 'v1', produit_id: PRODUITS_SEED[0]?.id, designation: PRODUITS_SEED[0]?.nom || 'Produit', quantite: 1, prix_unitaire: PRODUITS_SEED[0]?.prix_vente || 0, remise_pct: 0, total_ligne: PRODUITS_SEED[0]?.prix_vente || 0, type_produit: PRODUITS_SEED[0]?.type || 'F' }],
  v2: [
    { id: 'lv2', vente_id: 'v2', produit_id: PRODUITS_SEED[1]?.id, designation: PRODUITS_SEED[1]?.nom || 'Produit', quantite: 1, prix_unitaire: PRODUITS_SEED[1]?.prix_vente || 0, remise_pct: 0, total_ligne: PRODUITS_SEED[1]?.prix_vente || 0, type_produit: PRODUITS_SEED[1]?.type || 'F' },
    { id: 'lv3', vente_id: 'v2', produit_id: PRODUITS_SEED[2]?.id, designation: PRODUITS_SEED[2]?.nom || 'Produit', quantite: 1, prix_unitaire: PRODUITS_SEED[2]?.prix_vente || 0, remise_pct: 0, total_ligne: PRODUITS_SEED[2]?.prix_vente || 0, type_produit: PRODUITS_SEED[2]?.type || 'F' },
  ],
  v3: [{ id: 'lv4', vente_id: 'v3', produit_id: PRODUITS_SEED[3]?.id, designation: PRODUITS_SEED[3]?.nom || 'Produit', quantite: 1, prix_unitaire: PRODUITS_SEED[3]?.prix_vente || 0, remise_pct: 0, total_ligne: PRODUITS_SEED[3]?.prix_vente || 0, type_produit: PRODUITS_SEED[3]?.type || 'F' }],
}

const REPARATIONS = [
  { id: 'r1', numero: 'REP-20260501-001', shift_id: 'shift1', operateur_nom: 'Amira', client_nom: 'Mohamed Ben Ali', client_tel: '22 345 678', type_appareil: 'PC', marque: 'Dell', modele: 'Inspiron 15', description_panne: 'Écran fissuré, remplacement nécessaire', main_oeuvre: 30, acompte: 50, total_estime: 225, total_final: undefined, statut: 'EN_COURS', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  { id: 'r2', numero: 'REP-20260430-001', shift_id: 'shift1', operateur_nom: 'Hamdi', client_nom: 'Fatma Trabelsi', client_tel: '55 123 456', type_appareil: 'SMARTPHONE', marque: 'Samsung', modele: 'Galaxy A52', description_panne: 'Batterie gonflee, ne charge plus', main_oeuvre: 20, acompte: 30, total_estime: 75, total_final: 75, statut: 'TERMINE', created_at: new Date(Date.now() - 86400000).toISOString(), updated_at: new Date().toISOString() },
  { id: 'r3', numero: 'REP-20260429-001', shift_id: 'shift1', operateur_nom: 'Hamma', client_nom: 'Karim Mansouri', client_tel: '98 765 432', type_appareil: 'PC', marque: 'HP', modele: 'EliteBook 840', description_panne: 'Jack alimentation endommagé', main_oeuvre: 25, acompte: 0, total_estime: 40, total_final: undefined, statut: 'EN_ATTENTE', created_at: new Date(Date.now() - 172800000).toISOString(), updated_at: new Date(Date.now() - 172800000).toISOString() },
]

const SORTIES_CAISSE = [
  { id: 's1', shift_id: 'shift1', montant: 50, note: 'Achat fournitures bureau', operateur: 'Amira', created_at: new Date().toISOString() },
]

const TRANSACTIONS_SERVICES = [
  { id: 'ts1', service_id: 'svc1', service_nom: 'Enda Taw', shift_id: 'shift1', operateur_nom: 'Amira', montant_frais: 2.500, note: 'Tarek Ben Youssef — 6x 10 DT', created_at: new Date().toISOString() },
  { id: 'ts2', service_id: 'svc2', service_nom: 'Ooredoo', shift_id: 'shift1', operateur_nom: 'Hamdi', montant_frais: 2.500, note: '20 DT rechargement', created_at: new Date(Date.now() - 3600000).toISOString() },
]

const FACTURES_CLIENTS = [
  { id: 'fc1', numero: 'FAC-20260501-001', vente_id: 'v1', shift_id: 'shift1', client_nom: 'Entreprise Alpha', client_tel: '71 234 567', client_adresse: '15 Rue de l\'Indépendance, Tunis', client_matricule: '1234567A/P/C/000', montant_ttc: 195, created_at: new Date().toISOString() },
]

const CAISSE_INTERNE = {
  id: 'ci1',
  date: new Date().toISOString().slice(0, 10),
  solde_ouverture: 5200.000,
  total_entrees: 338.000,
  total_sorties: 50.000,
  solde_actuel: 5488.000,
  updated_at: new Date().toISOString(),
}

const MOUVEMENTS_CI = [
  { id: 'mci1', caisse_interne_id: 'ci1', type: 'ENTREE', montant: 500.000, libelle: 'Transfert shift matin', shift_id: 'shift0', operateur: 'Amira', created_at: new Date(Date.now() - 7200000).toISOString() },
  { id: 'mci2', caisse_interne_id: 'ci1', type: 'ENTREE', montant: 338.000, libelle: 'Ventes du jour', shift_id: 'shift1', operateur: 'Amira', created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: 'mci3', caisse_interne_id: 'ci1', type: 'SORTIE', montant: 50.000, libelle: 'Règlement facture PowerCell', operateur: 'Amira', created_at: new Date(Date.now() - 1800000).toISOString() },
]

const DASHBOARD_DATA = {
  dailyVentes: DAILY_VENTES,
  todayVentes: { total: 338, count: 2 },
  yestVentes: { total: 89, count: 1 },
  repsEnCours: { count: 2 },
  parMode: [
    { mode_paiement: 'ESPECES', count: 2, total: 284 },
    { mode_paiement: 'CARTE', count: 1, total: 143 },
  ],
  lowStock: PRODUITS_SEED.filter(p => p.stock_actuel <= p.stock_minimum).slice(0, 5).map(p => ({
    nom: p.nom, stock_actuel: p.stock_actuel, stock_minimum: p.stock_minimum
  })),
  topProduits: PRODUITS_SEED.slice(0, 5).map(p => ({
    designation: p.nom, revenue: p.prix_vente * 3, qty: 3
  })),
}

let nextVenteSeq = 3
let nextRepSeq = 4
let nextFacClientSeq = 2
let nextFacFourn = FACTURES_FOURNISSEURS.length

const mockApi = {
  dbQuery: async () => [],
  dbRun: async () => ({ changes: 1, lastInsertRowid: 1 }),
  dbGet: async () => null,
  syncQueueGetPending: async () => [],
  syncQueueMarkSynced: async () => ({ success: true }),
  syncQueueMarkFailed: async () => ({ success: true }),
  syncQueueCleanup: async () => ({ deleted: 0 }),
  syncQueuePendingCount: async () => 0,
  syncQueueFailedCount: async () => 0,
  syncQueueResetAllFailed: async () => ({ reset: 0 }),
  syncQueuePurgeAllFailed: async () => ({ deleted: 0 }),
  syncQueueGetErrors: async () => [],
  syncQueuePurgeAll: async () => ({ deleted: 0 }),
  syncQueuePurgeTables: async () => ({ deleted: 0 }),
  syncQueueDedupe: async () => ({ deleted: 0 }),
  syncBootstrapTableData: async () => [],
  syncPullApplyRows: async () => ({ applied: 0, skipped: 0, error: null }),
  syncLocalTableCount: async () => 0,
  syncShiftsGetFondDeCaisse: async () => 100,

  operateursList: async () => OPERATEURS,
  operateursUpsert: async (op: unknown) => op,

  shiftsOpen: async (shift: unknown) => ({ ...SHIFT_ACTIVE, ...(shift as object) }),
  shiftsClose: async () => ({ success: true }),
  appVersion: async () => '1.9.5',
  factoryReset: async () => ({ success: true }),
  updateCheck: async () => ({ ok: false, reason: 'browser' }),
  updateInstall: async () => {},
  onUpdateStatus: () => () => {},
  appHealth: async () => ({ ok: true, schemaVersion: '1.9.2', expectedSchemaVersion: '1.9.2', pendingSync: 0 }),
  shiftsGetActive: async () => SHIFT_ACTIVE,
  shiftsGetToday: async () => [SHIFT_ACTIVE],
  shiftsGetSummary: async () => ({
    ventes: { total: 338, count: 2 },
    reparations: { total: 75, count: 1 },
    sorties: { total: 50, count: 1 },
    creditsPercus: { total: 85, count: 1 },
    parMode: [
      { mode_paiement: 'ESPECES', total: 284 },
      { mode_paiement: 'CARTE', total: 143 },
    ],
  }),

  // Categories
  categoriesList: async () => CATEGORIES,
  categoriesCreate: async (cat: { id: string; nom: string; icone?: string }) => {
    CATEGORIES.push(cat)
    return { success: true }
  },
  produitsCheckBarcodeUnique: async () => ({ unique: true }),

  // Services POS
  servicesPosList: async () => SERVICES_POS,
  servicesPosFind: async (codeBarre: string) => SERVICES_POS.find(s => s.code_barre === codeBarre) || null,
  transactionsServicesCreate: async (t: unknown) => {
    const out = { ...(t as object), id: `ts${Date.now()}`, created_at: new Date().toISOString() }
    TRANSACTIONS_SERVICES.push(out as typeof TRANSACTIONS_SERVICES[0])
    return out
  },
  transactionsServicesList: async (filters?: { shift_id?: string; from?: string; to?: string }) => {
    let list = [...TRANSACTIONS_SERVICES]
    if (filters?.shift_id) list = list.filter(t => t.shift_id === filters.shift_id)
    return list
  },

  // Products
  produitsList: async () => PRODUITS,
  produitsFindByBarcode: async (code: string) => PRODUITS.find(p => p.code_barre === code) || null,
  produitsGet: async (id: string) => PRODUITS.find(p => p.id === id) || null,
  produitsCreate: async (p: unknown) => {
    const out = { ...(p as object), id: `p${Date.now()}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    PRODUITS.push(out as typeof PRODUITS[0])
    return out
  },
  produitsUpdate: async (id: string, p: unknown) => { const idx = PRODUITS.findIndex(x => x.id === id); if (idx >= 0) Object.assign(PRODUITS[idx], p); return PRODUITS[idx]; },
  produitsDelete: async () => ({ success: true }),
  produitsAdjustStock: async (id: string, delta: number) => { const p = PRODUITS.find(x => x.id === id); if (p) p.stock_actuel = Math.max(0, p.stock_actuel + delta); return p; },
  produitsBulkInsert: async (ps: unknown[]) => ({ inserted: (ps as unknown[]).length, errors: 0 }),
  produitsBulkImport: async (payload: { produits: unknown[] }) => ({
    success: true,
    inserted: (payload.produits as unknown[]).length,
    updated: 0,
    skipped: 0,
  }),

  // Serial Numbers
  serialNumbersGetByProduit: async () => [],
  serialNumbersBulkSet: async () => ({ success: true }),
  serialNumbersMarkSold: async () => ({ success: true }),

  // Ventes
  ventesCreate: async (vente: unknown, lignes: unknown[]) => {
    const seq = String(++nextVenteSeq).padStart(4, '0')
    const v = { ...(vente as object), id: `v${Date.now()}`, numero: `VTE-20260501-${seq}` }
    VENTES.push(v as typeof VENTES[0])
    LIGNES_VENTE[(v as { id: string }).id] = lignes
    return v
  },
  ventesList: async (filters?: { type?: string; from?: string; to?: string }) => {
    let list = [...VENTES]
    if (filters?.type === 'VENTE') list = list.filter(v => v.type === 'VENTE')
    if (filters?.type === 'REPARATION') list = list.filter(v => v.type === 'REPARATION')
    return list
  },
  ventesGetLignes: async (venteId: string) => LIGNES_VENTE[venteId] || [],
  ventesGetLastNumber: async () => nextVenteSeq,

  // Réparations
  reparationsCreate: async (rep: unknown, pieces: unknown[]) => {
    const seq = String(++nextRepSeq).padStart(3, '0')
    const r = { ...(rep as object), id: `r${Date.now()}`, numero: `REP-20260501-${seq}`, statut: 'EN_ATTENTE', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    REPARATIONS.push(r as typeof REPARATIONS[0])
    return { rep: r, pieces }
  },
  reparationsList: async () => REPARATIONS,
  reparationsUpdateStatut: async (id: string, statut: string) => { const r = REPARATIONS.find(x => x.id === id); if (r) r.statut = statut as typeof r.statut; return r; },
  reparationsGetPieces: async () => [],
  reparationsGetLastNumber: async () => nextRepSeq,
  reparationsGetBeneficeStats: async () => ({
    overall: { benefice_net: 0, nb: 0 },
    breakdown: [],
    benefice_mootez: 0,
    part_sml: 0,
    part_materiel: 0,
    part_techniciens: 0,
  }),

  // Sorties caisse
  sortiesCreate: async (s: unknown) => { const out = { ...(s as object), id: `s${Date.now()}`, created_at: new Date().toISOString() }; SORTIES_CAISSE.push(out as typeof SORTIES_CAISSE[0]); return out },
  sortiesList: async () => SORTIES_CAISSE,
  sortiesRecentNotes: async () => ['Achat fournitures bureau', 'Remboursement client', 'Frais livraison'],

  // Factures clients
  facturesClientsList: async (filters?: { from?: string; to?: string }) => {
    void filters
    return [...FACTURES_CLIENTS]
  },
  facturesClientsCreate: async (fc: unknown) => {
    const seq = String(++nextFacClientSeq).padStart(3, '0')
    const out = { ...(fc as object), id: `fc${Date.now()}`, numero: `FAC-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${seq}`, created_at: new Date().toISOString() }
    FACTURES_CLIENTS.push(out as typeof FACTURES_CLIENTS[0])
    return out
  },
  facturesClientsGetLastNumber: async () => nextFacClientSeq,

  // Fournisseurs
  fournisseursList: async () => FOURNISSEURS,
  fournisseursGet: async (id: string) => FOURNISSEURS.find(f => f.id === id) || null,
  fournisseursCreate: async (f: unknown) => {
    const out = { ...(f as object), id: `f${Date.now()}`, solde_du: 0, actif: 1, created_at: new Date().toISOString() }
    FOURNISSEURS.push(out as unknown as typeof FOURNISSEURS[0])
    return out
  },
  fournisseursUpdate: async (id: string, f: unknown) => {
    const idx = FOURNISSEURS.findIndex(x => x.id === id)
    if (idx >= 0) Object.assign(FOURNISSEURS[idx], f, { updated_at: new Date().toISOString() })
    return FOURNISSEURS[idx]
  },

  // Factures fournisseurs
  facturesFournisseursList: async (filters?: { fournisseur_id?: string; statut?: string }) => {
    let list = [...FACTURES_FOURNISSEURS]
    if (filters?.fournisseur_id) list = list.filter(f => f.fournisseur_id === filters.fournisseur_id)
    if (filters?.statut) list = list.filter(f => f.statut_paiement === filters.statut)
    return list
  },
  facturesFournisseursCreate: async (facture: unknown, lignes: unknown[]) => {
    const seq = String(++nextFacFourn).padStart(3, '0')
    const f = facture as { fournisseur_id: string; montant_ttc: number }
    const out = { ...(facture as object), id: `ff${Date.now()}`, numero_facture: `FF-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${seq}`, montant_paye: 0, statut_paiement: 'EN_ATTENTE', created_at: new Date().toISOString() }
    FACTURES_FOURNISSEURS.push(out as typeof FACTURES_FOURNISSEURS[0])
    const fourn = FOURNISSEURS.find(x => x.id === f.fournisseur_id)
    if (fourn) fourn.solde_du = +(fourn.solde_du + f.montant_ttc).toFixed(3)
    void lignes
    return out
  },
  facturesFournisseursGetLastNumber: async () => nextFacFourn,
  facturesFournisseursGet: async () => ({}),
  facturesFournisseursGetLignes: async () => [],
  facturesFournisseursListDrafts: async () => [],
  facturesFournisseursGetDraft: async () => null,
  facturesFournisseursSaveDraft: async (payload: { draftId?: string }) => ({
    success: true,
    draftId: payload.draftId ?? `draft-${Date.now()}`,
    updated_at: new Date().toISOString(),
  }),
  facturesFournisseursDeleteDraft: async () => ({ success: true }),

  // Paiements fournisseurs
  paiementsFournisseursCreate: async (paiement: unknown) => {
    const p = paiement as { facture_id: string; montant: number; fournisseur_id: string }
    const facture = FACTURES_FOURNISSEURS.find(f => f.id === p.facture_id)
    if (facture) {
      facture.montant_paye = +(facture.montant_paye + p.montant).toFixed(3)
      if (facture.montant_paye >= facture.montant_ttc) {
        facture.statut_paiement = 'PAYE'
      } else {
        facture.statut_paiement = 'PARTIEL'
      }
    }
    const fourn = FOURNISSEURS.find(f => f.id === p.fournisseur_id)
    if (fourn) fourn.solde_du = Math.max(0, +(fourn.solde_du - p.montant).toFixed(3))
    return { ...(paiement as object), id: `pf${Date.now()}`, created_at: new Date().toISOString() }
  },

  // Caisse interne
  caisseInterneGetToday: async () => ({ ...CAISSE_INTERNE }),
  caisseInterneMouvementsList: async (date?: string) => {
    void date
    return [...MOUVEMENTS_CI]
  },
  caisseInterneAddMouvement: async (mouvement: unknown) => {
    const m = mouvement as { type: string; montant: number }
    const out = { ...(mouvement as object), id: `mci${Date.now()}`, caisse_interne_id: 'ci1', created_at: new Date().toISOString() }
    MOUVEMENTS_CI.push(out as typeof MOUVEMENTS_CI[0])
    if (m.type === 'ENTREE') {
      CAISSE_INTERNE.total_entrees = +(CAISSE_INTERNE.total_entrees + m.montant).toFixed(3)
      CAISSE_INTERNE.solde_actuel = +(CAISSE_INTERNE.solde_actuel + m.montant).toFixed(3)
    } else {
      CAISSE_INTERNE.total_sorties = +(CAISSE_INTERNE.total_sorties + m.montant).toFixed(3)
      CAISSE_INTERNE.solde_actuel = +(CAISSE_INTERNE.solde_actuel - m.montant).toFixed(3)
    }
    return out
  },
  caisseInterneTransferShift: async (shift_id: string, montant: number) => {
    CAISSE_INTERNE.total_entrees = +(CAISSE_INTERNE.total_entrees + montant).toFixed(3)
    CAISSE_INTERNE.solde_actuel = +(CAISSE_INTERNE.solde_actuel + montant).toFixed(3)
    return { success: true, shift_id, montant }
  },

  // Logs
  logsAdd: async () => ({ success: true }),
  logsList: async () => [],

  // Stats
  statsToday: async () => ({ totalVentes: 338, nombreVentes: 2 }),
  statsByDate: async () => ({ totalVentes: 0, nombreVentes: 0 }),
  statsDashboard: async () => DASHBOARD_DATA,

  // Window controls
  windowMinimize: async () => {},
  windowMaximize: async () => {},
  windowClose: async () => {},

  // Ventes en ligne
  ventesLigneList: async () => [],
  ventesLigneCreate: async (cmd: unknown) => ({ ...(cmd as object), id: `vl${Date.now()}`, statut: 'EN_ATTENTE', created_at: new Date().toISOString() }),
  ventesLigneUpdateStatut: async () => ({ success: true }),
  ventesLigneGetLastNumber: async () => 0,

  // Clients
  clientsList: async (filters?: { search?: string }) => {
    const CLIENTS = [
      { id: 'cl1', nom: 'Mohamed Ben Ali', telephone: '22 345 678', solde_credit: 85.000, credit_limite: 500, actif: 1 },
      { id: 'cl2', nom: 'Fatma Trabelsi', telephone: '55 123 456', solde_credit: 0, credit_limite: 500, actif: 1 },
      { id: 'cl3', nom: 'Karim Mansouri', telephone: '98 765 432', solde_credit: 210.500, credit_limite: 500, actif: 1 },
    ]
    if (filters?.search) {
      const s = filters.search.toLowerCase()
      return CLIENTS.filter(c => c.nom.toLowerCase().includes(s) || c.telephone.includes(s))
    }
    return CLIENTS
  },
  clientsCreate: async (c: unknown) => ({ ...(c as object), id: `cl${Date.now()}`, solde_credit: 0, actif: 1, created_at: new Date().toISOString() }),
  clientsUpdate: async (_id: string, data: unknown) => ({ success: true, ...data }),

  // Crédits clients
  creditsList: async () => [],
  creditsCreate: async (credit: unknown) => ({ ...(credit as object), success: true }),

  // Ventes: annulation
  ventesAnnuler: async (id: string, data: unknown) => ({ success: true, id, ...data }),

  // Organisations
  organisationsList: async () => [
    { id: 'org1', nom: 'B2B Tech', telephone: '71 000 001', matricule_fiscal: '1234567B', credit_total: 0, actif: 1, created_at: new Date().toISOString() },
  ],
  organisationsCreate: async (org: unknown) => ({ ...(org as object), id: `org${Date.now()}`, credit_total: 0, actif: 1, created_at: new Date().toISOString() }),
  organisationsUpdate: async (_id: string, data: unknown) => ({ success: true, ...data }),
  organisationsDelete: async () => ({ success: true }),

  // Personnels
  personnelsList: async () => [
    { id: 'pers1', nom: 'Salah', prenom: 'Ben Amor', poste: 'Technicien', telephone: '22 111 222', cin: '12345678', salaire_base: 900, avance_solde: 0, credit_solde: 0, actif: 1, created_at: new Date().toISOString() },
  ],
  personnelsCreate: async (p: unknown) => ({ ...(p as object), id: `pers${Date.now()}`, avance_solde: 0, credit_solde: 0, actif: 1, created_at: new Date().toISOString() }),
  personnelsUpdate: async (_id: string, data: unknown) => ({ success: true, ...data }),
  personnelsDelete: async () => ({ success: true }),
  mouvementsPersonnelsList: async () => [],
  mouvementsPersonnelsCreate: async (m: unknown) => ({ ...(m as object), id: `mp${Date.now()}`, created_at: new Date().toISOString() }),

  // Documents
  documentsList: async () => [],
  documentsCreate: async (doc: unknown, _lignes: unknown[]) => ({ ...(doc as object), id: `doc${Date.now()}`, created_at: new Date().toISOString() }),
  documentsUpdate: async (_id: string, data: unknown) => ({ success: true, ...data }),
  documentsReplaceLignes: async (_documentId: string, _lignes: unknown[], _totals: unknown) => ({ success: true }),
  documentsGetLignes: async () => [],
  documentsGetLastNumber: async () => 0,

  // Factures fournisseurs marquer reçu
  facturesFournisseursMarquerRecu: async () => ({ success: true }),

  // Retours
  retoursCreate: async (retour: unknown) => {
    const r = retour as { type_retour: string; montant_rembourse: number }
    return { ...(r as object), id: `ret${Date.now()}`, statut: r.type_retour === 'DEFECTUEUX' ? 'EN_ATTENTE' : 'RESOLU', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  },
  retoursList: async () => [
    { id: 'ret1', vente_id: 'v1', vente_numero: 'VTE-20260501-0001', shift_id: 'shift1', produit_id: 'p1', designation: 'Écran Dell 24"', quantite: 1, prix_unitaire: 195.000, motif: 'Défaut de fabrication', type_retour: 'DEFECTUEUX', statut: 'EN_ATTENTE', resolution: null, montant_rembourse: 0, operateur: 'Amira', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ],
  retoursUpdateStatut: async (id: string, statut: string) => ({ id, statut, updated_at: new Date().toISOString() }),

  // Paramètres
  settingsGetAll: async () => ({
    company_name: 'SML Informatiques', company_subtitle: 'Vente · Installation · Maintenance',
    company_address: 'Cité Ain Mnekh, 7100 Kef', company_phone: '78 203 905',
    company_matricule: '1820629/E', company_rib: '08062021061000261191',
    company_email: '', invoice_primary_color: '#F59E0B',
    facture_layout: 'professionnel', invoice_prefix_facture: 'FAC', invoice_prefix_vente: 'VTE',
    invoice_footer: 'Merci pour votre confiance !', invoice_show_tva: 'true', invoice_timbre_fiscal: 'true', tva_defaut_pct: '19',
    fond_de_caisse_defaut: '100', frais_retour_colis: '4', credit_max_client: '500',
    marge_defaut_pct: '30', pos_show_calculator: 'true', pos_confirm_sortie: 'true',
    impression_largeur: '80', impression_copies: '1', impression_auto_print: 'false',
    caisse_interne_pin: 'sml2023', securite_require_shift: 'true', currency: 'DT', currency_decimals: '3',
    lock_screen_minutes: '30', pin_amira: 'amira123', pin_hamdi: 'hamdi123', pin_hamma: 'hamma123',
    invoice_template_json: '{}',
  }),
  settingsGet: async (key: string) => {
    const defaults: Record<string, string> = {
      caisse_interne_pin: 'sml2023', frais_retour_colis: '4', fond_de_caisse_defaut: '100',
    }
    return defaults[key] ?? null
  },
  settingsSet: async () => ({ success: true }),
  settingsSetMany: async () => ({ success: true }),

  // Cloud backup (R2) — mock for browser preview
  r2GetStatus: async () => ({
    configured: false,
    enabled: false,
    machineId: 'preview-pc',
    bucket: '',
    endpoint: '',
    lastUploadAt: null,
    lastUploadKey: null,
    lastError: null,
    snapshotCount: 0,
    nextUploadInMs: null,
  }),
  r2ListSnapshots: async () => [],
  r2TestConnection: async () => ({ ok: false, error: 'Disponible dans l\'application Electron' }),
  r2UploadNow: async () => ({ success: false, error: 'Disponible dans l\'application Electron' }),
  r2Restore: async () => ({ success: false, error: 'Disponible dans l\'application Electron' }),

  // Caisse interne stats
  caisseInterneGetStats: async () => ({
    byAgent: [], byCategorie: [], totalEntrees: 0, totalSorties: 0,
  }),

}

function isElectronRuntime() {
  return typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('electron')
}

// Auto-inject at module evaluation time so window.api is set before any
// component module captures it via `const api = window.api`.
if (typeof window !== 'undefined' && !(window as unknown as { api?: unknown }).api && !isElectronRuntime()) {
  ;(window as unknown as { api: typeof mockApi }).api = mockApi
  console.info('[SMLPOS] Running in browser preview mode — mock API injected')
}

/** @deprecated Side-effect is now automatic; kept for backwards compatibility. */
export function injectMockApi() {
  if (typeof window !== 'undefined' && !(window as unknown as { api?: unknown }).api && !isElectronRuntime()) {
    ;(window as unknown as { api: typeof mockApi }).api = mockApi
  }
}
