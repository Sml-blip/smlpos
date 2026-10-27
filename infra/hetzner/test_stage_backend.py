"""Offline safety checks: no SSH, Docker, DNS or server access."""
import base64
from contextlib import redirect_stdout
import copy
import hashlib
import io
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import stage_backend as local
import stage_backend_remote as remote


class SafetyTests(unittest.TestCase):
    def call_main(self, args, env=None):
        with patch.object(sys, 'argv', ['stage_backend.py', *args]), \
             patch.dict(os.environ, {'USERPROFILE':str(local.ROOT), **(env or {})}, clear=True), \
             patch.object(local.subprocess, 'run', side_effect=AssertionError('Network call forbidden')), \
             redirect_stdout(io.StringIO()):
            return local.main()

    def test_preview_never_connects(self):
        self.assertEqual(self.call_main(['--shared-host-staging','--show-plan']), 0)

    def test_deadman_is_embedded_and_scheduled_before_compose_up(self):
        self.assertIn('Remove only verified smlpos-staging Docker resources',local.REMOTE)
        self.assertIn("'--on-active=3h'",local.REMOTE)
        self.assertIn('PREPARED: timer active; no staging container started.',local.REMOTE)

    def test_archive_is_streamed_over_ssh_without_scp(self):
        with patch.object(sys, 'argv', ['stage_backend.py','--shared-host-staging','--show-plan']), \
             patch.dict(os.environ, {'USERPROFILE':str(local.ROOT)}, clear=True), \
             redirect_stdout(io.StringIO()) as out:
            self.assertEqual(local.main(),0)
        plan=out.getvalue()
        self.assertIn('set -C; umask 077; cat > /opt/smlpos-staging/sync-backend.tar.gz',plan)
        self.assertIn('second SSH command receives the binary archive on stdin',plan)
        self.assertNotIn('\nscp ',plan)

    def test_execute_streams_archive_as_stdin_in_order(self):
        calls=[]
        def fake_run(command, **kwargs):
            calls.append(command)
            if len(calls)==2:
                self.assertEqual(kwargs['stdin'].read(),b'synthetic archive')
            return type('Result',(),{'returncode':0})()
        with patch.object(sys,'argv',['stage_backend.py','--shared-host-staging','--execute','--step-b-clean','--prepare-only']), \
             patch.dict(os.environ,{'USERPROFILE':str(local.ROOT),'SMLPOS_STAGING_HOST':local.HOST,
                'SMLPOS_STAGING_HOST_FINGERPRINT':'SHA256:'+'A'*43},clear=True), \
             patch.object(local,'validate_pin'), patch.object(local,'build_archive'), \
             patch.object(Path,'is_file',return_value=True), \
             patch.object(Path,'open',return_value=io.BytesIO(b'synthetic archive')), \
             patch.object(local.subprocess,'run',side_effect=fake_run), redirect_stdout(io.StringIO()):
            self.assertEqual(local.main(),0)
        self.assertEqual(len(calls),3)
        self.assertIn('install -d',calls[0][-1])
        self.assertIn('cat > /opt/smlpos-staging/sync-backend.tar.gz',calls[1][-1])
        self.assertEqual(calls[2][-1],'sudo -n python3 -')

    def test_no_target_and_unpinned_production_are_refused(self):
        with self.assertRaisesRegex(SystemExit, 'no target selected'):
            self.call_main(['--shared-host-staging'])
        with self.assertRaisesRegex(SystemExit, 'Refusing production host'):
            self.call_main(['--shared-host-staging'], {'SMLPOS_STAGING_HOST':local.HOST})

    def test_explicit_shared_acknowledgement_required(self):
        with self.assertRaises(SystemExit):
            self.call_main([])

    def test_execution_requires_clean_step_b(self):
        with patch.object(local, 'validate_pin'), patch.object(Path, 'is_file', return_value=True):
            with self.assertRaisesRegex(SystemExit, 'complete and review Step B'):
                self.call_main(['--shared-host-staging','--execute'],
                    {'SMLPOS_STAGING_HOST':local.HOST,'SMLPOS_STAGING_HOST_FINGERPRINT':'SHA256:'+'A'*43})

    def test_placeholder_cannot_connect(self):
        with self.assertRaisesRegex(SystemExit, 'fingerprint required'):
            self.call_main(['--shared-host-staging','--execute','--step-b-clean'],
                           {'SMLPOS_STAGING_HOST':local.HOST,'SMLPOS_STAGING_HOST_FINGERPRINT':'<PASTE SHA256:... (ED25519) HERE>'})

    def test_production_directory_and_project_refused(self):
        for env in [{'SMLPOS_STAGING_DIR':'/opt/pos'},
                    {'SMLPOS_STAGING_DIR':'/opt/pos/staging'},
                    {'COMPOSE_PROJECT_NAME':'pos-sync-staging'},
                    {'SMLPOS_STAGING_HOST':'api.pos.sml.boutique'}]:
            with self.subTest(env=env), self.assertRaises(SystemExit):
                self.call_main(['--shared-host-staging','--show-plan'], env)

    def test_pin_matches_exact_ed25519_key_only(self):
        blob = b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20' + bytes(range(32))
        fingerprint = 'SHA256:' + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip('=')
        line = local.HOST+' ssh-ed25519 '+base64.b64encode(blob).decode()+'\n'
        pin = Path('offline-known-hosts-fixture')
        with patch.object(Path, 'read_text', return_value=line) as read:
            local.validate_pin(pin, fingerprint)
            with self.assertRaisesRegex(SystemExit, 'mismatch'):
                local.validate_pin(pin, 'SHA256:'+'A'*43)
            read.return_value = line+line
            with self.assertRaises(SystemExit):
                local.validate_pin(pin, fingerprint)

    def test_compose_rejects_production_resources(self):
        config = {'name':'smlpos-staging',
                  'volumes':{'pgdata':{'name':'smlpos-staging_pgdata'}},
                  'networks':{'internal':{'name':'smlpos-staging_internal'}},
                  'services':{name:{'mem_limit':256*1024*1024,'cpus':0.5,'networks':{'internal':None}}
                              for name in ['postgres','api']}}
        config['services']['postgres']['environment'] = {'POSTGRES_DB':'smlpos_staging'}
        config['services']['postgres']['mem_limit'] = 512*1024*1024
        config['services']['api']['environment'] = {key:'true' for key in
            ['LIVE_WRITES_ENABLED','SEED_STAGING_ENABLED','SYNC2_ENABLED','STAGING_ONLY']}
        config['services']['api']['environment']['DATABASE_URL'] = 'postgresql://pos_api:secret@postgres:5432/smlpos_staging'
        remote.validate_config(config)
        variants = []
        def changed():
            result = copy.deepcopy(config)
            variants.append(result)
            return result
        changed()['name'] = 'pos-sync-staging'
        changed()['name'] = 'pos-v1-production'
        changed()['volumes']['pgdata']['name'] = 'pos-sync-staging_pgdata'
        changed()['volumes']['pgdata']['name'] = 'pos-v1_pgdata'
        changed()['networks']['internal']['name'] = 'pos-sync-staging_internal'
        changed()['networks']['internal']['name'] = 'pos-v1-network'
        changed()['volumes']['pgdata']['external'] = True
        changed()['networks']['internal']['external'] = True
        changed()['services']['api']['ports'] = [{'host_ip':'0.0.0.0','published':'23001'}]
        changed()['services']['api']['ports'] = [{'host_ip':'127.0.0.1','published':'443'}]
        changed()['services']['api']['mem_limit'] = 0
        changed()['services']['postgres']['cpus'] = 0
        changed()['services']['api']['volumes'] = [{'type':'bind','source':'/opt/pos','read_only':True}]
        changed()['services']['api']['volumes'] = [{'type':'bind','source':'/opt/pos-v1/secrets','read_only':True}]
        changed()['services']['api']['volumes'] = [{'type':'bind','source':'/var/run/docker.sock','read_only':True}]
        changed()['services']['postgres']['volumes'] = [{'type':'volume','source':'production_pgdata'}]
        changed()['services']['api']['network_mode'] = 'host'
        changed()['services']['api']['container_name'] = 'pos-v1-api'
        changed()['services']['api']['environment']['LIVE_WRITES_ENABLED'] = 'false'
        changed()['services']['api']['environment']['DATABASE_URL'] = 'postgresql://x:y@postgres:5432/pos'
        changed()['services']['api']['environment']['DATABASE_URL'] = 'postgresql://x:y@pos-sync-staging-postgres-1:5432/smlpos_staging'
        changed()['services']['api']['environment']['DATABASE_URL'] = 'postgresql://pos_api:y@postgres:5432/smlpos_staging?host=pos-sync-staging-postgres-1'
        changed()['services']['postgres']['environment']['POSTGRES_DB'] = 'pos'
        for index, invalid in enumerate(variants):
            with self.subTest(index=index), self.assertRaises(SystemExit):
                remote.validate_config(invalid)


if __name__ == '__main__':
    unittest.main(verbosity=2)
