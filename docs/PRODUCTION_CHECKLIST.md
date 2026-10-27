# Production migration checklist

**DO NOT RUN YET.** Mark PASS only with raw command evidence.

- [ ] PASS/FAIL: branch and candidate commit recorded.
- [ ] PASS/FAIL: same immutable image digest passed isolated staging.
- [ ] PASS/FAIL: full-fidelity backup and operator-PC checksum verified.
- [ ] PASS/FAIL: maintenance window and rollback owner approved.
- [ ] PASS/FAIL: production IDs, uptimes, volumes, flags, health, counts captured.
- [ ] PASS/FAIL: slot and WAL baseline captured; no slot mutation planned.
- [ ] PASS/FAIL: four-column additive migration reviewed and dry-run tested.
- [ ] PASS/FAIL: only API container restart authorized.
- [ ] PASS/FAIL: post-change health, flags, schema, latency, errors, slot and WAL verified.
- [ ] PASS/FAIL: rollback image and tested recovery procedure available.
- [ ] PASS/FAIL: abort criteria monitored and signed off.

