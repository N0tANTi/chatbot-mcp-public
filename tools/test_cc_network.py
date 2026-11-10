"""Verify the ordinary entry and explicit overrides without a model/network call."""
import importlib.util, os, pathlib, unittest
from unittest.mock import patch,MagicMock
spec=importlib.util.spec_from_file_location('cc_network',pathlib.Path(__file__).with_name('cc_network.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class NetworkTests(unittest.TestCase):
    def test_entry_and_mode(self):
        for name in ['claude','claude-net']:
            with patch.object(m.sys,'argv',[name,'--version']),patch.object(m,'run') as run:
                m.main();run.assert_called_once_with(['--version'])
    def test_explicit_modes(self):
        for flag,expected in [('--proxy',True)]:
            with patch.object(m,'mode',return_value='on'),patch.object(m.subprocess,'run',return_value=MagicMock(returncode=0,stdout='{"CLAUDE_CODE_OAUTH_TOKEN":"fixture"}')),patch.object(m.socket,'create_connection',return_value=MagicMock()),patch.object(m.os,'execve') as execute,patch.dict(os.environ,{'https_proxy':'wrong','NO_PROXY':'*','ANTHROPIC_API_KEY':'obsolete'}):
                m.run([flag,'--version']);executable,args,env=execute.call_args.args
                self.assertTrue(executable.replace('\\','/').endswith('/@anthropic-ai/claude-code/bin/claude.exe'))
                self.assertEqual(args[-1],'--version');self.assertNotIn('https_proxy',env)
                self.assertEqual('HTTPS_PROXY' in env,expected)
                self.assertNotIn('ANTHROPIC_API_KEY',env)
                self.assertEqual(env['CLAUDE_CODE_OAUTH_TOKEN'],'fixture')
                if expected:self.assertEqual(env['HTTPS_PROXY'],m.PROXY)
    def test_refuse_direct_and_failed_broker(self):
        with patch.object(m,'mode',return_value='on'),patch.object(m.os,'execve') as execute:
            with self.assertRaises(SystemExit): m.run(['--direct'])
            with patch.object(m.subprocess,'run',return_value=MagicMock(returncode=1)):
                with self.assertRaises(SystemExit): m.run([])
            execute.assert_not_called()
    def test_explicit_login_uses_probe_not_old_credentials(self):
        with patch.object(m,'mode',return_value='on'),patch.object(m.subprocess,'run',return_value=MagicMock(returncode=0,stdout='PROXY_READY')) as helper,patch.object(m.socket,'create_connection',return_value=MagicMock()),patch.object(m.os,'execve') as execute,patch.dict(os.environ,{'CLAUDE_CODE_OAUTH_TOKEN':'obsolete'}):
            m.run(['auth','login','--claudeai'])
            self.assertEqual(helper.call_args.args[0][-1],'--probe')
            env=execute.call_args.args[2]
            self.assertNotIn('CLAUDE_CODE_OAUTH_TOKEN',env)
            self.assertEqual(env['CLAUDE_CONFIG_DIR'],'/home/appuser/cloudcli-runtime/data/official-account')
if __name__=='__main__':unittest.main()
