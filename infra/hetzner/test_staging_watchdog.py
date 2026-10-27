import copy
import unittest
from unittest.mock import Mock
from unittest.mock import patch
import json
import types
import staging_watchdog as watchdog


class WatchdogTests(unittest.TestCase):
    def setUp(self):
        self.base={'available_mb':1000,'production':{'pos-v1-api':
            {'id':'abc','restarts':1,'started':'2026-01-01','running':True}}}

    def scenario(self, change):
        changed=copy.deepcopy(self.base)
        change(changed)
        teardown=Mock(return_value='simulated teardown')
        code=watchdog.run_monitor(Mock(side_effect=[self.base,changed]),teardown,sleep=lambda _:None,iterations=1)
        self.assertEqual(code,1)
        teardown.assert_called_once()

    def test_low_memory_tears_down(self):
        self.scenario(lambda x:x.update(available_mb=799))

    def test_restart_tears_down(self):
        self.scenario(lambda x:x['production']['pos-v1-api'].update(restarts=2))

    def test_replacement_tears_down(self):
        self.scenario(lambda x:x['production']['pos-v1-api'].update(id='different'))

    def test_stopped_tears_down(self):
        self.scenario(lambda x:x['production']['pos-v1-api'].update(running=False))

    def test_healthy_does_not_teardown(self):
        teardown=Mock()
        self.assertEqual(watchdog.run_monitor(lambda:self.base,teardown,sleep=lambda _:None,iterations=1),0)
        teardown.assert_not_called()

    def test_no_production_refused(self):
        with self.assertRaises(ValueError): watchdog.unsafe_reason({'production':{}},{'available_mb':1000,'production':{}})

    def test_teardown_rejects_production_name_even_if_mislabelled(self):
        production={'Name':'/pos-v1-api','Id':'production-id',
                    'Config':{'Labels':{'com.docker.compose.project':'smlpos-staging'}},
                    'Mounts':[],'NetworkSettings':{'Networks':{'pos-v1-network':{}}}}
        removed=[]
        def output(args, text):
            if args[:2]==('docker','ps'): return 'production-id\n'
            if args[:2]==('docker','inspect'): return json.dumps([production])
            raise AssertionError(args)
        fake=types.SimpleNamespace(check_output=output,run=lambda *args,**kwargs:removed.append(args))
        with patch.dict('sys.modules',{'subprocess':fake}):
            with self.assertRaisesRegex(SystemExit,'Refusing unexpected staging container'):
                exec(watchdog.TEARDOWN,{})
        self.assertEqual(removed,[])


if __name__=='__main__': unittest.main(verbosity=2)
