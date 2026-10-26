import { writeFileSync } from 'node:fs'
import { connectDatabase, initDatabase, getDb, closeDatabase } from '../../src/main/db'
import { describeColumns } from '../../src/main/seed/dryRun'
import { syncedTableNames, primaryKeyOf, COUNTER_COLUMNS, LOCAL_ONLY_SETTING_KEYS, SECRET_SETTING_FRAGMENTS } from '../../src/main/seed/tables'
connectDatabase(); initDatabase()
try {
  const db = getDb()
  const names = syncedTableNames((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(row => row.name))
  const tables = Object.fromEntries(names.map(table => {
    const info = db.prepare(`PRAGMA table_info("${table}")`).all() as {name:string;notnull:number;dflt_value:string|null}[]
    const unique = (db.prepare(`PRAGMA index_list("${table}")`).all() as {name:string;unique:number;partial:number}[])
      .filter(index => index.unique && !index.partial).map(index => (db.prepare(`PRAGMA index_info("${index.name}")`).all() as {name:string}[]).map(column => column.name))
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list("${table}")`).all()
    return [table, {pk:primaryKeyOf(table), columns:describeColumns(db,table), required:info.filter(column => column.notnull).map(column => column.name), unique, foreignKeys, counters:COUNTER_COLUMNS[table] ?? []}]
  }))
  writeFileSync(process.argv[2], JSON.stringify({contract_version:1,schema_version:'1.10.10',tables,localSettings:[...LOCAL_ONLY_SETTING_KEYS],secretFragments:SECRET_SETTING_FRAGMENTS})+'\n')
} finally { closeDatabase() }
