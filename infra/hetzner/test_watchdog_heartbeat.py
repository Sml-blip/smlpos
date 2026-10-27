from datetime import datetime,timedelta,timezone
from pathlib import Path
import json
import unittest
from unittest.mock import patch
import watchdog_heartbeat


class HeartbeatTests(unittest.TestCase):
    def test_fresh_and_stale_and_stop(self):
        now=datetime(2026,1,1,tzinfo=timezone.utc)
        path=Path('not-opened')
        def line(seconds):return 'HEARTBEAT '+json.dumps({'timestamp':(now-timedelta(seconds=seconds)).isoformat(),'sample':{}})+'\n'
        with patch.object(Path,'read_text',return_value=line(29)):
            self.assertEqual(watchdog_heartbeat.check(path,now)[0],29)
        with patch.object(Path,'read_text',return_value=line(90)):
            with self.assertRaises(ValueError):watchdog_heartbeat.check(path,now)
        with patch.object(Path,'read_text',return_value=line(1)+'STOP: unsafe\n'):
            with self.assertRaises(ValueError):watchdog_heartbeat.check(path,now)


if __name__=='__main__':unittest.main(verbosity=2)
