# SQL write-path source inventory

Lexical candidates across desktop, Android, web-admin, integration and Supabase source. These are source locations, not proof that a statement runs. ON CONFLICT clauses, comments and dynamic SQL require contextual review. The nearest preceding IPC handler is a navigation aid, not call-graph attribution; helpers can serve several handlers.

| Source | SQL operation | Table / expression | Nearest preceding IPC handler |
|---|---|---|---|
| [src/main/dataPaths.ts:34](../../src/main/dataPaths.ts#L34) | UPDATE | `uses` | `outside IPC / other source` |
| [src/main/db.ts:436](../../src/main/db.ts#L436) | INSERT OR IGNORE INTO | `operateurs` | `outside IPC / other source` |
| [src/main/db.ts:441](../../src/main/db.ts#L441) | INSERT OR IGNORE INTO | `categories` | `outside IPC / other source` |
| [src/main/db.ts:459](../../src/main/db.ts#L459) | INSERT OR IGNORE INTO | `services_pos` | `outside IPC / other source` |
| [src/main/db.ts:497](../../src/main/db.ts#L497) | UPDATE | `shifts` | `outside IPC / other source` |
| [src/main/db.ts:899](../../src/main/db.ts#L899) | UPDATE | `serial_numbers` | `outside IPC / other source` |
| [src/main/db.ts:966](../../src/main/db.ts#L966) | UPDATE | `avances_clients` | `outside IPC / other source` |
| [src/main/db.ts:967](../../src/main/db.ts#L967) | UPDATE | `avances_clients` | `outside IPC / other source` |
| [src/main/db.ts:996](../../src/main/db.ts#L996) | INSERT OR IGNORE INTO | `reparations` | `outside IPC / other source` |
| [src/main/db.ts:1005](../../src/main/db.ts#L1005) | INSERT OR IGNORE INTO | `reparation_status_history` | `outside IPC / other source` |
| [src/main/db.ts:1027](../../src/main/db.ts#L1027) | INSERT INTO | `app_settings` | `outside IPC / other source` |
| [src/main/db.ts:1054](../../src/main/db.ts#L1054) | UPDATE | `produits` | `outside IPC / other source` |
| [src/main/db.ts:1059](../../src/main/db.ts#L1059) | INSERT OR IGNORE INTO | `categories` | `outside IPC / other source` |
| [src/main/db.ts:1125](../../src/main/db.ts#L1125) | INSERT OR IGNORE INTO | `app_settings` | `outside IPC / other source` |
| [src/main/db.ts:1131](../../src/main/db.ts#L1131) | INSERT OR REPLACE INTO | `app_settings` | `outside IPC / other source` |
| [src/main/factoryReset.ts:25](../../src/main/factoryReset.ts#L25) | DELETE FROM | `${name}` | `outside IPC / other source` |
| [src/main/index.ts:222](../../src/main/index.ts#L222) | INSERT INTO | `activity_logs` | `outside IPC / other source` |
| [src/main/index.ts:241](../../src/main/index.ts#L241) | DELETE FROM | `sync_queue` | `outside IPC / other source` |
| [src/main/index.ts:245](../../src/main/index.ts#L245) | INSERT INTO | `sync_queue` | `outside IPC / other source` |
| [src/main/index.ts:312](../../src/main/index.ts#L312) | UPDATE | `ventes` | `outside IPC / other source` |
| [src/main/index.ts:321](../../src/main/index.ts#L321) | UPDATE | `ventes` | `outside IPC / other source` |
| [src/main/index.ts:329](../../src/main/index.ts#L329) | UPDATE | `lignes_vente` | `outside IPC / other source` |
| [src/main/index.ts:335](../../src/main/index.ts#L335) | UPDATE | `documents` | `outside IPC / other source` |
| [src/main/index.ts:350](../../src/main/index.ts#L350) | UPDATE | `lignes_document` | `outside IPC / other source` |
| [src/main/index.ts:384](../../src/main/index.ts#L384) | INSERT OR IGNORE INTO | `inventory_repair_ledger` | `outside IPC / other source` |
| [src/main/index.ts:394](../../src/main/index.ts#L394) | UPDATE | `serial_numbers` | `outside IPC / other source` |
| [src/main/index.ts:407](../../src/main/index.ts#L407) | UPDATE | `produits` | `outside IPC / other source` |
| [src/main/index.ts:423](../../src/main/index.ts#L423) | UPDATE | `serial_numbers` | `outside IPC / other source` |
| [src/main/index.ts:479](../../src/main/index.ts#L479) | DELETE FROM | `mouvements_caisse_interne` | `outside IPC / other source` |
| [src/main/index.ts:481](../../src/main/index.ts#L481) | UPDATE | `caisse_interne` | `outside IPC / other source` |
| [src/main/index.ts:491](../../src/main/index.ts#L491) | UPDATE | `mouvements_tresorerie_attente` | `outside IPC / other source` |
| [src/main/index.ts:496](../../src/main/index.ts#L496) | UPDATE | `mouvements_caisse_interne` | `outside IPC / other source` |
| [src/main/index.ts:497](../../src/main/index.ts#L497) | UPDATE | `caisse_interne` | `outside IPC / other source` |
| [src/main/index.ts:501](../../src/main/index.ts#L501) | UPDATE | `mouvements_tresorerie_attente` | `outside IPC / other source` |
| [src/main/index.ts:551](../../src/main/index.ts#L551) | UPDATE | `mouvements_tresorerie_attente` | `outside IPC / other source` |
| [src/main/index.ts:555](../../src/main/index.ts#L555) | UPDATE | `mouvements_caisse_interne` | `outside IPC / other source` |
| [src/main/index.ts:556](../../src/main/index.ts#L556) | UPDATE | `caisse_interne` | `outside IPC / other source` |
| [src/main/index.ts:726](../../src/main/index.ts#L726) | INSERT OR IGNORE INTO | `caisse_interne` | `outside IPC / other source` |
| [src/main/index.ts:736](../../src/main/index.ts#L736) | UPDATE | `caisse_interne` | `outside IPC / other source` |
| [src/main/index.ts:763](../../src/main/index.ts#L763) | INSERT OR IGNORE INTO | `mouvements_tresorerie_attente` | `outside IPC / other source` |
| [src/main/index.ts:798](../../src/main/index.ts#L798) | INSERT OR IGNORE INTO | `mouvements_caisse_interne` | `outside IPC / other source` |
| [src/main/index.ts:801](../../src/main/index.ts#L801) | UPDATE | `mouvements_tresorerie_attente` | `outside IPC / other source` |
| [src/main/index.ts:848](../../src/main/index.ts#L848) | INSERT OR IGNORE INTO | `saved_paniers` | `outside IPC / other source` |
| [src/main/index.ts:853](../../src/main/index.ts#L853) | INSERT INTO | `saved_paniers` | `outside IPC / other source` |
| [src/main/index.ts:909](../../src/main/index.ts#L909) | DELETE FROM | `saved_paniers` | `savedPaniers:delete` |
| [src/main/index.ts:913](../../src/main/index.ts#L913) | UPDATE | `cannot` | `savedPaniers:delete` |
| [src/main/index.ts:931](../../src/main/index.ts#L931) | DELETE FROM | `saved_paniers` | `posCartDraft:save` |
| [src/main/index.ts:947](../../src/main/index.ts#L947) | DELETE FROM | `saved_paniers` | `posCartDraft:clear` |
| [src/main/index.ts:1215](../../src/main/index.ts#L1215) | INSERT INTO | `operateurs` | `operateurs:upsert` |
| [src/main/index.ts:1266](../../src/main/index.ts#L1266) | INSERT INTO | `shifts` | `shifts:open` |
| [src/main/index.ts:1292](../../src/main/index.ts#L1292) | UPDATE | `shifts` | `shifts:close` |
| [src/main/index.ts:1316](../../src/main/index.ts#L1316) | INSERT INTO | `rapports_caisse` | `shifts:close` |
| [src/main/index.ts:1608](../../src/main/index.ts#L1608) | UPDATE | `documents` | `documents:createDailyFactureF` |
| [src/main/index.ts:1646](../../src/main/index.ts#L1646) | INSERT OR REPLACE INTO | `app_settings` | `documents:createDailyFactureF` |
| [src/main/index.ts:1732](../../src/main/index.ts#L1732) | DELETE FROM | `lignes_document` | `documents:createDailyFactureF` |
| [src/main/index.ts:1734](../../src/main/index.ts#L1734) | UPDATE | `documents` | `documents:createDailyFactureF` |
| [src/main/index.ts:1744](../../src/main/index.ts#L1744) | INSERT INTO | `documents` | `documents:createDailyFactureF` |
| [src/main/index.ts:1749](../../src/main/index.ts#L1749) | INSERT INTO | `lignes_document` | `documents:createDailyFactureF` |
| [src/main/index.ts:1941](../../src/main/index.ts#L1941) | INSERT INTO | `produits` | `produits:create` |
| [src/main/index.ts:1994](../../src/main/index.ts#L1994) | UPDATE | `produits` | `produits:update` |
| [src/main/index.ts:2010](../../src/main/index.ts#L2010) | DELETE FROM | `serial_numbers` | `produits:update` |
| [src/main/index.ts:2026](../../src/main/index.ts#L2026) | UPDATE | `produits` | `produits:delete` |
| [src/main/index.ts:2033](../../src/main/index.ts#L2033) | UPDATE | `produits` | `produits:adjustStock` |
| [src/main/index.ts:2125](../../src/main/index.ts#L2125) | INSERT INTO | `serial_numbers` | `produits:adjustStock` |
| [src/main/index.ts:2136](../../src/main/index.ts#L2136) | UPDATE | `produits` | `produits:adjustStock` |
| [src/main/index.ts:2168](../../src/main/index.ts#L2168) | DELETE FROM | `serial_numbers` | `produits:adjustStock` |
| [src/main/index.ts:2171](../../src/main/index.ts#L2171) | UPDATE | `produits` | `produits:adjustStock` |
| [src/main/index.ts:2183](../../src/main/index.ts#L2183) | UPDATE | `produits` | `produits:adjustStock` |
| [src/main/index.ts:2187](../../src/main/index.ts#L2187) | UPDATE | `produits` | `produits:adjustStock` |
| [src/main/index.ts:2194](../../src/main/index.ts#L2194) | UPDATE | `produits` | `produits:adjustStock` |
| [src/main/index.ts:2198](../../src/main/index.ts#L2198) | UPDATE | `serial_numbers` | `produits:adjustStock` |
| [src/main/index.ts:2205](../../src/main/index.ts#L2205) | UPDATE | `serial_numbers` | `produits:adjustStock` |
| [src/main/index.ts:2267](../../src/main/index.ts#L2267) | UPDATE | `produits` | `produits:adjustStock` |
| [src/main/index.ts:2268](../../src/main/index.ts#L2268) | UPDATE | `produits` | `produits:adjustStock` |
| [src/main/index.ts:2276](../../src/main/index.ts#L2276) | UPDATE | `serial_numbers` | `produits:adjustStock` |
| [src/main/index.ts:2327](../../src/main/index.ts#L2327) | INSERT INTO | `serial_numbers` | `produits:adjustStock` |
| [src/main/index.ts:2334](../../src/main/index.ts#L2334) | UPDATE | `produits` | `produits:adjustStock` |
| [src/main/index.ts:2359](../../src/main/index.ts#L2359) | DELETE FROM | `serial_numbers` | `serialNumbers:bulkSet` |
| [src/main/index.ts:2361](../../src/main/index.ts#L2361) | INSERT INTO | `serial_numbers` | `serialNumbers:bulkSet` |
| [src/main/index.ts:2367](../../src/main/index.ts#L2367) | UPDATE | `produits` | `serialNumbers:bulkSet` |
| [src/main/index.ts:2381](../../src/main/index.ts#L2381) | INSERT OR REPLACE INTO | `produits` | `produits:bulkInsert` |
| [src/main/index.ts:2411](../../src/main/index.ts#L2411) | INSERT INTO | `produits` | `produits:bulkImport` |
| [src/main/index.ts:2418](../../src/main/index.ts#L2418) | UPDATE | `produits` | `produits:bulkImport` |
| [src/main/index.ts:2552](../../src/main/index.ts#L2552) | INSERT INTO | `ventes` | `ventes:create` |
| [src/main/index.ts:2560](../../src/main/index.ts#L2560) | INSERT INTO | `lignes_vente` | `ventes:create` |
| [src/main/index.ts:2583](../../src/main/index.ts#L2583) | UPDATE | `serial_numbers` | `ventes:create` |
| [src/main/index.ts:2597](../../src/main/index.ts#L2597) | INSERT OR IGNORE INTO | `inventory_repair_ledger` | `ventes:create` |
| [src/main/index.ts:2605](../../src/main/index.ts#L2605) | INSERT INTO | `mouvements_fidelite` | `ventes:create` |
| [src/main/index.ts:2627](../../src/main/index.ts#L2627) | UPDATE | `clients` | `ventes:create` |
| [src/main/index.ts:2630](../../src/main/index.ts#L2630) | UPDATE | `avances_clients` | `ventes:create` |
| [src/main/index.ts:2714](../../src/main/index.ts#L2714) | INSERT INTO | `reparations` | `reparations:create` |
| [src/main/index.ts:2722](../../src/main/index.ts#L2722) | INSERT INTO | `pieces_reparation` | `reparations:create` |
| [src/main/index.ts:2725](../../src/main/index.ts#L2725) | UPDATE | `produits` | `reparations:create` |
| [src/main/index.ts:2759](../../src/main/index.ts#L2759) | UPDATE | `pieces_reparation` | `reparations:applyDegatPrices` |
| [src/main/index.ts:2771](../../src/main/index.ts#L2771) | UPDATE | `reparations` | `reparations:applyDegatPrices` |
| [src/main/index.ts:2852](../../src/main/index.ts#L2852) | UPDATE | `reparations` | `reparations:updateStatut` |
| [src/main/index.ts:2867](../../src/main/index.ts#L2867) | UPDATE | `reparations` | `reparations:finalize` |
| [src/main/index.ts:2905](../../src/main/index.ts#L2905) | UPDATE | `reparations` | `reparations:markPayment` |
| [src/main/index.ts:2910](../../src/main/index.ts#L2910) | UPDATE | `reparations` | `reparations:markPayment` |
| [src/main/index.ts:2953](../../src/main/index.ts#L2953) | INSERT INTO | `mouvements_caisse_interne` | `sorties:create` |
| [src/main/index.ts:2963](../../src/main/index.ts#L2963) | INSERT INTO | `sorties_caisse` | `sorties:create` |
| [src/main/index.ts:2989](../../src/main/index.ts#L2989) | INSERT INTO | `activity_logs` | `logs:add` |
| [src/main/index.ts:3125](../../src/main/index.ts#L3125) | INSERT INTO | `transactions_services` | `transactionsServices:create` |
| [src/main/index.ts:3230](../../src/main/index.ts#L3230) | INSERT INTO | `demandes_clients` | `demandesClients:create` |
| [src/main/index.ts:3251](../../src/main/index.ts#L3251) | UPDATE | `demandes_clients` | `demandesClients:updateStatus` |
| [src/main/index.ts:3271](../../src/main/index.ts#L3271) | INSERT OR IGNORE INTO | `categories` | `categories:create` |
| [src/main/index.ts:3300](../../src/main/index.ts#L3300) | INSERT INTO | `factures_clients` | `facturesClients:create` |
| [src/main/index.ts:3350](../../src/main/index.ts#L3350) | INSERT INTO | `fournisseurs` | `fournisseurs:create` |
| [src/main/index.ts:3360](../../src/main/index.ts#L3360) | UPDATE | `fournisseurs` | `fournisseurs:update` |
| [src/main/index.ts:3377](../../src/main/index.ts#L3377) | INSERT INTO | `fournisseur_commerciaux` | `fournisseurCommerciaux:create` |
| [src/main/index.ts:3385](../../src/main/index.ts#L3385) | INSERT OR IGNORE INTO | `fournisseur_commerciaux` | `fournisseurCommerciaux:bulkCreate` |
| [src/main/index.ts:3415](../../src/main/index.ts#L3415) | INSERT INTO | `factures_fournisseurs` | `facturesFournisseurs:create` |
| [src/main/index.ts:3423](../../src/main/index.ts#L3423) | INSERT INTO | `lignes_facture_fournisseur` | `facturesFournisseurs:create` |
| [src/main/index.ts:3428](../../src/main/index.ts#L3428) | UPDATE | `produits` | `facturesFournisseurs:create` |
| [src/main/index.ts:3429](../../src/main/index.ts#L3429) | UPDATE | `produits` | `facturesFournisseurs:create` |
| [src/main/index.ts:3430](../../src/main/index.ts#L3430) | UPDATE | `produits` | `facturesFournisseurs:create` |
| [src/main/index.ts:3431](../../src/main/index.ts#L3431) | UPDATE | `fournisseurs` | `facturesFournisseurs:create` |
| [src/main/index.ts:3463](../../src/main/index.ts#L3463) | DELETE FROM | `lignes_facture_fournisseur` | `facturesFournisseurs:create` |
| [src/main/index.ts:3464](../../src/main/index.ts#L3464) | DELETE FROM | `factures_fournisseurs` | `facturesFournisseurs:create` |
| [src/main/index.ts:3515](../../src/main/index.ts#L3515) | UPDATE | `factures_fournisseurs` | `facturesFournisseurs:annuler` |
| [src/main/index.ts:3516](../../src/main/index.ts#L3516) | UPDATE | `fournisseurs` | `facturesFournisseurs:annuler` |
| [src/main/index.ts:3553](../../src/main/index.ts#L3553) | UPDATE | `factures_fournisseurs` | `facturesFournisseurs:update` |
| [src/main/index.ts:3568](../../src/main/index.ts#L3568) | INSERT INTO | `lignes_facture_fournisseur` | `facturesFournisseurs:replaceLignes` |
| [src/main/index.ts:3580](../../src/main/index.ts#L3580) | DELETE FROM | `lignes_facture_fournisseur` | `facturesFournisseurs:replaceLignes` |
| [src/main/index.ts:3603](../../src/main/index.ts#L3603) | UPDATE | `factures_fournisseurs` | `facturesFournisseurs:replaceLignes` |
| [src/main/index.ts:3631](../../src/main/index.ts#L3631) | UPDATE | `produits` | `facturesFournisseurs:marquerRecu` |
| [src/main/index.ts:3632](../../src/main/index.ts#L3632) | UPDATE | `produits` | `facturesFournisseurs:marquerRecu` |
| [src/main/index.ts:3633](../../src/main/index.ts#L3633) | UPDATE | `produits` | `facturesFournisseurs:marquerRecu` |
| [src/main/index.ts:3640](../../src/main/index.ts#L3640) | UPDATE | `the` | `facturesFournisseurs:marquerRecu` |
| [src/main/index.ts:3656](../../src/main/index.ts#L3656) | UPDATE | `factures_fournisseurs` | `facturesFournisseurs:marquerRecu` |
| [src/main/index.ts:3725](../../src/main/index.ts#L3725) | INSERT INTO | `factures_fournisseurs` | `facturesFournisseurs:saveDraft` |
| [src/main/index.ts:3752](../../src/main/index.ts#L3752) | DELETE FROM | `lignes_facture_fournisseur` | `facturesFournisseurs:saveDraft` |
| [src/main/index.ts:3754](../../src/main/index.ts#L3754) | INSERT INTO | `lignes_facture_fournisseur` | `facturesFournisseurs:saveDraft` |
| [src/main/index.ts:3808](../../src/main/index.ts#L3808) | DELETE FROM | `lignes_facture_fournisseur` | `facturesFournisseurs:deleteDraft` |
| [src/main/index.ts:3809](../../src/main/index.ts#L3809) | DELETE FROM | `factures_fournisseurs` | `facturesFournisseurs:deleteDraft` |
| [src/main/index.ts:3844](../../src/main/index.ts#L3844) | INSERT INTO | `paiements_fournisseurs` | `paiementsFournisseurs:create` |
| [src/main/index.ts:3850](../../src/main/index.ts#L3850) | UPDATE | `factures_fournisseurs` | `paiementsFournisseurs:create` |
| [src/main/index.ts:3857](../../src/main/index.ts#L3857) | UPDATE | `fournisseurs` | `paiementsFournisseurs:create` |
| [src/main/index.ts:3864](../../src/main/index.ts#L3864) | INSERT INTO | `mouvements_caisse_interne` | `paiementsFournisseurs:create` |
| [src/main/index.ts:3869](../../src/main/index.ts#L3869) | INSERT INTO | `sorties_caisse` | `paiementsFournisseurs:create` |
| [src/main/index.ts:3913](../../src/main/index.ts#L3913) | INSERT INTO | `ajustements_fournisseurs` | `ajustementsFournisseurs:create` |
| [src/main/index.ts:3915](../../src/main/index.ts#L3915) | UPDATE | `fournisseurs` | `ajustementsFournisseurs:create` |
| [src/main/index.ts:3917](../../src/main/index.ts#L3917) | INSERT INTO | `mouvements_caisse_interne` | `ajustementsFournisseurs:create` |
| [src/main/index.ts:3922](../../src/main/index.ts#L3922) | INSERT INTO | `sorties_caisse` | `ajustementsFournisseurs:create` |
| [src/main/index.ts:3941](../../src/main/index.ts#L3941) | INSERT OR IGNORE INTO | `caisse_interne` | `caisseInterne:getToday` |
| [src/main/index.ts:4006](../../src/main/index.ts#L4006) | INSERT INTO | `mouvements_caisse_interne` | `caisseInterne:addMouvement` |
| [src/main/index.ts:4010](../../src/main/index.ts#L4010) | UPDATE | `caisse_interne` | `caisseInterne:addMouvement` |
| [src/main/index.ts:4011](../../src/main/index.ts#L4011) | UPDATE | `caisse_interne` | `caisseInterne:addMouvement` |
| [src/main/index.ts:4056](../../src/main/index.ts#L4056) | UPDATE | `shifts` | `caisseInterne:transferShift` |
| [src/main/index.ts:4076](../../src/main/index.ts#L4076) | UPDATE | `shifts` | `caisseInterne:transferShift` |
| [src/main/index.ts:4090](../../src/main/index.ts#L4090) | UPDATE | `shifts` | `caisseInterne:transferShift` |
| [src/main/index.ts:4110](../../src/main/index.ts#L4110) | INSERT INTO | `ventes_en_ligne` | `ventesLigne:create` |
| [src/main/index.ts:4134](../../src/main/index.ts#L4134) | INSERT INTO | `sorties_caisse` | `ventesLigne:updateStatut` |
| [src/main/index.ts:4142](../../src/main/index.ts#L4142) | UPDATE | `produits` | `ventesLigne:updateStatut` |
| [src/main/index.ts:4149](../../src/main/index.ts#L4149) | UPDATE | `ventes_en_ligne` | `ventesLigne:updateStatut` |
| [src/main/index.ts:4150](../../src/main/index.ts#L4150) | UPDATE | `ventes_en_ligne` | `ventesLigne:updateStatut` |
| [src/main/index.ts:4162](../../src/main/index.ts#L4162) | INSERT INTO | `mouvements_caisse_interne` | `ventesLigne:updateStatut` |
| [src/main/index.ts:4164](../../src/main/index.ts#L4164) | UPDATE | `caisse_interne` | `ventesLigne:updateStatut` |
| [src/main/index.ts:4165](../../src/main/index.ts#L4165) | UPDATE | `ventes_en_ligne` | `ventesLigne:updateStatut` |
| [src/main/index.ts:4182](../../src/main/index.ts#L4182) | UPDATE | `produits` | `ventesLigne:updateStatut` |
| [src/main/index.ts:4188](../../src/main/index.ts#L4188) | UPDATE | `ventes_en_ligne` | `ventesLigne:updateStatut` |
| [src/main/index.ts:4223](../../src/main/index.ts#L4223) | INSERT INTO | `clients` | `clients:create` |
| [src/main/index.ts:4249](../../src/main/index.ts#L4249) | INSERT INTO | `credits_clients` | `clients:create` |
| [src/main/index.ts:4251](../../src/main/index.ts#L4251) | UPDATE | `clients` | `clients:create` |
| [src/main/index.ts:4262](../../src/main/index.ts#L4262) | UPDATE | `clients` | `clients:update` |
| [src/main/index.ts:4293](../../src/main/index.ts#L4293) | UPDATE | `clients` | `fidelite:assignCard` |
| [src/main/index.ts:4345](../../src/main/index.ts#L4345) | INSERT INTO | `credits_clients` | `credits:create` |
| [src/main/index.ts:4346](../../src/main/index.ts#L4346) | UPDATE | `clients` | `credits:create` |
| [src/main/index.ts:4348](../../src/main/index.ts#L4348) | UPDATE | `produits` | `credits:create` |
| [src/main/index.ts:4351](../../src/main/index.ts#L4351) | UPDATE | `shifts` | `credits:create` |
| [src/main/index.ts:4354](../../src/main/index.ts#L4354) | UPDATE | `organisations` | `credits:create` |
| [src/main/index.ts:4387](../../src/main/index.ts#L4387) | UPDATE | `produits` | `credits:update` |
| [src/main/index.ts:4389](../../src/main/index.ts#L4389) | UPDATE | `credits_clients` | `credits:update` |
| [src/main/index.ts:4394](../../src/main/index.ts#L4394) | UPDATE | `clients` | `credits:update` |
| [src/main/index.ts:4397](../../src/main/index.ts#L4397) | UPDATE | `shifts` | `credits:update` |
| [src/main/index.ts:4400](../../src/main/index.ts#L4400) | UPDATE | `organisations` | `credits:update` |
| [src/main/index.ts:4461](../../src/main/index.ts#L4461) | UPDATE | `serial_numbers` | `credits:update` |
| [src/main/index.ts:4464](../../src/main/index.ts#L4464) | INSERT INTO | `ventes` | `credits:update` |
| [src/main/index.ts:4465](../../src/main/index.ts#L4465) | INSERT INTO | `lignes_vente` | `credits:update` |
| [src/main/index.ts:4467](../../src/main/index.ts#L4467) | INSERT INTO | `documents` | `credits:update` |
| [src/main/index.ts:4468](../../src/main/index.ts#L4468) | INSERT INTO | `lignes_document` | `credits:update` |
| [src/main/index.ts:4470](../../src/main/index.ts#L4470) | UPDATE | `avances_clients` | `credits:update` |
| [src/main/index.ts:4603](../../src/main/index.ts#L4603) | UPDATE | `serial_numbers` | `avancesClients:create` |
| [src/main/index.ts:4608](../../src/main/index.ts#L4608) | INSERT INTO | `avances_clients` | `avancesClients:create` |
| [src/main/index.ts:4611](../../src/main/index.ts#L4611) | UPDATE | `avances_clients` | `avancesClients:create` |
| [src/main/index.ts:4653](../../src/main/index.ts#L4653) | INSERT OR REPLACE INTO | `app_settings` | `settings:set` |
| [src/main/index.ts:4662](../../src/main/index.ts#L4662) | INSERT OR REPLACE INTO | `app_settings` | `settings:setMany` |
| [src/main/index.ts:4694](../../src/main/index.ts#L4694) | INSERT INTO | `retours` | `retours:create` |
| [src/main/index.ts:4696](../../src/main/index.ts#L4696) | UPDATE | `produits` | `retours:create` |
| [src/main/index.ts:4704](../../src/main/index.ts#L4704) | INSERT INTO | `sorties_caisse` | `retours:create` |
| [src/main/index.ts:4723](../../src/main/index.ts#L4723) | UPDATE | `retours` | `retours:updateStatut` |
| [src/main/index.ts:4832](../../src/main/index.ts#L4832) | INSERT INTO | `lignes_document` | `retours:updateStatut` |
| [src/main/index.ts:4837](../../src/main/index.ts#L4837) | UPDATE | `documents` | `retours:updateStatut` |
| [src/main/index.ts:4980](../../src/main/index.ts#L4980) | DELETE FROM | `lignes_vente` | `ventes:exchange` |
| [src/main/index.ts:4982](../../src/main/index.ts#L4982) | INSERT INTO | `lignes_vente` | `ventes:exchange` |
| [src/main/index.ts:4987](../../src/main/index.ts#L4987) | UPDATE | `ventes` | `ventes:exchange` |
| [src/main/index.ts:4991](../../src/main/index.ts#L4991) | INSERT INTO | `mouvements_echange` | `ventes:exchange` |
| [src/main/index.ts:5017](../../src/main/index.ts#L5017) | DELETE FROM | `lignes_document` | `ventes:exchange` |
| [src/main/index.ts:5019](../../src/main/index.ts#L5019) | INSERT INTO | `lignes_document` | `ventes:exchange` |
| [src/main/index.ts:5025](../../src/main/index.ts#L5025) | UPDATE | `documents` | `ventes:exchange` |
| [src/main/index.ts:5050](../../src/main/index.ts#L5050) | UPDATE | `factures_clients` | `ventes:exchange` |
| [src/main/index.ts:5106](../../src/main/index.ts#L5106) | UPDATE | `ventes` | `ventes:annuler` |
| [src/main/index.ts:5108](../../src/main/index.ts#L5108) | INSERT OR IGNORE INTO | `remboursements_ventes` | `ventes:annuler` |
| [src/main/index.ts:5124](../../src/main/index.ts#L5124) | UPDATE | `avances_clients` | `ventes:annuler` |
| [src/main/index.ts:5127](../../src/main/index.ts#L5127) | UPDATE | `serial_numbers` | `ventes:annuler` |
| [src/main/index.ts:5134](../../src/main/index.ts#L5134) | UPDATE | `documents` | `ventes:annuler` |
| [src/main/index.ts:5147](../../src/main/index.ts#L5147) | INSERT INTO | `mouvements_fidelite` | `ventes:annuler` |
| [src/main/index.ts:5163](../../src/main/index.ts#L5163) | UPDATE | `clients` | `ventes:annuler` |
| [src/main/index.ts:5213](../../src/main/index.ts#L5213) | INSERT INTO | `organisations` | `organisations:create` |
| [src/main/index.ts:5220](../../src/main/index.ts#L5220) | UPDATE | `organisations` | `organisations:update` |
| [src/main/index.ts:5226](../../src/main/index.ts#L5226) | UPDATE | `organisations` | `organisations:delete` |
| [src/main/index.ts:5259](../../src/main/index.ts#L5259) | INSERT INTO | `personnels` | `personnels:create` |
| [src/main/index.ts:5276](../../src/main/index.ts#L5276) | UPDATE | `personnels` | `personnels:update` |
| [src/main/index.ts:5282](../../src/main/index.ts#L5282) | UPDATE | `personnels` | `personnels:delete` |
| [src/main/index.ts:5333](../../src/main/index.ts#L5333) | INSERT INTO | `mouvements_personnels` | `mouvementsPersonnels:create` |
| [src/main/index.ts:5337](../../src/main/index.ts#L5337) | UPDATE | `personnels` | `mouvementsPersonnels:create` |
| [src/main/index.ts:5338](../../src/main/index.ts#L5338) | UPDATE | `personnels` | `mouvementsPersonnels:create` |
| [src/main/index.ts:5339](../../src/main/index.ts#L5339) | UPDATE | `personnels` | `mouvementsPersonnels:create` |
| [src/main/index.ts:5340](../../src/main/index.ts#L5340) | UPDATE | `personnels` | `mouvementsPersonnels:create` |
| [src/main/index.ts:5342](../../src/main/index.ts#L5342) | UPDATE | `produits` | `mouvementsPersonnels:create` |
| [src/main/index.ts:5344](../../src/main/index.ts#L5344) | INSERT INTO | `sorties_caisse` | `mouvementsPersonnels:create` |
| [src/main/index.ts:5348](../../src/main/index.ts#L5348) | INSERT INTO | `mouvements_caisse_interne` | `mouvementsPersonnels:create` |
| [src/main/index.ts:5431](../../src/main/index.ts#L5431) | INSERT INTO | `documents` | `documents:create` |
| [src/main/index.ts:5446](../../src/main/index.ts#L5446) | INSERT INTO | `lignes_document` | `documents:create` |
| [src/main/index.ts:5476](../../src/main/index.ts#L5476) | UPDATE | `documents` | `documents:update` |
| [src/main/index.ts:5534](../../src/main/index.ts#L5534) | INSERT INTO | `lignes_document` | `documents:replaceLignes` |
| [src/main/index.ts:5538](../../src/main/index.ts#L5538) | INSERT INTO | `lignes_vente` | `documents:replaceLignes` |
| [src/main/index.ts:5549](../../src/main/index.ts#L5549) | DELETE FROM | `lignes_vente` | `documents:replaceLignes` |
| [src/main/index.ts:5553](../../src/main/index.ts#L5553) | DELETE FROM | `lignes_document` | `documents:replaceLignes` |
| [src/main/index.ts:5577](../../src/main/index.ts#L5577) | UPDATE | `documents` | `documents:replaceLignes` |
| [src/main/index.ts:5675](../../src/main/index.ts#L5675) | INSERT INTO | `documents` | `documents:annulerAvecAvoir` |
| [src/main/index.ts:5679](../../src/main/index.ts#L5679) | INSERT INTO | `lignes_document` | `documents:annulerAvecAvoir` |
| [src/main/index.ts:5702](../../src/main/index.ts#L5702) | UPDATE | `documents` | `documents:annulerAvecAvoir` |
| [src/main/index.ts:5715](../../src/main/index.ts#L5715) | UPDATE | `ventes` | `documents:annulerAvecAvoir` |
| [src/main/index.ts:5717](../../src/main/index.ts#L5717) | INSERT OR IGNORE INTO | `remboursements_ventes` | `documents:annulerAvecAvoir` |
| [src/main/index.ts:5726](../../src/main/index.ts#L5726) | UPDATE | `avances_clients` | `documents:annulerAvecAvoir` |
| [src/main/index.ts:5728](../../src/main/index.ts#L5728) | UPDATE | `serial_numbers` | `documents:annulerAvecAvoir` |
| [src/main/index.ts:5755](../../src/main/index.ts#L5755) | UPDATE | `documents` | `documents:revoquer` |
| [src/main/index.ts:5926](../../src/main/index.ts#L5926) | UPDATE | `sync_queue` | `sync:queue:markSynced` |
| [src/main/index.ts:5931](../../src/main/index.ts#L5931) | UPDATE | `sync_queue` | `sync:queue:markFailed` |
| [src/main/index.ts:5939](../../src/main/index.ts#L5939) | DELETE FROM | `sync_queue` | `sync:queue:cleanup` |
| [src/main/index.ts:5941](../../src/main/index.ts#L5941) | DELETE FROM | `sync_queue` | `sync:queue:cleanup` |
| [src/main/index.ts:5963](../../src/main/index.ts#L5963) | DELETE FROM | `sync_queue` | `sync:queue:purgeAllFailed` |
| [src/main/index.ts:5971](../../src/main/index.ts#L5971) | UPDATE | `sync_queue` | `sync:queue:resetAllFailed` |
| [src/main/index.ts:5987](../../src/main/index.ts#L5987) | DELETE FROM | `sync_queue` | `sync:queue:purgeAll` |
| [src/main/index.ts:5995](../../src/main/index.ts#L5995) | DELETE FROM | `sync_queue` | `sync:queue:purgeTables` |
| [src/main/index.ts:6002](../../src/main/index.ts#L6002) | DELETE FROM | `sync_queue` | `sync:queue:dedupe` |
| [src/main/r2BackupService.ts:87](../../src/main/r2BackupService.ts#L87) | INSERT INTO | `app_settings` | `outside IPC / other source` |
| [src/main/seedProducts.ts:19](../../src/main/seedProducts.ts#L19) | INSERT OR IGNORE INTO | `produits` | `outside IPC / other source` |
| [src/main/supabaseKeepAlive.ts:20](../../src/main/supabaseKeepAlive.ts#L20) | INSERT INTO | `app_settings` | `outside IPC / other source` |
| [src/main/supabaseKeepAlive.ts:25](../../src/main/supabaseKeepAlive.ts#L25) | DELETE FROM | `app_settings` | `outside IPC / other source` |
| [src/main/syncPull.ts:70](../../src/main/syncPull.ts#L70) | INSERT INTO | `${tableName}` | `outside IPC / other source` |
| [src/main/updater.ts:136](../../src/main/updater.ts#L136) | UPDATE | `modal` | `update:install` |
| [src/renderer/src/components/UpdateModal.tsx:76](../../src/renderer/src/components/UpdateModal.tsx#L76) | UPDATE | `ready` | `outside IPC / other source` |
| [src/renderer/src/components/UpdateModal.tsx:88](../../src/renderer/src/components/UpdateModal.tsx#L88) | UPDATE | `failed` | `outside IPC / other source` |
| [src/renderer/src/modules/documents/DocumentsTab.tsx:223](../../src/renderer/src/modules/documents/DocumentsTab.tsx#L223) | UPDATE | `title` | `outside IPC / other source` |
| [src/renderer/src/modules/retours/RetoursTab.tsx:245](../../src/renderer/src/modules/retours/RetoursTab.tsx#L245) | UPDATE | `status` | `outside IPC / other source` |
| [integrations/smlsite/rls-readonly-smlsite.sql:26](../../integrations/smlsite/rls-readonly-smlsite.sql#L26) | UPDATE | `on` | `outside IPC / other source` |

