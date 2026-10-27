"""Monitor production over pinned SSH and remove only verified staging resources.

Start before staging deployment. This never modifies production resources.
SSH or inspection failures abort with a non-zero status; they cannot guarantee
remote teardown when the host is unreachable.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import stage_backend

PRODUCTION_PREFIXES = ('pos-sync-staging', 'pos-v1')
MONITOR = r'''
import json, subprocess, time, urllib.request
def run(*args): return subprocess.check_output(args, text=True)
lines=run('free','-m').splitlines()
available=int(next(x for x in lines if x.startswith('Mem:')).split()[-1])
ids=run('docker','ps','-aq','--no-trunc').splitlines()
items=json.loads(run('docker','inspect',*ids)) if ids else []
production={x['Name'].lstrip('/'):{'id':x['Id'],'restarts':x['RestartCount'],
  'started':x['State']['StartedAt'],'running':x['State']['Running']}
  for x in items if x['Name'].lstrip('/').startswith(('pos-sync-staging','pos-v1'))}
started=time.monotonic()
try:
 with urllib.request.urlopen('http://127.0.0.1:13000/health',timeout=3) as r:
  body=json.load(r)
  health={'status':r.status,'ok':body.get('ok'),'liveWritesEnabled':body.get('liveWritesEnabled'),
          'seedStagingEnabled':body.get('seedStagingEnabled'),'latency_ms':round((time.monotonic()-started)*1000,2)}
except Exception as exc:
 health={'error':type(exc).__name__,'latency_ms':round((time.monotonic()-started)*1000,2)}
print(json.dumps({'available_mb':available,'production':production,'health':health},sort_keys=True))
'''
TEARDOWN = Path(__file__).with_name('staging_teardown_remote.py').read_text(encoding='utf-8')


def unsafe_reason(baseline, current):
    if current['available_mb'] < 800:
        return f"available memory {current['available_mb']} MB is below 800 MB"
    if not baseline['production']:
        raise ValueError('No production containers found; refusing to monitor')
    health=current['health']
    if health.get('status')!=200 or health.get('ok') is not True or health.get('liveWritesEnabled') is not False or health.get('seedStagingEnabled') is not False:
        return 'production health or feature flags changed'
    baseline_latency=baseline['health'].get('latency_ms',0)
    if health.get('latency_ms',float('inf')) > max(500,baseline_latency*3):
        return 'production health latency exceeded baseline tolerance'
    if set(current['production']) != set(baseline['production']):
        return 'production container set changed'
    for name, old in baseline['production'].items():
        new = current['production'][name]
        if not old['running'] or not new['running'] or any(new[k] != old[k] for k in ('id','restarts','started')):
            return f'production container changed or stopped: {name}'
    return None


def ssh_command(identity, known_hosts):
    return [os.environ.get('SMLPOS_SSH_BINARY','ssh'),'-i',str(identity),'-o','IdentitiesOnly=yes','-o','BatchMode=yes',
            '-o','StrictHostKeyChecking=yes','-o','GlobalKnownHostsFile=none',
            '-o',f'UserKnownHostsFile={known_hosts}','-o','HostKeyAlgorithms=ssh-ed25519',
            '-o','UpdateHostKeys=no','-o','ConnectTimeout=10','-o','ConnectionAttempts=1',
            'deploy@2.28.64.69','python3','-']


def remote(command, script):
    return subprocess.run(command,input=script,text=True,capture_output=True,check=True).stdout


def run_monitor(poll, teardown, sleep=time.sleep, interval=30, iterations=None):
    baseline = poll()
    reason = unsafe_reason(baseline, baseline)
    if reason:
        print('STOP:',reason,flush=True)
        print(teardown(),flush=True)
        return 1
    print('Baseline:',json.dumps(baseline,sort_keys=True),flush=True)
    count=0
    while iterations is None or count < iterations:
        sleep(interval)
        current=poll()
        print('Check:',json.dumps(current,sort_keys=True),flush=True)
        reason=unsafe_reason(baseline,current)
        if reason:
            print('STOP:',reason,flush=True)
            print(teardown(),flush=True)
            return 1
        count+=1
    return 0


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--interval',type=int,default=30)
    args=parser.parse_args()
    if not 1 <= args.interval <= 30: parser.error('interval must be 1–30 seconds')
    known=Path(os.environ.get('SMLPOS_STAGING_KNOWN_HOSTS',str(stage_backend.GENERATED/'known_hosts')))
    key=Path(os.environ.get('SMLPOS_STAGING_SSH_KEY',str(Path.home()/'.ssh'/'pos_codex')))
    stage_backend.validate_pin(known,os.environ.get('SMLPOS_STAGING_HOST_FINGERPRINT',''))
    if not key.is_file(): raise SystemExit('SSH key absent')
    command=ssh_command(key,known)
    try:
        return run_monitor(lambda:json.loads(remote(command,MONITOR)),lambda:remote(command,TEARDOWN),interval=args.interval)
    except (subprocess.SubprocessError,OSError,ValueError,KeyError,json.JSONDecodeError) as exc:
        print(f'Watchdog failed: {exc}; remote teardown cannot be confirmed.',file=sys.stderr)
        return 2


if __name__=='__main__':
    sys.exit(main())
