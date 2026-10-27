"""Validate audit queries and demonstrate schema limits using synthetic data.

Does not start Electron or execute business handlers. Does not open any DB file.
"""
from pathlib import Path
import json
import sqlite3
from audit_sources import reconstruct


def statements(text):
    buffer = ''
    for line in text.splitlines():
        buffer += line + '\n'
        if sqlite3.complete_statement(buffer):
            yield buffer
            buffer = ''
    if buffer.strip():
        raise AssertionError('Unterminated SQL statement')


def main():
    conn, tables, _, _, errors = reconstruct()
    assert not errors
    conn.execute('PRAGMA foreign_keys=ON')
    checks = []
    # Ordinary SQLite TEXT PRIMARY KEY permits NULL without explicit NOT NULL.
    conn.execute("INSERT INTO clients(id,nom) VALUES(NULL,'Audit fixture A')")
    conn.execute("INSERT INTO clients(id,nom) VALUES(NULL,'Audit fixture B')")
    assert conn.execute('SELECT COUNT(*) FROM clients WHERE id IS NULL').fetchone()[0] == 2
    checks.append('TEXT primary key accepts multiple NULLs in reconstructed clients table')
    conn.execute("INSERT INTO produits(id,reference,nom,stock_actuel,has_serial_number) VALUES('audit-product','AUDIT-ONLY','Synthetic item',3,1)")
    conn.execute("INSERT INTO serial_numbers(id,produit_id,numero_serie) VALUES('sn-1','audit-product','AUDIT-SN')")
    conn.execute("INSERT INTO serial_numbers(id,produit_id,numero_serie) VALUES('sn-2','audit-product','AUDIT-SN')")
    assert conn.execute("SELECT COUNT(*) FROM serial_numbers WHERE numero_serie='AUDIT-SN'").fetchone()[0] == 2
    checks.append('duplicate serial values are accepted by schema despite distinct row IDs')
    conn.execute("INSERT INTO ventes(id,numero,total_ttc) VALUES('audit-sale','AUDIT-SALE',10)")
    conn.execute("INSERT INTO lignes_vente(id,vente_id,produit_id,designation,quantite,prix_unitaire,total_ligne) VALUES('audit-line','audit-sale','missing-product','Synthetic orphan',1,10,10)")
    assert conn.execute('PRAGMA foreign_key_check').fetchall() == []
    checks.append('undeclared line-to-product relationship can be orphaned even with FK enforcement on')
    conn.execute("INSERT INTO clients(id,nom,solde_credit) VALUES('audit-client','Audit fixture C',20)")
    conn.execute("INSERT INTO credits_clients(id,client_id,client_nom,type,montant) VALUES('audit-credit','audit-client','Audit fixture C','CREDIT',10)")
    conn.commit()
    # Execute the complete query suite, then verify it detected seeded issues.
    queries = list(statements((Path(__file__).parent / 'RECONCILIATION.sql').read_text(encoding='utf-8')))
    outputs = [(q, conn.execute(q).fetchall()) for q in queries]
    assert any('movement_millimes' in q and any(r[0] == 'audit-client' and r[1:] == (20000, 10000) for r in rows) for q, rows in outputs)
    assert any("'lignes_vente.produit_id'" in q and ('lignes_vente.produit_id', 'audit-line') in rows for q, rows in outputs)
    assert any('AS serial_key' in q and ('audit-product', 'audit-sn', 2) in rows for q, rows in outputs)
    checks.append('reconciliation diagnostics detect synthetic debt mismatch, product orphan and duplicate serial')
    try:
        conn.execute("DELETE FROM clients WHERE id='audit-client'")
    except sqlite3.OperationalError as exc:
        assert 'readonly' in str(exc).lower()
    else:
        raise AssertionError('query_only did not prevent writing')
    checks.append('diagnostic query_only mode blocks subsequent writes on the synthetic connection')
    result = {'checks': checks, 'reconciliation_statements_executed': len(queries), 'business_databases_opened': 0, 'limitation': 'Synthetic schema/query checks only; no Electron handlers or production workflows executed'}
    (Path(__file__).parent / 'validation-results.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))


if __name__ == '__main__':
    main()

