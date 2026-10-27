"""Reviewed stdin for stage_backend.py; does nothing when imported locally."""
from pathlib import Path
import json
import os
import secrets
import subprocess
import tarfile
import shlex
from urllib.parse import urlsplit

BASE = Path('/opt/smlpos-staging')
PROJECT = 'smlpos-staging'
VOLUME = 'smlpos-staging_pgdata'
COMPOSE = ['docker','compose','--project-name',PROJECT,
           '--project-directory',str(BASE),'--env-file',str(BASE/'.env'),
           '-f',str(BASE/'docker-compose.staging.yml')]
DEADMAN_SOURCE = '__DEADMAN_SOURCE__'
DEADMAN = ['systemd-run','--unit=smlpos-staging-deadman','--on-active=3h',
           '/usr/bin/python3','-c',DEADMAN_SOURCE]


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def names(args):
    return set(run(args, capture_output=True, text=True).stdout.splitlines())


def validate_config(config):
    # Exact allowlists reject /opt/pos, production projects/volumes and external resources.
    if config.get('name') != PROJECT or set(config['services']) != {'postgres','api'}:
        raise SystemExit('Unsafe Compose project/services')
    if set(config.get('volumes',{})) != {'pgdata'} or config['volumes']['pgdata'].get('name') != VOLUME or config['volumes']['pgdata'].get('external'):
        raise SystemExit('Unsafe volume: production volume names forbidden')
    if set(config.get('networks',{})) != {'internal'} or config['networks']['internal'].get('name') != PROJECT+'_internal' or config['networks']['internal'].get('external'):
        raise SystemExit('Unsafe network')
    for name, service in config['services'].items():
        expected_memory = {'postgres': 512 * 1024 * 1024, 'api': 256 * 1024 * 1024}[name]
        if int(service.get('mem_limit', 0)) != expected_memory or not 0 < float(service.get('cpus',0)) <= 0.5:
            raise SystemExit('Unexpected resource limit: '+name)
        if any(service.get(k) for k in ['privileged','network_mode','container_name','volumes_from','devices','pid','ipc','external_links','links','extra_hosts','dns','cap_add']):
            raise SystemExit('Unsafe service settings: '+name)
        for port in service.get('ports',[]):
            if name != 'api' or port.get('host_ip') != '127.0.0.1' or str(port.get('published')) != '23001':
                raise SystemExit('Unsafe published port')
        for volume in service.get('volumes',[]):
            if volume['type'] == 'volume':
                if name != 'postgres' or volume['source'] != 'pgdata':
                    raise SystemExit('Unsafe named volume')
            elif volume['type'] != 'bind' or not Path(volume['source']).resolve().is_relative_to(BASE) or not volume.get('read_only'):
                raise SystemExit('Unsafe bind mount')
        if set(service.get('networks',{})) != {'internal'}:
            raise SystemExit('Unsafe service network')
    api_env = config['services']['api']['environment']
    database = urlsplit(api_env.get('DATABASE_URL', ''))
    if (database.scheme != 'postgresql' or database.hostname != 'postgres'
            or database.username != 'pos_api' or database.port != 5432
            or database.path != '/smlpos_staging' or database.query or database.fragment):
        raise SystemExit('Unsafe staging DATABASE_URL host or database')
    if config['services']['postgres'].get('environment', {}).get('POSTGRES_DB') != 'smlpos_staging':
        raise SystemExit('Unsafe staging PostgreSQL database name')
    if any(str(api_env.get(k)).lower() != 'true' for k in ['LIVE_WRITES_ENABLED','SEED_STAGING_ENABLED','SYNC2_ENABLED','STAGING_ONLY']):
        raise SystemExit('Unexpected staging feature flags')


def main():
    if BASE.is_symlink() or BASE.resolve() != BASE or BASE.parent.resolve() != Path('/opt'):
        raise SystemExit('Unsafe staging directory')
    if set(p.name for p in BASE.iterdir()) != {'sync-backend.tar.gz'}:
        raise SystemExit('Unexpected staging directory contents; stop and inspect')
    if names(['docker','ps','-aq','--filter','label=com.docker.compose.project='+PROJECT]):
        raise SystemExit('Staging containers already exist')
    if VOLUME in names(['docker','volume','ls','--format','{{.Name}}']):
        raise SystemExit('Staging volume already exists')
    if PROJECT+'_internal' in names(['docker','network','ls','--format','{{.Name}}']):
        raise SystemExit('Staging network already exists')
    with tarfile.open(BASE/'sync-backend.tar.gz') as tar:
        for item in tar.getmembers():
            if not (BASE/item.name).resolve().is_relative_to(BASE) or not item.isfile():
                raise SystemExit('Unsafe archive member')
        tar.extractall(BASE, filter='data')
    secret_dir = BASE/'secrets'
    secret_dir.mkdir(mode=0o700)
    values = {'MIN_CLIENT_VERSION':'1.9.1038',
              'LIVE_WRITES_ENABLED':'true','SEED_STAGING_ENABLED':'true',
              'SYNC2_ENABLED':'true','STAGING_ONLY':'true'}
    for name in ['PG_PASSWORD','API_DB_PASSWORD']:
        values[name] = secrets.token_hex(24)
    fd = os.open(BASE/'.env', os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
    with os.fdopen(fd,'w') as f:
        f.write(''.join(k+'='+v+'\n' for k,v in values.items()))
    key = secret_dir/'jwt_private.pem'
    run(['openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048','-out',str(key)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # API image runs as unprivileged node UID 1000; parent remains private.
    run(['chown','1000:1000',str(key)])
    key.chmod(0o400)
    os.chdir(BASE)
    # Resolved config contains secrets: validate in memory, never print it.
    config = json.loads(run([*COMPOSE,'config','--format','json'],
                            capture_output=True,text=True).stdout)
    validate_config(config)
    run([*COMPOSE,'config','--quiet'])
    if DEADMAN_SOURCE.startswith('__DEADMAN_'):
        raise SystemExit('Dead-man teardown payload was not embedded')
    print('Exact dead-man command:',shlex.join(DEADMAN),flush=True)
    # A scheduling failure blocks deployment. The inline source is stored by
    # systemd itself and does not execute a deploy-user-writable script as root.
    run(DEADMAN)
    run(['systemctl','is-active','--quiet','smlpos-staging-deadman.timer'])
    run(['systemctl','list-timers','smlpos-staging-deadman.timer','--no-pager'])
    run([*COMPOSE,'up','-d','--build','postgres','api'])
    run([*COMPOSE,'ps'])
    print('Complete tunnel/two-PC verification and reviewed teardown separately. Stop on any failure.')


if __name__ == '__main__':
    main()
