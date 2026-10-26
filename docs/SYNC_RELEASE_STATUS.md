# SMLPOS multi-device sync release status

## Current state

- Desktop candidate: `1.9.1039`, SQLite schema `1.10.10`.
- The verified seed flow remains manual. It takes and checks a local backup, blocks on schema or data issues, and uploads only after the operator explicitly approves `SEED`.
- The secondary-PC flow accepts only a newly prepared empty replica. It keeps local backup files and refuses to erase business history.
- New document numbers use a server-assigned device code. Historical numbers stay as they are. Finalized financial rows are corrected with credit notes or reversals.
- No main-PC database was supplied or read. No business data or enrollment token has been uploaded or generated.

## Hetzner v1 service

- Public base URL: `https://api.pos.sml.boutique`.
- `/v1/*` routes to the new sync service. Other paths keep their prior API route.
- The service is in a private Docker container on the existing internal network and binds to host loopback port `13001`. PostgreSQL has no host-published port.
- v1 tables are isolated in PostgreSQL schema `pos_sync_v1`; the v1 seed is empty and there are no registered devices.
- The container is non-root, read-only, has all Linux capabilities dropped, and uses a pinned Node 24 image digest and npm lockfile.
- A private pre-deployment PostgreSQL dump is at `/opt/pos/backups/pos-pre-v1-20261025.dump` on the VPS. It was catalogued with `pg_restore -l`; it has not been restored off-host.
- HTTPS, the public v1 health endpoint, HSTS, security headers, HTTP redirect, certificate chain, and unauthenticated status rejection were verified.

## Checks run

- Desktop sync suite: 37 passed.
- Production API contract suite: 8 passed against a disposable synthetic PostgreSQL schema; the test drops only its `v1test_<uuid>` schema.
- Node and renderer TypeScript checks: passed.
- Windows x64 NSIS candidate built locally without publishing. Its SHA-256 is `909D05670B6D0A3AD95719FA47BB6F29E9C60B27A589CBBAFBE1164F0165764B`.
- The packaged app launched against a temporary APPDATA database. SQLite integrity was `ok`, schema `1.10.10`, and the seeded synthetic catalogue contained 1,143 products.
- The installer archive contains the main, preload, and renderer outputs; no test bundles or `.env` files were found.

## Main-PC rollout gate

The installer has not been merged into `main` or published as a GitHub Release. **Do not update the seed PC yet.** Publishing is still required for its existing update mechanism, and a private seed enrollment file must be prepared for the released version.

After the release is published, update the seed PC at a quiet time with the POS closed and a verified local backup. Confirm the installed version, configure its seed enrollment, run the real-data dry run, and resolve every blocker before approving the seed. Upload remains locked unless the dry-run report is clean and the operator approves it. No seed has been performed.

## Platform-plan items not included in this sync candidate

This release does not implement the separate Expo app, `/dash`, Cloudflare Access policy, Android download site, server-driven app-version management, telemetry, SSE, or the 1,000-seed simulation. The current client uses 15-second polling. Those are separate phases in `MASTER_PROMPT_PLATFORM.md`; the SMLPOS-Android repository inspected for that plan is an older Electron app, so the selected direction is a new Expo app. Confirmed preferences: Ethernet printer, Cloudflare Access for `/dash`, and Android downloads from `https://pos.sml.boutique/download`.
