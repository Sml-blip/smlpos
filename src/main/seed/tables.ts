/**
 * Seed contract — table/column classification.
 *
 * Money in SMLPOS is stored locally as REAL dinars (3 decimals). The seed contract sends
 * every money column as an INTEGER number of millimes (1 TND = 1000 millimes).
 * Any REAL column that is neither money nor a known rate is "unclassified" and BLOCKS the
 * seed until it is classified here — nothing is guessed silently.
 */

export const CONTRACT_VERSION = 1
export const MONEY_UNIT = 'millime'

/** Local-only technical tables that are never seeded. */
export const EXCLUDED_TABLES = new Set(['sync_queue', 'saved_paniers', 'inventory_repair_ledger', 'outbox', 'sync_state', 'pull_rejects'])

/** One table selection rule for snapshot export and transactional live capture. */
export function syncedTableNames(names: string[]): string[] { return tableOrder(names.filter(name => !name.startsWith('sqlite_') && !EXCLUDED_TABLES.has(name))) }
export const COUNTER_COLUMNS: Record<string, readonly string[]> = {
  produits: ['stock_actuel'], clients: ['solde_credit', 'solde_fidelite'], fournisseurs: ['solde_du'],
  organisations: ['credit_total'], personnels: ['avance_solde', 'credit_solde'],
  caisse_interne: ['total_entrees', 'total_sorties'],
}

/** app_settings keys that stay on the machine (devices, secrets, local paths). */
export const LOCAL_ONLY_SETTING_KEYS = new Set([
  'bootstrap_completed_at', 'bootstrap_last_errors', 'pull_last_at', 'backup_folder_path',
  'r2_enabled', 'r2_endpoint', 'r2_bucket', 'r2_access_key_id', 'r2_secret_access_key',
  'r2_machine_id', 'r2_last_upload_at', 'r2_last_upload_key', 'r2_last_upload_error',
  'supabase_keepalive_at', 'supabase_keepalive_error', 'schema_version',
  'device_id', 'install_id', 'backend_url', 'sync_backend', 'pull_cursor', 'apply_mute', 'seed_finalized_at',
])
/** Anything that looks like a credential is never uploaded, whatever its key. */
export const SECRET_SETTING_FRAGMENTS = ['secret', 'token', 'password', 'passwd', 'pin', 'api_key', 'api-key', 'apikey', 'access_key', 'access-key', 'accesskey', 'private']
export const SECRET_SETTING_PATTERN = new RegExp(SECRET_SETTING_FRAGMENTS.join('|'), 'i')

/** Parent tables first. Unlisted tables go last (priority 45). */
export const TABLE_PRIORITY: Record<string, number> = {
  operateurs: 10, categories: 10, fournisseurs: 10, organisations: 10, clients: 10,
  personnels: 10, services_pos: 10, app_settings: 10,
  shifts: 20,
  produits: 30, caisse_interne: 30, documents: 30,
  ventes: 40, factures_fournisseurs: 40, reparations: 40, ventes_en_ligne: 40,
  lignes_vente: 50, lignes_document: 50, lignes_facture_fournisseur: 50,
  pieces_reparation: 50, factures_clients: 50, credits_clients: 50, sorties_caisse: 50,
  transactions_services: 50, paiements_fournisseurs: 50, mouvements_caisse_interne: 50,
  mouvements_personnels: 50, retours: 50,
  activity_logs: 60,
}
export const DEFAULT_PRIORITY = 45

export function tableOrder(names: string[]): string[] {
  return [...names].sort(
    (a, b) => (TABLE_PRIORITY[a] ?? DEFAULT_PRIORITY) - (TABLE_PRIORITY[b] ?? DEFAULT_PRIORITY) || a.localeCompare(b),
  )
}

export function primaryKeyOf(table: string): string {
  return table === 'app_settings' ? 'key' : 'id'
}

/** Money columns per table (REAL dinars locally → integer millimes on the wire). */
export const MONEY_COLUMNS: Record<string, readonly string[]> = {
  fournisseurs: ['solde_du'],
  organisations: ['credit_total'],
  clients: ['credit_limite', 'solde_credit', 'solde_fidelite'],
  personnels: ['salaire_base', 'avance_solde', 'credit_solde'],
  shifts: [
    'fond_de_caisse', 'total_ventes_especes', 'total_services', 'total_reparations',
    'total_credits_recus', 'total_sorties', 'solde_theorique', 'solde_declare', 'ecart',
  ],
  produits: [
    'prix_achat', 'prix_vente', 'prix_achat_ttc', 'cout_supplementaire', 'cout_de_revient',
    'prix_vente_ht', 'pvp',
  ],
  ventes: [
    'sous_total', 'total_remises', 'total_ttc', 'montant_recu', 'monnaie_rendue',
    'fidelite_utilisee', 'fidelite_gagnee', 'montant_encaisse_initial', 'avance_utilisee',
  ],
  lignes_vente: ['prix_unitaire', 'total_ligne'],
  factures_clients: ['total_ht', 'total_tva', 'total_ttc'],
  reparations: ['main_oeuvre', 'acompte', 'total_estime', 'total_final', 'benefice'],
  pieces_reparation: ['prix_unitaire', 'prix_achat'],
  sorties_caisse: ['montant'],
  factures_fournisseurs: [
    'montant_ht', 'montant_tva', 'montant_ttc', 'montant_paye', 'timbre',
    'ht_7', 'tva_7', 'ht_19', 'tva_19', 'total_remise', 'retenue_source_montant', 'net_a_payer',
  ],
  lignes_facture_fournisseur: ['ancien_prix_achat', 'nouveau_prix_achat', 'prix_vente_suggere', 'prix_vente_applique'],
  paiements_fournisseurs: ['montant'],
  ajustements_fournisseurs: ['montant'],
  credits_clients: ['montant'],
  retours: ['prix_unitaire', 'montant_rembourse'],
  ventes_en_ligne: ['montant_ttc', 'montant_net', 'frais_livraison', 'frais_retour', 'montant_recu'],
  caisse_interne: ['solde_ouverture', 'total_entrees', 'total_sorties'],
  mouvements_caisse_interne: ['montant'],
  mouvements_personnels: ['montant'],
  documents: [
    'total_ht', 'total_tva', 'total_ttc', 'montant_paye', 'timbre',
    'ht_7', 'tva_7', 'ht_19', 'tva_19', 'total_remise',
  ],
  lignes_document: ['prix_unitaire', 'total_ht', 'total_tva', 'total_ttc'],
  transactions_services: ['montant_frais'],
  activity_logs: ['montant'],
  // Tables outside the legacy Supabase sync list — found by the "unclassified REAL" guard.
  avances_clients: ['montant', 'prix_produit'],
  demandes_clients: ['avance'],
  mouvements_fidelite: ['montant', 'solde_avant', 'solde_apres'], // loyalty is stored via money3() → dinars
  mouvements_echange: ['montant', 'ancien_total', 'nouveau_total'],
  mouvements_tresorerie_attente: ['montant'],
  rapports_caisse: ['fond_de_caisse', 'total_entrees', 'total_sorties', 'solde_theorique', 'solde_reel', 'ecart'],
  remboursements_ventes: ['montant'],
}

/** Percent / ratio columns: sent as plain decimals, never converted. */
export const RATE_COLUMNS = new Set([
  'tva_taux', 'tva_achat_pct', 'marge_pct', 'coef_av', 'remise_pct', 'tva_taux_principal', 'retenue_source_pct',
])

export function moneyColumnsOf(table: string): readonly string[] {
  return MONEY_COLUMNS[table] ?? []
}

export type ColumnKind = 'money' | 'rate' | 'integer' | 'real_unclassified' | 'other'

export function classifyColumn(table: string, column: string, declaredType: string): ColumnKind {
  if (moneyColumnsOf(table).includes(column)) return 'money'
  if (RATE_COLUMNS.has(column)) return 'rate'
  const t = declaredType.toUpperCase()
  if (t.includes('INT')) return 'integer'
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB') || t.includes('NUM') || t.includes('DEC')) {
    return 'real_unclassified'
  }
  return 'other'
}

/** Money value (dinars) → integer millimes. Returns the rounding drift in millimes. */
export function toMillimes(value: unknown): { ok: true; millimes: number; drift: number } | { ok: false; reason: string } {
  let n: number
  if (typeof value === 'number') n = value
  else if (typeof value === 'string' && value.trim() !== '') n = Number(value)
  else return { ok: false, reason: 'not_numeric' }
  if (!Number.isFinite(n)) return { ok: false, reason: 'not_finite' }
  const scaled = n * 1000
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled))
  if (!Number.isSafeInteger(rounded)) return { ok: false, reason: 'out_of_range' }
  return { ok: true, millimes: rounded, drift: Math.abs(scaled - rounded) }
}

/** Float noise from 3-decimal arithmetic (e.g. 12.345000000000001) is not real drift. */
export const DRIFT_TOLERANCE_MILLIMES = 1e-6
