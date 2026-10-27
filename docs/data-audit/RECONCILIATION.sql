-- Read-only diagnostics for a VERIFIED COPY. No automatic repairs.
-- Schema compatibility must be checked first with BASELINE.sql.
-- Empty-schema validation proves SQL syntax, not real-data correctness.
PRAGMA query_only = ON;
PRAGMA integrity_check;
PRAGMA foreign_key_check;

-- Keep sale turnover separate from invoice/document representations.
SELECT type,type_vente,statut,COUNT(*) AS rows,
       SUM(CAST(ROUND(COALESCE(total_ttc,0)*1000) AS INTEGER)) AS total_millimes,
       SUM(CAST(ROUND(COALESCE(avance_utilisee,0)*1000) AS INTEGER)) AS applied_deposits_millimes
FROM ventes GROUP BY type,type_vente,statut;

SELECT type_document,statut,COUNT(*) AS rows,
       SUM(CAST(ROUND(COALESCE(total_ht,0)*1000) AS INTEGER)) AS ht_millimes,
       SUM(CAST(ROUND(COALESCE(total_tva,0)*1000) AS INTEGER)) AS tva_millimes,
       SUM(CAST(ROUND(COALESCE(total_ttc,0)*1000) AS INTEGER)) AS ttc_millimes,
       SUM(CAST(ROUND(COALESCE(timbre,0)*1000) AS INTEGER)) AS stamp_millimes
FROM documents GROUP BY type_document,statut;

SELECT COUNT(*) AS rows,SUM(CAST(ROUND(total_ttc*1000) AS INTEGER)) AS total_millimes
FROM factures_clients;
SELECT mode_paiement,COUNT(*) AS rows,SUM(CAST(ROUND(montant*1000) AS INTEGER)) AS total_millimes
FROM paiements_fournisseurs GROUP BY mode_paiement;
SELECT type,COUNT(*) AS rows,SUM(CAST(ROUND(montant*1000) AS INTEGER)) AS total_millimes
FROM credits_clients GROUP BY type;
SELECT type_avance,statut,COUNT(*) AS rows,SUM(CAST(ROUND(montant*1000) AS INTEGER)) AS total_millimes
FROM avances_clients GROUP BY type_avance,statut;
SELECT COUNT(*) AS rows,SUM(CAST(ROUND(montant*1000) AS INTEGER)) AS total_millimes
FROM remboursements_ventes;
SELECT type_retour,statut,COUNT(*) AS rows,SUM(CAST(ROUND(montant_rembourse*1000) AS INTEGER)) AS refunded_millimes
FROM retours GROUP BY type_retour,statut;
SELECT type,COUNT(*) AS rows,SUM(CAST(ROUND(montant*1000) AS INTEGER)) AS total_millimes
FROM mouvements_personnels GROUP BY type;

-- Compare these per-record values with mapped records after migration.
SELECT id,stock_actuel,has_serial_number FROM produits ORDER BY id;
SELECT id,CAST(ROUND(solde_credit*1000) AS INTEGER) AS debt_millimes,
       CAST(ROUND(solde_fidelite*1000) AS INTEGER) AS loyalty_millimes FROM clients ORDER BY id;
SELECT id,CAST(ROUND(solde_du*1000) AS INTEGER) AS debt_millimes FROM fournisseurs ORDER BY id;
SELECT id,CAST(ROUND(avance_solde*1000) AS INTEGER) AS advance_millimes,
       CAST(ROUND(credit_solde*1000) AS INTEGER) AS credit_millimes FROM personnels ORDER BY id;

-- Diagnostic debt reconciliation: differences can include historical opening balances.
WITH movement AS (
  SELECT client_id,SUM(CAST(ROUND(CASE WHEN type='CREDIT' THEN montant ELSE -montant END*1000) AS INTEGER)) AS amount
  FROM credits_clients GROUP BY client_id
)
SELECT c.id,CAST(ROUND(c.solde_credit*1000) AS INTEGER) AS stored_millimes,
       COALESCE(m.amount,0) AS movement_millimes
FROM clients c LEFT JOIN movement m ON m.client_id=c.id
WHERE CAST(ROUND(c.solde_credit*1000) AS INTEGER)!=COALESCE(m.amount,0);

WITH amounts AS (
  SELECT client_id,SUM(CAST(ROUND(CASE WHEN type IN ('GAIN','REMBOURSEMENT') THEN montant ELSE -montant END*1000) AS INTEGER)) AS amount
  FROM mouvements_fidelite GROUP BY client_id
)
SELECT c.id,CAST(ROUND(c.solde_fidelite*1000) AS INTEGER) AS stored_millimes,
       COALESCE(a.amount,0) AS movement_millimes
FROM clients c LEFT JOIN amounts a ON a.client_id=c.id
WHERE CAST(ROUND(c.solde_fidelite*1000) AS INTEGER)!=COALESCE(a.amount,0);

WITH payments AS (
 SELECT facture_id,SUM(CAST(ROUND(montant*1000) AS INTEGER)) AS amount
 FROM paiements_fournisseurs GROUP BY facture_id
)
SELECT f.id,CAST(ROUND(f.montant_paye*1000) AS INTEGER) AS stored_paid,
       COALESCE(p.amount,0) AS payment_rows
FROM factures_fournisseurs f LEFT JOIN payments p ON p.facture_id=f.id
WHERE CAST(ROUND(f.montant_paye*1000) AS INTEGER)!=COALESCE(p.amount,0);

WITH invoices AS (
 SELECT fournisseur_id,SUM(CAST(ROUND((COALESCE(net_a_payer,montant_ttc)-montant_paye)*1000) AS INTEGER)) AS outstanding
 FROM factures_fournisseurs WHERE statut_paiement NOT IN ('BROUILLON','ANNULE') GROUP BY fournisseur_id
), adjustments AS (
 SELECT fournisseur_id,SUM(CAST(ROUND(CASE WHEN type='AJOUT' THEN montant ELSE -montant END*1000) AS INTEGER)) AS amount
 FROM ajustements_fournisseurs GROUP BY fournisseur_id
)
SELECT f.id,CAST(ROUND(f.solde_du*1000) AS INTEGER) AS stored,
       COALESCE(i.outstanding,0)+COALESCE(a.amount,0) AS invoice_and_adjustment_total
FROM fournisseurs f LEFT JOIN invoices i ON i.fournisseur_id=f.id LEFT JOIN adjustments a ON a.fournisseur_id=f.id
WHERE CAST(ROUND(f.solde_du*1000) AS INTEGER)!=COALESCE(i.outstanding,0)+COALESCE(a.amount,0);

-- Header/line diagnostic, not an automatic error: cart discounts can explain sale differences.
SELECT v.id,v.total_ttc,SUM(l.total_ligne) AS line_total
FROM ventes v LEFT JOIN lignes_vente l ON l.vente_id=v.id
GROUP BY v.id HAVING ABS(COALESCE(v.total_ttc,0)-COALESCE(SUM(l.total_ligne),0))>0.001;
SELECT d.id,d.type_document,d.total_ht,d.total_tva,d.total_ttc,
       SUM(l.total_ht) AS line_ht,SUM(l.total_tva) AS line_tva,SUM(l.total_ttc) AS line_ttc
FROM documents d LEFT JOIN lignes_document l ON l.document_id=d.id
GROUP BY d.id HAVING ABS(COALESCE(d.total_ttc,0)-COALESCE(SUM(l.total_ttc),0))>0.001;

-- Logical orphan checks not fully covered by declared SQLite foreign keys.
SELECT 'ventes.client_id' AS relation,v.id FROM ventes v LEFT JOIN clients c ON c.id=v.client_id
WHERE NULLIF(TRIM(v.client_id),'') IS NOT NULL AND c.id IS NULL;
SELECT 'ventes.shift_id' AS relation,v.id FROM ventes v LEFT JOIN shifts s ON s.id=v.shift_id
WHERE NULLIF(TRIM(v.shift_id),'') IS NOT NULL AND s.id IS NULL;
SELECT 'lignes_vente.produit_id' AS relation,l.id FROM lignes_vente l LEFT JOIN produits p ON p.id=l.produit_id
WHERE NULLIF(TRIM(l.produit_id),'') IS NOT NULL AND p.id IS NULL;
SELECT 'documents.vente_id' AS relation,d.id FROM documents d LEFT JOIN ventes v ON v.id=d.vente_id
WHERE NULLIF(TRIM(d.vente_id),'') IS NOT NULL AND v.id IS NULL;
SELECT 'lignes_document.produit_id' AS relation,l.id FROM lignes_document l LEFT JOIN produits p ON p.id=l.produit_id
WHERE NULLIF(TRIM(l.produit_id),'') IS NOT NULL AND p.id IS NULL;
SELECT c.id,c.organisation_id FROM clients c
WHERE NULLIF(TRIM(c.organisation_id),'') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM organisations o WHERE o.id=c.organisation_id OR LOWER(TRIM(o.nom))=LOWER(TRIM(c.organisation_id)));

-- Missing primary keys are possible with ordinary SQLite TEXT PRIMARY KEY.
SELECT 'ventes' AS table_name,COUNT(*) AS bad_ids FROM ventes WHERE id IS NULL OR TRIM(id)=''
UNION ALL SELECT 'produits',COUNT(*) FROM produits WHERE id IS NULL OR TRIM(id)=''
UNION ALL SELECT 'clients',COUNT(*) FROM clients WHERE id IS NULL OR TRIM(id)='';

-- Serial uniqueness and state consistency. Reserved vente_id is a dossier reference.
SELECT produit_id,LOWER(TRIM(numero_serie)) AS serial_key,COUNT(*) AS duplicates
FROM serial_numbers GROUP BY produit_id,LOWER(TRIM(numero_serie)) HAVING COUNT(*)>1;
SELECT s.id,s.produit_id,s.vente_id FROM serial_numbers s
WHERE s.statut='VENDU' AND NOT EXISTS (SELECT 1 FROM ventes v WHERE v.id=s.vente_id);
SELECT s.id,s.produit_id,s.vente_id FROM serial_numbers s
WHERE s.statut='RESERVE_AVANCE' AND NOT EXISTS (
 SELECT 1 FROM avances_clients a WHERE a.dossier_id=s.vente_id AND a.statut IN ('EN_COURS','SOLDE')
);
SELECT p.id,p.stock_actuel,
 SUM(CASE WHEN s.statut IN ('EN_STOCK','RESERVE_AVANCE') THEN 1 ELSE 0 END) AS available_and_reserved_serials
FROM produits p LEFT JOIN serial_numbers s ON s.produit_id=p.id
WHERE p.has_serial_number=1 GROUP BY p.id
HAVING p.stock_actuel!=SUM(CASE WHEN s.statut IN ('EN_STOCK','RESERVE_AVANCE') THEN 1 ELSE 0 END);
SELECT id,stock_actuel FROM produits WHERE stock_actuel<0;

-- JSON quality. Marker JSON in notes needs a separate parser, not json_valid(note).
SELECT 'ventes_en_ligne.produits_json' AS field,id FROM ventes_en_ligne WHERE NOT json_valid(produits_json)
UNION ALL SELECT 'saved_paniers.payload_json',id FROM saved_paniers WHERE NOT json_valid(payload_json)
UNION ALL SELECT 'avances_clients.produits_json',id FROM avances_clients WHERE produits_json IS NOT NULL AND NOT json_valid(produits_json)
UNION ALL SELECT 'documents.contenu_json',id FROM documents WHERE contenu_json IS NOT NULL AND NOT json_valid(contenu_json);

-- Deposit root/group consistency, preserving every receipt independently.
SELECT dossier_id,COUNT(*) AS receipts,MIN(client_id) AS min_client,MAX(client_id) AS max_client,
 SUM(CAST(ROUND(montant*1000) AS INTEGER)) AS received_millimes,MAX(prix_produit) AS dossier_price
FROM avances_clients GROUP BY dossier_id;
SELECT a.id,a.dossier_id FROM avances_clients a
WHERE a.type_avance='PRODUIT' AND NOT EXISTS (SELECT 1 FROM avances_clients r WHERE r.id=a.dossier_id);

-- Cash journals: compare stored totals with detail; legacy adjustments may explain differences.
SELECT c.id,c.date_journal,c.total_entrees,c.total_sorties,
 COALESCE(SUM(CASE WHEN m.type='ENTREE' THEN m.montant ELSE 0 END),0) AS movement_entries,
 COALESCE(SUM(CASE WHEN m.type='SORTIE' THEN m.montant ELSE 0 END),0) AS movement_exits
FROM caisse_interne c LEFT JOIN mouvements_caisse_interne m ON m.date_journal=c.date_journal
GROUP BY c.id HAVING ABS(c.total_entrees-COALESCE(SUM(CASE WHEN m.type='ENTREE' THEN m.montant ELSE 0 END),0))>0.001
OR ABS(c.total_sorties-COALESCE(SUM(CASE WHEN m.type='SORTIE' THEN m.montant ELSE 0 END),0))>0.001;
SELECT id,date_journal,solde_ouverture,total_entrees,total_sorties,
 ROUND(solde_ouverture+total_entrees-total_sorties,3) AS stored_closing_balance FROM caisse_interne ORDER BY date_journal;

SELECT table_name,operation,attempts,COUNT(*) AS rows
FROM sync_queue WHERE synced_at IS NULL GROUP BY table_name,operation,attempts;

