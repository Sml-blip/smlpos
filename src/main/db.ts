import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { seedProductsIfEmpty } from './seedProducts'
import { applyPendingWipeBeforeDbOpen, getActiveDbPath, recoverLegacyDatabaseIfNeeded } from './userDataWipe'

let dbInstance: Database.Database | null = null
export let dbFilePath = ''

/** Open SQLite after any pending factory wipe — call from app.whenReady() only. */
export function connectDatabase(): Database.Database {
  if (dbInstance) return dbInstance
  applyPendingWipeBeforeDbOpen()
  const recovery = recoverLegacyDatabaseIfNeeded()
  if (recovery.recovered) {
    console.log(`[db] Auto-recovered ${recovery.productCount} products from ${recovery.from}`)
  }
  dbFilePath = getActiveDbPath()
  const dbDir = join(dbFilePath, '..')
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })
  dbInstance = new Database(dbFilePath)
  return dbInstance
}

export function getDb(): Database.Database {
  if (!dbInstance) throw new Error('Database not connected — call connectDatabase() first')
  return dbInstance
}

export function closeDatabase(): void {
  if (!dbInstance) return
  try { dbInstance.close() } catch { /* ignore */ }
  dbInstance = null
}

export const db = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const inst = getDb()
    const value = Reflect.get(inst as object, prop)
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(inst) : value
  },
})

/** Bump when migrations change — logged on boot and returned by app:health */
export const SCHEMA_VERSION = '1.9.5'

export function initDatabase() {
  const db = getDb()
  const dbPath = dbFilePath
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    -- ── Opérateurs ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS operateurs (
      id          TEXT PRIMARY KEY,
      nom         TEXT NOT NULL,
      identifiant TEXT UNIQUE NOT NULL,
      role        TEXT DEFAULT 'caissier',
      actif       INTEGER DEFAULT 1,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    -- ── Catégories ───────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS categories (
      id    TEXT PRIMARY KEY,
      nom   TEXT UNIQUE NOT NULL,
      icone TEXT
    );

    -- ── Fournisseurs ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS fournisseurs (
      id               TEXT PRIMARY KEY,
      nom              TEXT NOT NULL,
      contact_nom      TEXT,
      telephone        TEXT,
      email            TEXT,
      adresse          TEXT,
      matricule_fiscal TEXT,
      rib              TEXT,
      solde_du         REAL DEFAULT 0,
      notes            TEXT,
      actif            INTEGER DEFAULT 1,
      created_at       TEXT DEFAULT (datetime('now'))
    );

    -- ── Shifts ───────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS shifts (
      id                       TEXT PRIMARY KEY,
      operateur_id             TEXT,
      operateur_nom            TEXT NOT NULL,
      fond_de_caisse           REAL NOT NULL,
      started_at               TEXT NOT NULL,
      ended_at                 TEXT,
      total_ventes_especes     REAL DEFAULT 0,
      total_services           REAL DEFAULT 0,
      total_reparations        REAL DEFAULT 0,
      total_credits_recus      REAL DEFAULT 0,
      total_sorties            REAL DEFAULT 0,
      solde_theorique          REAL,
      solde_declare            REAL,
      ecart                    REAL,
      transfere_caisse_interne INTEGER DEFAULT 0,
      notes_cloture            TEXT
    );

    -- ── Services POS (Enda / Ooredoo / Orange) ───────────────────────────────
    CREATE TABLE IF NOT EXISTS services_pos (
      id         TEXT PRIMARY KEY,
      nom        TEXT NOT NULL,
      code_barre TEXT UNIQUE NOT NULL,
      logo_url   TEXT,
      actif      INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions_services (
      id            TEXT PRIMARY KEY,
      shift_id      TEXT REFERENCES shifts(id),
      service_id    TEXT REFERENCES services_pos(id),
      service_nom   TEXT NOT NULL,
      montant_frais REAL NOT NULL,
      note          TEXT,
      operateur     TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    -- ── Produits ─────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS produits (
      id             TEXT PRIMARY KEY,
      code_barre     TEXT UNIQUE,
      reference      TEXT UNIQUE NOT NULL,
      nom            TEXT NOT NULL,
      description    TEXT,
      categorie      TEXT DEFAULT 'Général',
      categorie_id   TEXT REFERENCES categories(id),
      type           TEXT CHECK(type IN ('F','NF')) DEFAULT 'F',
      prix_achat     REAL,
      prix_vente     REAL NOT NULL DEFAULT 0,
      tva_taux       REAL DEFAULT 0,
      stock_actuel   INTEGER DEFAULT 0,
      stock_minimum  INTEGER DEFAULT 5,
      fournisseur    TEXT,
      fournisseur_id TEXT REFERENCES fournisseurs(id),
      actif          INTEGER DEFAULT 1,
      created_at     TEXT DEFAULT (datetime('now')),
      updated_at     TEXT DEFAULT (datetime('now'))
    );

    -- ── Numéros de Série ─────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS serial_numbers (
      id          TEXT PRIMARY KEY,
      produit_id  TEXT NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
      numero_serie TEXT NOT NULL,
      statut      TEXT DEFAULT 'EN_STOCK',
      vente_id    TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    -- ── Ventes & Factures ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS ventes (
      id               TEXT PRIMARY KEY,
      numero           TEXT UNIQUE NOT NULL,
      shift_id         TEXT,
      operateur_nom    TEXT,
      client_nom       TEXT,
      client_tel       TEXT,
      client_adresse   TEXT,
      client_matricule TEXT,
      sous_total       REAL,
      total_remises    REAL DEFAULT 0,
      total_ttc        REAL NOT NULL,
      mode_paiement    TEXT,
      montant_recu     REAL,
      monnaie_rendue   REAL DEFAULT 0,
      type             TEXT DEFAULT 'VENTE',
      a_facture        INTEGER DEFAULT 0,
      created_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lignes_vente (
      id            TEXT PRIMARY KEY,
      vente_id      TEXT REFERENCES ventes(id) ON DELETE CASCADE,
      produit_id    TEXT,
      designation   TEXT NOT NULL,
      quantite      INTEGER NOT NULL,
      prix_unitaire REAL NOT NULL,
      remise_pct    REAL DEFAULT 0,
      total_ligne   REAL NOT NULL,
      type_produit  TEXT DEFAULT 'F'
    );

    -- ── Factures Clients ─────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS factures_clients (
      id               TEXT PRIMARY KEY,
      numero           TEXT UNIQUE NOT NULL,
      shift_id         TEXT,
      vente_id         TEXT REFERENCES ventes(id),
      type_facture     TEXT DEFAULT 'VENTE_INDIVIDUELLE',
      client_nom       TEXT,
      client_tel       TEXT,
      client_adresse   TEXT,
      client_matricule TEXT,
      total_ht         REAL NOT NULL,
      total_tva        REAL DEFAULT 0,
      total_ttc        REAL NOT NULL,
      imprimee         INTEGER DEFAULT 0,
      created_at       TEXT DEFAULT (datetime('now'))
    );

    -- ── Réparations ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS reparations (
      id                TEXT PRIMARY KEY,
      numero            TEXT UNIQUE NOT NULL,
      shift_id          TEXT,
      operateur_nom     TEXT,
      client_nom        TEXT,
      client_tel        TEXT,
      type_appareil     TEXT,
      marque            TEXT,
      modele            TEXT,
      description_panne TEXT,
      main_oeuvre       REAL DEFAULT 0,
      acompte           REAL DEFAULT 0,
      total_estime      REAL DEFAULT 0,
      total_final       REAL,
      statut            TEXT DEFAULT 'EN_ATTENTE',
      technicien        TEXT,
      notes_technicien  TEXT,
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pieces_reparation (
      id            TEXT PRIMARY KEY,
      reparation_id TEXT REFERENCES reparations(id) ON DELETE CASCADE,
      produit_id    TEXT,
      designation   TEXT NOT NULL,
      quantite      INTEGER DEFAULT 1,
      prix_unitaire REAL DEFAULT 0,
      type          TEXT DEFAULT 'F'
    );

    -- ── Sorties de caisse ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS sorties_caisse (
      id         TEXT PRIMARY KEY,
      shift_id   TEXT,
      montant    REAL NOT NULL,
      note       TEXT NOT NULL,
      operateur  TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ── Factures Fournisseurs ────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS factures_fournisseurs (
      id              TEXT PRIMARY KEY,
      numero_facture  TEXT NOT NULL,
      fournisseur_id  TEXT REFERENCES fournisseurs(id),
      date_facture    TEXT NOT NULL,
      date_echeance   TEXT,
      statut_paiement TEXT DEFAULT 'EN_ATTENTE',
      montant_ht      REAL NOT NULL,
      montant_tva     REAL DEFAULT 0,
      montant_ttc     REAL NOT NULL,
      montant_paye    REAL DEFAULT 0,
      notes           TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lignes_facture_fournisseur (
      id                  TEXT PRIMARY KEY,
      facture_id          TEXT REFERENCES factures_fournisseurs(id) ON DELETE CASCADE,
      produit_id          TEXT,
      designation         TEXT NOT NULL,
      quantite            INTEGER NOT NULL,
      ancien_prix_achat   REAL,
      nouveau_prix_achat  REAL NOT NULL,
      prix_vente_suggere  REAL,
      prix_vente_applique REAL,
      tva_taux            REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS paiements_fournisseurs (
      id               TEXT PRIMARY KEY,
      facture_id       TEXT REFERENCES factures_fournisseurs(id),
      fournisseur_id   TEXT REFERENCES fournisseurs(id),
      montant          REAL NOT NULL,
      mode_paiement    TEXT DEFAULT 'ESPECES',
      reference_cheque TEXT,
      date_paiement    TEXT DEFAULT (date('now')),
      notes            TEXT,
      created_at       TEXT DEFAULT (datetime('now'))
    );

    -- ── Caisse Interne ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS caisse_interne (
      id              TEXT PRIMARY KEY,
      date_journal    TEXT UNIQUE NOT NULL DEFAULT (date('now')),
      solde_ouverture REAL NOT NULL DEFAULT 100.000,
      total_entrees   REAL DEFAULT 0,
      total_sorties   REAL DEFAULT 0,
      notes           TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mouvements_caisse_interne (
      id           TEXT PRIMARY KEY,
      date_journal TEXT NOT NULL DEFAULT (date('now')),
      type         TEXT NOT NULL CHECK (type IN ('ENTREE','SORTIE')),
      categorie    TEXT NOT NULL,
      montant      REAL NOT NULL,
      reference_id TEXT,
      note         TEXT,
      operateur    TEXT DEFAULT 'superadmin',
      created_at   TEXT DEFAULT (datetime('now'))
    );

    -- ── Activity Logs ────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS activity_logs (
      id         TEXT PRIMARY KEY,
      shift_id   TEXT,
      operateur  TEXT,
      action     TEXT NOT NULL,
      details    TEXT DEFAULT '{}',
      montant    REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ── Sync Queue (offline) ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS sync_queue (
      id         TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      operation  TEXT NOT NULL,
      payload    TEXT NOT NULL,
      record_id  TEXT,
      attempts   INTEGER DEFAULT 0,
      last_error TEXT,
      synced_at  TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ── Seeds ────────────────────────────────────────────────────────────────
    INSERT OR IGNORE INTO operateurs (id, nom, identifiant, role) VALUES
      ('op-hamdi', 'Hamdi', 'hamdi', 'caissier'),
      ('op-hamma', 'Hamma', 'hamma', 'caissier'),
      ('op-amira', 'Amira', 'amira', 'superadmin');

    INSERT OR IGNORE INTO categories (id, nom) VALUES
      ('cat-01', 'ACCESSOIRE'),
      ('cat-02', 'COMPOSANTS GAMING'),
      ('cat-03', 'ECRAN'),
      ('cat-04', 'ELECTRO'),
      ('cat-05', 'FORNETURE'),
      ('cat-06', 'IMPRIMANTE'),
      ('cat-07', 'PC GAMING'),
      ('cat-08', 'PC PORTABLE'),
      ('cat-09', 'SERVICE'),
      ('cat-10', 'SMARTPHONE'),
      ('cat-11', 'SMARTWATCH'),
      ('cat-12', 'TABLETTE'),
      ('cat-13', 'TELEPHONE PORTABLE'),
      ('cat-14', 'TELEVISION'),
      ('cat-15', 'TROTTINETTE ELECTRIQUE'),
      ('cat-16', 'Général');

    INSERT OR IGNORE INTO services_pos (id, nom, code_barre) VALUES
      ('svc-enda',    'Enda Taw', '0000000000001'),
      ('svc-ooredoo', 'Ooredoo',  '0000000000002'),
      ('svc-orange',  'Orange',   '0000000000003');
  `)

  // Migrate existing shifts table to add new columns if not present
  const shiftCols = (db.pragma('table_info(shifts)') as { name: string }[]).map(c => c.name)
  if (!shiftCols.includes('total_ventes_especes')) {
    db.exec(`ALTER TABLE shifts ADD COLUMN total_ventes_especes REAL DEFAULT 0`)
  }
  if (!shiftCols.includes('total_services')) {
    db.exec(`ALTER TABLE shifts ADD COLUMN total_services REAL DEFAULT 0`)
  }
  if (!shiftCols.includes('total_reparations')) {
    db.exec(`ALTER TABLE shifts ADD COLUMN total_reparations REAL DEFAULT 0`)
  }
  if (!shiftCols.includes('total_credits_recus')) {
    db.exec(`ALTER TABLE shifts ADD COLUMN total_credits_recus REAL DEFAULT 0`)
  }
  if (!shiftCols.includes('total_sorties')) {
    db.exec(`ALTER TABLE shifts ADD COLUMN total_sorties REAL DEFAULT 0`)
  }
  if (!shiftCols.includes('solde_declare')) {
    db.exec(`ALTER TABLE shifts ADD COLUMN solde_declare REAL`)
  }
  if (!shiftCols.includes('ecart')) {
    db.exec(`ALTER TABLE shifts ADD COLUMN ecart REAL`)
  }
  if (!shiftCols.includes('transfere_caisse_interne')) {
    db.exec(`ALTER TABLE shifts ADD COLUMN transfere_caisse_interne INTEGER DEFAULT 0`)
  }

  // Migrate ventes table
  const venteCols = (db.pragma('table_info(ventes)') as { name: string }[]).map(c => c.name)
  if (!venteCols.includes('client_nom')) {
    db.exec(`ALTER TABLE ventes ADD COLUMN client_nom TEXT`)
    db.exec(`ALTER TABLE ventes ADD COLUMN client_tel TEXT`)
    db.exec(`ALTER TABLE ventes ADD COLUMN client_adresse TEXT`)
    db.exec(`ALTER TABLE ventes ADD COLUMN client_matricule TEXT`)
    db.exec(`ALTER TABLE ventes ADD COLUMN a_facture INTEGER DEFAULT 0`)
  }

  // Migrate produits table
  const produitCols = (db.pragma('table_info(produits)') as { name: string }[]).map(c => c.name)
  if (!produitCols.includes('categorie_id')) {
    db.exec(`ALTER TABLE produits ADD COLUMN categorie_id TEXT REFERENCES categories(id)`)
    db.exec(`ALTER TABLE produits ADD COLUMN fournisseur_id TEXT REFERENCES fournisseurs(id)`)
  }
  if (!produitCols.includes('has_serial_number')) {
    db.exec(`ALTER TABLE produits ADD COLUMN has_serial_number INTEGER DEFAULT 0`)
  }
  if (!produitCols.includes('numero_serie')) {
    db.exec(`ALTER TABLE produits ADD COLUMN numero_serie TEXT`)
  }
  // v1.7 — pricing algorithm columns
  if (!produitCols.includes('tva_achat_pct')) {
    db.exec(`ALTER TABLE produits ADD COLUMN tva_achat_pct REAL DEFAULT 0`)
  }
  if (!produitCols.includes('marge_pct')) {
    db.exec(`ALTER TABLE produits ADD COLUMN marge_pct REAL`)
  }
  if (!produitCols.includes('coef_av')) {
    db.exec(`ALTER TABLE produits ADD COLUMN coef_av REAL`)
  }
  if (!produitCols.includes('cout_supplementaire')) {
    db.exec(`ALTER TABLE produits ADD COLUMN cout_supplementaire REAL DEFAULT 0`)
  }
  if (!produitCols.includes('cout_de_revient')) {
    db.exec(`ALTER TABLE produits ADD COLUMN cout_de_revient REAL`)
  }
  if (!produitCols.includes('prix_vente_ht')) {
    db.exec(`ALTER TABLE produits ADD COLUMN prix_vente_ht REAL`)
  }
  if (!produitCols.includes('pvp')) {
    db.exec(`ALTER TABLE produits ADD COLUMN pvp REAL`)
  }

  // Migrate reparations table
  const repCols = (db.pragma('table_info(reparations)') as { name: string }[]).map(c => c.name)
  if (!repCols.includes('technicien')) {
    db.exec(`ALTER TABLE reparations ADD COLUMN technicien TEXT`)
    db.exec(`ALTER TABLE reparations ADD COLUMN notes_technicien TEXT`)
  }
  if (!repCols.includes('benefice')) {
    db.exec(`ALTER TABLE reparations ADD COLUMN benefice REAL`)
  }

  // Migrate sorties_caisse table — add mouvement_interne_id link
  const sortieCols = (db.pragma('table_info(sorties_caisse)') as { name: string }[]).map(c => c.name)
  if (!sortieCols.includes('mouvement_interne_id')) {
    db.exec(`ALTER TABLE sorties_caisse ADD COLUMN mouvement_interne_id TEXT`)
  }

  // ── Ventes en Ligne ────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS ventes_en_ligne (
      id                   TEXT PRIMARY KEY,
      numero               TEXT UNIQUE NOT NULL,
      shift_id             TEXT,
      operateur_nom        TEXT,
      client_nom           TEXT NOT NULL,
      client_tel           TEXT,
      client_adresse       TEXT,
      produits_json        TEXT NOT NULL DEFAULT '[]',
      montant_ttc          REAL NOT NULL,
      montant_net          REAL,
      frais_livraison      REAL DEFAULT 0,
      frais_retour         REAL DEFAULT 4,
      statut               TEXT DEFAULT 'EN_ATTENTE',
      livraison_nom        TEXT,
      montant_recu         REAL DEFAULT 0,
      reference_livraison  TEXT,
      note                 TEXT,
      created_at           TEXT DEFAULT (datetime('now')),
      updated_at           TEXT DEFAULT (datetime('now'))
    );

    -- ── Clients ────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS clients (
      id               TEXT PRIMARY KEY,
      nom              TEXT NOT NULL,
      telephone        TEXT,
      email            TEXT,
      adresse          TEXT,
      matricule_fiscal TEXT,
      credit_limite    REAL DEFAULT 500,
      solde_credit     REAL DEFAULT 0,
      organisation_id  TEXT,
      agent            TEXT,
      actif            INTEGER DEFAULT 1,
      notes            TEXT,
      created_at       TEXT DEFAULT (datetime('now'))
    );

    -- ── Crédits Clients ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS credits_clients (
      id         TEXT PRIMARY KEY,
      client_id  TEXT REFERENCES clients(id),
      client_nom TEXT NOT NULL,
      shift_id   TEXT,
      type       TEXT NOT NULL CHECK(type IN ('CREDIT','PAIEMENT')),
      montant    REAL NOT NULL,
      reference  TEXT,
      note       TEXT,
      operateur  TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ── Paramètres Application ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- ── Retours (Returns) ──────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS retours (
      id                TEXT PRIMARY KEY,
      vente_id          TEXT,
      vente_numero      TEXT,
      shift_id          TEXT,
      produit_id        TEXT,
      designation       TEXT NOT NULL,
      quantite          INTEGER NOT NULL,
      prix_unitaire     REAL NOT NULL,
      motif             TEXT,
      type_retour       TEXT NOT NULL CHECK(type_retour IN ('DEFECTUEUX','SANS_PROBLEME')),
      statut            TEXT DEFAULT 'EN_ATTENTE',
      resolution        TEXT,
      montant_rembourse REAL DEFAULT 0,
      operateur         TEXT,
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now'))
    );
  `)

  // ── v1.3.9 migrations ──────────────────────────────────────────────────────
  try { db.exec(`ALTER TABLE clients ADD COLUMN credit_limite REAL DEFAULT 500`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE ventes_en_ligne ADD COLUMN montant_net REAL`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE ventes_en_ligne ADD COLUMN reference_livraison TEXT`) } catch { /* already exists */ }

  // ── v1.5 migrations ────────────────────────────────────────────────────────
  // Ventes: cancel support
  try { db.exec(`ALTER TABLE ventes ADD COLUMN statut TEXT DEFAULT 'ACTIVE'`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE ventes ADD COLUMN annule_par TEXT`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE ventes ADD COLUMN annule_at TEXT`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE ventes ADD COLUMN annule_motif TEXT`) } catch { /* already exists */ }

  // Clients: organisations
  try { db.exec(`ALTER TABLE clients ADD COLUMN organisation_id TEXT`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE clients ADD COLUMN matricule_fiscal TEXT`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE clients ADD COLUMN agent TEXT`) } catch { /* already exists */ }

  // New tables for v1.5
  db.exec(`
    -- Organisations
    CREATE TABLE IF NOT EXISTS organisations (
      id               TEXT PRIMARY KEY,
      nom              TEXT NOT NULL,
      telephone        TEXT,
      email            TEXT,
      adresse          TEXT,
      matricule_fiscal TEXT,
      credit_total     REAL DEFAULT 0,
      notes            TEXT,
      actif            INTEGER DEFAULT 1,
      created_at       TEXT DEFAULT (datetime('now'))
    );

    -- Personnels
    CREATE TABLE IF NOT EXISTS personnels (
      id              TEXT PRIMARY KEY,
      nom             TEXT NOT NULL,
      prenom          TEXT,
      poste           TEXT,
      telephone       TEXT,
      cin             TEXT UNIQUE,
      date_embauche   TEXT,
      salaire_base    REAL NOT NULL DEFAULT 0,
      avance_solde    REAL DEFAULT 0,
      credit_solde    REAL DEFAULT 0,
      actif           INTEGER DEFAULT 1,
      notes           TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS mouvements_personnels (
      id           TEXT PRIMARY KEY,
      personnel_id TEXT REFERENCES personnels(id),
      type         TEXT NOT NULL CHECK(type IN ('SALAIRE','AVANCE','AVANCE_REMBOURSEMENT','CREDIT_PERSONNEL','CREDIT_REMBOURSEMENT')),
      montant      REAL NOT NULL,
      mois         TEXT,
      note         TEXT,
      operateur    TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );

    -- Documents (Facture / Devis / BL)
    CREATE TABLE IF NOT EXISTS documents (
      id               TEXT PRIMARY KEY,
      numero           TEXT UNIQUE NOT NULL,
      type_document    TEXT NOT NULL,
      statut           TEXT DEFAULT 'ACTIF',
      shift_id         TEXT,
      vente_id         TEXT,
      fournisseur_id   TEXT,
      client_id        TEXT,
      client_nom       TEXT,
      client_tel       TEXT,
      client_adresse   TEXT,
      client_matricule TEXT,
      total_ht         REAL NOT NULL DEFAULT 0,
      total_tva        REAL DEFAULT 0,
      total_ttc        REAL NOT NULL DEFAULT 0,
      statut_paiement  TEXT DEFAULT 'PAYE',
      montant_paye     REAL DEFAULT 0,
      date_echeance    TEXT,
      imprimee         INTEGER DEFAULT 0,
      layout_snapshot  TEXT,
      contenu_json     TEXT,
      created_at       TEXT DEFAULT (datetime('now')),
      updated_at       TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lignes_document (
      id            TEXT PRIMARY KEY,
      document_id   TEXT REFERENCES documents(id) ON DELETE CASCADE,
      produit_id    TEXT,
      designation   TEXT NOT NULL,
      quantite      INTEGER NOT NULL,
      prix_unitaire REAL NOT NULL,
      remise_pct    REAL DEFAULT 0,
      tva_taux      REAL DEFAULT 0,
      total_ht      REAL NOT NULL,
      total_tva     REAL DEFAULT 0,
      total_ttc     REAL NOT NULL,
      type_produit  TEXT DEFAULT 'F'
    );
  `)

  // Migrate factures_fournisseurs: add type + statut_reception columns (for BL support)
  try { db.exec(`ALTER TABLE factures_fournisseurs ADD COLUMN type TEXT DEFAULT 'FACTURE_ACHAT'`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE factures_fournisseurs ADD COLUMN statut_reception TEXT DEFAULT 'ARRIVE'`) } catch { /* already exists */ }

  // ── v1.8 migrations ────────────────────────────────────────────────────────

  // fournisseur_commerciaux (new table)
  db.exec(`
    CREATE TABLE IF NOT EXISTS fournisseur_commerciaux (
      id             TEXT PRIMARY KEY,
      fournisseur_id TEXT REFERENCES fournisseurs(id) ON DELETE CASCADE,
      nom            TEXT NOT NULL,
      telephone      TEXT,
      email          TEXT,
      actif          INTEGER DEFAULT 1,
      created_at     TEXT DEFAULT (datetime('now'))
    );
  `)

  // produits: prix_achat_ttc
  try { db.exec(`ALTER TABLE produits ADD COLUMN prix_achat_ttc REAL`) } catch { /* already exists */ }

  // documents: new export/fiscal columns
  try { db.exec(`ALTER TABLE documents ADD COLUMN exo TEXT`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE documents ADD COLUMN timbre REAL DEFAULT 1`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE documents ADD COLUMN ht_7 REAL`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE documents ADD COLUMN tva_7 REAL`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE documents ADD COLUMN ht_19 REAL`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE documents ADD COLUMN tva_19 REAL`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE documents ADD COLUMN total_remise REAL`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE documents ADD COLUMN tva_taux_principal REAL`) } catch { /* already exists */ }

  // factures_fournisseurs: export fields
  try { db.exec(`ALTER TABLE factures_fournisseurs ADD COLUMN exo TEXT`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE factures_fournisseurs ADD COLUMN timbre REAL DEFAULT 1`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE factures_fournisseurs ADD COLUMN ht_7 REAL`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE factures_fournisseurs ADD COLUMN tva_7 REAL`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE factures_fournisseurs ADD COLUMN ht_19 REAL`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE factures_fournisseurs ADD COLUMN tva_19 REAL`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE factures_fournisseurs ADD COLUMN total_remise REAL`) } catch { /* already exists */ }

  // factures_clients: export fields
  try { db.exec(`ALTER TABLE factures_clients ADD COLUMN tva_taux_principal REAL`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE factures_clients ADD COLUMN exo TEXT`) } catch { /* already exists */ }

  // ── v1.9 migrations ────────────────────────────────────────────────────────
  // documents: révocation
  try { db.exec(`ALTER TABLE documents ADD COLUMN revoque_par TEXT`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE documents ADD COLUMN revoque_at TEXT`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE documents ADD COLUMN revoque_motif TEXT`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE documents ADD COLUMN reference_source_id TEXT`) } catch { /* already exists */ }
  // ventes: type_vente
  try { db.exec(`ALTER TABLE ventes ADD COLUMN type_vente TEXT DEFAULT 'TICKET'`) } catch { /* already exists */ }
  // produits: source_tag (NF fournisseur libre)
  try { db.exec(`ALTER TABLE produits ADD COLUMN source_tag TEXT`) } catch { /* already exists */ }
  // lignes_document: numéro de série
  try { db.exec(`ALTER TABLE lignes_document ADD COLUMN numero_serie TEXT`) } catch { /* already exists */ }

  try { db.exec(`ALTER TABLE pieces_reparation ADD COLUMN prix_achat REAL DEFAULT 0`) } catch { /* exists */ }
  try { db.exec(`ALTER TABLE pieces_reparation ADD COLUMN destock_stock INTEGER DEFAULT 0`) } catch { /* exists */ }

  try { db.exec(`ALTER TABLE factures_fournisseurs ADD COLUMN updated_at TEXT`) } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE lignes_facture_fournisseur ADD COLUMN pending_product_json TEXT`) } catch { /* already exists */ }

  db.prepare(`INSERT OR IGNORE INTO categories (id, nom, icone) VALUES ('cat-reparation', 'Réparation', '🔧')`).run()

  // Default settings — keys must match SettingsTab DEFAULTS
  const settingsDefaults: Record<string, string> = {
    // Entreprise
    company_name:            'SML Store',
    company_subtitle:        '',
    company_address:         'Tunis, Tunisie',
    company_phone:           '',
    company_email:           '',
    company_matricule:       '',
    company_rib:             '',
    company_logo:            '',
    // Factures
    facture_layout:          'professionnel',
    invoice_prefix_facture:  'FAC',
    invoice_prefix_vente:    'VTE',
    invoice_footer:          'Merci pour votre confiance !',
    invoice_show_tva:        'true',
    invoice_timbre_fiscal:   'true',
    tva_defaut_pct:          '19',
    // POS
    fond_de_caisse_defaut:   '100',
    frais_retour_colis:      '4',
    credit_max_client:       '500',
    marge_defaut_pct:        '30',
    pos_show_calculator:     'true',
    pos_confirm_sortie:      'true',
    // Impression
    impression_largeur:      '80',
    impression_copies:       '1',
    impression_auto_print:   'false',
    impression_printer_a4:   '',
    impression_printer_ticket: '',
    // Sécurité
    caisse_interne_pin:      'sml2023',
    securite_require_shift:  'true',
    pin_amira:               'amira123',
    pin_hamdi:               'hamdi123',
    pin_hamma:               'hamma123',
    lock_screen_minutes:     '30',
    demo_mode:               'false',
    // Legacy (keep for backwards compat)
    currency:                'DT',
    currency_decimals:       '3',
    // Invoice template
    invoice_template_json:   '{}',
    invoice_primary_color:   '#F59E0B',
    backup_folder_path:            '',
    // v1.9
    facture_vente_sequence_2026:   '0',
    boutique_rib:                  '',
    boutique_banque:               '',
  }
  const insertSetting = db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`)
  for (const [k, v] of Object.entries(settingsDefaults)) insertSetting.run(k, v)

  // Seed demo catalog only on genuine first install (never after factory reset)
  seedProductsIfEmpty(db)

  db.prepare(`INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('schema_version', ?, datetime('now'))`).run(SCHEMA_VERSION)

  const productCount = (db.prepare('SELECT COUNT(*) as cnt FROM produits').get() as { cnt: number }).cnt
  console.log(`Database initialized at: ${dbPath} (schema ${SCHEMA_VERSION}, ${productCount} products)`)
}
