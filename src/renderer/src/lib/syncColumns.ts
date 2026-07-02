/** Columns that exist on Supabase — strip local-only fields before upsert. */
export const SYNC_REMOTE_COLUMNS: Record<string, ReadonlySet<string>> = {
  operateurs: new Set(['id', 'nom', 'identifiant', 'role', 'actif', 'created_at']),
  categories: new Set(['id', 'nom', 'icone']),
  fournisseurs: new Set(['id', 'nom', 'contact_nom', 'telephone', 'email', 'adresse', 'matricule_fiscal', 'rib', 'solde_du', 'notes', 'actif', 'created_at']),
  organisations: new Set(['id', 'nom', 'telephone', 'email', 'adresse', 'matricule_fiscal', 'credit_total', 'notes', 'actif', 'created_at']),
  clients: new Set(['id', 'nom', 'telephone', 'email', 'adresse', 'matricule_fiscal', 'credit_limite', 'solde_credit', 'organisation_id', 'agent', 'actif', 'notes', 'created_at']),
  personnels: new Set(['id', 'nom', 'prenom', 'poste', 'telephone', 'cin', 'date_embauche', 'salaire_base', 'avance_solde', 'credit_solde', 'actif', 'notes', 'created_at', 'updated_at']),
  services_pos: new Set(['id', 'nom', 'code_barre', 'logo_url', 'actif', 'created_at']),
  app_settings: new Set(['key', 'value', 'updated_at']),
  shifts: new Set(['id', 'operateur_id', 'operateur_nom', 'fond_de_caisse', 'started_at', 'ended_at', 'total_ventes_especes', 'total_services', 'total_reparations', 'total_credits_recus', 'total_sorties', 'solde_theorique', 'solde_declare', 'ecart', 'transfere_caisse_interne', 'notes_cloture']),
  produits: new Set([
    'id', 'code_barre', 'reference', 'nom', 'description', 'categorie', 'categorie_id', 'type',
    'prix_achat', 'prix_vente', 'tva_taux', 'stock_actuel', 'stock_minimum', 'fournisseur', 'fournisseur_id',
    'actif', 'has_serial_number', 'numero_serie', 'tva_achat_pct', 'marge_pct', 'coef_av',
    'cout_supplementaire', 'cout_de_revient', 'prix_vente_ht', 'pvp', 'prix_achat_ttc', 'created_at', 'updated_at',
  ]),
  ventes: new Set([
    'id', 'numero', 'shift_id', 'operateur_nom', 'client_nom', 'client_tel', 'client_adresse', 'client_matricule',
    'sous_total', 'total_remises', 'total_ttc', 'mode_paiement', 'montant_recu', 'monnaie_rendue', 'type',
    'a_facture', 'statut', 'annule_par', 'annule_at', 'annule_motif', 'created_at',
  ]),
  lignes_vente: new Set(['id', 'vente_id', 'produit_id', 'designation', 'quantite', 'prix_unitaire', 'remise_pct', 'total_ligne', 'type_produit']),
  factures_clients: new Set(['id', 'numero', 'shift_id', 'vente_id', 'type_facture', 'client_nom', 'client_tel', 'client_adresse', 'client_matricule', 'total_ht', 'total_tva', 'total_ttc', 'imprimee', 'tva_taux_principal', 'exo', 'created_at']),
  reparations: new Set(['id', 'numero', 'shift_id', 'operateur_nom', 'client_nom', 'client_tel', 'type_appareil', 'marque', 'modele', 'description_panne', 'main_oeuvre', 'acompte', 'total_estime', 'total_final', 'statut', 'technicien', 'notes_technicien', 'benefice', 'created_at', 'updated_at']),
  pieces_reparation: new Set(['id', 'reparation_id', 'produit_id', 'designation', 'quantite', 'prix_unitaire', 'type']),
  sorties_caisse: new Set(['id', 'shift_id', 'montant', 'note', 'operateur', 'mouvement_interne_id', 'created_at']),
  factures_fournisseurs: new Set(['id', 'numero_facture', 'fournisseur_id', 'date_facture', 'date_echeance', 'statut_paiement', 'montant_ht', 'montant_tva', 'montant_ttc', 'montant_paye', 'notes', 'type', 'statut_reception', 'exo', 'timbre', 'ht_7', 'tva_7', 'ht_19', 'tva_19', 'total_remise', 'created_at']),
  lignes_facture_fournisseur: new Set(['id', 'facture_id', 'produit_id', 'designation', 'quantite', 'ancien_prix_achat', 'nouveau_prix_achat', 'prix_vente_suggere', 'prix_vente_applique', 'tva_taux']),
  paiements_fournisseurs: new Set(['id', 'facture_id', 'fournisseur_id', 'montant', 'mode_paiement', 'reference_cheque', 'date_paiement', 'notes', 'created_at']),
  credits_clients: new Set(['id', 'client_id', 'client_nom', 'shift_id', 'type', 'montant', 'reference', 'note', 'operateur', 'created_at']),
  retours: new Set(['id', 'vente_id', 'vente_numero', 'shift_id', 'produit_id', 'designation', 'quantite', 'prix_unitaire', 'motif', 'type_retour', 'statut', 'resolution', 'montant_rembourse', 'operateur', 'created_at', 'updated_at']),
  ventes_en_ligne: new Set(['id', 'numero', 'shift_id', 'operateur_nom', 'client_nom', 'client_tel', 'client_adresse', 'produits_json', 'montant_ttc', 'montant_net', 'frais_livraison', 'frais_retour', 'statut', 'livraison_nom', 'montant_recu', 'reference_livraison', 'note', 'created_at', 'updated_at']),
  caisse_interne: new Set(['id', 'date_journal', 'solde_ouverture', 'total_entrees', 'total_sorties', 'notes', 'created_at']),
  mouvements_caisse_interne: new Set(['id', 'date_journal', 'type', 'categorie', 'montant', 'reference_id', 'note', 'operateur', 'created_at']),
  mouvements_personnels: new Set(['id', 'personnel_id', 'type', 'montant', 'mois', 'note', 'operateur', 'created_at']),
  documents: new Set([
    'id', 'numero', 'type_document', 'statut', 'shift_id', 'vente_id', 'fournisseur_id', 'client_id',
    'client_nom', 'client_tel', 'client_adresse', 'client_matricule', 'total_ht', 'total_tva', 'total_ttc',
    'statut_paiement', 'montant_paye', 'date_echeance', 'imprimee', 'layout_snapshot', 'contenu_json',
    'exo', 'timbre', 'ht_7', 'tva_7', 'ht_19', 'tva_19', 'total_remise', 'tva_taux_principal', 'created_at', 'updated_at',
  ]),
  lignes_document: new Set(['id', 'document_id', 'produit_id', 'designation', 'quantite', 'prix_unitaire', 'remise_pct', 'tva_taux', 'total_ht', 'total_tva', 'total_ttc', 'type_produit']),
  transactions_services: new Set(['id', 'shift_id', 'service_id', 'service_nom', 'montant_frais', 'note', 'operateur', 'created_at']),
  activity_logs: new Set(['id', 'shift_id', 'operateur', 'action', 'details', 'montant', 'created_at']),
}

export function stripPayloadForRemote(tableName: string, payload: Record<string, unknown>): Record<string, unknown> {
  const allowed = SYNC_REMOTE_COLUMNS[tableName]
  if (!allowed) return payload
  return Object.fromEntries(Object.entries(payload).filter(([k]) => allowed.has(k)))
}
