"""Prompt locally and pass a staging-only synthetic admin credential via stdin."""
import getpass
import json
from pathlib import Path
import subprocess
import sys


def main():
    password = getpass.getpass('Choose the synthetic staging admin password: ')
    if len(password) < 12:
        raise SystemExit('Password must be at least 12 characters.')
    confirmation = getpass.getpass('Repeat the synthetic staging admin password: ')
    if password != confirmation:
        raise SystemExit('Passwords did not match; nothing was sent.')
    payload = json.dumps({'username': 'desktop-proof', 'password': password, 'role': 'admin'})
    helper = Path(__file__).with_name('provision_staging_admin.py')
    result = subprocess.run([sys.executable, '-B', str(helper)], input=payload, text=True)
    return result.returncode


if __name__ == '__main__':
    sys.exit(main())
