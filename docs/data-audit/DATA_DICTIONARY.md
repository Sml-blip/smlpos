# SMLPOS data dictionary

Generated from literal DDL in `src/main/db.ts`, including later ALTER TABLE additions. SQLite DDL was reconstructed in memory only. No app, seed, repair, import or business database was run.

This is the expected fresh-install structure. Older deployed databases may differ where a migration failed or created a column with different constraints. Row counts and real-data quality are unknown.

43 tables; 536 columns; 28 declared foreign-key relationships.

Column `PK` is its primary-key ordinal; `NOT NULL` is SQLite PRAGMA metadata. In ordinary SQLite rowid tables, a TEXT PRIMARY KEY alone does not imply NOT NULL.

## activity_logs

First declaration: [src/main/db.ts:374](../../src/main/db.ts#L374)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `shift_id` | TEXT | False | — | `—` |
| `operateur` | TEXT | False | — | `—` |
| `action` | TEXT | True | — | `—` |
| `details` | TEXT | False | — | `'{}'` |
| `montant` | REAL | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_activity_logs_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE activity_logs (
      id         TEXT PRIMARY KEY,
      shift_id   TEXT,
      operateur  TEXT,
      action     TEXT NOT NULL,
      details    TEXT DEFAULT '{}',
      montant    REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );
```

## ajustements_fournisseurs

First declaration: [src/main/db.ts:320](../../src/main/db.ts#L320)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `fournisseur_id` | TEXT | True | — | `—` |
| `type` | TEXT | True | — | `—` |
| `montant` | REAL | True | — | `—` |
| `motif` | TEXT | True | — | `—` |
| `caisse_source` | TEXT | False | — | `'SANS_TRACE'` |
| `operateur` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- `fournisseur_id` → `fournisseurs.id`; delete: NO ACTION; update: NO ACTION.

**Indexes and uniqueness:**
- `sqlite_autoindex_ajustements_fournisseurs_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE ajustements_fournisseurs (
      id               TEXT PRIMARY KEY,
      fournisseur_id   TEXT NOT NULL REFERENCES fournisseurs(id),
      type             TEXT NOT NULL CHECK(type IN ('AJOUT','RETRAIT')),
      montant          REAL NOT NULL,
      motif            TEXT NOT NULL,
      caisse_source    TEXT DEFAULT 'SANS_TRACE',
      operateur        TEXT,
      created_at       TEXT DEFAULT (datetime('now'))
    );
```

## app_settings

First declaration: [src/main/db.ts:625](../../src/main/db.ts#L625)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `key` | TEXT | False | 1 | `—` |
| `value` | TEXT | True | — | `''` |
| `updated_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_app_settings_1`: unique (key), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );
```

## avances_clients

First declaration: [src/main/db.ts:928](../../src/main/db.ts#L928)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `numero` | TEXT | True | — | `—` |
| `client_id` | TEXT | True | — | `—` |
| `client_nom` | TEXT | True | — | `—` |
| `client_tel` | TEXT | False | — | `—` |
| `client_adresse` | TEXT | False | — | `—` |
| `produit_description` | TEXT | True | — | `—` |
| `montant` | REAL | True | — | `—` |
| `mode_paiement` | TEXT | True | — | `'ESPECES'` |
| `reference` | TEXT | False | — | `—` |
| `note` | TEXT | False | — | `—` |
| `shift_id` | TEXT | False | — | `—` |
| `operateur` | TEXT | False | — | `—` |
| `type_avance` | TEXT | True | — | `'LIBRE'` |
| `dossier_id` | TEXT | False | — | `—` |
| `produit_id` | TEXT | False | — | `—` |
| `numero_serie` | TEXT | False | — | `—` |
| `prix_produit` | REAL | False | — | `—` |
| `inclure_facture` | INTEGER | True | — | `0` |
| `produits_json` | TEXT | False | — | `—` |
| `facture_id` | TEXT | False | — | `—` |
| `statut` | TEXT | True | — | `'EN_COURS'` |
| `vente_id` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- `produit_id` → `produits.id`; delete: NO ACTION; update: NO ACTION.
- `shift_id` → `shifts.id`; delete: NO ACTION; update: NO ACTION.
- `client_id` → `clients.id`; delete: NO ACTION; update: NO ACTION.

**Indexes and uniqueness:**
- `idx_avances_dossier`: non-unique (dossier_id, statut), partial=False. SQL: `CREATE INDEX idx_avances_dossier ON avances_clients(dossier_id, statut)`
- `idx_avances_client_date`: non-unique (client_id, created_at), partial=False. SQL: `CREATE INDEX idx_avances_client_date ON avances_clients(client_id, created_at DESC)`
- `sqlite_autoindex_avances_clients_2`: unique (numero), partial=False.
- `sqlite_autoindex_avances_clients_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE avances_clients (
      id                  TEXT PRIMARY KEY,
      numero              TEXT UNIQUE NOT NULL,
      client_id           TEXT NOT NULL REFERENCES clients(id),
      client_nom          TEXT NOT NULL,
      client_tel          TEXT,
      client_adresse      TEXT,
      produit_description TEXT NOT NULL,
      montant             REAL NOT NULL CHECK(montant > 0),
      mode_paiement       TEXT NOT NULL DEFAULT 'ESPECES',
      reference           TEXT,
      note                TEXT,
      shift_id            TEXT REFERENCES shifts(id),
      operateur           TEXT,
      type_avance         TEXT NOT NULL DEFAULT 'LIBRE',
      dossier_id          TEXT,
      produit_id          TEXT REFERENCES produits(id),
      numero_serie        TEXT,
      prix_produit        REAL,
      inclure_facture     INTEGER NOT NULL DEFAULT 0,
      produits_json       TEXT,
      facture_id          TEXT,
      statut              TEXT NOT NULL DEFAULT 'EN_COURS',
      vente_id            TEXT,
      created_at          TEXT DEFAULT (datetime('now'))
    );
```

## caisse_interne

First declaration: [src/main/db.ts:332](../../src/main/db.ts#L332)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `date_journal` | TEXT | True | — | `date('now')` |
| `solde_ouverture` | REAL | True | — | `100.000` |
| `total_entrees` | REAL | False | — | `0` |
| `total_sorties` | REAL | False | — | `0` |
| `notes` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_caisse_interne_2`: unique (date_journal), partial=False.
- `sqlite_autoindex_caisse_interne_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE caisse_interne (
      id              TEXT PRIMARY KEY,
      date_journal    TEXT UNIQUE NOT NULL DEFAULT (date('now')),
      solde_ouverture REAL NOT NULL DEFAULT 100.000,
      total_entrees   REAL DEFAULT 0,
      total_sorties   REAL DEFAULT 0,
      notes           TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );
```

## categories

First declaration: [src/main/db.ts:73](../../src/main/db.ts#L73)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `nom` | TEXT | True | — | `—` |
| `icone` | TEXT | False | — | `—` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_categories_2`: unique (nom), partial=False.
- `sqlite_autoindex_categories_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE categories (
      id    TEXT PRIMARY KEY,
      nom   TEXT UNIQUE NOT NULL,
      icone TEXT
    );
```

## clients

First declaration: [src/main/db.ts:594](../../src/main/db.ts#L594)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `nom` | TEXT | True | — | `—` |
| `telephone` | TEXT | False | — | `—` |
| `email` | TEXT | False | — | `—` |
| `adresse` | TEXT | False | — | `—` |
| `matricule_fiscal` | TEXT | False | — | `—` |
| `credit_limite` | REAL | False | — | `500` |
| `solde_credit` | REAL | False | — | `0` |
| `organisation_id` | TEXT | False | — | `—` |
| `agent` | TEXT | False | — | `—` |
| `actif` | INTEGER | False | — | `1` |
| `notes` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |
| `fidelite_code` | TEXT | False | — | `—` |
| `solde_fidelite` | REAL | False | — | `0` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `idx_clients_fidelite_code`: unique (fidelite_code), partial=True. SQL: `CREATE UNIQUE INDEX idx_clients_fidelite_code ON clients(fidelite_code) WHERE fidelite_code IS NOT NULL`
- `sqlite_autoindex_clients_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE clients (
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
    , fidelite_code TEXT, solde_fidelite REAL DEFAULT 0);
```

## credits_clients

First declaration: [src/main/db.ts:611](../../src/main/db.ts#L611)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `client_id` | TEXT | False | — | `—` |
| `client_nom` | TEXT | True | — | `—` |
| `shift_id` | TEXT | False | — | `—` |
| `type` | TEXT | True | — | `—` |
| `montant` | REAL | True | — | `—` |
| `reference` | TEXT | False | — | `—` |
| `note` | TEXT | False | — | `—` |
| `operateur` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- `client_id` → `clients.id`; delete: NO ACTION; update: NO ACTION.

**Indexes and uniqueness:**
- `sqlite_autoindex_credits_clients_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE credits_clients (
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
```

## demandes_clients

First declaration: [src/main/db.ts:711](../../src/main/db.ts#L711)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `type_demande` | TEXT | True | — | `—` |
| `titre` | TEXT | True | — | `—` |
| `details` | TEXT | False | — | `—` |
| `client_nom` | TEXT | False | — | `—` |
| `client_tel` | TEXT | False | — | `—` |
| `avance` | REAL | True | — | `0` |
| `responsable_id` | TEXT | False | — | `—` |
| `responsable_nom` | TEXT | True | — | `—` |
| `echeance` | TEXT | False | — | `—` |
| `priorite` | TEXT | True | — | `'NORMALE'` |
| `statut` | TEXT | True | — | `'A_FAIRE'` |
| `created_by` | TEXT | False | — | `—` |
| `completed_at` | TEXT | False | — | `—` |
| `created_at` | TEXT | True | — | `—` |
| `updated_at` | TEXT | True | — | `—` |

**Declared foreign keys:**
- `responsable_id` → `operateurs.id`; delete: NO ACTION; update: NO ACTION.

**Indexes and uniqueness:**
- `idx_demandes_clients_responsable`: non-unique (responsable_id, statut), partial=False. SQL: `CREATE INDEX idx_demandes_clients_responsable
      ON demandes_clients(responsable_id, statut)`
- `idx_demandes_clients_statut_echeance`: non-unique (statut, echeance), partial=False. SQL: `CREATE INDEX idx_demandes_clients_statut_echeance
      ON demandes_clients(statut, echeance)`
- `sqlite_autoindex_demandes_clients_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE demandes_clients (
      id               TEXT PRIMARY KEY,
      type_demande     TEXT NOT NULL CHECK(type_demande IN ('PRODUIT','PIECE','RAPPEL')),
      titre            TEXT NOT NULL,
      details          TEXT,
      client_nom       TEXT,
      client_tel       TEXT,
      avance           REAL NOT NULL DEFAULT 0,
      responsable_id   TEXT REFERENCES operateurs(id),
      responsable_nom  TEXT NOT NULL,
      echeance         TEXT,
      priorite         TEXT NOT NULL DEFAULT 'NORMALE' CHECK(priorite IN ('NORMALE','URGENTE')),
      statut           TEXT NOT NULL DEFAULT 'A_FAIRE' CHECK(statut IN ('A_FAIRE','TERMINE','ANNULE')),
      created_by       TEXT,
      completed_at     TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
```

## documents

First declaration: [src/main/db.ts:783](../../src/main/db.ts#L783)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `numero` | TEXT | True | — | `—` |
| `type_document` | TEXT | True | — | `—` |
| `statut` | TEXT | False | — | `'ACTIF'` |
| `shift_id` | TEXT | False | — | `—` |
| `vente_id` | TEXT | False | — | `—` |
| `fournisseur_id` | TEXT | False | — | `—` |
| `client_id` | TEXT | False | — | `—` |
| `client_nom` | TEXT | False | — | `—` |
| `client_tel` | TEXT | False | — | `—` |
| `client_adresse` | TEXT | False | — | `—` |
| `client_matricule` | TEXT | False | — | `—` |
| `total_ht` | REAL | True | — | `0` |
| `total_tva` | REAL | False | — | `0` |
| `total_ttc` | REAL | True | — | `0` |
| `statut_paiement` | TEXT | False | — | `'PAYE'` |
| `montant_paye` | REAL | False | — | `0` |
| `date_echeance` | TEXT | False | — | `—` |
| `imprimee` | INTEGER | False | — | `0` |
| `layout_snapshot` | TEXT | False | — | `—` |
| `contenu_json` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |
| `updated_at` | TEXT | False | — | `datetime('now')` |
| `exo` | TEXT | False | — | `—` |
| `timbre` | REAL | False | — | `1` |
| `ht_7` | REAL | False | — | `—` |
| `tva_7` | REAL | False | — | `—` |
| `ht_19` | REAL | False | — | `—` |
| `tva_19` | REAL | False | — | `—` |
| `total_remise` | REAL | False | — | `—` |
| `tva_taux_principal` | REAL | False | — | `—` |
| `revoque_par` | TEXT | False | — | `—` |
| `revoque_at` | TEXT | False | — | `—` |
| `revoque_motif` | TEXT | False | — | `—` |
| `reference_source_id` | TEXT | False | — | `—` |
| `avoir_id` | TEXT | False | — | `—` |
| `document_origine_id` | TEXT | False | — | `—` |
| `facture_origine_numero` | TEXT | False | — | `—` |
| `annule_motif` | TEXT | False | — | `—` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_documents_2`: unique (numero), partial=False.
- `sqlite_autoindex_documents_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE documents (
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
    , exo TEXT, timbre REAL DEFAULT 1, ht_7 REAL, tva_7 REAL, ht_19 REAL, tva_19 REAL, total_remise REAL, tva_taux_principal REAL, revoque_par TEXT, revoque_at TEXT, revoque_motif TEXT, reference_source_id TEXT, avoir_id TEXT, document_origine_id TEXT, facture_origine_numero TEXT, annule_motif TEXT);
```

## factures_clients

First declaration: [src/main/db.ts:205](../../src/main/db.ts#L205)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `numero` | TEXT | True | — | `—` |
| `shift_id` | TEXT | False | — | `—` |
| `vente_id` | TEXT | False | — | `—` |
| `type_facture` | TEXT | False | — | `'VENTE_INDIVIDUELLE'` |
| `client_nom` | TEXT | False | — | `—` |
| `client_tel` | TEXT | False | — | `—` |
| `client_adresse` | TEXT | False | — | `—` |
| `client_matricule` | TEXT | False | — | `—` |
| `total_ht` | REAL | True | — | `—` |
| `total_tva` | REAL | False | — | `0` |
| `total_ttc` | REAL | True | — | `—` |
| `imprimee` | INTEGER | False | — | `0` |
| `created_at` | TEXT | False | — | `datetime('now')` |
| `tva_taux_principal` | REAL | False | — | `—` |
| `exo` | TEXT | False | — | `—` |

**Declared foreign keys:**
- `vente_id` → `ventes.id`; delete: NO ACTION; update: NO ACTION.

**Indexes and uniqueness:**
- `sqlite_autoindex_factures_clients_2`: unique (numero), partial=False.
- `sqlite_autoindex_factures_clients_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE factures_clients (
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
    , tva_taux_principal REAL, exo TEXT);
```

## factures_fournisseurs

First declaration: [src/main/db.ts:277](../../src/main/db.ts#L277)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `numero_facture` | TEXT | True | — | `—` |
| `fournisseur_id` | TEXT | False | — | `—` |
| `date_facture` | TEXT | True | — | `—` |
| `date_echeance` | TEXT | False | — | `—` |
| `statut_paiement` | TEXT | False | — | `'EN_ATTENTE'` |
| `montant_ht` | REAL | True | — | `—` |
| `montant_tva` | REAL | False | — | `0` |
| `montant_ttc` | REAL | True | — | `—` |
| `montant_paye` | REAL | False | — | `0` |
| `retenue_source_pct` | REAL | False | — | `0` |
| `retenue_source_montant` | REAL | False | — | `0` |
| `net_a_payer` | REAL | False | — | `—` |
| `notes` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |
| `type` | TEXT | False | — | `'FACTURE_ACHAT'` |
| `statut_reception` | TEXT | False | — | `'ARRIVE'` |
| `exo` | TEXT | False | — | `—` |
| `timbre` | REAL | False | — | `1` |
| `ht_7` | REAL | False | — | `—` |
| `tva_7` | REAL | False | — | `—` |
| `ht_19` | REAL | False | — | `—` |
| `tva_19` | REAL | False | — | `—` |
| `total_remise` | REAL | False | — | `—` |
| `updated_at` | TEXT | False | — | `—` |
| `stock_applied` | INTEGER | False | — | `0` |

**Declared foreign keys:**
- `fournisseur_id` → `fournisseurs.id`; delete: NO ACTION; update: NO ACTION.

**Indexes and uniqueness:**
- `sqlite_autoindex_factures_fournisseurs_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE factures_fournisseurs (
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
      retenue_source_pct REAL DEFAULT 0,
      retenue_source_montant REAL DEFAULT 0,
      net_a_payer     REAL,
      notes           TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    , type TEXT DEFAULT 'FACTURE_ACHAT', statut_reception TEXT DEFAULT 'ARRIVE', exo TEXT, timbre REAL DEFAULT 1, ht_7 REAL, tva_7 REAL, ht_19 REAL, tva_19 REAL, total_remise REAL, updated_at TEXT, stock_applied INTEGER DEFAULT 0);
```

## fournisseur_commerciaux

First declaration: [src/main/db.ts:833](../../src/main/db.ts#L833)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `fournisseur_id` | TEXT | False | — | `—` |
| `nom` | TEXT | True | — | `—` |
| `telephone` | TEXT | False | — | `—` |
| `email` | TEXT | False | — | `—` |
| `actif` | INTEGER | False | — | `1` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- `fournisseur_id` → `fournisseurs.id`; delete: CASCADE; update: NO ACTION.

**Indexes and uniqueness:**
- `sqlite_autoindex_fournisseur_commerciaux_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE fournisseur_commerciaux (
      id             TEXT PRIMARY KEY,
      fournisseur_id TEXT REFERENCES fournisseurs(id) ON DELETE CASCADE,
      nom            TEXT NOT NULL,
      telephone      TEXT,
      email          TEXT,
      actif          INTEGER DEFAULT 1,
      created_at     TEXT DEFAULT (datetime('now'))
    );
```

## fournisseurs

First declaration: [src/main/db.ts:80](../../src/main/db.ts#L80)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `nom` | TEXT | True | — | `—` |
| `contact_nom` | TEXT | False | — | `—` |
| `telephone` | TEXT | False | — | `—` |
| `email` | TEXT | False | — | `—` |
| `adresse` | TEXT | False | — | `—` |
| `matricule_fiscal` | TEXT | False | — | `—` |
| `rib` | TEXT | False | — | `—` |
| `solde_du` | REAL | False | — | `0` |
| `notes` | TEXT | False | — | `—` |
| `actif` | INTEGER | False | — | `1` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_fournisseurs_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE fournisseurs (
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
```

## inventory_repair_ledger

First declaration: [src/main/db.ts:633](../../src/main/db.ts#L633)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `repair_key` | TEXT | True | 1 | `—` |
| `operation_id` | TEXT | True | 2 | `—` |
| `repaired_at` | TEXT | True | — | `datetime('now')` |
| `details` | TEXT | False | — | `—` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_inventory_repair_ledger_1`: unique (repair_key, operation_id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE inventory_repair_ledger (
      repair_key   TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      repaired_at  TEXT NOT NULL DEFAULT (datetime('now')),
      details      TEXT,
      PRIMARY KEY (repair_key, operation_id)
    );
```

## lignes_document

First declaration: [src/main/db.ts:809](../../src/main/db.ts#L809)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `document_id` | TEXT | False | — | `—` |
| `produit_id` | TEXT | False | — | `—` |
| `designation` | TEXT | True | — | `—` |
| `quantite` | INTEGER | True | — | `—` |
| `prix_unitaire` | REAL | True | — | `—` |
| `remise_pct` | REAL | False | — | `0` |
| `tva_taux` | REAL | False | — | `0` |
| `total_ht` | REAL | True | — | `—` |
| `total_tva` | REAL | False | — | `0` |
| `total_ttc` | REAL | True | — | `—` |
| `type_produit` | TEXT | False | — | `'F'` |
| `numero_serie` | TEXT | False | — | `—` |

**Declared foreign keys:**
- `document_id` → `documents.id`; delete: CASCADE; update: NO ACTION.

**Indexes and uniqueness:**
- `sqlite_autoindex_lignes_document_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE lignes_document (
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
    , numero_serie TEXT);
```

## lignes_facture_fournisseur

First declaration: [src/main/db.ts:295](../../src/main/db.ts#L295)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `facture_id` | TEXT | False | — | `—` |
| `produit_id` | TEXT | False | — | `—` |
| `designation` | TEXT | True | — | `—` |
| `quantite` | INTEGER | True | — | `—` |
| `ancien_prix_achat` | REAL | False | — | `—` |
| `nouveau_prix_achat` | REAL | True | — | `—` |
| `prix_vente_suggere` | REAL | False | — | `—` |
| `prix_vente_applique` | REAL | False | — | `—` |
| `tva_taux` | REAL | False | — | `0` |
| `pending_product_json` | TEXT | False | — | `—` |
| `numeros_serie_json` | TEXT | False | — | `—` |

**Declared foreign keys:**
- `facture_id` → `factures_fournisseurs.id`; delete: CASCADE; update: NO ACTION.

**Indexes and uniqueness:**
- `sqlite_autoindex_lignes_facture_fournisseur_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE lignes_facture_fournisseur (
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
    , pending_product_json TEXT, numeros_serie_json TEXT);
```

## lignes_vente

First declaration: [src/main/db.ts:192](../../src/main/db.ts#L192)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `vente_id` | TEXT | False | — | `—` |
| `produit_id` | TEXT | False | — | `—` |
| `designation` | TEXT | True | — | `—` |
| `quantite` | INTEGER | True | — | `—` |
| `prix_unitaire` | REAL | True | — | `—` |
| `remise_pct` | REAL | False | — | `0` |
| `total_ligne` | REAL | True | — | `—` |
| `type_produit` | TEXT | False | — | `'F'` |
| `numero_serie` | TEXT | False | — | `—` |

**Declared foreign keys:**
- `vente_id` → `ventes.id`; delete: CASCADE; update: NO ACTION.

**Indexes and uniqueness:**
- `sqlite_autoindex_lignes_vente_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE lignes_vente (
      id            TEXT PRIMARY KEY,
      vente_id      TEXT REFERENCES ventes(id) ON DELETE CASCADE,
      produit_id    TEXT,
      designation   TEXT NOT NULL,
      quantite      INTEGER NOT NULL,
      prix_unitaire REAL NOT NULL,
      remise_pct    REAL DEFAULT 0,
      total_ligne   REAL NOT NULL,
      type_produit  TEXT DEFAULT 'F'
    , numero_serie TEXT);
```

## mouvements_caisse_interne

First declaration: [src/main/db.ts:342](../../src/main/db.ts#L342)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `date_journal` | TEXT | True | — | `date('now')` |
| `type` | TEXT | True | — | `—` |
| `categorie` | TEXT | True | — | `—` |
| `montant` | REAL | True | — | `—` |
| `reference_id` | TEXT | False | — | `—` |
| `note` | TEXT | False | — | `—` |
| `operateur` | TEXT | False | — | `'superadmin'` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_mouvements_caisse_interne_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE mouvements_caisse_interne (
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
```

## mouvements_echange

First declaration: [src/main/db.ts:385](../../src/main/db.ts#L385)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `vente_id` | TEXT | True | — | `—` |
| `shift_id` | TEXT | True | — | `—` |
| `type` | TEXT | True | — | `—` |
| `montant` | REAL | True | — | `—` |
| `ancien_total` | REAL | True | — | `—` |
| `nouveau_total` | REAL | True | — | `—` |
| `operateur` | TEXT | False | — | `—` |
| `details_json` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- `shift_id` → `shifts.id`; delete: NO ACTION; update: NO ACTION.
- `vente_id` → `ventes.id`; delete: NO ACTION; update: NO ACTION.

**Indexes and uniqueness:**
- `sqlite_autoindex_mouvements_echange_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE mouvements_echange (
      id            TEXT PRIMARY KEY,
      vente_id      TEXT NOT NULL REFERENCES ventes(id),
      shift_id      TEXT NOT NULL REFERENCES shifts(id),
      type          TEXT NOT NULL CHECK(type IN ('ENTREE','SORTIE')),
      montant       REAL NOT NULL,
      ancien_total  REAL NOT NULL,
      nouveau_total REAL NOT NULL,
      operateur     TEXT,
      details_json  TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );
```

## mouvements_fidelite

First declaration: [src/main/db.ts:684](../../src/main/db.ts#L684)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `client_id` | TEXT | True | — | `—` |
| `vente_id` | TEXT | False | — | `—` |
| `type` | TEXT | True | — | `—` |
| `montant` | REAL | True | — | `—` |
| `solde_avant` | REAL | True | — | `—` |
| `solde_apres` | REAL | True | — | `—` |
| `note` | TEXT | False | — | `—` |
| `operateur` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- `vente_id` → `ventes.id`; delete: NO ACTION; update: NO ACTION.
- `client_id` → `clients.id`; delete: NO ACTION; update: NO ACTION.

**Indexes and uniqueness:**
- `idx_fidelite_vente_type`: unique (vente_id, type), partial=True. SQL: `CREATE UNIQUE INDEX idx_fidelite_vente_type
      ON mouvements_fidelite(vente_id, type) WHERE vente_id IS NOT NULL`
- `sqlite_autoindex_mouvements_fidelite_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE mouvements_fidelite (
      id            TEXT PRIMARY KEY,
      client_id     TEXT NOT NULL REFERENCES clients(id),
      vente_id      TEXT REFERENCES ventes(id),
      type          TEXT NOT NULL CHECK(type IN ('GAIN','UTILISATION','ANNULATION_GAIN','REMBOURSEMENT')),
      montant       REAL NOT NULL,
      solde_avant   REAL NOT NULL,
      solde_apres   REAL NOT NULL,
      note          TEXT,
      operateur     TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );
```

## mouvements_personnels

First declaration: [src/main/db.ts:771](../../src/main/db.ts#L771)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `personnel_id` | TEXT | False | — | `—` |
| `type` | TEXT | True | — | `—` |
| `montant` | REAL | True | — | `—` |
| `mois` | TEXT | False | — | `—` |
| `note` | TEXT | False | — | `—` |
| `operateur` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- `personnel_id` → `personnels.id`; delete: NO ACTION; update: NO ACTION.

**Indexes and uniqueness:**
- `sqlite_autoindex_mouvements_personnels_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE mouvements_personnels (
      id           TEXT PRIMARY KEY,
      personnel_id TEXT REFERENCES personnels(id),
      type         TEXT NOT NULL CHECK(type IN ('SALAIRE','AVANCE','AVANCE_REMBOURSEMENT','CREDIT_PERSONNEL','CREDIT_REMBOURSEMENT')),
      montant      REAL NOT NULL,
      mois         TEXT,
      note         TEXT,
      operateur    TEXT,
      created_at   TEXT DEFAULT (datetime('now'))
    );
```

## mouvements_tresorerie_attente

First declaration: [src/main/db.ts:357](../../src/main/db.ts#L357)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `direction` | TEXT | True | — | `—` |
| `categorie` | TEXT | True | — | `—` |
| `montant` | REAL | True | — | `—` |
| `reference_id` | TEXT | True | — | `—` |
| `note` | TEXT | False | — | `—` |
| `operateur` | TEXT | False | — | `'superadmin'` |
| `impact_applique` | INTEGER | True | — | `0` |
| `statut` | TEXT | True | — | `'EN_ATTENTE'` |
| `created_at` | TEXT | False | — | `datetime('now')` |
| `accepted_at` | TEXT | False | — | `—` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `idx_tresorerie_attente_reference`: unique (categorie, reference_id), partial=False. SQL: `CREATE UNIQUE INDEX idx_tresorerie_attente_reference
      ON mouvements_tresorerie_attente(categorie, reference_id)`
- `sqlite_autoindex_mouvements_tresorerie_attente_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE mouvements_tresorerie_attente (
      id               TEXT PRIMARY KEY,
      direction        TEXT NOT NULL CHECK (direction IN ('ENTREE','SORTIE')),
      categorie        TEXT NOT NULL,
      montant          REAL NOT NULL,
      reference_id     TEXT NOT NULL,
      note             TEXT,
      operateur        TEXT DEFAULT 'superadmin',
      impact_applique  INTEGER NOT NULL DEFAULT 0,
      statut           TEXT NOT NULL DEFAULT 'EN_ATTENTE' CHECK (statut IN ('EN_ATTENTE','ACCEPTE')),
      created_at       TEXT DEFAULT (datetime('now')),
      accepted_at      TEXT
    );
```

## operateurs

First declaration: [src/main/db.ts:63](../../src/main/db.ts#L63)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `nom` | TEXT | True | — | `—` |
| `identifiant` | TEXT | True | — | `—` |
| `role` | TEXT | False | — | `'caissier'` |
| `actif` | INTEGER | False | — | `1` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_operateurs_2`: unique (identifiant), partial=False.
- `sqlite_autoindex_operateurs_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE operateurs (
      id          TEXT PRIMARY KEY,
      nom         TEXT NOT NULL,
      identifiant TEXT UNIQUE NOT NULL,
      role        TEXT DEFAULT 'caissier',
      actif       INTEGER DEFAULT 1,
      created_at  TEXT DEFAULT (datetime('now'))
    );
```

## organisations

First declaration: [src/main/db.ts:740](../../src/main/db.ts#L740)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `nom` | TEXT | True | — | `—` |
| `telephone` | TEXT | False | — | `—` |
| `email` | TEXT | False | — | `—` |
| `adresse` | TEXT | False | — | `—` |
| `matricule_fiscal` | TEXT | False | — | `—` |
| `credit_total` | REAL | False | — | `0` |
| `notes` | TEXT | False | — | `—` |
| `actif` | INTEGER | False | — | `1` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_organisations_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE organisations (
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
```

## paiements_fournisseurs

First declaration: [src/main/db.ts:308](../../src/main/db.ts#L308)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `facture_id` | TEXT | False | — | `—` |
| `fournisseur_id` | TEXT | False | — | `—` |
| `montant` | REAL | True | — | `—` |
| `mode_paiement` | TEXT | False | — | `'ESPECES'` |
| `reference_cheque` | TEXT | False | — | `—` |
| `date_paiement` | TEXT | False | — | `date('now')` |
| `notes` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- `fournisseur_id` → `fournisseurs.id`; delete: NO ACTION; update: NO ACTION.
- `facture_id` → `factures_fournisseurs.id`; delete: NO ACTION; update: NO ACTION.

**Indexes and uniqueness:**
- `sqlite_autoindex_paiements_fournisseurs_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE paiements_fournisseurs (
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
```

## personnels

First declaration: [src/main/db.ts:754](../../src/main/db.ts#L754)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `nom` | TEXT | True | — | `—` |
| `prenom` | TEXT | False | — | `—` |
| `poste` | TEXT | False | — | `—` |
| `telephone` | TEXT | False | — | `—` |
| `cin` | TEXT | False | — | `—` |
| `date_embauche` | TEXT | False | — | `—` |
| `salaire_base` | REAL | True | — | `0` |
| `avance_solde` | REAL | False | — | `0` |
| `credit_solde` | REAL | False | — | `0` |
| `actif` | INTEGER | False | — | `1` |
| `notes` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |
| `updated_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_personnels_2`: unique (cin), partial=False.
- `sqlite_autoindex_personnels_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE personnels (
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
```

## pieces_reparation

First declaration: [src/main/db.ts:245](../../src/main/db.ts#L245)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `reparation_id` | TEXT | False | — | `—` |
| `produit_id` | TEXT | False | — | `—` |
| `designation` | TEXT | True | — | `—` |
| `quantite` | INTEGER | False | — | `1` |
| `prix_unitaire` | REAL | False | — | `0` |
| `type` | TEXT | False | — | `'F'` |
| `prix_achat` | REAL | False | — | `0` |
| `destock_stock` | INTEGER | False | — | `0` |

**Declared foreign keys:**
- `reparation_id` → `reparations.id`; delete: CASCADE; update: NO ACTION.

**Indexes and uniqueness:**
- `sqlite_autoindex_pieces_reparation_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE pieces_reparation (
      id            TEXT PRIMARY KEY,
      reparation_id TEXT REFERENCES reparations(id) ON DELETE CASCADE,
      produit_id    TEXT,
      designation   TEXT NOT NULL,
      quantite      INTEGER DEFAULT 1,
      prix_unitaire REAL DEFAULT 0,
      type          TEXT DEFAULT 'F'
    , prix_achat REAL DEFAULT 0, destock_stock INTEGER DEFAULT 0);
```

## produits

First declaration: [src/main/db.ts:138](../../src/main/db.ts#L138)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `code_barre` | TEXT | False | — | `—` |
| `reference` | TEXT | True | — | `—` |
| `nom` | TEXT | True | — | `—` |
| `description` | TEXT | False | — | `—` |
| `categorie` | TEXT | False | — | `'Général'` |
| `categorie_id` | TEXT | False | — | `—` |
| `type` | TEXT | False | — | `'F'` |
| `prix_achat` | REAL | False | — | `—` |
| `prix_vente` | REAL | True | — | `0` |
| `tva_taux` | REAL | False | — | `0` |
| `stock_actuel` | INTEGER | False | — | `0` |
| `stock_minimum` | INTEGER | False | — | `5` |
| `fournisseur` | TEXT | False | — | `—` |
| `fournisseur_id` | TEXT | False | — | `—` |
| `actif` | INTEGER | False | — | `1` |
| `created_at` | TEXT | False | — | `datetime('now')` |
| `updated_at` | TEXT | False | — | `datetime('now')` |
| `has_serial_number` | INTEGER | False | — | `0` |
| `numero_serie` | TEXT | False | — | `—` |
| `tva_achat_pct` | REAL | False | — | `0` |
| `marge_pct` | REAL | False | — | `—` |
| `coef_av` | REAL | False | — | `—` |
| `cout_supplementaire` | REAL | False | — | `0` |
| `cout_de_revient` | REAL | False | — | `—` |
| `prix_vente_ht` | REAL | False | — | `—` |
| `pvp` | REAL | False | — | `—` |
| `prix_achat_ttc` | REAL | False | — | `—` |
| `source_tag` | TEXT | False | — | `—` |

**Declared foreign keys:**
- `fournisseur_id` → `fournisseurs.id`; delete: NO ACTION; update: NO ACTION.
- `categorie_id` → `categories.id`; delete: NO ACTION; update: NO ACTION.

**Indexes and uniqueness:**
- `sqlite_autoindex_produits_3`: unique (reference), partial=False.
- `sqlite_autoindex_produits_2`: unique (code_barre), partial=False.
- `sqlite_autoindex_produits_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE produits (
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
    , has_serial_number INTEGER DEFAULT 0, numero_serie TEXT, tva_achat_pct REAL DEFAULT 0, marge_pct REAL, coef_av REAL, cout_supplementaire REAL DEFAULT 0, cout_de_revient REAL, prix_vente_ht REAL, pvp REAL, prix_achat_ttc REAL, source_tag TEXT);
```

## rapports_caisse

First declaration: [src/main/db.ts:400](../../src/main/db.ts#L400)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `numero` | TEXT | True | — | `—` |
| `shift_id` | TEXT | True | — | `—` |
| `date_journal` | TEXT | True | — | `—` |
| `session_type` | TEXT | True | — | `—` |
| `operateur` | TEXT | False | — | `—` |
| `started_at` | TEXT | True | — | `—` |
| `ended_at` | TEXT | True | — | `—` |
| `fond_de_caisse` | REAL | True | — | `0` |
| `total_entrees` | REAL | True | — | `0` |
| `total_sorties` | REAL | True | — | `0` |
| `solde_theorique` | REAL | True | — | `0` |
| `solde_reel` | REAL | False | — | `—` |
| `ecart` | REAL | False | — | `—` |
| `notes` | TEXT | False | — | `—` |
| `summary_json` | TEXT | True | — | `'{}'` |
| `operations_json` | TEXT | True | — | `'[]'` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- `shift_id` → `shifts.id`; delete: NO ACTION; update: NO ACTION.

**Indexes and uniqueness:**
- `idx_rapports_caisse_date`: non-unique (date_journal, session_type), partial=False. SQL: `CREATE INDEX idx_rapports_caisse_date ON rapports_caisse(date_journal DESC, session_type)`
- `sqlite_autoindex_rapports_caisse_3`: unique (shift_id), partial=False.
- `sqlite_autoindex_rapports_caisse_2`: unique (numero), partial=False.
- `sqlite_autoindex_rapports_caisse_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE rapports_caisse (
      id                TEXT PRIMARY KEY,
      numero            TEXT UNIQUE NOT NULL,
      shift_id          TEXT UNIQUE NOT NULL REFERENCES shifts(id),
      date_journal      TEXT NOT NULL,
      session_type      TEXT NOT NULL CHECK(session_type IN ('MATIN','SOIR')),
      operateur         TEXT,
      started_at        TEXT NOT NULL,
      ended_at          TEXT NOT NULL,
      fond_de_caisse    REAL NOT NULL DEFAULT 0,
      total_entrees     REAL NOT NULL DEFAULT 0,
      total_sorties     REAL NOT NULL DEFAULT 0,
      solde_theorique   REAL NOT NULL DEFAULT 0,
      solde_reel        REAL,
      ecart             REAL,
      notes             TEXT,
      summary_json      TEXT NOT NULL DEFAULT '{}',
      operations_json   TEXT NOT NULL DEFAULT '[]',
      created_at        TEXT DEFAULT (datetime('now'))
    );
```

## remboursements_ventes

First declaration: [src/main/db.ts:265](../../src/main/db.ts#L265)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `vente_id` | TEXT | True | — | `—` |
| `shift_id` | TEXT | False | — | `—` |
| `montant` | REAL | True | — | `0` |
| `mode_paiement` | TEXT | False | — | `'ESPECES'` |
| `operateur` | TEXT | False | — | `—` |
| `motif` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- `vente_id` → `ventes.id`; delete: NO ACTION; update: NO ACTION.

**Indexes and uniqueness:**
- `sqlite_autoindex_remboursements_ventes_2`: unique (vente_id), partial=False.
- `sqlite_autoindex_remboursements_ventes_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE remboursements_ventes (
      id             TEXT PRIMARY KEY,
      vente_id       TEXT NOT NULL UNIQUE REFERENCES ventes(id),
      shift_id       TEXT,
      montant        REAL NOT NULL DEFAULT 0,
      mode_paiement  TEXT DEFAULT 'ESPECES',
      operateur      TEXT,
      motif          TEXT,
      created_at     TEXT DEFAULT (datetime('now'))
    );
```

## reparation_status_history

First declaration: [src/main/db.ts:917](../../src/main/db.ts#L917)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `reparation_id` | TEXT | True | — | `—` |
| `statut` | TEXT | True | — | `—` |
| `source_status` | TEXT | False | — | `—` |
| `note` | TEXT | False | — | `—` |
| `changed_by` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- `reparation_id` → `reparations.id`; delete: CASCADE; update: NO ACTION.

**Indexes and uniqueness:**
- `sqlite_autoindex_reparation_status_history_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE reparation_status_history (
      id TEXT PRIMARY KEY,
      reparation_id TEXT NOT NULL REFERENCES reparations(id) ON DELETE CASCADE,
      statut TEXT NOT NULL,
      source_status TEXT,
      note TEXT,
      changed_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
```

## reparations

First declaration: [src/main/db.ts:223](../../src/main/db.ts#L223)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `numero` | TEXT | True | — | `—` |
| `shift_id` | TEXT | False | — | `—` |
| `operateur_nom` | TEXT | False | — | `—` |
| `client_nom` | TEXT | False | — | `—` |
| `client_tel` | TEXT | False | — | `—` |
| `type_appareil` | TEXT | False | — | `—` |
| `marque` | TEXT | False | — | `—` |
| `modele` | TEXT | False | — | `—` |
| `description_panne` | TEXT | False | — | `—` |
| `main_oeuvre` | REAL | False | — | `0` |
| `acompte` | REAL | False | — | `0` |
| `total_estime` | REAL | False | — | `0` |
| `total_final` | REAL | False | — | `—` |
| `statut` | TEXT | False | — | `'EN_ATTENTE'` |
| `technicien` | TEXT | False | — | `—` |
| `notes_technicien` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |
| `updated_at` | TEXT | False | — | `datetime('now')` |
| `benefice` | REAL | False | — | `—` |
| `repair_token` | TEXT | False | — | `—` |
| `estimated_completion` | TEXT | False | — | `—` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_reparations_2`: unique (numero), partial=False.
- `sqlite_autoindex_reparations_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE reparations (
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
    , benefice REAL, repair_token TEXT, estimated_completion TEXT);
```

## retours

First declaration: [src/main/db.ts:642](../../src/main/db.ts#L642)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `vente_id` | TEXT | False | — | `—` |
| `vente_numero` | TEXT | False | — | `—` |
| `shift_id` | TEXT | False | — | `—` |
| `produit_id` | TEXT | False | — | `—` |
| `designation` | TEXT | True | — | `—` |
| `quantite` | INTEGER | True | — | `—` |
| `prix_unitaire` | REAL | True | — | `—` |
| `motif` | TEXT | False | — | `—` |
| `type_retour` | TEXT | True | — | `—` |
| `statut` | TEXT | False | — | `'EN_ATTENTE'` |
| `resolution` | TEXT | False | — | `—` |
| `montant_rembourse` | REAL | False | — | `0` |
| `operateur` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |
| `updated_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_retours_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE retours (
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
```

## saved_paniers

First declaration: [src/main/db.ts:699](../../src/main/db.ts#L699)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `label` | TEXT | True | — | `—` |
| `saved_at` | TEXT | True | — | `—` |
| `shift_id` | TEXT | False | — | `—` |
| `payload_json` | TEXT | True | — | `—` |
| `updated_at` | TEXT | True | — | `—` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `idx_saved_paniers_saved_at`: non-unique (saved_at), partial=False. SQL: `CREATE INDEX idx_saved_paniers_saved_at
      ON saved_paniers(saved_at DESC)`
- `sqlite_autoindex_saved_paniers_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE saved_paniers (
      id           TEXT PRIMARY KEY,
      label        TEXT NOT NULL,
      saved_at     TEXT NOT NULL,
      shift_id     TEXT,
      payload_json TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
```

## serial_numbers

First declaration: [src/main/db.ts:160](../../src/main/db.ts#L160)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `produit_id` | TEXT | True | — | `—` |
| `numero_serie` | TEXT | True | — | `—` |
| `statut` | TEXT | False | — | `'EN_STOCK'` |
| `vente_id` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |
| `updated_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- `produit_id` → `produits.id`; delete: CASCADE; update: NO ACTION.

**Indexes and uniqueness:**
- `sqlite_autoindex_serial_numbers_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE serial_numbers (
      id          TEXT PRIMARY KEY,
      produit_id  TEXT NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
      numero_serie TEXT NOT NULL,
      statut      TEXT DEFAULT 'EN_STOCK',
      vente_id    TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );
```

## services_pos

First declaration: [src/main/db.ts:117](../../src/main/db.ts#L117)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `nom` | TEXT | True | — | `—` |
| `code_barre` | TEXT | True | — | `—` |
| `logo_url` | TEXT | False | — | `—` |
| `actif` | INTEGER | False | — | `1` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_services_pos_2`: unique (code_barre), partial=False.
- `sqlite_autoindex_services_pos_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE services_pos (
      id         TEXT PRIMARY KEY,
      nom        TEXT NOT NULL,
      code_barre TEXT UNIQUE NOT NULL,
      logo_url   TEXT,
      actif      INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
```

## shifts

First declaration: [src/main/db.ts:96](../../src/main/db.ts#L96)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `operateur_id` | TEXT | False | — | `—` |
| `operateur_nom` | TEXT | True | — | `—` |
| `fond_de_caisse` | REAL | True | — | `—` |
| `started_at` | TEXT | True | — | `—` |
| `ended_at` | TEXT | False | — | `—` |
| `total_ventes_especes` | REAL | False | — | `0` |
| `total_services` | REAL | False | — | `0` |
| `total_reparations` | REAL | False | — | `0` |
| `total_credits_recus` | REAL | False | — | `0` |
| `total_sorties` | REAL | False | — | `0` |
| `solde_theorique` | REAL | False | — | `—` |
| `solde_declare` | REAL | False | — | `—` |
| `ecart` | REAL | False | — | `—` |
| `transfere_caisse_interne` | INTEGER | False | — | `0` |
| `notes_cloture` | TEXT | False | — | `—` |
| `session_type` | TEXT | False | — | `—` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_shifts_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE shifts (
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
      notes_cloture            TEXT,
      session_type             TEXT CHECK(session_type IN ('MATIN','SOIR'))
    );
```

## sorties_caisse

First declaration: [src/main/db.ts:256](../../src/main/db.ts#L256)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `shift_id` | TEXT | False | — | `—` |
| `montant` | REAL | True | — | `—` |
| `note` | TEXT | True | — | `—` |
| `operateur` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |
| `mouvement_interne_id` | TEXT | False | — | `—` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_sorties_caisse_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE sorties_caisse (
      id         TEXT PRIMARY KEY,
      shift_id   TEXT,
      montant    REAL NOT NULL,
      note       TEXT NOT NULL,
      operateur  TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    , mouvement_interne_id TEXT);
```

## sync_queue

First declaration: [src/main/db.ts:423](../../src/main/db.ts#L423)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `table_name` | TEXT | True | — | `—` |
| `operation` | TEXT | True | — | `—` |
| `payload` | TEXT | True | — | `—` |
| `record_id` | TEXT | False | — | `—` |
| `attempts` | INTEGER | False | — | `0` |
| `last_error` | TEXT | False | — | `—` |
| `synced_at` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_sync_queue_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE sync_queue (
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
```

## transactions_services

First declaration: [src/main/db.ts:126](../../src/main/db.ts#L126)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `shift_id` | TEXT | False | — | `—` |
| `service_id` | TEXT | False | — | `—` |
| `service_nom` | TEXT | True | — | `—` |
| `montant_frais` | REAL | True | — | `—` |
| `note` | TEXT | False | — | `—` |
| `operateur` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- `service_id` → `services_pos.id`; delete: NO ACTION; update: NO ACTION.
- `shift_id` → `shifts.id`; delete: NO ACTION; update: NO ACTION.

**Indexes and uniqueness:**
- `sqlite_autoindex_transactions_services_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE transactions_services (
      id            TEXT PRIMARY KEY,
      shift_id      TEXT REFERENCES shifts(id),
      service_id    TEXT REFERENCES services_pos(id),
      service_nom   TEXT NOT NULL,
      montant_frais REAL NOT NULL,
      note          TEXT,
      operateur     TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );
```

## ventes

First declaration: [src/main/db.ts:171](../../src/main/db.ts#L171)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `numero` | TEXT | True | — | `—` |
| `shift_id` | TEXT | False | — | `—` |
| `operateur_nom` | TEXT | False | — | `—` |
| `client_nom` | TEXT | False | — | `—` |
| `client_tel` | TEXT | False | — | `—` |
| `client_adresse` | TEXT | False | — | `—` |
| `client_matricule` | TEXT | False | — | `—` |
| `sous_total` | REAL | False | — | `—` |
| `total_remises` | REAL | False | — | `0` |
| `total_ttc` | REAL | True | — | `—` |
| `mode_paiement` | TEXT | False | — | `—` |
| `montant_recu` | REAL | False | — | `—` |
| `monnaie_rendue` | REAL | False | — | `0` |
| `type` | TEXT | False | — | `'VENTE'` |
| `note_vente` | TEXT | False | — | `—` |
| `a_facture` | INTEGER | False | — | `0` |
| `created_at` | TEXT | False | — | `datetime('now')` |
| `montant_encaisse_initial` | REAL | False | — | `—` |
| `statut` | TEXT | False | — | `'ACTIVE'` |
| `annule_par` | TEXT | False | — | `—` |
| `annule_at` | TEXT | False | — | `—` |
| `annule_motif` | TEXT | False | — | `—` |
| `fidelite_utilisee` | REAL | False | — | `0` |
| `fidelite_gagnee` | REAL | False | — | `0` |
| `type_vente` | TEXT | False | — | `'TICKET'` |
| `client_id` | TEXT | False | — | `—` |
| `avance_dossier_id` | TEXT | False | — | `—` |
| `avance_utilisee` | REAL | False | — | `0` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_ventes_2`: unique (numero), partial=False.
- `sqlite_autoindex_ventes_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE ventes (
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
      note_vente       TEXT,
      a_facture        INTEGER DEFAULT 0,
      created_at       TEXT DEFAULT (datetime('now'))
    , montant_encaisse_initial REAL, statut TEXT DEFAULT 'ACTIVE', annule_par TEXT, annule_at TEXT, annule_motif TEXT, fidelite_utilisee REAL DEFAULT 0, fidelite_gagnee REAL DEFAULT 0, type_vente TEXT DEFAULT 'TICKET', client_id TEXT, avance_dossier_id TEXT, avance_utilisee REAL DEFAULT 0);
```

## ventes_en_ligne

First declaration: [src/main/db.ts:571](../../src/main/db.ts#L571)

| Column | SQLite type | NOT NULL | PK | Default |
|---|---|---|---|---|
| `id` | TEXT | False | 1 | `—` |
| `numero` | TEXT | True | — | `—` |
| `shift_id` | TEXT | False | — | `—` |
| `operateur_nom` | TEXT | False | — | `—` |
| `client_nom` | TEXT | True | — | `—` |
| `client_tel` | TEXT | False | — | `—` |
| `client_adresse` | TEXT | False | — | `—` |
| `produits_json` | TEXT | True | — | `'[]'` |
| `montant_ttc` | REAL | True | — | `—` |
| `montant_net` | REAL | False | — | `—` |
| `frais_livraison` | REAL | False | — | `0` |
| `frais_retour` | REAL | False | — | `4` |
| `statut` | TEXT | False | — | `'EN_ATTENTE'` |
| `livraison_nom` | TEXT | False | — | `—` |
| `montant_recu` | REAL | False | — | `0` |
| `reference_livraison` | TEXT | False | — | `—` |
| `note` | TEXT | False | — | `—` |
| `created_at` | TEXT | False | — | `datetime('now')` |
| `updated_at` | TEXT | False | — | `datetime('now')` |

**Declared foreign keys:**
- None. Logical relationships may still exist in handlers or JSON.

**Indexes and uniqueness:**
- `sqlite_autoindex_ventes_en_ligne_2`: unique (numero), partial=False.
- `sqlite_autoindex_ventes_en_ligne_1`: unique (id), partial=False.

**Full reconstructed DDL, including CHECK clauses:**

```sql
CREATE TABLE ventes_en_ligne (
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
```

