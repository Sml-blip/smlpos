import json
import unittest
from unittest.mock import patch

import provision_staging_admin_interactive as interactive


class InteractiveTests(unittest.TestCase):
    def test_password_goes_only_to_stdin(self):
        secret = 'synthetic-test-password'
        with patch.object(interactive.getpass, 'getpass', side_effect=[secret, secret]), \
             patch.object(interactive.subprocess, 'run') as run:
            run.return_value.returncode = 0
            self.assertEqual(interactive.main(), 0)
        args, kwargs = run.call_args
        self.assertNotIn(secret, repr(args))
        self.assertNotIn(secret, repr({k: v for k, v in kwargs.items() if k != 'input'}))
        self.assertEqual(json.loads(kwargs['input']), {'username': 'desktop-proof', 'password': secret, 'role': 'admin'})

    def test_mismatch_does_not_run_helper(self):
        with patch.object(interactive.getpass, 'getpass', side_effect=['synthetic-pass-one', 'synthetic-pass-two']), \
             patch.object(interactive.subprocess, 'run') as run:
            with self.assertRaises(SystemExit):
                interactive.main()
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
