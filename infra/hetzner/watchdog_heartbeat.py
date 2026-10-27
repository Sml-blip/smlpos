"""Fail closed unless the latest watchdog line is a recent UTC heartbeat."""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys


def check(path: Path, now=None):
    lines=path.read_text(encoding='utf-8').splitlines()
    if not lines or not lines[-1].startswith('HEARTBEAT '):
        raise ValueError('Latest watchdog line is not a heartbeat')
    item=json.loads(lines[-1][len('HEARTBEAT '):])
    stamp=datetime.fromisoformat(item['timestamp'])
    if stamp.tzinfo is None: raise ValueError('Heartbeat is not timezone-aware')
    age=((now or datetime.now(timezone.utc))-stamp).total_seconds()
    if age < 0 or age >= 90: raise ValueError(f'Heartbeat age {age:.1f}s is outside [0,90)')
    return age,lines[-1]


def main():
    if len(sys.argv)!=2: raise SystemExit('Usage: watchdog_heartbeat.py LOG')
    try:
        age,line=check(Path(sys.argv[1]))
        print(f'heartbeat_age_seconds={age:.1f}')
        print(line)
        return 0
    except (OSError,ValueError,KeyError,json.JSONDecodeError) as exc:
        print(f'HEARTBEAT NOT VALID: {exc}',file=sys.stderr)
        return 1


if __name__=='__main__': sys.exit(main())
