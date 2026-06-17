export const ACTIVITY_LABELS: Record<string, string> = {
  SHIFT_OPENED: 'Ouverture caisse',
  SHIFT_CLOSED: 'Fermeture caisse',
  SALE_CREATED: 'Vente créée',
  SALE_CANCELLED: 'Vente annulée',
  REPAIR_CREATED: 'Réparation créée',
  REPAIR_STATUS_UPDATED: 'Statut réparation',
  CASH_OUT_CREATED: 'Sortie caisse',
  SERVICE_TRANSACTION_CREATED: 'Transaction service',
  CLIENT_INVOICE_CREATED: 'Facture client',
  SUPPLIER_CREATED: 'Fournisseur créé',
  SUPPLIER_UPDATED: 'Fournisseur modifié',
  SUPPLIER_INVOICE_CREATED: 'Facture fournisseur',
  SUPPLIER_PAYMENT_CREATED: 'Paiement fournisseur',
  PRODUCT_CREATED: 'Produit créé',
  PRODUCT_UPDATED: 'Produit modifié',
  PRODUCT_DELETED: 'Produit supprimé',
  STOCK_ADJUSTED: 'Stock ajusté',
  PRODUCTS_IMPORTED: 'Import produits',
  CLIENT_CREATED: 'Client créé',
  CLIENT_UPDATED: 'Client modifié',
  CLIENT_CREDIT_CREATED: 'Crédit client',
  CLIENT_PAYMENT_RECEIVED: 'Paiement client',
  RETURN_CREATED: 'Retour créé',
  RETURN_STATUS_UPDATED: 'Retour mis à jour',
  STAFF_CREATED: 'Personnel créé',
  STAFF_UPDATED: 'Personnel modifié',
  STAFF_MOVEMENT_CREATED: 'Mouvement personnel',
  ORGANISATION_CREATED: 'Organisation créée',
  SETTING_UPDATED: 'Paramètre modifié',
  SETTINGS_UPDATED: 'Paramètres modifiés',
}

export function formatActivityDetails(details: unknown): string {
  if (!details || typeof details !== 'object') return ''
  const d = details as Record<string, unknown>
  const parts: string[] = []
  if (d.nom) parts.push(String(d.nom))
  if (d.numero) parts.push(String(d.numero))
  if (d.client_nom) parts.push(String(d.client_nom))
  if (d.mode) parts.push(String(d.mode))
  if (d.type) parts.push(String(d.type))
  return parts.slice(0, 3).join(' · ')
}
