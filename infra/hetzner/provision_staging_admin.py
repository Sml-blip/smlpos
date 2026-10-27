"""Create only the synthetic staging admin; accept credentials via stdin."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

import stage_backend
import staging_watchdog

INSPECT = r'''
import json,subprocess
from urllib.parse import urlsplit
items=json.loads(subprocess.check_output(['docker','inspect','smlpos-staging-api-1','smlpos-staging-postgres-1'],text=True))
api,db=items
for item,name in ((api,'smlpos-staging-api-1'),(db,'smlpos-staging-postgres-1')):
 if item['Name'].lstrip('/')!=name or (item['Config'].get('Labels') or {}).get('com.docker.compose.project')!='smlpos-staging':raise SystemExit('Refusing container identity')
 if set(item['NetworkSettings']['Networks'])!={'smlpos-staging_internal'} or item['HostConfig'].get('ExtraHosts'):raise SystemExit('Refusing network')
url=next((x.split('=',1)[1] for x in api['Config']['Env'] if x.startswith('DATABASE_URL=')),'')
parsed=urlsplit(url)
if parsed.scheme!='postgresql' or parsed.username!='pos_api' or parsed.hostname!='postgres' or parsed.port!=5432 or parsed.path!='/smlpos_staging' or parsed.query or parsed.fragment:raise SystemExit('Refusing API database')
if 'POSTGRES_DB=smlpos_staging' not in db['Config']['Env']:raise SystemExit('Refusing database name')
if not any(m['Type']=='volume' and m.get('Name')=='smlpos-staging_pgdata' and m['Destination']=='/var/lib/postgresql/data' for m in db['Mounts']):raise SystemExit('Refusing database volume')
print(api['Id'])
'''


def main():
    credentials=json.load(sys.stdin)
    if set(credentials)!={'username','password','role'} or credentials['username']!='desktop-proof' or credentials['role']!='admin' or not isinstance(credentials['password'],str) or len(credentials['password'])<12:
        raise SystemExit('Invalid synthetic admin input')
    known=Path(os.environ.get('SMLPOS_STAGING_KNOWN_HOSTS',str(stage_backend.GENERATED/'known_hosts')))
    identity=Path(os.environ.get('SMLPOS_STAGING_SSH_KEY',str(Path.home()/'.ssh'/'pos_codex')))
    stage_backend.validate_pin(known,os.environ.get('SMLPOS_STAGING_HOST_FINGERPRINT',''))
    if not identity.is_file():raise SystemExit('SSH key absent')
    command=staging_watchdog.ssh_command(identity,known)
    container=staging_watchdog.remote(command,INSPECT).strip()
    if not re.fullmatch(r'[0-9a-f]{64}',container):raise SystemExit('Invalid staging container ID')
    target=command[:-2]+[f'docker exec -i {container} node src/admin.ts create-user']
    result=subprocess.run(target,input=json.dumps(credentials),text=True,check=True)
    return result.returncode


if __name__=='__main__':
    sys.exit(main())
