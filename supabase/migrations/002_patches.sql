-- SMLPOS v1.9.2 — Incremental patches for existing Supabase projects
-- Safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS where supported)

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS total_credits_recus FLOAT DEFAULT 0;
ALTER TABLE ventes ADD COLUMN IF NOT EXISTS statut TEXT DEFAULT 'ACTIVE';
ALTER TABLE ventes ADD COLUMN IF NOT EXISTS annule_par TEXT;
ALTER TABLE ventes ADD COLUMN IF NOT EXISTS annule_at TEXT;
ALTER TABLE ventes ADD COLUMN IF NOT EXISTS annule_motif TEXT;
ALTER TABLE ventes ADD COLUMN IF NOT EXISTS type_vente TEXT DEFAULT 'TICKET';
ALTER TABLE factures_fournisseurs ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'FACTURE_ACHAT';
ALTER TABLE factures_fournisseurs ADD COLUMN IF NOT EXISTS statut_reception TEXT DEFAULT 'ARRIVE';
ALTER TABLE factures_fournisseurs ADD COLUMN IF NOT EXISTS exo TEXT;
ALTER TABLE factures_fournisseurs ADD COLUMN IF NOT EXISTS timbre FLOAT DEFAULT 1;
ALTER TABLE factures_fournisseurs ADD COLUMN IF NOT EXISTS ht_7 FLOAT;
ALTER TABLE factures_fournisseurs ADD COLUMN IF NOT EXISTS tva_7 FLOAT;
ALTER TABLE factures_fournisseurs ADD COLUMN IF NOT EXISTS ht_19 FLOAT;
ALTER TABLE factures_fournisseurs ADD COLUMN IF NOT EXISTS tva_19 FLOAT;
ALTER TABLE factures_fournisseurs ADD COLUMN IF NOT EXISTS total_remise FLOAT;
ALTER TABLE sorties_caisse ADD COLUMN IF NOT EXISTS mouvement_interne_id TEXT;
ALTER TABLE reparations ADD COLUMN IF NOT EXISTS benefice FLOAT;
ALTER TABLE produits ADD COLUMN IF NOT EXISTS source_tag TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS revoque_par TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS revoque_at TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS revoque_motif TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS reference_source_id TEXT;
ALTER TABLE lignes_document ADD COLUMN IF NOT EXISTS numero_serie TEXT;

-- Create missing tables (from v1.5+)
CREATE TABLE IF NOT EXISTS ventes_en_ligne (id TEXT PRIMARY KEY, numero TEXT UNIQUE NOT NULL, shift_id TEXT, operateur_nom TEXT, client_nom TEXT NOT NULL, client_tel TEXT, client_adresse TEXT, produits_json TEXT NOT NULL DEFAULT '[]', montant_ttc FLOAT NOT NULL, montant_net FLOAT, frais_livraison FLOAT DEFAULT 0, frais_retour FLOAT DEFAULT 4, statut TEXT DEFAULT 'EN_ATTENTE', livraison_nom TEXT, montant_recu FLOAT DEFAULT 0, reference_livraison TEXT, note TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, nom TEXT NOT NULL, telephone TEXT, email TEXT, adresse TEXT, matricule_fiscal TEXT, credit_limite FLOAT DEFAULT 500, solde_credit FLOAT DEFAULT 0, organisation_id TEXT, agent TEXT, actif INTEGER DEFAULT 1, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS credits_clients (id TEXT PRIMARY KEY, client_id TEXT, client_nom TEXT NOT NULL, shift_id TEXT, type TEXT NOT NULL, montant FLOAT NOT NULL, reference TEXT, note TEXT, operateur TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS retours (id TEXT PRIMARY KEY, vente_id TEXT, vente_numero TEXT, shift_id TEXT, produit_id TEXT, designation TEXT NOT NULL, quantite INTEGER NOT NULL, prix_unitaire FLOAT NOT NULL, motif TEXT, type_retour TEXT NOT NULL, statut TEXT DEFAULT 'EN_ATTENTE', resolution TEXT, montant_rembourse FLOAT DEFAULT 0, operateur TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS organisations (id TEXT PRIMARY KEY, nom TEXT NOT NULL, telephone TEXT, email TEXT, adresse TEXT, matricule_fiscal TEXT, credit_total FLOAT DEFAULT 0, notes TEXT, actif INTEGER DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS personnels (id TEXT PRIMARY KEY, nom TEXT NOT NULL, prenom TEXT, poste TEXT, telephone TEXT, cin TEXT UNIQUE, date_embauche TEXT, salaire_base FLOAT NOT NULL DEFAULT 0, avance_solde FLOAT DEFAULT 0, credit_solde FLOAT DEFAULT 0, actif INTEGER DEFAULT 1, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS mouvements_personnels (id TEXT PRIMARY KEY, personnel_id TEXT, type TEXT NOT NULL, montant FLOAT NOT NULL, mois TEXT, note TEXT, operateur TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, numero TEXT UNIQUE NOT NULL, type_document TEXT NOT NULL, statut TEXT DEFAULT 'ACTIF', shift_id TEXT, vente_id TEXT, fournisseur_id TEXT, client_id TEXT, client_nom TEXT, client_tel TEXT, client_adresse TEXT, client_matricule TEXT, total_ht FLOAT NOT NULL DEFAULT 0, total_tva FLOAT DEFAULT 0, total_ttc FLOAT NOT NULL DEFAULT 0, statut_paiement TEXT DEFAULT 'PAYE', montant_paye FLOAT DEFAULT 0, date_echeance TEXT, imprimee INTEGER DEFAULT 0, layout_snapshot TEXT, contenu_json TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS lignes_document (id TEXT PRIMARY KEY, document_id TEXT, produit_id TEXT, designation TEXT NOT NULL, quantite INTEGER NOT NULL, prix_unitaire FLOAT NOT NULL, remise_pct FLOAT DEFAULT 0, tva_taux FLOAT DEFAULT 0, total_ht FLOAT NOT NULL, total_tva FLOAT DEFAULT 0, total_ttc FLOAT NOT NULL, type_produit TEXT DEFAULT 'F');
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS fournisseur_commerciaux (id TEXT PRIMARY KEY, fournisseur_id TEXT, nom TEXT NOT NULL, telephone TEXT, email TEXT, actif INTEGER DEFAULT 1, created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS serial_numbers (id TEXT PRIMARY KEY, produit_id TEXT NOT NULL, numero_serie TEXT NOT NULL, statut TEXT DEFAULT 'EN_STOCK', vente_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS pieces_reparation (id TEXT PRIMARY KEY, reparation_id TEXT, produit_id TEXT, designation TEXT NOT NULL, quantite INTEGER DEFAULT 1, prix_unitaire FLOAT DEFAULT 0, type TEXT DEFAULT 'F');
