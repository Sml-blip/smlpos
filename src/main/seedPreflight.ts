import type Database from 'better-sqlite3'

/** Read-only summary. It never repairs, imports, renumbers or uploads records. */
export function inspectSeedCopy(db: Database.Database) {
  const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>
  const foreignKeyErrors = db.pragma('foreign_key_check') as unknown[]
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{name:string}>
  const rowCounts: Record<string,number> = {}
  const moneyTotals: Record<string,string> = {}
  const warnings: string[] = []
  for(const {name} of tables) {
    if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))throw new Error('Nom de table inattendu : analyse arrêtée')
    rowCounts[name]=Number((db.prepare(`SELECT COUNT(*) n FROM "${name}"`).get() as {n:number}).n)
  }
  if(integrity.some(r=>r.integrity_check!=='ok'))warnings.push('La vérification SQLite a signalé une erreur.')
  if(foreignKeyErrors.length)warnings.push(`${foreignKeyErrors.length} référence(s) SQLite à examiner.`)
  const moneyColumns: Array<[string,string]> = [['ventes','total_ttc'],['documents','total_ttc'],['factures_clients','total_ttc'],['paiements_fournisseurs','montant'],['credits_clients','montant'],['avances_clients','montant'],['remboursements_ventes','montant']]
  for(const [table,column] of moneyColumns) {
    if(!(table in rowCounts)) {warnings.push(`Table attendue absente : ${table}`);continue}
    const value=db.prepare(`SELECT COALESCE(SUM(CAST(ROUND(COALESCE("${column}",0)*1000) AS INTEGER)),0) AS amount FROM "${table}"`).safeIntegers(true).get() as {amount:number|bigint}
    moneyTotals[`${table}.${column}`]=String(value.amount)
  }
  if('serial_numbers' in rowCounts) {
    const duplicates=db.prepare(`SELECT COUNT(*) n FROM (SELECT produit_id,lower(trim(numero_serie)) FROM serial_numbers GROUP BY produit_id,lower(trim(numero_serie)) HAVING COUNT(*)>1)`).get() as {n:number}
    if(duplicates.n)warnings.push(`${duplicates.n} doublon(s) de numéros de série à examiner.`)
  }
  if('clients' in rowCounts) {
    const debt=db.prepare(`SELECT COUNT(*) n FROM clients c WHERE ABS(COALESCE(c.solde_credit,0)-COALESCE((SELECT SUM(CASE WHEN type='CREDIT' THEN montant ELSE -montant END) FROM credits_clients WHERE client_id=c.id),0))>0.001`).get() as {n:number}
    if(debt.n)warnings.push(`${debt.n} solde(s) client différent(s) de l'historique : ouverture à justifier.`)
  }
  return {createdAt:new Date().toISOString(),tableCount:tables.length,rowCounts,moneyTotalsMillimes:moneyTotals,foreignKeyErrorCount:foreignKeyErrors.length,integrityOk:integrity.every(r=>r.integrity_check==='ok'),warnings,importEnabled:false as const,stage:'preflight_only' as const}
}

