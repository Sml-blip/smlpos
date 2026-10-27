# Existing normal-sync coverage

Source comparison only. Whitelist presence does not prove every write enqueues or every remote table exists. An absent whitelist entry passes payloads through unchanged in stripPayloadForRemote; it does not mean upload is forbidden. The main bootstrap allowlist must also permit the table. The separate bootstrap upload does not use this ordinary whitelist.

29 local tables are in the pull allowlist; 14 are absent.

| Table | Pull allowed | Explicit push column whitelist | Local columns missing from push whitelist |
|---|---|---|---|
| `activity_logs` | True | True | — |
| `ajustements_fournisseurs` | False | False | No explicit whitelist entry |
| `app_settings` | True | True | — |
| `avances_clients` | False | False | No explicit whitelist entry |
| `caisse_interne` | True | True | — |
| `categories` | True | True | — |
| `clients` | True | True | — |
| `credits_clients` | True | True | — |
| `demandes_clients` | False | False | No explicit whitelist entry |
| `documents` | True | True | annule_motif, avoir_id, document_origine_id, facture_origine_numero, reference_source_id, revoque_at, revoque_motif, revoque_par |
| `factures_clients` | True | True | — |
| `factures_fournisseurs` | True | True | net_a_payer, retenue_source_montant, retenue_source_pct, stock_applied, updated_at |
| `fournisseur_commerciaux` | False | False | No explicit whitelist entry |
| `fournisseurs` | True | True | — |
| `inventory_repair_ledger` | False | False | No explicit whitelist entry |
| `lignes_document` | True | True | — |
| `lignes_facture_fournisseur` | True | True | numeros_serie_json, pending_product_json |
| `lignes_vente` | True | True | numero_serie |
| `mouvements_caisse_interne` | True | True | — |
| `mouvements_echange` | False | False | No explicit whitelist entry |
| `mouvements_fidelite` | False | False | No explicit whitelist entry |
| `mouvements_personnels` | True | True | — |
| `mouvements_tresorerie_attente` | False | False | No explicit whitelist entry |
| `operateurs` | True | True | — |
| `organisations` | True | True | — |
| `paiements_fournisseurs` | True | True | — |
| `personnels` | True | True | — |
| `pieces_reparation` | True | True | destock_stock, prix_achat |
| `produits` | True | True | source_tag |
| `rapports_caisse` | False | False | No explicit whitelist entry |
| `remboursements_ventes` | False | False | No explicit whitelist entry |
| `reparation_status_history` | False | False | No explicit whitelist entry |
| `reparations` | True | True | estimated_completion, repair_token |
| `retours` | True | True | — |
| `saved_paniers` | False | False | No explicit whitelist entry |
| `serial_numbers` | False | False | No explicit whitelist entry |
| `services_pos` | True | True | — |
| `shifts` | True | True | session_type |
| `sorties_caisse` | True | True | — |
| `sync_queue` | False | False | No explicit whitelist entry |
| `transactions_services` | True | True | — |
| `ventes` | True | True | avance_dossier_id, avance_utilisee, client_id, montant_encaisse_initial, note_vente |
| `ventes_en_ligne` | True | True | — |

Missing local columns can be stripped during normal uploads. On pull, missing remote values are replaced with default expressions or NULL for all local columns; they are not automatically preserved. Excluded local infrastructure is expected, but excluded business histories require a complete migration design.

