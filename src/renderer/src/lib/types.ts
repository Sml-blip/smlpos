export type TypeFacturation = 'F' | 'NF'
export type ModePaiement = 'ESPECES' | 'CARTE' | 'CHEQUE' | 'MIXTE'
export type StatutReparation = 'EN_ATTENTE' | 'EN_COURS' | 'TERMINE' | 'RENDU' | 'ANNULE'
export type TypeAppareil = 'PC' | 'SCOOTER' | 'SMARTPHONE' | 'IMPRIMANTE'
export type StatutPaiement = 'EN_ATTENTE' | 'PARTIEL' | 'PAYE' | 'EN_RETARD'

export interface Operateur {
  id: string
  nom: string
  identifiant: string
  role: 'caissier' | 'superadmin'
  actif: number
}

export interface Shift {
  id: string
  operateur_id?: string
  operateur_nom: string
  fond_de_caisse: number
  started_at: string
  ended_at?: string
  total_ventes_especes?: number
  total_services?: number
  total_reparations?: number
  total_credits_recus?: number
  total_sorties?: number
  solde_theorique?: number
  solde_declare?: number
  ecart?: number
  transfere_caisse_interne?: number
  notes_cloture?: string
}

export interface Categorie {
  id: string
  nom: string
  icone?: string
}

export interface Produit {
  id: string
  code_barre?: string
  reference: string
  nom: string
  description?: string
  categorie: string
  categorie_id?: string
  type: TypeFacturation
  prix_achat?: number
  prix_vente: number
  tva_taux?: number
  // v1.7 pricing fields
  tva_achat_pct?: number
  marge_pct?: number
  coef_av?: number
  cout_supplementaire?: number
  cout_de_revient?: number
  prix_vente_ht?: number
  pvp?: number
  stock_actuel: number
  stock_minimum: number
  fournisseur?: string
  fournisseur_id?: string
  has_serial_number?: number   // 1 = yes, 0 = no
  numero_serie?: string
  source_tag?: string          // NF products: free-text supplier/source tag
  actif: number
  created_at: string
  updated_at: string
}

export interface SerialNumber {
  id: string
  produit_id: string
  numero_serie: string
  statut: 'EN_STOCK' | 'VENDU' | 'DEFECTUEUX'
  vente_id?: string
  created_at: string
  updated_at: string
}

export interface CartItem {
  produit_id?: string
  designation: string
  quantite: number
  prix_unitaire: number
  remise_pct: number
  total_ligne: number
  type_produit: TypeFacturation
  is_service?: boolean
  is_libre?: boolean
}

export interface Vente {
  id: string
  numero: string
  shift_id?: string
  operateur_nom?: string
  client_nom?: string
  client_tel?: string
  client_adresse?: string
  client_matricule?: string
  sous_total: number
  total_remises: number
  total_ttc: number
  mode_paiement: ModePaiement
  montant_recu?: number
  monnaie_rendue?: number
  type: 'VENTE' | 'REPARATION'
  type_vente?: 'TICKET' | 'FACTURE' | 'BL_VENTE'
  statut?: 'ACTIVE' | 'ANNULEE'
  annule_par?: string
  annule_at?: string
  annule_motif?: string
  a_facture?: number
  created_at: string
}

export interface LigneVente {
  id: string
  vente_id: string
  produit_id?: string
  designation: string
  quantite: number
  prix_unitaire: number
  remise_pct: number
  total_ligne: number
  type_produit: TypeFacturation
}

export interface Reparation {
  id: string
  numero: string
  shift_id?: string
  operateur_nom?: string
  client_nom?: string
  client_tel?: string
  type_appareil: TypeAppareil
  marque?: string
  modele?: string
  description_panne: string
  main_oeuvre: number
  acompte: number
  total_estime: number
  total_final?: number
  benefice?: number
  statut: StatutReparation
  technicien?: string
  notes_technicien?: string
  created_at: string
  updated_at: string
}

export interface PieceReparation {
  id: string
  reparation_id: string
  produit_id?: string
  designation: string
  quantite: number
  prix_unitaire: number
  type: TypeFacturation
}

export interface SortieCaisse {
  id: string
  shift_id?: string
  montant: number
  note: string
  operateur?: string
  created_at: string
}

export interface ActivityLog {
  id: string
  shift_id?: string
  operateur?: string
  action: string
  details: Record<string, unknown>
  montant?: number
  created_at: string
}

// ── Services POS (Enda / Ooredoo / Orange) ──────────────────────────────────

export interface ServicePOS {
  id: string
  nom: string
  code_barre: string   // 13 chars unique
  logo_url?: string
  actif: number
  created_at: string
}

export interface TransactionService {
  id: string
  shift_id?: string
  service_id: string
  service_nom: string
  montant_frais: number
  note?: string
  operateur?: string
  created_at: string
}

// ── Fournisseurs & Achats ────────────────────────────────────────────────────

export interface Fournisseur {
  id: string
  nom: string
  contact_nom?: string
  telephone?: string
  email?: string
  adresse?: string
  matricule_fiscal?: string
  rib?: string
  solde_du: number
  notes?: string
  actif: number
  created_at: string
}

export interface FactureFournisseur {
  id: string
  numero_facture: string
  fournisseur_id: string
  fournisseur_nom?: string
  date_facture: string
  date_echeance?: string
  statut_paiement: StatutPaiement
  montant_ht: number
  montant_tva: number
  montant_ttc: number
  montant_paye: number
  montant_restant?: number
  notes?: string
  type?: 'FACTURE_ACHAT' | 'FACTURE_ACHAT_BL'
  statut_reception?: 'NON_ARRIVE' | 'ARRIVE'
  created_at: string
}

export interface LigneFactureFournisseur {
  id: string
  facture_id: string
  produit_id?: string
  designation: string
  quantite: number
  ancien_prix_achat?: number
  nouveau_prix_achat: number
  prix_vente_suggere?: number
  prix_vente_applique?: number
  tva_taux: number
  total_ht?: number
}

export interface PaiementFournisseur {
  id: string
  facture_id: string
  fournisseur_id: string
  montant: number
  mode_paiement: 'ESPECES' | 'CHEQUE' | 'VIREMENT' | 'AUTRE'
  reference_cheque?: string
  date_paiement: string
  notes?: string
  created_at: string
}

// ── Factures Clients ─────────────────────────────────────────────────────────

export interface FactureClient {
  id: string
  numero: string
  shift_id?: string
  vente_id?: string
  type_facture: 'VENTE_INDIVIDUELLE' | 'JOURNALIERE_F'
  client_nom?: string
  client_tel?: string
  client_adresse?: string
  client_matricule?: string
  total_ht: number
  total_tva: number
  total_ttc: number
  imprimee: number
  created_at: string
}

// ── Organisations ─────────────────────────────────────────────────────────────

export interface Organisation {
  id: string
  nom: string
  telephone?: string
  email?: string
  adresse?: string
  matricule_fiscal?: string
  credit_total: number
  notes?: string
  actif: number
  created_at: string
}

// ── Personnels ────────────────────────────────────────────────────────────────

export type TypeMouvementPersonnel = 'SALAIRE' | 'AVANCE' | 'AVANCE_REMBOURSEMENT' | 'CREDIT_PERSONNEL' | 'CREDIT_REMBOURSEMENT'

export interface Personnel {
  id: string
  nom: string
  prenom?: string
  poste?: string
  telephone?: string
  cin?: string
  date_embauche?: string
  salaire_base: number
  avance_solde: number
  credit_solde: number
  actif: number
  notes?: string
  created_at: string
  updated_at: string
}

export interface MouvementPersonnel {
  id: string
  personnel_id: string
  personnel_nom_full?: string
  type: TypeMouvementPersonnel
  montant: number
  mois?: string
  note?: string
  operateur?: string
  created_at: string
}

// ── Documents (Facture/Devis/BL) ─────────────────────────────────────────────

export type TypeDocument = 'FACTURE_VENTE' | 'DEVIS' | 'BON_LIVRAISON' | 'FACTURE_JOURNALIERE_F' | 'FACTURE_ACHAT' | 'FACTURE_ACHAT_BL' | 'TICKET'

export interface Document {
  id: string
  numero: string
  type_document: TypeDocument
  statut: 'ACTIF' | 'ANNULE' | 'CONVERTI' | 'NON_ARRIVE' | 'ARRIVE'
  shift_id?: string
  vente_id?: string
  fournisseur_id?: string
  client_id?: string
  client_nom?: string
  client_tel?: string
  client_adresse?: string
  client_matricule?: string
  total_ht: number
  total_tva: number
  total_ttc: number
  statut_paiement: StatutPaiement
  montant_paye: number
  date_echeance?: string
  imprimee: number
  layout_snapshot?: string
  contenu_json?: string
  created_at: string
  updated_at: string
}

export interface LigneDocument {
  id: string
  document_id: string
  produit_id?: string
  designation: string
  quantite: number
  prix_unitaire: number
  remise_pct: number
  tva_taux: number
  total_ht: number
  total_tva: number
  total_ttc: number
  type_produit: TypeFacturation
}

// ── Retours ──────────────────────────────────────────────────────────────────

export interface Retour {
  id: string
  vente_id?: string
  vente_numero?: string
  shift_id?: string
  produit_id?: string
  designation: string
  quantite: number
  prix_unitaire: number
  motif?: string
  type_retour: 'DEFECTUEUX' | 'SANS_PROBLEME'
  statut: 'EN_ATTENTE' | 'RESOLU' | 'REMBOURSE' | 'ECHANGE'
  resolution?: string
  montant_rembourse: number
  operateur?: string
  created_at: string
  updated_at: string
}

// ── Caisse Interne ───────────────────────────────────────────────────────────

export interface CaisseInterne {
  id: string
  date_journal: string
  solde_ouverture: number
  total_entrees: number
  total_sorties: number
  solde_cloture?: number
  notes?: string
  created_at: string
}

export interface MouvementCaisseInterne {
  id: string
  date_journal: string
  type: 'ENTREE' | 'SORTIE'
  categorie: string
  montant: number
  reference_id?: string
  note?: string
  operateur: string
  created_at: string
}
