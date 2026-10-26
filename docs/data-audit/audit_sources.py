"""Generate a source-derived SMLPOS data dictionary without opening app data.

Only CREATE TABLE, CREATE INDEX and ALTER TABLE statements from literal
db.exec templates are executed, exclusively against SQLite :memory:.
This reconstructs the expected fresh-install schema, not a deployed database.
"""
from pathlib import Path
import hashlib
import json
import re
import sqlite3

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
SCHEMA = ROOT / 'src/main/db.ts'


def read(path):
    return path.read_text(encoding='utf-8')


def link(path, line=1):
    return f'[{path}:{line}](../../{path}#L{line})'


def reconstruct():
    source = read(SCHEMA)
    conn = sqlite3.connect(':memory:')
    ignored_duplicates = []
    errors = []
    statements = []
    for match in re.finditer(r'db\.exec\(`([\s\S]*?)`\)', source):
        sql = re.sub(r'--[^\n]*', '', match[1])
        for part in sql.split(';'):
            part = part.strip()
            if not re.match(r'^(?:CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)|ALTER\s+TABLE)\b', part, re.I):
                continue
            line = source.count('\n', 0, match.start()) + 1
            if '${' in part:
                errors.append({'line': line, 'error': 'dynamic DDL requires manual review'})
                continue
            try:
                conn.execute(part)
                statements.append({'line': line, 'sql': part})
            except sqlite3.OperationalError as exc:
                if 'duplicate column name' in str(exc):
                    ignored_duplicates.append({'line': line, 'error': str(exc)})
                else:
                    errors.append({'line': line, 'error': str(exc)})
    tables = []
    for name, ddl in conn.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
        cols = [dict(zip(['cid', 'name', 'type', 'notnull', 'default', 'pk'], row)) for row in conn.execute(f'PRAGMA table_info("{name}")')]
        fks = [dict(zip(['id', 'seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'], row)) for row in conn.execute(f'PRAGMA foreign_key_list("{name}")')]
        indexes = []
        for row in conn.execute(f'PRAGMA index_list("{name}")'):
            index_name = row[1]
            definition = conn.execute('SELECT sql FROM sqlite_master WHERE name=?', (index_name,)).fetchone()
            indexes.append({'name': index_name, 'unique': bool(row[2]), 'origin': row[3], 'partial': bool(row[4]), 'columns': [c[2] for c in conn.execute(f'PRAGMA index_info("{index_name}")')], 'sql': definition[0] if definition else None})
        location = re.search(r'CREATE TABLE IF NOT EXISTS\s+' + re.escape(name) + r'\b', source)
        tables.append({'name': name, 'line': source.count('\n', 0, location.start()) + 1, 'columns': cols, 'foreign_keys': fks, 'indexes': indexes, 'ddl': ddl})
    return conn, tables, statements, ignored_duplicates, errors


def write_inventory():
    results = []
    roots = [ROOT / 'src', ROOT / 'mobile', ROOT / 'apps/web-admin', ROOT / 'integrations', ROOT / 'supabase']
    for base in roots:
        for path in sorted(base.rglob('*')):
            if path.suffix not in {'.ts', '.tsx', '.mjs', '.sql'} or any(p in {'node_modules', 'dist-android-test'} for p in path.parts):
                continue
            text = read(path)
            handlers = [(m.start(), m[1]) for m in re.finditer(r"ipcMain\.handle\(['\"]([^'\"]+)", text)]
            for match in re.finditer(r'\b(INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?([A-Za-z_][A-Za-z_0-9]*|\$\{[^}]+\})', text, re.I):
                operation, table = match.groups()
                # Exclude the SQL ON CONFLICT ... DO UPDATE SET clause.
                if table.upper() in {'SET', 'CASCADE'}:
                    continue
                current = next((name for offset, name in reversed(handlers) if offset < match.start()), None)
                results.append({'path': path.relative_to(ROOT).as_posix(), 'line': text.count('\n', 0, match.start()) + 1, 'operation': operation.upper(), 'table': table, 'nearest_preceding_ipc_handler': current})
    return results


def main():
    conn, tables, statements, duplicates, errors = reconstruct()
    assert len(tables) == 43, f'Expected 43 distinct source tables, got {len(tables)}'
    assert not errors, errors
    assert 'avance_utilisee' in {c['name'] for t in tables if t['name'] == 'ventes' for c in t['columns']}
    assert 'facture_id' in {c['name'] for t in tables if t['name'] == 'avances_clients' for c in t['columns']}
    assert 'stock_applied' in {c['name'] for t in tables if t['name'] == 'factures_fournisseurs' for c in t['columns']}
    writes = write_inventory()
    paths = sorted({r['path'] for r in writes} | {'src/main/db.ts', 'src/preload/index.ts', 'src/main/dataPaths.ts', 'src/main/backupService.ts', 'src/main/syncPull.ts', 'src/renderer/src/lib/sync.ts', 'src/renderer/src/lib/syncColumns.ts'})
    inventory = {'scope': 'Source-derived fresh-install schema; no business database opened', 'tables': tables, 'ddl_statements_applied': len(statements), 'duplicate_add_columns_ignored': duplicates, 'ddl_errors': errors, 'write_candidates': writes, 'source_sha256': {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in paths}}
    (OUT / 'source-inventory.json').write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    dictionary = ['# SMLPOS data dictionary', '', 'Generated from literal DDL in `src/main/db.ts`, including later ALTER TABLE additions. SQLite DDL was reconstructed in memory only. No app, seed, repair, import or business database was run.', '', 'This is the expected fresh-install structure. Older deployed databases may differ where a migration failed or created a column with different constraints. Row counts and real-data quality are unknown.', '', f'{len(tables)} tables; {sum(len(t["columns"]) for t in tables)} columns; {sum(len(t["foreign_keys"]) for t in tables)} declared foreign-key relationships.', '', 'Column `PK` is its primary-key ordinal; `NOT NULL` is SQLite PRAGMA metadata. In ordinary SQLite rowid tables, a TEXT PRIMARY KEY alone does not imply NOT NULL.', '']
    for table in tables:
        dictionary += [f'## {table["name"]}', '', 'First declaration: ' + link('src/main/db.ts', table['line']), '', '| Column | SQLite type | NOT NULL | PK | Default |', '|---|---|---|---|---|']
        for c in table['columns']:
            default = '—' if c['default'] is None else str(c['default']).replace('|', '\\|')
            dictionary.append(f'| `{c["name"]}` | {c["type"]} | {bool(c["notnull"])} | {c["pk"] or "—"} | `{default}` |')
        dictionary += ['', '**Declared foreign keys:**']
        dictionary += [f'- `{f["from"]}` → `{f["table"]}.{f["to"]}`; delete: {f["on_delete"]}; update: {f["on_update"]}.' for f in table['foreign_keys']] or ['- None. Logical relationships may still exist in handlers or JSON.']
        dictionary += ['', '**Indexes and uniqueness:**']
        dictionary += [f'- `{idx["name"]}`: {"unique" if idx["unique"] else "non-unique"} ({", ".join(str(c) for c in idx["columns"])}), partial={idx["partial"]}.' + (f' SQL: `{idx["sql"]}`' if idx['sql'] else '') for idx in table['indexes']] or ['- No explicit/automatic indexes returned.']
        dictionary += ['', '**Full reconstructed DDL, including CHECK clauses:**', '', '```sql', table['ddl'] + ';', '```', '']
    (OUT / 'DATA_DICTIONARY.md').write_text('\n'.join(dictionary), encoding='utf-8')
    report = ['# SQL write-path source inventory', '', 'Lexical candidates across desktop, Android, web-admin, integration and Supabase source. These are source locations, not proof that a statement runs. ON CONFLICT clauses, comments and dynamic SQL require contextual review. The nearest preceding IPC handler is a navigation aid, not call-graph attribution; helpers can serve several handlers.', '', '| Source | SQL operation | Table / expression | Nearest preceding IPC handler |', '|---|---|---|---|']
    for w in writes:
        report.append(f'| {link(w["path"], w["line"])} | {w["operation"]} | `{w["table"]}` | `{w["nearest_preceding_ipc_handler"] or "outside IPC / other source"}` |')
    (OUT / 'WRITE_PATHS.md').write_text('\n'.join(report) + '\n', encoding='utf-8')
    counts = ['-- Generated read-only baseline statements. Run ONLY on a verified database copy.', '-- Do not run the application to execute this file: startup changes data.', 'PRAGMA query_only = ON;', 'PRAGMA integrity_check;', 'PRAGMA foreign_key_check;', "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name;"]
    for t in tables:
        n = t['name']
        counts += [f"SELECT '{n}' AS table_name, COUNT(*) AS row_count FROM \"{n}\";", f'PRAGMA table_info("{n}");', f'PRAGMA foreign_key_list("{n}");', f'PRAGMA index_list("{n}");']
    (OUT / 'BASELINE.sql').write_text('\n'.join(counts) + '\n', encoding='utf-8')
    remote_source = read(ROOT / 'src/renderer/src/lib/syncColumns.ts')
    remote = {m[1]: set(re.findall(r"'([^']+)'", m[2])) for m in re.finditer(r'(\w+): new Set\(\[([\s\S]*?)\]\)', remote_source)}
    pull_source = read(ROOT / 'src/main/syncPull.ts')
    pull_match = re.search(r'const SYNC_PULL_ALLOWED = new Set\(\[([\s\S]*?)\]\)', pull_source)
    pull = set(re.findall(r"'([^']+)'", pull_match[1]))
    coverage = ['# Existing normal-sync coverage', '', 'Source comparison only. Whitelist presence does not prove every write enqueues or every remote table exists. An absent whitelist entry passes payloads through unchanged in stripPayloadForRemote; it does not mean upload is forbidden. The main bootstrap allowlist must also permit the table. The separate bootstrap upload does not use this ordinary whitelist.', '', f'{len(pull)} local tables are in the pull allowlist; {len(tables) - len(pull)} are absent.', '', '| Table | Pull allowed | Explicit push column whitelist | Local columns missing from push whitelist |', '|---|---|---|---|']
    for t in tables:
        n = t['name']
        missing = ', '.join(sorted({c['name'] for c in t['columns']} - remote[n])) if n in remote else 'No explicit whitelist entry'
        coverage.append(f'| `{n}` | {n in pull} | {n in remote} | {missing or "—"} |')
    coverage += ['', 'Missing local columns can be stripped during normal uploads. On pull, missing remote values are replaced with default expressions or NULL for all local columns; they are not automatically preserved. Excluded local infrastructure is expected, but excluded business histories require a complete migration design.']
    (OUT / 'SYNC_COVERAGE.md').write_text('\n'.join(coverage) + '\n', encoding='utf-8')
    # Parse every generated read-only statement against the empty synthetic schema.
    for stmt in counts:
        if not stmt.startswith('--'):
            conn.execute(stmt).fetchall()
    print(json.dumps({'tables': len(tables), 'columns': sum(len(t['columns']) for t in tables), 'foreign_keys': sum(len(t['foreign_keys']) for t in tables), 'write_candidates': len(writes), 'ddl_statements_applied': len(statements), 'ddl_errors': errors, 'baseline_sql': 'all statements executed on empty in-memory schema', 'business_databases_opened': 0}))


if __name__ == '__main__':
    main()

