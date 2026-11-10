"""No network or actual credential use. Models a depleted/failed proxy and refresh."""
import importlib.util
import json
import pathlib
import sys
import tempfile
import time
import unittest
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

if sys.platform == 'win32':
    sys.modules['fcntl'] = MagicMock()
spec = importlib.util.spec_from_file_location('official', pathlib.Path(__file__).with_name('cc_official.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class OfficialTests(unittest.TestCase):
    @contextmanager
    def profile(self, expired=False):
        with tempfile.TemporaryDirectory() as directory, patch.object(m,'PROFILE',pathlib.Path(directory)):
            target=pathlib.Path(directory)/'.credentials.json'
            original={'claudeAiOauth':{'accessToken':'fixture-access','refreshToken':'fixture-refresh','expiresAt':1 if expired else int((time.time()+3600)*1000)}}
            target.write_text(json.dumps(original));target.chmod(0o600)
            with patch.object(pathlib.Path,'stat',return_value=MagicMock(st_uid=0,st_mode=0o600)),patch.object(m.os,'getuid',return_value=0,create=True):
                yield target,original

    def test_repeated_web_turns_make_no_external_probe(self):
        with self.profile(), patch.object(m,'require_proxy_policy') as policy, patch.object(m,'preflight') as probe, patch.object(m,'request') as request:
            for _ in range(3):self.assertEqual(m.credential(probe=False),{'CLAUDE_CODE_OAUTH_TOKEN':'fixture-access'})
            self.assertEqual(policy.call_count,3)
            probe.assert_not_called();request.assert_not_called()

    def test_web_refresh_probes_before_sending_refresh_and_only_once(self):
        with self.profile(expired=True),patch.object(m,'require_proxy_policy'),patch.object(m,'preflight') as probe,patch.object(m,'request') as request:
            def refresh(*args):
                probe.assert_called_once()
                return 200,json.dumps({'access_token':'fresh','expires_in':3600}).encode()
            request.side_effect=refresh
            self.assertEqual(m.credential(probe=False),{'CLAUDE_CODE_OAUTH_TOKEN':'fresh'})
            self.assertEqual(m.credential(probe=False),{'CLAUDE_CODE_OAUTH_TOKEN':'fresh'})
            request.assert_called_once();probe.assert_called_once()

    def test_failed_web_refresh_probe_preserves_credential_and_sends_no_token(self):
        with self.profile(expired=True) as (target,original),patch.object(m,'require_proxy_policy'),patch.object(m,'preflight',side_effect=RuntimeError('offline')),patch.object(m,'request') as request:
            with self.assertRaises(RuntimeError):m.credential(probe=False)
            request.assert_not_called();self.assertEqual(json.loads(target.read_text()),original)

    def test_web_turn_still_rejects_direct_policy_without_external_request(self):
        with patch.object(m,'require_proxy_policy',side_effect=RuntimeError('direct')),patch.object(m,'PROFILE') as profile,patch.object(m,'request') as request:
            with self.assertRaises(RuntimeError):m.credential(probe=False)
            profile.__truediv__.assert_not_called();request.assert_not_called()

    def test_failed_proxy_never_reads_credentials_or_refreshes(self):
        with patch.object(m, 'preflight', side_effect=RuntimeError('quota depleted')), patch.object(m, 'PROFILE') as profile:
            with self.assertRaises(RuntimeError): m.credential()
            profile.__truediv__.assert_not_called()

    def test_off_policy_never_opens_connection(self):
        with patch.object(m, 'MODE') as mode, patch.object(m, 'request') as request:
            mode.read_text.return_value = 'off'
            with self.assertRaises(RuntimeError): m.preflight()
            request.assert_not_called()

    def test_mihomo_direct_or_fallback_policy_is_rejected(self):
        with patch.object(m, 'control', return_value={'mode':'direct'}):
            with self.assertRaises(RuntimeError): m.proxy_policy()
        fixtures=[{'mode':'rule'}, {'rules':[{'type':'Match','proxy':'CC-NODE'}]}, {'now':'DIRECT','all':['DIRECT']}]
        with patch.object(m, 'control', side_effect=fixtures):
            with self.assertRaises(RuntimeError): m.proxy_policy()
        fixtures=[{'mode':'rule'}, {'rules':[{'type':'Match','proxy':'CC-NODE'}]}, {'now':'Node-5','all':['Node-5']}, {'type':'Vmess'}]
        with patch.object(m, 'control', side_effect=fixtures): m.proxy_policy()

    def test_rotation_is_atomic_and_failure_retains_credentials(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(m, 'PROFILE', pathlib.Path(directory)), patch.object(m, 'preflight'), patch.object(m.os, 'getuid', return_value=pathlib.Path(directory).stat().st_uid, create=True):
            target = pathlib.Path(directory) / '.credentials.json'
            original = {'claudeAiOauth': {'accessToken':'old', 'refreshToken':'private-refresh', 'expiresAt':1}, 'other':'preserved'}
            target.write_text(json.dumps(original));target.chmod(0o600)
            # Windows does not expose Unix permission bits consistently.
            with patch.object(pathlib.Path, 'stat', return_value=MagicMock(st_uid=0, st_mode=0o600)), patch.object(m.os, 'getuid', return_value=0, create=True):
                with patch.object(m, 'request', return_value=(503,b'unavailable')):
                    with self.assertRaises(RuntimeError): m.credential()
                self.assertEqual(json.loads(target.read_text()), original)
                with patch.object(m, 'request', return_value=(200,json.dumps({'access_token':'new', 'refresh_token':'rotated', 'expires_in':3600}).encode())):
                    self.assertEqual(m.credential(), {'CLAUDE_CODE_OAUTH_TOKEN':'new'})
                saved=json.loads(target.read_text())
                self.assertEqual(saved['claudeAiOauth']['refreshToken'],'rotated')
                self.assertEqual(saved['other'],'preserved')
                self.assertGreater(saved['claudeAiOauth']['expiresAt'],time.time()*1000)


if __name__ == '__main__': unittest.main()
