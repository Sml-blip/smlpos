import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
import Database from 'better-sqlite3'
import { installOutbox } from '../outbox'
import { COUNTER_COLUMNS, LOCAL_ONLY_SETTING_KEYS, SECRET_SETTING_FRAGMENTS, syncedTableNames } from '../tables'

const source = readFileSync(resolve('src/main/db.ts'), 'utf8')
// Use every actual CREATE TABLE from the app, plus its additive ALTERs.
function fixture() {
  const db = new Database(':memory:')
  for (const match of source.matchAll(/CREATE TABLE IF NOT EXISTS[\s\S]*?;/g)) db.exec(match[0])
  for (const match of source.matchAll(/ALTER TABLE[^`]+/g)) try { db.exec(match[0]) } catch { /* already present */ }
  return db
}
const outbox = (db: Database.Database) => db.prepare('SELECT * FROM outbox ORDER BY seq').all() as Array<{ seq:number;table_name:string;pk:string;op:string;row_json:string|null;delta_field:string|null;delta_value:number|null }>
function insertFixture(db: Database.Database, table: string) {
  const definition = (db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(table) as {sql:string}).sql
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{name:string;type:string;pk:number;notnull:number;dflt_value:unknown}>
  const values: Record<string, unknown> = {}
  for (const column of columns) if (column.pk || (column.notnull && column.dflt_value === null)) {
    const choices = new RegExp(`${column.name}\\s+IN\\s*\\(\\s*'([^']+)'`, 'i').exec(definition)
    values[column.name] = choices?.[1] ?? (/INT|REAL/i.test(column.type) ? 1 : `fixture-${table}-${column.name}`)
  }
  const names = Object.keys(values)
  db.prepare(`INSERT INTO "${table}" (${names.map(name=>`"${name}"`).join(',')}) VALUES (${names.map(()=>'?').join(',')})`).run(...Object.values(values))
  return String(values[table==='app_settings'?'key':'id'])
}

test('every seeded table has INSERT, UPDATE and DELETE capture using the real app schema', () => {
  const db=fixture()
  try {
    db.pragma('foreign_keys = OFF') // Generic coverage creates deliberately independent fixture rows.
    const names=installOutbox(db)
    assert.deepEqual(names,syncedTableNames((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[]).map(row=>row.name)))
    for (const table of names) {
      for (const suffix of ['insert','update','delete']) assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(`live_${table}_${suffix}`),`${table}:${suffix}`)
      db.exec('DELETE FROM outbox');const pk=insertFixture(db,table);const key=table==='app_settings'?'key':'id'
      db.prepare(`UPDATE "${table}" SET "${key}"="${key}" WHERE "${key}"=?`).run(pk)
      db.prepare(`DELETE FROM "${table}" WHERE "${key}"=?`).run(pk)
      assert.deepEqual(outbox(db).filter(row=>row.table_name===table&&row.pk===pk&&row.op!=='DELTA').map(row=>row.op),['UPSERT','UPSERT','DELETE'],table)
    }
    const before=outbox(db).length;installOutbox(db);assert.equal(outbox(db).length,before)
    assert.equal((db.prepare("SELECT v FROM sync_state WHERE k='outbox_drain_enabled'").get() as {v:string}).v,'0')
  } finally { db.close() }
})

test('counters travel only as deltas; replacement, clamp, A→B→A, mute and rollback are safe', () => {
  const db=fixture()
  try {
    installOutbox(db)
    db.exec("INSERT INTO produits(id,nom,reference,stock_actuel,prix_vente) VALUES('p','Product','P',10,10)")
    db.exec('DELETE FROM outbox')
    db.exec("UPDATE produits SET stock_actuel=8,prix_vente=12 WHERE id='p'; UPDATE produits SET stock_actuel=MAX(0,stock_actuel-20),prix_vente=10 WHERE id='p'")
    assert.deepEqual(outbox(db).filter(row=>row.op==='DELTA').map(row=>row.delta_value),[-2,-8])
    assert.deepEqual(outbox(db).filter(row=>row.op==='UPSERT').map(row=>JSON.parse(row.row_json!).prix_vente),[12,10])
    assert.ok(outbox(db).filter(row=>row.op==='UPSERT').every(row=>!('stock_actuel' in JSON.parse(row.row_json!))))
    db.exec("INSERT OR REPLACE INTO produits(id,nom,reference,stock_actuel,prix_vente) VALUES('p','Product','P',5,10)")
    assert.equal(outbox(db).filter(row=>row.op==='DELTA').at(-1)?.delta_value,5)
    db.exec("INSERT OR REPLACE INTO produits(id,nom,reference,stock_actuel,prix_vente) VALUES('p','Product','P',7,10)")
    assert.equal(outbox(db).filter(row=>row.op==='DELTA').at(-1)?.delta_value,2)
    const checkpoint=outbox(db).length
    assert.throws(()=>db.transaction(()=>{db.exec("UPDATE produits SET stock_actuel=2 WHERE id='p'");throw new Error('sale fails')})(),/sale fails/)
    assert.equal(outbox(db).length,checkpoint)
    db.exec("UPDATE sync_state SET v='1' WHERE k='apply_mute'; UPDATE produits SET stock_actuel=1 WHERE id='p'; UPDATE sync_state SET v='0' WHERE k='apply_mute'")
    assert.equal(outbox(db).length,checkpoint)
    const fixtureIds = new Map<string,string>([['produits','p']])
    for(const [table,counters] of Object.entries(COUNTER_COLUMNS)) for(const field of counters) {
      if(!(db.prepare(`PRAGMA table_info("${table}")`).all() as {name:string}[]).some(column=>column.name===field))continue
      const pk=fixtureIds.get(table)??insertFixture(db,table);fixtureIds.set(table,pk);db.exec('DELETE FROM outbox')
      db.prepare(`UPDATE "${table}" SET "${field}"=COALESCE("${field}",0)+2 WHERE id=?`).run(pk)
      assert.equal(outbox(db).find(row=>row.op==='DELTA'&&row.delta_field===field)?.delta_value,2,`${table}.${field}`)
      assert.ok(outbox(db).filter(row=>row.op==='UPSERT').every(row=>!Object.keys(JSON.parse(row.row_json!)).some(key=>counters.includes(key))))
    }
    db.exec('DELETE FROM outbox');db.exec("INSERT INTO app_settings(key,value) VALUES('admin_pin','private'),('company_name','Shop')")
    for(const key of [...LOCAL_ONLY_SETTING_KEYS,...SECRET_SETTING_FRAGMENTS.map(fragment=>`custom_${fragment}_key`)])db.prepare('INSERT OR IGNORE INTO app_settings(key,value) VALUES(?,?)').run(key,'private')
    assert.deepEqual(outbox(db).map(row=>row.pk),['company_name'])
  } finally { db.close() }
})

test('actual ventes:create callback captures serial, stock and loyalty changes; failed sale rolls everything back', () => {
  const db=fixture()
  try {
    installOutbox(db)
    db.exec("INSERT INTO produits(id,nom,reference,stock_actuel,has_serial_number) VALUES('p','Product','P',5,1); INSERT INTO serial_numbers(id,produit_id,numero_serie,statut) VALUES('sn','p','SERIAL','EN_STOCK'); INSERT INTO clients(id,nom,fidelite_code,solde_fidelite) VALUES('c','Client','LOYALTY',10); INSERT INTO app_settings(key,value) VALUES('fidelite_gain_pct','10'),('fidelite_min_achat','0'),('fidelite_max_utilisation_pct','100')")
    const text=readFileSync(resolve('src/main/index.ts'),'utf8');const ast=ts.createSourceFile('index.ts',text,ts.ScriptTarget.Latest,true)
    let callback='';const helpers:string[]=[]
    function visit(node:ts.Node) {
      if(ts.isFunctionDeclaration(node)&&['money3','normalizeMoneyFields','normalizeVenteLine'].includes(node.name?.text??''))helpers.push(node.getText(ast))
      if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.getText(ast)==='ipcMain.handle'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==='ventes:create')callback=node.arguments[1].getText(ast)
      ts.forEachChild(node,visit)
    }
    visit(ast);assert.ok(callback);assert.equal(helpers.length,3)
    const js=ts.transpileModule(`function build(db,randomUUID,addActivityLog,enqueueSync,enqueueProductSnapshot){${helpers.join('\n')};return (${callback})};exports.build=build`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
    const module:{build?:Function}={};new Function('exports',js)(module)
    const sale=module.build!(db,randomUUID,()=>{},()=>{},()=>{})
    const vente={id:'sale',numero:'VTE-1',shift_id:null,operateur_nom:'Fixture',client_id:'c',client_nom:'Client',client_tel:null,sous_total:10,total_remises:0,total_ttc:10,mode_paiement:'ESPECES',montant_recu:10,monnaie_rendue:0,type:'PRODUIT',created_at:new Date().toISOString()}
    const line={id:'line',vente_id:'sale',produit_id:'p',designation:'Product',quantite:1,prix_unitaire:10,remise_pct:0,total_ligne:10,type_produit:'PRODUIT',numero_serie:'SERIAL'}
    db.exec('DELETE FROM outbox');sale(null,vente,[line]);const captured=outbox(db)
    for(const table of ['ventes','lignes_vente','serial_numbers','mouvements_fidelite'])assert.ok(captured.some(row=>row.table_name===table),table)
    assert.equal(captured.find(row=>row.table_name==='produits'&&row.op==='DELTA')?.delta_value,-1)
    assert.equal(captured.find(row=>row.table_name==='clients'&&row.delta_field==='solde_fidelite')?.delta_value,1)
    const count=captured.length
    assert.throws(()=>sale(null,{...vente,id:'failed',numero:'VTE-2'},[line]))
    assert.equal(outbox(db).length,count);assert.equal(db.prepare("SELECT id FROM ventes WHERE id='failed'").get(),undefined)
  } finally { db.close() }
})
