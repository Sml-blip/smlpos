"""Generate the staging Postgres contract from the audited, source-derived schema.

This does not migrate any data. Review conversion policy before production import.
"""
from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[1]
tables=json.loads((ROOT/'docs/data-audit/source-inventory.json').read_text(encoding='utf-8'))['tables']
out=ROOT/'deploy/api/schema';out.mkdir(parents=True,exist_ok=True)
local={'sync_queue','saved_paniers','inventory_repair_ledger'}
derived={'produits':{'stock_actuel'},'clients':{'solde_credit','solde_fidelite'},'fournisseurs':{'solde_du'},'organisations':{'credit_total'},'personnels':{'avance_solde','credit_solde'}}
rates={'tva_taux','tva_taux_principal','tva_achat_pct','marge_pct','coef_av','remise_pct','retenue_source_pct'}
lww={'produits','clients','categories','app_settings'}
manager={'operateurs','fournisseurs','fournisseur_commerciaux','factures_fournisseurs','lignes_facture_fournisseur','paiements_fournisseurs','ajustements_fournisseurs','personnels','mouvements_personnels','organisations','app_settings','categories','produits'}
meta={'id','created_at','updated_at','updated_by','device_id','deleted_at'}
logical={'ventes':{'client_id':'clients','shift_id':'shifts'},'lignes_vente':{'produit_id':'produits'},'documents':{'vente_id':'ventes','client_id':'clients','shift_id':'shifts','fournisseur_id':'fournisseurs','avoir_id':'documents','document_origine_id':'documents'},'lignes_document':{'produit_id':'produits'},'credits_clients':{'shift_id':'shifts'},'clients':{'organisation_id':'organisations'},'retours':{'vente_id':'ventes','produit_id':'produits','shift_id':'shifts'},'pieces_reparation':{'produit_id':'produits'},'lignes_facture_fournisseur':{'produit_id':'produits'}}
registry={};foreign=[]; sql=[(ROOT/'deploy/api/schema/control.sql').read_text(encoding='utf-8')]
for table in tables:
 name=table['name']
 if name in local:continue
 columns={}; refs={f['from']:f['table'] for f in table['foreign_keys']}; refs.update(logical.get(name,{}))
 for col in table['columns']:
  key=col['name']
  if key in meta or key in derived.get(name,set()):continue
  kind='text'
  if key in refs or key in {'dossier_id','facture_id','vente_id','personnel_id','responsable_id'}:kind='uuid'
  elif key.endswith('_at') or key in {'started_at','ended_at'}:kind='timestamp'
  elif col['type']=='INTEGER':kind='integer'
  elif col['type']=='REAL':kind='numeric' if key in rates else 'money'
  required=bool(col['notnull'] and col['default'] is None)
  columns[key]={'type':kind,'required':required}
  if key in refs:foreign.append((name,key,refs[key]))
 columns['legacy_id']={'type':'text','required':False}
 registry[name]={'columns':columns,'lww':name in lww,'manager':name in manager}
for name,cols in {
 'stock_movements':{'product_id':('uuid',True),'qty_delta':('integer',True),'reason':('text',True),'ref_type':('text',True),'ref_id':('uuid',True),'legacy_id':('text',False)},
 'account_movements':{'account_kind':('text',True),'owner_id':('uuid',True),'amount_millimes':('money',True),'reason':('text',True),'ref_type':('text',True),'ref_id':('uuid',True),'legacy_id':('text',False)},
}.items():registry[name]={'columns':{k:{'type':t,'required':r} for k,(t,r) in cols.items()},'lww':False,'manager':False}
foreign.append(('stock_movements','product_id','produits'))
for name,table in registry.items():
 defs=['id uuid PRIMARY KEY']
 for namecol,col in table['columns'].items():
  typ={'text':'text','uuid':'uuid','integer':'bigint','money':'bigint','numeric':'numeric(24,6)','timestamp':'timestamptz'}[col['type']]
  defs.append(f'"{namecol}" {typ}'+(' NOT NULL' if col['required'] else ''))
 defs+=['created_at timestamptz NOT NULL DEFAULT now()','updated_at timestamptz NOT NULL DEFAULT now()','updated_by uuid NOT NULL REFERENCES app_users(id)','device_id uuid NOT NULL REFERENCES devices(id)','deleted_at timestamptz']
 if name=='stock_movements':defs.append('CHECK (qty_delta <> 0)')
 if name=='account_movements':defs+=['CHECK (amount_millimes <> 0)',"CHECK (account_kind IN ('customer_credit','supplier_debt','cash','loyalty','staff_advance','staff_credit'))"]
 sql.append(f'CREATE TABLE IF NOT EXISTS "{name}" (\n  '+',\n  '.join(defs)+'\n);')
 sql.append(f'CREATE INDEX IF NOT EXISTS "{name}_updated_idx" ON "{name}"(updated_at);')
 if not table['lww']:
  sql.append(f'''DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='{name}_immutable' AND tgrelid='"{name}"'::regclass) THEN
      CREATE TRIGGER "{name}_immutable" BEFORE UPDATE OR DELETE ON "{name}" FOR EACH ROW EXECUTE FUNCTION immutable_business_row();
    END IF;
  END $$;''')
for name,col,target in foreign:
 if target not in registry:continue
 constraint=f'{name}_{col}_fk'[:63]
 sql.append(f'''DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='{constraint}' AND conrelid='"{name}"'::regclass) THEN
    ALTER TABLE "{name}" ADD CONSTRAINT "{constraint}" FOREIGN KEY ("{col}") REFERENCES "{target}"(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;''')
for name,col in [('produits','reference'),('produits','code_barre'),('categories','nom'),('operateurs','identifiant'),('ventes','numero'),('documents','numero'),('factures_clients','numero'),('reparations','numero'),('avances_clients','numero'),('app_settings','key')]:
 sql.append(f'CREATE UNIQUE INDEX IF NOT EXISTS "{name}_{col}_uq" ON "{name}"("{col}");')
sql.append('CREATE UNIQUE INDEX IF NOT EXISTS serial_normalized_uq ON serial_numbers(produit_id,lower(trim(numero_serie)));')
publication_tables=', '.join('"'+name+'"' for name in registry)
sql.append("DO $$ BEGIN IF current_schema()='public' AND EXISTS(SELECT 1 FROM pg_publication WHERE pubname='powersync') THEN ALTER PUBLICATION powersync SET TABLE "+publication_tables+"; END IF; END $$;")
for name in registry:
 sql.append(f'GRANT SELECT ON "{name}" TO powersync_role;')
sql.append("INSERT INTO sync_schema_versions(version) VALUES(1) ON CONFLICT DO NOTHING;")
(out/'registry.json').write_text(json.dumps(registry,indent=2)+'\n',encoding='utf-8')
(out/'references.json').write_text(json.dumps([{'table':name,'column':col,'target':target} for name,col,target in foreign if target in registry],indent=2)+'\n',encoding='utf-8')
(out/'legacy-contract.json').write_text(json.dumps({'tables':[{ 'name':t['name'],'columns':[c['name'] for c in t['columns']], 'local':t['name'] in local} for t in tables],'derived':{k:sorted(v) for k,v in derived.items()}},indent=2)+'\n',encoding='utf-8')
(out/'schema.sql').write_text('\n\n'.join(sql)+'\n',encoding='utf-8')
queries=[f'      - SELECT * FROM {name}' for name in registry]
(ROOT/'deploy/powersync/sync_rules.yaml').write_text('''# Legacy Sync Rules retained for compatibility with the supplied kit.
# Only the private, authenticated single-business service can issue tokens.
bucket_definitions:
  business_data:
    data:
'''+ '\n'.join(queries)+'\n',encoding='utf-8')
print(json.dumps({'synced_tables':len(registry),'foreign_keys':len(foreign),'mutable_stock_removed':True,'business_data_accessed':False}))

