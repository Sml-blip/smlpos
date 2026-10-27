# Audit validation results

Date: 2026-10-24. All database work described here used SQLite `:memory:` only.

## Passed: source schema and artifact checks

Command:

```powershell
python docs/data-audit/audit_sources.py
```

Results:

- 43 distinct tables, 536 columns and 28 declared foreign-key relationships.
- 116 DDL statements applied successfully, zero unhandled DDL errors.
- Duplicate ADD COLUMN declarations were recorded separately, not treated as new columns.
- 258 lexical SQL write candidates indexed. These are not a count of business workflows or runtime writes.
- Every generated baseline statement executed successfully against the empty in-memory schema.
- Normal sync pull allowlist contains 29 tables; 14 local tables are absent.
- No business DB file opened.

Command:

```powershell
python -B docs/data-audit/validate_audit.py
```

Results: five check groups passed; all 40 reconciliation statements executed on a synthetic schema/fixture. The checks demonstrate that:

1. Ordinary SQLite TEXT primary keys allow multiple NULL IDs unless NOT NULL is explicit.
2. The serial table accepts duplicate serial values under distinct row IDs.
3. A sale line can reference a missing product even with foreign-key enforcement ON, because that relationship is not declared.
4. The diagnostics detect seeded debt discrepancies, product orphans and duplicate serials.
5. The diagnostics enable query_only mode, which rejects subsequent writes to that connection.

See `validation-results.json`. These checks test the schema and audit SQL, not the Electron business handlers, live sync, client balances, real backups or production deployment.

## Failed: existing main/preload TypeScript check

Command:

```powershell
node node_modules/typescript/bin/tsc -p tsconfig.node.json --composite false --incremental false --noEmit
```

Exit: 1. Observed existing diagnostics include:

- `src/main/index.ts:138`: unsupported PDF `disableWorker` parameter.
- `src/main/index.ts:955`, `1108`, `1964`: BrowserWindow may be undefined.
- `src/main/index.ts:2014`: inferred product object lacks `nom`.
- `src/main/index.ts:4357`, `4711`, `5450`: unsafe null-to-string casts.
- `src/main/index.ts:5396–5455`: document object inference loses fields such as type_document, numero and id.
- `src/main/index.ts:5561–5568`: rebuilt line object inference loses product/price/quantity fields.
- `src/main/printer/PrinterService.ts:465`: page-size type incompatible with Electron.

## Failed: existing renderer TypeScript check

Command:

```powershell
node node_modules/typescript/bin/tsc -p tsconfig.web.json --composite false --incremental false --noEmit
```

Exit: 1. Observed existing diagnostic categories include:

- Missing IPC declaration members, including appHealth and document/source-tag helpers.
- Invoice edit/print type mismatches, including product fields, serial JSON and tax bucket shapes.
- Shift status staleOpen type mismatch.
- Product type missing prix_achat_ttc.
- replaceAll unavailable under configured ES2020 library.
- Missing setOpen in personnel UI.
- Missing formatPrice in online-order print UI.
- Inconsistent online-order status unions.
- Optional callbacks possibly undefined and incompatible Promise return types.

No application TypeScript file was changed during this audit. These failures are part of the starting state; they are not resolved by the audit. No full application build, desktop UI run, Android typecheck/build or web-admin build was attempted.

## Other checks and exclusions

- `git diff --check`: exit 0 for tracked-file changes. Newly created audit files are additionally checked by the artifact validation, as untracked files are not covered by git diff.
- Root package.json has no lint/test scripts. No substitute package or new dependency was installed.
- No client database was available: expected development and canonical packaged DB paths did not exist. This is consistent with the user identifying this as a development computer.
- Existing untracked project/reference/mobile/integration files were preserved.
- Changes are confined to `docs/data-audit/` documents, JSON inventories, SQL diagnostics and their Python generation/validation tools. No source application/configuration changes, Git commits, VPS changes or external writes.

