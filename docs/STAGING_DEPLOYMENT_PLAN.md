# Isolated staging deployment plan

**DO NOT RUN YET.** This is a copy-paste plan for review. It must not be executed until explicitly approved. It never targets the production project, database, volume, network, Caddy, or ports 80/443.

## Invariants

- Project/directory: `smlpos-staging` / `/opt/smlpos-staging`.
- Services: Postgres and API only; no Caddy, PowerSync, or v1 service.
- Network: a new Compose network named `smlpos-staging_internal`.
- Volume: `smlpos-staging_pgdata` only.
- API bind: `127.0.0.1:23001:3000`; Postgres is internal-only.
- Limits: Postgres `512m`, API `256m`.
- The helper must refuse `/opt/pos`, every `pos-sync-staging*`/`pos-v1*` project/container/volume/network, and production volume names before connecting.

## Preflight (local and remote read-only)

Use the pinned ED25519 key and known-host entry; substitute no other key:

```powershell
$ssh='C:\Program Files\Git\usr\bin\ssh.exe'
$kh='C:\Users\moote\OneDrive\Documents\Code\sapphire-goldfish\infra\hetzner\.generated\known_hosts'
$key='C:\Users\moote\.ssh\pos_codex'
$host='deploy@2.28.64.69'
& $ssh -i $key -o UserKnownHostsFile=$kh -o StrictHostKeyChecking=yes $host 'hostname; free -m; df -h; docker ps --format "table {{.Names}}\t{{.ID}}\t{{.Status}}"; docker network ls; docker volume ls; ss -ltnp'
```

Abort if available memory is below 800 MB, disk is above 70%, a production container restarted, or any expected identity differs.

## Provision the isolated stack

```bash
# DO NOT RUN YET; run only after preflight approval.
set -eu
install -d -m 700 /opt/smlpos-staging
cd /opt/smlpos-staging
umask 077
openssl rand -base64 32 > .postgres_password
printf 'POSTGRES_DB=smlpos_staging\nPOSTGRES_USER=smlpos_staging\nPOSTGRES_PASSWORD=%s\n' "$(cat .postgres_password)" > .env
```

`deploy/docker-compose.staging.yml` must be the only Compose file and must define the names, network, loopback port, healthcheck, and memory limits above. Verify before starting:

```bash
docker compose --project-name smlpos-staging --project-directory /opt/smlpos-staging -f /opt/smlpos-staging/docker-compose.staging.yml config --quiet
docker compose --project-name smlpos-staging --project-directory /opt/smlpos-staging -f /opt/smlpos-staging/docker-compose.staging.yml config
```

The rendered API `DATABASE_URL` must show host `postgres` and database `smlpos_staging` (redact the password); it must never contain database `pos`, `/opt/pos`, or a production network/volume.

## Start and migrate staging only

```bash
docker compose --project-name smlpos-staging --project-directory /opt/smlpos-staging -f /opt/smlpos-staging/docker-compose.staging.yml up -d postgres api
docker compose --project-name smlpos-staging --project-directory /opt/smlpos-staging -f /opt/smlpos-staging/docker-compose.staging.yml ps
docker compose --project-name smlpos-staging --project-directory /opt/smlpos-staging -f /opt/smlpos-staging/docker-compose.staging.yml exec -T api node src/migrate.ts
```

Before accepting this migration command, first prove on an isolated restored database that it changes only the four additive columns. If the branch's normal startup migrator executes publication/grant changes, stop and produce a candidate with a dedicated additive-only migration mode; do not use the unmodified startup path.

## Synthetic data and two-desktop proof

Create test credentials through the API container using hidden stdin, never argv or logs. Use two clean, non-primary Windows machines and two separate SQLite files. Connect only through a tunnel:

```powershell
ssh -N -L 23001:127.0.0.1:23001 -i $key -o UserKnownHostsFile=$kh -o StrictHostKeyChecking=yes $host
```

Run the proof with `--base-url http://127.0.0.1:23001 --seeds 50`; the runner must reject every other base URL. Cover seed, activate, fresh join, offline/restart/crash, duplicate/reordered requests, revoked device, version-too-old (426), repeated operation, A→B→A price edit, and the two-PC same-product sale. Assert row counts, millime totals, every-product stock, unique `numero`, empty outbox, and explained/empty pull rejects.

## Rollback rehearsal and teardown

Take a staging dump before and after tests, record checksums, and verify restore into a separate scratch database. Rollback means stop the staging project, remove only its containers/network/volume, and remove `/opt/smlpos-staging`; no production object may appear in the command output:

```bash
docker compose --project-name smlpos-staging --project-directory /opt/smlpos-staging -f /opt/smlpos-staging/docker-compose.staging.yml down --volumes --remove-orphans
docker volume rm smlpos-staging_pgdata
rm -rf -- /opt/smlpos-staging
```

Before using the final `rm`, verify the resolved path is exactly `/opt/smlpos-staging` and that `docker volume inspect` returns only the staging volume. Close the tunnel and prove production container IDs, uptimes, volumes, flags, health, and database counts are unchanged.

## Required human decisions

- Approve the candidate image and the additive-only migration implementation.
- Approve the staging window, two physical test PCs, synthetic credentials, and the 3-active-device limit.
- Approve whether a restored production dump may be used as staging input; otherwise use generated synthetic data only.
- Approve the SSH key/user and the pinned host-key file.

