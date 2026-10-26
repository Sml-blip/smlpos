# SMLPOS Hetzner bootstrap

Provisioned and verified 2026-10-24. Project SMLPOS: 16522767.

## Current server

- Server: `smlpos-sync-01`, ID `172223596`.
- Public IPv4: `2.28.64.69`.
- IPv6 allocation: `2a01:4f8:1c16:8c6d::/64`. No AAAA record requested.
- CX23, Ubuntu 24.04, Nuremberg, 2 vCPU / 4 GB / 40 GB.
- Approved purchase total: $7.09/month excluding VAT, including IPv4.
- Firewall: `smlpos-public`, ID `11882888`, verified Applied on the server.
- Inbound allowed: TCP 22/80/443, UDP 443, ICMP for IPv4/IPv6. Other inbound blocked. Outbound unrestricted.
- `deploy` login using the dedicated local key verified. Root/password/keyboard-interactive SSH disabled; public-key authentication enabled.
- Cloud-init status done, zero reported errors, completion marker present.
- Docker Engine 29.9.2 active; Docker Compose v5.6.1 verified. Official `hello-world` container test exited 0 and removed its container.
- Fail2ban sshd jail active; automatic-update timers enabled.
- `/opt/pos` owned by deploy:deploy with mode 0750.
- The staging PostgreSQL/API/PowerSync/Caddy stack is deployed at `/opt/pos/staging`. Caddy publishes HTTPS; PostgreSQL remains private.
- Paid Hetzner backups and R2 backups were not enabled. HTTPS and API health checks pass; authoritative business data has not been imported.

Verification evidence: `server-verification.json`, `server-smoke-test.json`, `firewall-applied.png`, `server-created.png`.

DNS is verified: Vercel hosts the authoritative DNS, and both `api.pos.sml.boutique` and `sync.pos.sml.boutique` resolve to `2.28.64.69`. Caddy issued valid TLS certificates. API health and JWKS return 200. PowerSync root returns 404 as expected; streaming between clients remains untested.

## Bootstrap design

The base bootstrap is followed by a staging deployment. The backend passed 29 PostgreSQL/API/conversion tests using isolated synthetic schemas. Business writes and seeding remain disabled. See [deployment state](../../deploy/README.md) and [remaining migration work](../../docs/sync-implementation-status.md).

Purchased server: `smlpos-sync-01`, CX23, x86_64, 2 vCPU, 4 GB RAM, 40 GB disk, Nuremberg, Ubuntu 24.04, IPv4 and IPv6. The purchase form displayed $6.49/month server + $0.60/month IPv4 = $7.09/month excluding VAT. No additional volume or paid server backups selected.

`cloud-init.template.yaml` creates a key-only deploy user with administrative sudo/Docker privileges, disables root/password SSH, enables SSH brute-force protection and automatic security updates, installs Docker Engine and Compose from Docker's official Ubuntu repository, and prepares `/opt/pos`. Docker group membership is effectively root-level access. The dedicated private key stays at `%USERPROFILE%\.ssh\pos_codex`; never upload it. Render only the `.pub` file into the ignored `.generated/` copy.

Before provisioning, obtain confirmation of the recurring price and administrative SSH access. Attach a Hetzner Cloud Firewall allowing TCP 22, TCP 80, TCP 443 and UDP 443; block other inbound traffic. Prefer limiting SSH sources when a stable administrator IP is available. Postgres/PowerSync/API internal ports must never be published directly.

SSH host identity used normal trust on first use against the public IP shown in the logged-in Hetzner console. The first ED25519 host key was pinned in ignored `.generated/known_hosts`; all subsequent checks used `StrictHostKeyChecking=yes`. Independent console-fingerprint comparison was not completed. Never disable changed-host-key verification. The dedicated private key was never uploaded or printed.

When the public IPv4 exists, request DNS-only A records for `api.pos.sml.boutique` and `sync.pos.sml.boutique`. Do not publish AAAA records until IPv6 service reachability is verified. HTTPS services can be brought up after DNS and the locally validated application stack are ready.

References: [Docker Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/), [cloud-init SSH configuration](https://cloudinit.readthedocs.io/en/stable/reference/yaml_examples/ssh.html).

