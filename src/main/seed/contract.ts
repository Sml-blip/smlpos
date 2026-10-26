import inventory from '../../../docs/data-audit/source-inventory.json' with {type:'json'}

export const LOCAL_TABLES=new Set(['sync_queue','saved_paniers','inventory_repair_ledger'])
export const BUSINESS_TABLES=inventory.tables.filter(table=>!LOCAL_TABLES.has(table.name)).map(table=>table.name)
export const MONEY_COLUMNS=Object.fromEntries(inventory.tables.map(table=>[table.name,table.columns.filter(column=>column.type==='REAL' && !new Set(['tva_taux','tva_taux_principal','tva_achat_pct','marge_pct','coef_av','remise_pct','retenue_source_pct']).has(column.name)).map(column=>column.name)])) as Record<string,string[]>
export const LOCAL_SETTINGS=new Set(['bootstrap_completed_at','bootstrap_last_errors','pull_last_at','backup_folder_path','supabase_keepalive_at','supabase_keepalive_error','sync_backend','device_id','device_name','backend_url','schema_version','seed_role','seed_complete_at'])
export function localSetting(key:string){return LOCAL_SETTINGS.has(key)||/^(r2_|pin_|device_|seed_|sync2_|backup_)/i.test(key)||/(password|secret|token|api_key|private_key)/i.test(key)}
export const TABLE_PRIORITY:Record<string,number>={operateurs:10,categories:10,fournisseurs:10,organisations:10,clients:15,personnels:10,services_pos:10,app_settings:10,shifts:20,produits:30,caisse_interne:30,stock_movements:35,ventes:40,documents:45,factures_fournisseurs:40,reparations:40,ventes_en_ligne:40,lignes_vente:50,lignes_document:50,lignes_facture_fournisseur:50,pieces_reparation:50,factures_clients:50,credits_clients:50,sorties_caisse:50,transactions_services:50,paiements_fournisseurs:50,mouvements_caisse_interne:50,mouvements_personnels:50,retours:50,activity_logs:60}
export const SEED_TABLES=[...BUSINESS_TABLES,'stock_movements'].sort((a,b)=>(TABLE_PRIORITY[a]??50)-(TABLE_PRIORITY[b]??50)||(a<b?-1:a>b?1:0))
export const quote=(value:string)=>{if(!/^[a-z_][a-z0-9_]*$/i.test(value))throw new Error('Invalid SQLite identifier');return `"${value}"`}

