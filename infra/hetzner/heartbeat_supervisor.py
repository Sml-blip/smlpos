"""Independently detect a stale watchdog and request restricted teardown."""
import argparse
from datetime import datetime,timezone
import os
from pathlib import Path
import sys
import time

import stage_backend
import staging_watchdog
import watchdog_heartbeat


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('log',type=Path)
    args=parser.parse_args()
    known=Path(os.environ.get('SMLPOS_STAGING_KNOWN_HOSTS',str(stage_backend.GENERATED/'known_hosts')))
    key=Path(os.environ.get('SMLPOS_STAGING_SSH_KEY',str(Path.home()/'.ssh'/'pos_codex')))
    stage_backend.validate_pin(known,os.environ.get('SMLPOS_STAGING_HOST_FINGERPRINT',''))
    if not key.is_file(): raise SystemExit('SSH identity missing')
    command=staging_watchdog.ssh_command(key,known)
    while True:
        try:
            age,_=watchdog_heartbeat.check(args.log)
            print(f'SUPERVISOR {datetime.now(timezone.utc).isoformat()} heartbeat_age_seconds={age:.1f}',flush=True)
        except Exception as exc:
            print(f'STOP: watchdog heartbeat invalid: {exc}',flush=True)
            try: print(staging_watchdog.remote(command,staging_watchdog.TEARDOWN),flush=True)
            except Exception as teardown_error: print(f'TEARDOWN FAILED: {teardown_error}; server timer remains the fallback',flush=True)
            return 1
        time.sleep(10)


if __name__=='__main__':sys.exit(main())
