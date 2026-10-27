CREATE TABLE IF NOT EXISTS sync_schema_versions(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_users(
 id uuid PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL,
 role text NOT NULL CHECK(role IN ('admin','manager','cashier')), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS devices(
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users(id), name text NOT NULL,
 platform text NOT NULL CHECK(platform IN ('windows','android','development')),
 client_version text NOT NULL, importer boolean NOT NULL DEFAULT false,
 revoked_at timestamptz, last_seen_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS single_importer ON devices(importer) WHERE importer AND revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS refresh_sessions(
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_users(id), device_id uuid NOT NULL REFERENCES devices(id),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS upload_transactions(
 device_id uuid NOT NULL REFERENCES devices(id), transaction_id uuid NOT NULL,
 payload_hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(device_id,transaction_id)
);
CREATE TABLE IF NOT EXISTS sync_rejections(
 id uuid PRIMARY KEY, device_id uuid NOT NULL REFERENCES devices(id), transaction_id uuid,
 code text NOT NULL, message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS seed_jobs(
 id uuid PRIMARY KEY, device_id uuid NOT NULL REFERENCES devices(id), manifest_hash text NOT NULL,
 status text NOT NULL CHECK(status IN ('approved','uploading','verified','cancelled')),
 approved_by uuid NOT NULL REFERENCES app_users(id), expected_counts jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz
);
ALTER TABLE seed_jobs ADD COLUMN IF NOT EXISTS manifest jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS single_seed_job ON seed_jobs((true)) WHERE status <> 'cancelled';
CREATE TABLE IF NOT EXISTS seed_chunks(
 job_id uuid NOT NULL REFERENCES seed_jobs(id), chunk_index integer NOT NULL CHECK(chunk_index>=0),
 payload_hash text NOT NULL, row_count integer NOT NULL CHECK(row_count>0),
 received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,chunk_index)
);
CREATE TABLE IF NOT EXISTS seed_rows(
 job_id uuid NOT NULL REFERENCES seed_jobs(id), table_name text NOT NULL, row_id uuid NOT NULL,
 chunk_index integer NOT NULL, data jsonb NOT NULL,
 source_created_at timestamptz, source_updated_at timestamptz,
 PRIMARY KEY(job_id,table_name,row_id),
 FOREIGN KEY(job_id,chunk_index) REFERENCES seed_chunks(job_id,chunk_index)
);
CREATE OR REPLACE FUNCTION immutable_business_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Business history is immutable; insert a reversal' USING ERRCODE='23000';
END $$;


CREATE TABLE IF NOT EXISTS "activity_logs" (
  id uuid PRIMARY KEY,
  "shift_id" text,
  "operateur" text,
  "action" text NOT NULL,
  "details" text,
  "montant" bigint,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "activity_logs_updated_idx" ON "activity_logs"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='activity_logs_immutable' AND tgrelid='"activity_logs"'::regclass) THEN
      CREATE TRIGGER "activity_logs_immutable" BEFORE UPDATE OR DELETE ON "activity_logs" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "ajustements_fournisseurs" (
  id uuid PRIMARY KEY,
  "fournisseur_id" uuid NOT NULL,
  "type" text NOT NULL,
  "montant" bigint NOT NULL,
  "motif" text NOT NULL,
  "caisse_source" text,
  "operateur" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "ajustements_fournisseurs_updated_idx" ON "ajustements_fournisseurs"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='ajustements_fournisseurs_immutable' AND tgrelid='"ajustements_fournisseurs"'::regclass) THEN
      CREATE TRIGGER "ajustements_fournisseurs_immutable" BEFORE UPDATE OR DELETE ON "ajustements_fournisseurs" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "app_settings" (
  id uuid PRIMARY KEY,
  "key" text,
  "value" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "app_settings_updated_idx" ON "app_settings"(updated_at);

CREATE TABLE IF NOT EXISTS "avances_clients" (
  id uuid PRIMARY KEY,
  "numero" text NOT NULL,
  "client_id" uuid NOT NULL,
  "client_nom" text NOT NULL,
  "client_tel" text,
  "client_adresse" text,
  "produit_description" text NOT NULL,
  "montant" bigint NOT NULL,
  "mode_paiement" text,
  "reference" text,
  "note" text,
  "shift_id" uuid,
  "operateur" text,
  "type_avance" text,
  "dossier_id" uuid,
  "produit_id" uuid,
  "numero_serie" text,
  "prix_produit" bigint,
  "inclure_facture" bigint,
  "produits_json" text,
  "facture_id" uuid,
  "statut" text,
  "vente_id" uuid,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "avances_clients_updated_idx" ON "avances_clients"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='avances_clients_immutable' AND tgrelid='"avances_clients"'::regclass) THEN
      CREATE TRIGGER "avances_clients_immutable" BEFORE UPDATE OR DELETE ON "avances_clients" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "caisse_interne" (
  id uuid PRIMARY KEY,
  "date_journal" text,
  "solde_ouverture" bigint,
  "total_entrees" bigint,
  "total_sorties" bigint,
  "notes" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "caisse_interne_updated_idx" ON "caisse_interne"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='caisse_interne_immutable' AND tgrelid='"caisse_interne"'::regclass) THEN
      CREATE TRIGGER "caisse_interne_immutable" BEFORE UPDATE OR DELETE ON "caisse_interne" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "categories" (
  id uuid PRIMARY KEY,
  "nom" text NOT NULL,
  "icone" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "categories_updated_idx" ON "categories"(updated_at);

CREATE TABLE IF NOT EXISTS "clients" (
  id uuid PRIMARY KEY,
  "nom" text NOT NULL,
  "telephone" text,
  "email" text,
  "adresse" text,
  "matricule_fiscal" text,
  "credit_limite" bigint,
  "organisation_id" uuid,
  "agent" text,
  "actif" bigint,
  "notes" text,
  "fidelite_code" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "clients_updated_idx" ON "clients"(updated_at);

CREATE TABLE IF NOT EXISTS "credits_clients" (
  id uuid PRIMARY KEY,
  "client_id" uuid,
  "client_nom" text NOT NULL,
  "shift_id" uuid,
  "type" text NOT NULL,
  "montant" bigint NOT NULL,
  "reference" text,
  "note" text,
  "operateur" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "credits_clients_updated_idx" ON "credits_clients"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='credits_clients_immutable' AND tgrelid='"credits_clients"'::regclass) THEN
      CREATE TRIGGER "credits_clients_immutable" BEFORE UPDATE OR DELETE ON "credits_clients" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "demandes_clients" (
  id uuid PRIMARY KEY,
  "type_demande" text NOT NULL,
  "titre" text NOT NULL,
  "details" text,
  "client_nom" text,
  "client_tel" text,
  "avance" bigint,
  "responsable_id" uuid,
  "responsable_nom" text NOT NULL,
  "echeance" text,
  "priorite" text,
  "statut" text,
  "created_by" text,
  "completed_at" timestamptz,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "demandes_clients_updated_idx" ON "demandes_clients"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='demandes_clients_immutable' AND tgrelid='"demandes_clients"'::regclass) THEN
      CREATE TRIGGER "demandes_clients_immutable" BEFORE UPDATE OR DELETE ON "demandes_clients" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "documents" (
  id uuid PRIMARY KEY,
  "numero" text NOT NULL,
  "type_document" text NOT NULL,
  "statut" text,
  "shift_id" uuid,
  "vente_id" uuid,
  "fournisseur_id" uuid,
  "client_id" uuid,
  "client_nom" text,
  "client_tel" text,
  "client_adresse" text,
  "client_matricule" text,
  "total_ht" bigint,
  "total_tva" bigint,
  "total_ttc" bigint,
  "statut_paiement" text,
  "montant_paye" bigint,
  "date_echeance" text,
  "imprimee" bigint,
  "layout_snapshot" text,
  "contenu_json" text,
  "exo" text,
  "timbre" bigint,
  "ht_7" bigint,
  "tva_7" bigint,
  "ht_19" bigint,
  "tva_19" bigint,
  "total_remise" bigint,
  "tva_taux_principal" numeric(24,6),
  "revoque_par" text,
  "revoque_at" timestamptz,
  "revoque_motif" text,
  "reference_source_id" text,
  "avoir_id" uuid,
  "document_origine_id" uuid,
  "facture_origine_numero" text,
  "annule_motif" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "documents_updated_idx" ON "documents"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='documents_immutable' AND tgrelid='"documents"'::regclass) THEN
      CREATE TRIGGER "documents_immutable" BEFORE UPDATE OR DELETE ON "documents" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "factures_clients" (
  id uuid PRIMARY KEY,
  "numero" text NOT NULL,
  "shift_id" text,
  "vente_id" uuid,
  "type_facture" text,
  "client_nom" text,
  "client_tel" text,
  "client_adresse" text,
  "client_matricule" text,
  "total_ht" bigint NOT NULL,
  "total_tva" bigint,
  "total_ttc" bigint NOT NULL,
  "imprimee" bigint,
  "tva_taux_principal" numeric(24,6),
  "exo" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "factures_clients_updated_idx" ON "factures_clients"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='factures_clients_immutable' AND tgrelid='"factures_clients"'::regclass) THEN
      CREATE TRIGGER "factures_clients_immutable" BEFORE UPDATE OR DELETE ON "factures_clients" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "factures_fournisseurs" (
  id uuid PRIMARY KEY,
  "numero_facture" text NOT NULL,
  "fournisseur_id" uuid,
  "date_facture" text NOT NULL,
  "date_echeance" text,
  "statut_paiement" text,
  "montant_ht" bigint NOT NULL,
  "montant_tva" bigint,
  "montant_ttc" bigint NOT NULL,
  "montant_paye" bigint,
  "retenue_source_pct" numeric(24,6),
  "retenue_source_montant" bigint,
  "net_a_payer" bigint,
  "notes" text,
  "type" text,
  "statut_reception" text,
  "exo" text,
  "timbre" bigint,
  "ht_7" bigint,
  "tva_7" bigint,
  "ht_19" bigint,
  "tva_19" bigint,
  "total_remise" bigint,
  "stock_applied" bigint,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "factures_fournisseurs_updated_idx" ON "factures_fournisseurs"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='factures_fournisseurs_immutable' AND tgrelid='"factures_fournisseurs"'::regclass) THEN
      CREATE TRIGGER "factures_fournisseurs_immutable" BEFORE UPDATE OR DELETE ON "factures_fournisseurs" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "fournisseur_commerciaux" (
  id uuid PRIMARY KEY,
  "fournisseur_id" uuid,
  "nom" text NOT NULL,
  "telephone" text,
  "email" text,
  "actif" bigint,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "fournisseur_commerciaux_updated_idx" ON "fournisseur_commerciaux"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='fournisseur_commerciaux_immutable' AND tgrelid='"fournisseur_commerciaux"'::regclass) THEN
      CREATE TRIGGER "fournisseur_commerciaux_immutable" BEFORE UPDATE OR DELETE ON "fournisseur_commerciaux" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "fournisseurs" (
  id uuid PRIMARY KEY,
  "nom" text NOT NULL,
  "contact_nom" text,
  "telephone" text,
  "email" text,
  "adresse" text,
  "matricule_fiscal" text,
  "rib" text,
  "notes" text,
  "actif" bigint,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "fournisseurs_updated_idx" ON "fournisseurs"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='fournisseurs_immutable' AND tgrelid='"fournisseurs"'::regclass) THEN
      CREATE TRIGGER "fournisseurs_immutable" BEFORE UPDATE OR DELETE ON "fournisseurs" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "lignes_document" (
  id uuid PRIMARY KEY,
  "document_id" uuid,
  "produit_id" uuid,
  "designation" text NOT NULL,
  "quantite" bigint NOT NULL,
  "prix_unitaire" bigint NOT NULL,
  "remise_pct" numeric(24,6),
  "tva_taux" numeric(24,6),
  "total_ht" bigint NOT NULL,
  "total_tva" bigint,
  "total_ttc" bigint NOT NULL,
  "type_produit" text,
  "numero_serie" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "lignes_document_updated_idx" ON "lignes_document"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='lignes_document_immutable' AND tgrelid='"lignes_document"'::regclass) THEN
      CREATE TRIGGER "lignes_document_immutable" BEFORE UPDATE OR DELETE ON "lignes_document" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "lignes_facture_fournisseur" (
  id uuid PRIMARY KEY,
  "facture_id" uuid,
  "produit_id" uuid,
  "designation" text NOT NULL,
  "quantite" bigint NOT NULL,
  "ancien_prix_achat" bigint,
  "nouveau_prix_achat" bigint NOT NULL,
  "prix_vente_suggere" bigint,
  "prix_vente_applique" bigint,
  "tva_taux" numeric(24,6),
  "pending_product_json" text,
  "numeros_serie_json" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "lignes_facture_fournisseur_updated_idx" ON "lignes_facture_fournisseur"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='lignes_facture_fournisseur_immutable' AND tgrelid='"lignes_facture_fournisseur"'::regclass) THEN
      CREATE TRIGGER "lignes_facture_fournisseur_immutable" BEFORE UPDATE OR DELETE ON "lignes_facture_fournisseur" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "lignes_vente" (
  id uuid PRIMARY KEY,
  "vente_id" uuid,
  "produit_id" uuid,
  "designation" text NOT NULL,
  "quantite" bigint NOT NULL,
  "prix_unitaire" bigint NOT NULL,
  "remise_pct" numeric(24,6),
  "total_ligne" bigint NOT NULL,
  "type_produit" text,
  "numero_serie" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "lignes_vente_updated_idx" ON "lignes_vente"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='lignes_vente_immutable' AND tgrelid='"lignes_vente"'::regclass) THEN
      CREATE TRIGGER "lignes_vente_immutable" BEFORE UPDATE OR DELETE ON "lignes_vente" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "mouvements_caisse_interne" (
  id uuid PRIMARY KEY,
  "date_journal" text,
  "type" text NOT NULL,
  "categorie" text NOT NULL,
  "montant" bigint NOT NULL,
  "reference_id" text,
  "note" text,
  "operateur" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "mouvements_caisse_interne_updated_idx" ON "mouvements_caisse_interne"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='mouvements_caisse_interne_immutable' AND tgrelid='"mouvements_caisse_interne"'::regclass) THEN
      CREATE TRIGGER "mouvements_caisse_interne_immutable" BEFORE UPDATE OR DELETE ON "mouvements_caisse_interne" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "mouvements_echange" (
  id uuid PRIMARY KEY,
  "vente_id" uuid NOT NULL,
  "shift_id" uuid NOT NULL,
  "type" text NOT NULL,
  "montant" bigint NOT NULL,
  "ancien_total" bigint NOT NULL,
  "nouveau_total" bigint NOT NULL,
  "operateur" text,
  "details_json" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "mouvements_echange_updated_idx" ON "mouvements_echange"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='mouvements_echange_immutable' AND tgrelid='"mouvements_echange"'::regclass) THEN
      CREATE TRIGGER "mouvements_echange_immutable" BEFORE UPDATE OR DELETE ON "mouvements_echange" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "mouvements_fidelite" (
  id uuid PRIMARY KEY,
  "client_id" uuid NOT NULL,
  "vente_id" uuid,
  "type" text NOT NULL,
  "montant" bigint NOT NULL,
  "solde_avant" bigint NOT NULL,
  "solde_apres" bigint NOT NULL,
  "note" text,
  "operateur" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "mouvements_fidelite_updated_idx" ON "mouvements_fidelite"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='mouvements_fidelite_immutable' AND tgrelid='"mouvements_fidelite"'::regclass) THEN
      CREATE TRIGGER "mouvements_fidelite_immutable" BEFORE UPDATE OR DELETE ON "mouvements_fidelite" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "mouvements_personnels" (
  id uuid PRIMARY KEY,
  "personnel_id" uuid,
  "type" text NOT NULL,
  "montant" bigint NOT NULL,
  "mois" text,
  "note" text,
  "operateur" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "mouvements_personnels_updated_idx" ON "mouvements_personnels"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='mouvements_personnels_immutable' AND tgrelid='"mouvements_personnels"'::regclass) THEN
      CREATE TRIGGER "mouvements_personnels_immutable" BEFORE UPDATE OR DELETE ON "mouvements_personnels" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "mouvements_tresorerie_attente" (
  id uuid PRIMARY KEY,
  "direction" text NOT NULL,
  "categorie" text NOT NULL,
  "montant" bigint NOT NULL,
  "reference_id" text NOT NULL,
  "note" text,
  "operateur" text,
  "impact_applique" bigint,
  "statut" text,
  "accepted_at" timestamptz,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "mouvements_tresorerie_attente_updated_idx" ON "mouvements_tresorerie_attente"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='mouvements_tresorerie_attente_immutable' AND tgrelid='"mouvements_tresorerie_attente"'::regclass) THEN
      CREATE TRIGGER "mouvements_tresorerie_attente_immutable" BEFORE UPDATE OR DELETE ON "mouvements_tresorerie_attente" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "operateurs" (
  id uuid PRIMARY KEY,
  "nom" text NOT NULL,
  "identifiant" text NOT NULL,
  "role" text,
  "actif" bigint,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "operateurs_updated_idx" ON "operateurs"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='operateurs_immutable' AND tgrelid='"operateurs"'::regclass) THEN
      CREATE TRIGGER "operateurs_immutable" BEFORE UPDATE OR DELETE ON "operateurs" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "organisations" (
  id uuid PRIMARY KEY,
  "nom" text NOT NULL,
  "telephone" text,
  "email" text,
  "adresse" text,
  "matricule_fiscal" text,
  "notes" text,
  "actif" bigint,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "organisations_updated_idx" ON "organisations"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='organisations_immutable' AND tgrelid='"organisations"'::regclass) THEN
      CREATE TRIGGER "organisations_immutable" BEFORE UPDATE OR DELETE ON "organisations" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "paiements_fournisseurs" (
  id uuid PRIMARY KEY,
  "facture_id" uuid,
  "fournisseur_id" uuid,
  "montant" bigint NOT NULL,
  "mode_paiement" text,
  "reference_cheque" text,
  "date_paiement" text,
  "notes" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "paiements_fournisseurs_updated_idx" ON "paiements_fournisseurs"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='paiements_fournisseurs_immutable' AND tgrelid='"paiements_fournisseurs"'::regclass) THEN
      CREATE TRIGGER "paiements_fournisseurs_immutable" BEFORE UPDATE OR DELETE ON "paiements_fournisseurs" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "personnels" (
  id uuid PRIMARY KEY,
  "nom" text NOT NULL,
  "prenom" text,
  "poste" text,
  "telephone" text,
  "cin" text,
  "date_embauche" text,
  "salaire_base" bigint,
  "actif" bigint,
  "notes" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "personnels_updated_idx" ON "personnels"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='personnels_immutable' AND tgrelid='"personnels"'::regclass) THEN
      CREATE TRIGGER "personnels_immutable" BEFORE UPDATE OR DELETE ON "personnels" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "pieces_reparation" (
  id uuid PRIMARY KEY,
  "reparation_id" uuid,
  "produit_id" uuid,
  "designation" text NOT NULL,
  "quantite" bigint,
  "prix_unitaire" bigint,
  "type" text,
  "prix_achat" bigint,
  "destock_stock" bigint,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "pieces_reparation_updated_idx" ON "pieces_reparation"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='pieces_reparation_immutable' AND tgrelid='"pieces_reparation"'::regclass) THEN
      CREATE TRIGGER "pieces_reparation_immutable" BEFORE UPDATE OR DELETE ON "pieces_reparation" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "produits" (
  id uuid PRIMARY KEY,
  "code_barre" text,
  "reference" text NOT NULL,
  "nom" text NOT NULL,
  "description" text,
  "categorie" text,
  "categorie_id" uuid,
  "type" text,
  "prix_achat" bigint,
  "prix_vente" bigint,
  "tva_taux" numeric(24,6),
  "stock_minimum" bigint,
  "fournisseur" text,
  "fournisseur_id" uuid,
  "actif" bigint,
  "has_serial_number" bigint,
  "numero_serie" text,
  "tva_achat_pct" numeric(24,6),
  "marge_pct" numeric(24,6),
  "coef_av" numeric(24,6),
  "cout_supplementaire" bigint,
  "cout_de_revient" bigint,
  "prix_vente_ht" bigint,
  "pvp" bigint,
  "prix_achat_ttc" bigint,
  "source_tag" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "produits_updated_idx" ON "produits"(updated_at);

CREATE TABLE IF NOT EXISTS "rapports_caisse" (
  id uuid PRIMARY KEY,
  "numero" text NOT NULL,
  "shift_id" uuid NOT NULL,
  "date_journal" text NOT NULL,
  "session_type" text NOT NULL,
  "operateur" text,
  "started_at" timestamptz NOT NULL,
  "ended_at" timestamptz NOT NULL,
  "fond_de_caisse" bigint,
  "total_entrees" bigint,
  "total_sorties" bigint,
  "solde_theorique" bigint,
  "solde_reel" bigint,
  "ecart" bigint,
  "notes" text,
  "summary_json" text,
  "operations_json" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "rapports_caisse_updated_idx" ON "rapports_caisse"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='rapports_caisse_immutable' AND tgrelid='"rapports_caisse"'::regclass) THEN
      CREATE TRIGGER "rapports_caisse_immutable" BEFORE UPDATE OR DELETE ON "rapports_caisse" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "remboursements_ventes" (
  id uuid PRIMARY KEY,
  "vente_id" uuid NOT NULL,
  "shift_id" text,
  "montant" bigint,
  "mode_paiement" text,
  "operateur" text,
  "motif" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "remboursements_ventes_updated_idx" ON "remboursements_ventes"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='remboursements_ventes_immutable' AND tgrelid='"remboursements_ventes"'::regclass) THEN
      CREATE TRIGGER "remboursements_ventes_immutable" BEFORE UPDATE OR DELETE ON "remboursements_ventes" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "reparation_status_history" (
  id uuid PRIMARY KEY,
  "reparation_id" uuid NOT NULL,
  "statut" text NOT NULL,
  "source_status" text,
  "note" text,
  "changed_by" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "reparation_status_history_updated_idx" ON "reparation_status_history"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='reparation_status_history_immutable' AND tgrelid='"reparation_status_history"'::regclass) THEN
      CREATE TRIGGER "reparation_status_history_immutable" BEFORE UPDATE OR DELETE ON "reparation_status_history" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "reparations" (
  id uuid PRIMARY KEY,
  "numero" text NOT NULL,
  "shift_id" text,
  "operateur_nom" text,
  "client_nom" text,
  "client_tel" text,
  "type_appareil" text,
  "marque" text,
  "modele" text,
  "description_panne" text,
  "main_oeuvre" bigint,
  "acompte" bigint,
  "total_estime" bigint,
  "total_final" bigint,
  "statut" text,
  "technicien" text,
  "notes_technicien" text,
  "benefice" bigint,
  "repair_token" text,
  "estimated_completion" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "reparations_updated_idx" ON "reparations"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='reparations_immutable' AND tgrelid='"reparations"'::regclass) THEN
      CREATE TRIGGER "reparations_immutable" BEFORE UPDATE OR DELETE ON "reparations" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "retours" (
  id uuid PRIMARY KEY,
  "vente_id" uuid,
  "vente_numero" text,
  "shift_id" uuid,
  "produit_id" uuid,
  "designation" text NOT NULL,
  "quantite" bigint NOT NULL,
  "prix_unitaire" bigint NOT NULL,
  "motif" text,
  "type_retour" text NOT NULL,
  "statut" text,
  "resolution" text,
  "montant_rembourse" bigint,
  "operateur" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "retours_updated_idx" ON "retours"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='retours_immutable' AND tgrelid='"retours"'::regclass) THEN
      CREATE TRIGGER "retours_immutable" BEFORE UPDATE OR DELETE ON "retours" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "serial_numbers" (
  id uuid PRIMARY KEY,
  "produit_id" uuid NOT NULL,
  "numero_serie" text NOT NULL,
  "statut" text,
  "vente_id" uuid,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "serial_numbers_updated_idx" ON "serial_numbers"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='serial_numbers_immutable' AND tgrelid='"serial_numbers"'::regclass) THEN
      CREATE TRIGGER "serial_numbers_immutable" BEFORE UPDATE OR DELETE ON "serial_numbers" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "services_pos" (
  id uuid PRIMARY KEY,
  "nom" text NOT NULL,
  "code_barre" text NOT NULL,
  "logo_url" text,
  "actif" bigint,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "services_pos_updated_idx" ON "services_pos"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='services_pos_immutable' AND tgrelid='"services_pos"'::regclass) THEN
      CREATE TRIGGER "services_pos_immutable" BEFORE UPDATE OR DELETE ON "services_pos" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "shifts" (
  id uuid PRIMARY KEY,
  "operateur_id" text,
  "operateur_nom" text NOT NULL,
  "fond_de_caisse" bigint NOT NULL,
  "started_at" timestamptz NOT NULL,
  "ended_at" timestamptz,
  "total_ventes_especes" bigint,
  "total_services" bigint,
  "total_reparations" bigint,
  "total_credits_recus" bigint,
  "total_sorties" bigint,
  "solde_theorique" bigint,
  "solde_declare" bigint,
  "ecart" bigint,
  "transfere_caisse_interne" bigint,
  "notes_cloture" text,
  "session_type" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "shifts_updated_idx" ON "shifts"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='shifts_immutable' AND tgrelid='"shifts"'::regclass) THEN
      CREATE TRIGGER "shifts_immutable" BEFORE UPDATE OR DELETE ON "shifts" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "sorties_caisse" (
  id uuid PRIMARY KEY,
  "shift_id" text,
  "montant" bigint NOT NULL,
  "note" text NOT NULL,
  "operateur" text,
  "mouvement_interne_id" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "sorties_caisse_updated_idx" ON "sorties_caisse"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sorties_caisse_immutable' AND tgrelid='"sorties_caisse"'::regclass) THEN
      CREATE TRIGGER "sorties_caisse_immutable" BEFORE UPDATE OR DELETE ON "sorties_caisse" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "transactions_services" (
  id uuid PRIMARY KEY,
  "shift_id" uuid,
  "service_id" uuid,
  "service_nom" text NOT NULL,
  "montant_frais" bigint NOT NULL,
  "note" text,
  "operateur" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "transactions_services_updated_idx" ON "transactions_services"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='transactions_services_immutable' AND tgrelid='"transactions_services"'::regclass) THEN
      CREATE TRIGGER "transactions_services_immutable" BEFORE UPDATE OR DELETE ON "transactions_services" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "ventes" (
  id uuid PRIMARY KEY,
  "numero" text NOT NULL,
  "shift_id" uuid,
  "operateur_nom" text,
  "client_nom" text,
  "client_tel" text,
  "client_adresse" text,
  "client_matricule" text,
  "sous_total" bigint,
  "total_remises" bigint,
  "total_ttc" bigint NOT NULL,
  "mode_paiement" text,
  "montant_recu" bigint,
  "monnaie_rendue" bigint,
  "type" text,
  "note_vente" text,
  "a_facture" bigint,
  "montant_encaisse_initial" bigint,
  "statut" text,
  "annule_par" text,
  "annule_at" timestamptz,
  "annule_motif" text,
  "fidelite_utilisee" bigint,
  "fidelite_gagnee" bigint,
  "type_vente" text,
  "client_id" uuid,
  "avance_dossier_id" text,
  "avance_utilisee" bigint,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "ventes_updated_idx" ON "ventes"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='ventes_immutable' AND tgrelid='"ventes"'::regclass) THEN
      CREATE TRIGGER "ventes_immutable" BEFORE UPDATE OR DELETE ON "ventes" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "ventes_en_ligne" (
  id uuid PRIMARY KEY,
  "numero" text NOT NULL,
  "shift_id" text,
  "operateur_nom" text,
  "client_nom" text NOT NULL,
  "client_tel" text,
  "client_adresse" text,
  "produits_json" text,
  "montant_ttc" bigint NOT NULL,
  "montant_net" bigint,
  "frais_livraison" bigint,
  "frais_retour" bigint,
  "statut" text,
  "livraison_nom" text,
  "montant_recu" bigint,
  "reference_livraison" text,
  "note" text,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS "ventes_en_ligne_updated_idx" ON "ventes_en_ligne"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='ventes_en_ligne_immutable' AND tgrelid='"ventes_en_ligne"'::regclass) THEN
      CREATE TRIGGER "ventes_en_ligne_immutable" BEFORE UPDATE OR DELETE ON "ventes_en_ligne" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "stock_movements" (
  id uuid PRIMARY KEY,
  "product_id" uuid NOT NULL,
  "qty_delta" bigint NOT NULL,
  "reason" text NOT NULL,
  "ref_type" text NOT NULL,
  "ref_id" uuid NOT NULL,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz,
  CHECK (qty_delta <> 0)
);

CREATE INDEX IF NOT EXISTS "stock_movements_updated_idx" ON "stock_movements"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='stock_movements_immutable' AND tgrelid='"stock_movements"'::regclass) THEN
      CREATE TRIGGER "stock_movements_immutable" BEFORE UPDATE OR DELETE ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "account_movements" (
  id uuid PRIMARY KEY,
  "account_kind" text NOT NULL,
  "owner_id" uuid NOT NULL,
  "amount_millimes" bigint NOT NULL,
  "reason" text NOT NULL,
  "ref_type" text NOT NULL,
  "ref_id" uuid NOT NULL,
  "legacy_id" text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES app_users(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  deleted_at timestamptz,
  CHECK (amount_millimes <> 0),
  CHECK (account_kind IN ('customer_credit','supplier_debt','cash','loyalty','staff_advance','staff_credit'))
);

CREATE INDEX IF NOT EXISTS "account_movements_updated_idx" ON "account_movements"(updated_at);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='account_movements_immutable' AND tgrelid='"account_movements"'::regclass) THEN
      CREATE TRIGGER "account_movements_immutable" BEFORE UPDATE OR DELETE ON "account_movements" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ajustements_fournisseurs_fournisseur_id_fk' AND conrelid='"ajustements_fournisseurs"'::regclass) THEN
    ALTER TABLE "ajustements_fournisseurs" ADD CONSTRAINT "ajustements_fournisseurs_fournisseur_id_fk" FOREIGN KEY ("fournisseur_id") REFERENCES "fournisseurs"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='avances_clients_client_id_fk' AND conrelid='"avances_clients"'::regclass) THEN
    ALTER TABLE "avances_clients" ADD CONSTRAINT "avances_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "clients"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='avances_clients_shift_id_fk' AND conrelid='"avances_clients"'::regclass) THEN
    ALTER TABLE "avances_clients" ADD CONSTRAINT "avances_clients_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "shifts"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='avances_clients_produit_id_fk' AND conrelid='"avances_clients"'::regclass) THEN
    ALTER TABLE "avances_clients" ADD CONSTRAINT "avances_clients_produit_id_fk" FOREIGN KEY ("produit_id") REFERENCES "produits"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='clients_organisation_id_fk' AND conrelid='"clients"'::regclass) THEN
    ALTER TABLE "clients" ADD CONSTRAINT "clients_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "organisations"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='credits_clients_client_id_fk' AND conrelid='"credits_clients"'::regclass) THEN
    ALTER TABLE "credits_clients" ADD CONSTRAINT "credits_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "clients"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='credits_clients_shift_id_fk' AND conrelid='"credits_clients"'::regclass) THEN
    ALTER TABLE "credits_clients" ADD CONSTRAINT "credits_clients_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "shifts"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='demandes_clients_responsable_id_fk' AND conrelid='"demandes_clients"'::regclass) THEN
    ALTER TABLE "demandes_clients" ADD CONSTRAINT "demandes_clients_responsable_id_fk" FOREIGN KEY ("responsable_id") REFERENCES "operateurs"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='documents_shift_id_fk' AND conrelid='"documents"'::regclass) THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "shifts"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='documents_vente_id_fk' AND conrelid='"documents"'::regclass) THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_vente_id_fk" FOREIGN KEY ("vente_id") REFERENCES "ventes"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='documents_fournisseur_id_fk' AND conrelid='"documents"'::regclass) THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_fournisseur_id_fk" FOREIGN KEY ("fournisseur_id") REFERENCES "fournisseurs"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='documents_client_id_fk' AND conrelid='"documents"'::regclass) THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "clients"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='documents_avoir_id_fk' AND conrelid='"documents"'::regclass) THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_avoir_id_fk" FOREIGN KEY ("avoir_id") REFERENCES "documents"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='documents_document_origine_id_fk' AND conrelid='"documents"'::regclass) THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_document_origine_id_fk" FOREIGN KEY ("document_origine_id") REFERENCES "documents"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='factures_clients_vente_id_fk' AND conrelid='"factures_clients"'::regclass) THEN
    ALTER TABLE "factures_clients" ADD CONSTRAINT "factures_clients_vente_id_fk" FOREIGN KEY ("vente_id") REFERENCES "ventes"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='factures_fournisseurs_fournisseur_id_fk' AND conrelid='"factures_fournisseurs"'::regclass) THEN
    ALTER TABLE "factures_fournisseurs" ADD CONSTRAINT "factures_fournisseurs_fournisseur_id_fk" FOREIGN KEY ("fournisseur_id") REFERENCES "fournisseurs"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fournisseur_commerciaux_fournisseur_id_fk' AND conrelid='"fournisseur_commerciaux"'::regclass) THEN
    ALTER TABLE "fournisseur_commerciaux" ADD CONSTRAINT "fournisseur_commerciaux_fournisseur_id_fk" FOREIGN KEY ("fournisseur_id") REFERENCES "fournisseurs"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lignes_document_document_id_fk' AND conrelid='"lignes_document"'::regclass) THEN
    ALTER TABLE "lignes_document" ADD CONSTRAINT "lignes_document_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "documents"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lignes_document_produit_id_fk' AND conrelid='"lignes_document"'::regclass) THEN
    ALTER TABLE "lignes_document" ADD CONSTRAINT "lignes_document_produit_id_fk" FOREIGN KEY ("produit_id") REFERENCES "produits"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lignes_facture_fournisseur_facture_id_fk' AND conrelid='"lignes_facture_fournisseur"'::regclass) THEN
    ALTER TABLE "lignes_facture_fournisseur" ADD CONSTRAINT "lignes_facture_fournisseur_facture_id_fk" FOREIGN KEY ("facture_id") REFERENCES "factures_fournisseurs"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lignes_facture_fournisseur_produit_id_fk' AND conrelid='"lignes_facture_fournisseur"'::regclass) THEN
    ALTER TABLE "lignes_facture_fournisseur" ADD CONSTRAINT "lignes_facture_fournisseur_produit_id_fk" FOREIGN KEY ("produit_id") REFERENCES "produits"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lignes_vente_vente_id_fk' AND conrelid='"lignes_vente"'::regclass) THEN
    ALTER TABLE "lignes_vente" ADD CONSTRAINT "lignes_vente_vente_id_fk" FOREIGN KEY ("vente_id") REFERENCES "ventes"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lignes_vente_produit_id_fk' AND conrelid='"lignes_vente"'::regclass) THEN
    ALTER TABLE "lignes_vente" ADD CONSTRAINT "lignes_vente_produit_id_fk" FOREIGN KEY ("produit_id") REFERENCES "produits"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mouvements_echange_vente_id_fk' AND conrelid='"mouvements_echange"'::regclass) THEN
    ALTER TABLE "mouvements_echange" ADD CONSTRAINT "mouvements_echange_vente_id_fk" FOREIGN KEY ("vente_id") REFERENCES "ventes"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mouvements_echange_shift_id_fk' AND conrelid='"mouvements_echange"'::regclass) THEN
    ALTER TABLE "mouvements_echange" ADD CONSTRAINT "mouvements_echange_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "shifts"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mouvements_fidelite_client_id_fk' AND conrelid='"mouvements_fidelite"'::regclass) THEN
    ALTER TABLE "mouvements_fidelite" ADD CONSTRAINT "mouvements_fidelite_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "clients"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mouvements_fidelite_vente_id_fk' AND conrelid='"mouvements_fidelite"'::regclass) THEN
    ALTER TABLE "mouvements_fidelite" ADD CONSTRAINT "mouvements_fidelite_vente_id_fk" FOREIGN KEY ("vente_id") REFERENCES "ventes"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='mouvements_personnels_personnel_id_fk' AND conrelid='"mouvements_personnels"'::regclass) THEN
    ALTER TABLE "mouvements_personnels" ADD CONSTRAINT "mouvements_personnels_personnel_id_fk" FOREIGN KEY ("personnel_id") REFERENCES "personnels"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='paiements_fournisseurs_facture_id_fk' AND conrelid='"paiements_fournisseurs"'::regclass) THEN
    ALTER TABLE "paiements_fournisseurs" ADD CONSTRAINT "paiements_fournisseurs_facture_id_fk" FOREIGN KEY ("facture_id") REFERENCES "factures_fournisseurs"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='paiements_fournisseurs_fournisseur_id_fk' AND conrelid='"paiements_fournisseurs"'::regclass) THEN
    ALTER TABLE "paiements_fournisseurs" ADD CONSTRAINT "paiements_fournisseurs_fournisseur_id_fk" FOREIGN KEY ("fournisseur_id") REFERENCES "fournisseurs"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pieces_reparation_reparation_id_fk' AND conrelid='"pieces_reparation"'::regclass) THEN
    ALTER TABLE "pieces_reparation" ADD CONSTRAINT "pieces_reparation_reparation_id_fk" FOREIGN KEY ("reparation_id") REFERENCES "reparations"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pieces_reparation_produit_id_fk' AND conrelid='"pieces_reparation"'::regclass) THEN
    ALTER TABLE "pieces_reparation" ADD CONSTRAINT "pieces_reparation_produit_id_fk" FOREIGN KEY ("produit_id") REFERENCES "produits"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='produits_categorie_id_fk' AND conrelid='"produits"'::regclass) THEN
    ALTER TABLE "produits" ADD CONSTRAINT "produits_categorie_id_fk" FOREIGN KEY ("categorie_id") REFERENCES "categories"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='produits_fournisseur_id_fk' AND conrelid='"produits"'::regclass) THEN
    ALTER TABLE "produits" ADD CONSTRAINT "produits_fournisseur_id_fk" FOREIGN KEY ("fournisseur_id") REFERENCES "fournisseurs"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rapports_caisse_shift_id_fk' AND conrelid='"rapports_caisse"'::regclass) THEN
    ALTER TABLE "rapports_caisse" ADD CONSTRAINT "rapports_caisse_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "shifts"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='remboursements_ventes_vente_id_fk' AND conrelid='"remboursements_ventes"'::regclass) THEN
    ALTER TABLE "remboursements_ventes" ADD CONSTRAINT "remboursements_ventes_vente_id_fk" FOREIGN KEY ("vente_id") REFERENCES "ventes"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reparation_status_history_reparation_id_fk' AND conrelid='"reparation_status_history"'::regclass) THEN
    ALTER TABLE "reparation_status_history" ADD CONSTRAINT "reparation_status_history_reparation_id_fk" FOREIGN KEY ("reparation_id") REFERENCES "reparations"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='retours_vente_id_fk' AND conrelid='"retours"'::regclass) THEN
    ALTER TABLE "retours" ADD CONSTRAINT "retours_vente_id_fk" FOREIGN KEY ("vente_id") REFERENCES "ventes"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='retours_shift_id_fk' AND conrelid='"retours"'::regclass) THEN
    ALTER TABLE "retours" ADD CONSTRAINT "retours_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "shifts"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='retours_produit_id_fk' AND conrelid='"retours"'::regclass) THEN
    ALTER TABLE "retours" ADD CONSTRAINT "retours_produit_id_fk" FOREIGN KEY ("produit_id") REFERENCES "produits"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='serial_numbers_produit_id_fk' AND conrelid='"serial_numbers"'::regclass) THEN
    ALTER TABLE "serial_numbers" ADD CONSTRAINT "serial_numbers_produit_id_fk" FOREIGN KEY ("produit_id") REFERENCES "produits"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='transactions_services_shift_id_fk' AND conrelid='"transactions_services"'::regclass) THEN
    ALTER TABLE "transactions_services" ADD CONSTRAINT "transactions_services_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "shifts"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='transactions_services_service_id_fk' AND conrelid='"transactions_services"'::regclass) THEN
    ALTER TABLE "transactions_services" ADD CONSTRAINT "transactions_services_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "services_pos"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ventes_shift_id_fk' AND conrelid='"ventes"'::regclass) THEN
    ALTER TABLE "ventes" ADD CONSTRAINT "ventes_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "shifts"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ventes_client_id_fk' AND conrelid='"ventes"'::regclass) THEN
    ALTER TABLE "ventes" ADD CONSTRAINT "ventes_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "clients"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='stock_movements_product_id_fk' AND conrelid='"stock_movements"'::regclass) THEN
    ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "produits"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "produits_reference_uq" ON "produits"("reference");

CREATE UNIQUE INDEX IF NOT EXISTS "produits_code_barre_uq" ON "produits"("code_barre");

CREATE UNIQUE INDEX IF NOT EXISTS "categories_nom_uq" ON "categories"("nom");

CREATE UNIQUE INDEX IF NOT EXISTS "operateurs_identifiant_uq" ON "operateurs"("identifiant");

CREATE UNIQUE INDEX IF NOT EXISTS "ventes_numero_uq" ON "ventes"("numero");

CREATE UNIQUE INDEX IF NOT EXISTS "documents_numero_uq" ON "documents"("numero");

CREATE UNIQUE INDEX IF NOT EXISTS "factures_clients_numero_uq" ON "factures_clients"("numero");

CREATE UNIQUE INDEX IF NOT EXISTS "reparations_numero_uq" ON "reparations"("numero");

CREATE UNIQUE INDEX IF NOT EXISTS "avances_clients_numero_uq" ON "avances_clients"("numero");

CREATE UNIQUE INDEX IF NOT EXISTS "app_settings_key_uq" ON "app_settings"("key");

CREATE UNIQUE INDEX IF NOT EXISTS serial_normalized_uq ON serial_numbers(produit_id,lower(trim(numero_serie)));

DO $$ BEGIN IF current_schema()='public' AND EXISTS(SELECT 1 FROM pg_publication WHERE pubname='powersync') THEN ALTER PUBLICATION powersync SET TABLE "activity_logs", "ajustements_fournisseurs", "app_settings", "avances_clients", "caisse_interne", "categories", "clients", "credits_clients", "demandes_clients", "documents", "factures_clients", "factures_fournisseurs", "fournisseur_commerciaux", "fournisseurs", "lignes_document", "lignes_facture_fournisseur", "lignes_vente", "mouvements_caisse_interne", "mouvements_echange", "mouvements_fidelite", "mouvements_personnels", "mouvements_tresorerie_attente", "operateurs", "organisations", "paiements_fournisseurs", "personnels", "pieces_reparation", "produits", "rapports_caisse", "remboursements_ventes", "reparation_status_history", "reparations", "retours", "serial_numbers", "services_pos", "shifts", "sorties_caisse", "transactions_services", "ventes", "ventes_en_ligne", "stock_movements", "account_movements"; END IF; END $$;

GRANT SELECT ON "activity_logs" TO powersync_role;

GRANT SELECT ON "ajustements_fournisseurs" TO powersync_role;

GRANT SELECT ON "app_settings" TO powersync_role;

GRANT SELECT ON "avances_clients" TO powersync_role;

GRANT SELECT ON "caisse_interne" TO powersync_role;

GRANT SELECT ON "categories" TO powersync_role;

GRANT SELECT ON "clients" TO powersync_role;

GRANT SELECT ON "credits_clients" TO powersync_role;

GRANT SELECT ON "demandes_clients" TO powersync_role;

GRANT SELECT ON "documents" TO powersync_role;

GRANT SELECT ON "factures_clients" TO powersync_role;

GRANT SELECT ON "factures_fournisseurs" TO powersync_role;

GRANT SELECT ON "fournisseur_commerciaux" TO powersync_role;

GRANT SELECT ON "fournisseurs" TO powersync_role;

GRANT SELECT ON "lignes_document" TO powersync_role;

GRANT SELECT ON "lignes_facture_fournisseur" TO powersync_role;

GRANT SELECT ON "lignes_vente" TO powersync_role;

GRANT SELECT ON "mouvements_caisse_interne" TO powersync_role;

GRANT SELECT ON "mouvements_echange" TO powersync_role;

GRANT SELECT ON "mouvements_fidelite" TO powersync_role;

GRANT SELECT ON "mouvements_personnels" TO powersync_role;

GRANT SELECT ON "mouvements_tresorerie_attente" TO powersync_role;

GRANT SELECT ON "operateurs" TO powersync_role;

GRANT SELECT ON "organisations" TO powersync_role;

GRANT SELECT ON "paiements_fournisseurs" TO powersync_role;

GRANT SELECT ON "personnels" TO powersync_role;

GRANT SELECT ON "pieces_reparation" TO powersync_role;

GRANT SELECT ON "produits" TO powersync_role;

GRANT SELECT ON "rapports_caisse" TO powersync_role;

GRANT SELECT ON "remboursements_ventes" TO powersync_role;

GRANT SELECT ON "reparation_status_history" TO powersync_role;

GRANT SELECT ON "reparations" TO powersync_role;

GRANT SELECT ON "retours" TO powersync_role;

GRANT SELECT ON "serial_numbers" TO powersync_role;

GRANT SELECT ON "services_pos" TO powersync_role;

GRANT SELECT ON "shifts" TO powersync_role;

GRANT SELECT ON "sorties_caisse" TO powersync_role;

GRANT SELECT ON "transactions_services" TO powersync_role;

GRANT SELECT ON "ventes" TO powersync_role;

GRANT SELECT ON "ventes_en_ligne" TO powersync_role;

GRANT SELECT ON "stock_movements" TO powersync_role;

GRANT SELECT ON "account_movements" TO powersync_role;

INSERT INTO sync_schema_versions(version) VALUES(1) ON CONFLICT DO NOTHING;

