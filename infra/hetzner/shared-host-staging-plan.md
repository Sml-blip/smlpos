# Shared-host staging review

Target: existing `smlpos-sync-01`, `2.28.64.69`. No purchases.
The user authorized the staging run after successful local proof. The host key
was independently verified and pinned in Step B; recheck it before execution.

Identity selected from the local bootstrap record: SSH user `deploy`, local
identity `%USERPROFILE%\.ssh\pos_codex`. This identity authenticated in Step B;
recheck access. Do not use the new `smlpos-staging` key,
change SSH configuration, request private keys, or retry with other identities.
Stop and report if this identity cannot authenticate.

## Step B, after go, before deployment

1. Validate the syntax of the trusted fingerprint **before any connection**.
   Obtain only the ED25519 public host key with
   `ssh-keyscan -T 10 -t ed25519 2.28.64.69`. This scan is untrusted candidate
   material, never an accepted pin. Compare its SHA256 fingerprint with the
   supplied trusted fingerprint; stop immediately on mismatch. Write a single
   literal-host `2.28.64.69 ssh-ed25519 BASE64_PUBLIC_KEY` known-hosts entry
   only after a match. Never accept a new or changed key automatically.
2. Use the exact SSH options in `commands.preview.txt`, initially for read-only
   authentication and inspection only. Capture and paste raw outputs:

   ```sh
   id
   free -m
   df -h
   docker ps --no-trunc --format 'table {{.Names}}\t{{.ID}}\t{{.Status}}'
   docker stats --no-stream
   docker volume ls
   docker network ls
   if test -e /opt/smlpos-staging || test -L /opt/smlpos-staging; then
     ls -ld /opt/smlpos-staging
   else
     printf '/opt/smlpos-staging does not exist\n'
   fi
   ss -ltn
   sudo -n true
   python3 --version
   docker compose version
   ```

3. Discover production project/container/database identities from read-only
   inspection. Record full container IDs, StartedAt, RestartCount, project and
   volume labels, volume attachments, and the production feature flags only
   (never print database passwords or entire container environments).
   Stop on any unexpected result, occupied staging port 23001, existing
   staging resources/directory, production RAM above about 50% of physical
   RAM, or any relevant disk above about 70% full. Ask the user if either
   resource threshold is exceeded. Do not proceed based on old documentation.
4. After the read-only gate is clean, take a consistent production `pg_dump -Fc`
   using the discovered container/user/database. This is a read of production;
   save the backup outside production mounts, with restrictive permissions.
   Record dump byte size and SHA256, and `pg_restore --list` output. Verify an
   actual restore with `pg_restore --exit-on-error` into a **separate scratch
   PostgreSQL container and volume**, both labeled with project `smlpos-staging`,
   memory/CPU limited, no published ports, never into the production cluster.
   Check available RAM/disk again before creating scratch resources and allow
   room for the dump, restored DB and staging stack; stop if insufficient.
   Retain the verified dump. Record restore status, DB size and schema checks.
   Use a production read-only transaction to check whether public.sync2_seeds
   exists and, if present, count its rows; paste raw results. Remove only the
   explicitly identified scratch resources after successful verification.
   Exact dump/restore commands require live discovery; do not guess IDs or
   database names. Stop on errors and retain evidence for inspection.

## Step C, only after Step B is clean

The helper is **not** the Step B runner. It requires explicit
`--execute --step-b-clean` and either `--prepare-only` or `--start-prepared`.
Preparation schedules and lists the three-hour timer without starting containers;
after verifying the timer and fresh heartbeat, start the prepared stack. These
flags are operator attestations, not automatic proof that Step B passed.

```powershell
$env:SMLPOS_STAGING_HOST_FINGERPRINT = 'REAL_TRUSTED_SHA256_FINGERPRINT'
$env:SMLPOS_STAGING_HOST = '2.28.64.69'
# No connection: writes only the command preview to stdout.
& C:/Users/moote/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe -B infra/hetzner/stage_backend.py --shared-host-staging --show-plan
# After approval, clean Step B and pinning ONLY:
& C:/Users/moote/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe -B infra/hetzner/stage_backend.py --shared-host-staging --execute --step-b-clean --prepare-only
# Verify the timer listing and fresh watchdog/supervisor heartbeats before starting:
& C:/Users/moote/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe -B infra/hetzner/stage_backend.py --shared-host-staging --execute --step-b-clean --start-prepared
```

`commands.preview.txt` contains every SSH argument, the archive streamed on
stdin, and the exact Python stdin used remotely. `stage_backend_remote.py`
contains every nested command.
All Compose operations use exactly:

```sh
docker compose --project-name smlpos-staging --project-directory /opt/smlpos-staging --env-file /opt/smlpos-staging/.env -f /opt/smlpos-staging/docker-compose.staging.yml
```

There is no reference to the production Compose file in deployment commands.
No Caddy, DNS, firewall changes, ports 80/443, host Docker pruning, or production
container lifecycle commands are included. New secrets are generated remotely,
and existing staging directories/resources are refused rather than reused.
The only named data volume is `smlpos-staging_pgdata`; the only network is
`smlpos-staging_internal`. PostgreSQL's internal database is `smlpos_staging`
in its own volume. Only PostgreSQL (512 MiB/0.5 CPU) and the API (256 MiB/0.5
CPU) run; build and host overhead need additional headroom. The helper schedules
the restricted three-hour systemd teardown before starting either container;
if scheduling fails it stops before Compose up. The exact command is printed
by the helper and stored in the local command preview.

API flags LIVE_WRITES_ENABLED, SEED_STAGING_ENABLED, SYNC2_ENABLED and
STAGING_ONLY are true only in the staging .env. Only the API publishes
127.0.0.1:23001; the DB has no published port. Tunnel
with the same pinned SSH options and identity, adding:

```sh
-N -o ExitOnForwardFailure=yes -L 127.0.0.1:23001:127.0.0.1:23001
```

After deployment, paste raw health/flags and deploy/api test outputs. Run the
two-PC scenario against only a scratch database in the staging cluster, using
an SSH forward to the discovered staging DB container IP. The existing two-PC
runner also creates a fixture API and two local desktop databases; identify
that distinction explicitly in results, and verify the deployed staging HTTP
API separately. Do not claim actual PC-to-PC streaming based on fixture tests.
Stop and report any failure; preserve evidence until reviewed.

After successful testing, inspect the staging labels/mounts again and use the
exact Compose prefix above followed by `down --volumes`.
Never use `--remove-orphans`, Docker prune, or a production project for cleanup.
Retain the backup and logs. Paste raw production `docker ps`, full IDs,
StartedAt/RestartCount, volume list/attachments and production flags before
and after; require identical IDs, start times, restart counts and production
volumes, and flags still false. Human-readable uptime should advance with
elapsed time, not stay numerically identical. Staging teardown and production
proof are separate reviewed steps; the helper never silently cleans up after
a failure.

## Local validation limits

Offline Python safety tests and standalone YAML parsing run locally. Docker
is unavailable locally, so Compose's resolved configuration is validated on
the server before any `up`, with secrets captured only in process memory.
No Step B/C output or successful server checks exist yet.
