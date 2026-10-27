# Windows release candidate checklist

**Planning only. No release or publish.**

- [ ] Version bumped and recorded.
- [ ] French changelog reviewed and included.
- [ ] Sync remains locked by default until explicitly configured.
- [ ] No startup network call when sync is unconfigured; verify with a clean network profile.
- [ ] Build uses local packaging only (`--publish never`); no auto-update upload.
- [ ] Install on two clean physical Windows machines.
- [ ] Verify login, seed/join, offline/restart, duplicate/reordered requests, and recovery.
- [ ] Verify HTTPS endpoint and rejection of remote plain HTTP.
- [ ] Record installer/executable hashes and test logs.

