"""Local preview by default; deploy only after approval and a clean Step B."""
import argparse
import base64
import hashlib
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
GENERATED = Path(__file__).parent / '.generated'
ARCHIVE = GENERATED / 'sync-backend.tar.gz'
HOST = '2.28.64.69'
PROJECT = 'smlpos-staging'
DIRECTORY = '/opt/smlpos-staging'
COMPOSE_FILE = 'docker-compose.staging.yml'
REMOTE = Path(__file__).with_name('stage_backend_remote.py').read_text()


def validate_pin(known_hosts: Path, fingerprint: str) -> None:
    if not re.fullmatch(r'SHA256:[A-Za-z0-9+/]{43}', fingerprint):
        raise SystemExit('Real trusted ED25519 SHA256 fingerprint required; placeholders refused.')
    lines = [line.split() for line in known_hosts.read_text().splitlines()
             if line.strip() and not line.startswith('#')]
    if len(lines) != 1 or len(lines[0]) != 3 or lines[0][:2] != [HOST, 'ssh-ed25519']:
        raise SystemExit('Known-hosts must contain exactly one literal-host ED25519 pin.')
    try:
        blob = base64.b64decode(lines[0][2], validate=True)
    except ValueError as exc:
        raise SystemExit('Invalid host public key') from exc
    if len(blob) != 51 or blob[:19] != b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20':
        raise SystemExit('Invalid ED25519 host public key encoding')
    actual = 'SHA256:' + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip('=')
    if actual != fingerprint:
        raise SystemExit(f'Host-key fingerprint mismatch: {actual}; refusing connection.')


def build_archive() -> None:
    GENERATED.mkdir(exist_ok=True)
    with tarfile.open(ARCHIVE, 'w:gz') as tar:
        # Never ship the production Compose file, Caddy, secrets or local .env.
        for entry in [COMPOSE_FILE, 'api', 'postgres', 'powersync']:
            source = ROOT / 'deploy' / entry
            for path in sorted(source.rglob('*')) if source.is_dir() else [source]:
                rel = path.relative_to(ROOT / 'deploy')
                if (path.is_symlink() or not path.is_file()
                    or any(p in {'node_modules','secrets','.generated','.git'} for p in rel.parts)
                    or path.name.startswith('.env') or path.suffix in {'.pem','.key','.db','.log'}):
                    continue
                tar.add(path, arcname=rel.as_posix(), recursive=False)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--shared-host-staging', action='store_true', required=True)
    parser.add_argument('--show-plan', action='store_true', help='Print commands without selecting or contacting a target')
    parser.add_argument('--execute', action='store_true', help='Default is local preview only')
    parser.add_argument('--step-b-clean', action='store_true', help='Attest reviewed Step B passed')
    args = parser.parse_args()
    if args.show_plan and (args.execute or args.step_b_clean):
        raise SystemExit('--show-plan cannot be combined with execution flags.')
    host = os.environ.get('SMLPOS_STAGING_HOST', '').strip()
    if not args.show_plan and not host:
        raise SystemExit('Refusing: set SMLPOS_STAGING_HOST explicitly; no target selected.')
    if host and host != HOST:
        raise SystemExit('This reviewed plan allows only 2.28.64.69.')
    # Exact allowlists: no directory/project/volume overrides, including through env.
    for name, expected in {'SMLPOS_STAGING_DIR':DIRECTORY,
                           'COMPOSE_PROJECT_NAME':PROJECT}.items():
        if os.environ.get(name, expected) != expected:
            raise SystemExit(f'Refusing {name}: only {expected} is permitted.')
    user = os.environ.get('SMLPOS_STAGING_SSH_USER', 'deploy')
    if not re.fullmatch(r'[a-z_][a-z0-9_-]*', user):
        raise SystemExit('Invalid SSH account')
    key = Path(os.environ.get('SMLPOS_STAGING_SSH_KEY', str(Path.home()/'.ssh'/'pos_codex')))
    known_hosts = Path(os.environ.get('SMLPOS_STAGING_KNOWN_HOSTS', str(GENERATED/'known_hosts')))
    if not args.show_plan:
        fingerprint = os.environ.get('SMLPOS_STAGING_HOST_FINGERPRINT', '')
        if not re.fullmatch(r'SHA256:[A-Za-z0-9+/]{43}', fingerprint):
            raise SystemExit('Refusing production host: verified ED25519 SHA256 fingerprint required.')
        if not known_hosts.is_file():
            raise SystemExit('Refusing production host: pinned known-hosts file required.')
        validate_pin(known_hosts, fingerprint)
    common = ['-i',str(key),'-o','IdentitiesOnly=yes','-o','BatchMode=yes',
              '-o','StrictHostKeyChecking=yes','-o','GlobalKnownHostsFile=none',
              '-o',f'UserKnownHostsFile={known_hosts}','-o','HostKeyAlgorithms=ssh-ed25519',
              '-o','UpdateHostKeys=no','-o','ConnectTimeout=10','-o','ConnectionAttempts=1']
    target = f'{user}@{HOST}'
    prepare = (f'test ! -e {DIRECTORY} && test ! -L {DIRECTORY} && '
               f'sudo -n install -d -m 0700 -o {user} -g $(id -gn) {DIRECTORY}')
    commands = [
        ['ssh',*common,target,prepare],
        ['scp',*common,str(ARCHIVE),f'{target}:{DIRECTORY}/sync-backend.tar.gz'],
        ['ssh',*common,target,'sudo -n python3 -'],
    ]
    print('LOCAL PLAN ONLY' if args.show_plan else 'PINNED LOCAL PREVIEW; no connection without --execute and --step-b-clean.')
    print(f'SSH user: {user}; identity file: {key}; host: {HOST}')
    for command in commands:
        print(shlex.join(command))
    print('--- Exact Python stdin for the final SSH command ---')
    print(REMOTE)
    if args.show_plan or not args.execute:
        return 0
    if not args.step_b_clean:
        raise SystemExit('Refusing execution: complete and review Step B first.')
    if not key.is_file():
        raise SystemExit('SSH identity absent; no connection attempted.')
    build_archive()
    subprocess.run(commands[0], check=True)
    subprocess.run(commands[1], check=True)
    return subprocess.run(commands[2], input=REMOTE, text=True).returncode


if __name__ == '__main__':
    sys.exit(main())
