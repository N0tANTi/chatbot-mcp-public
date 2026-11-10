import pathlib
import sqlite3
import tempfile
import unittest
from migrate_web_host_history import migrate


class HistoryMigration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = pathlib.Path(self.tmp.name) / 'runtime'
        self.home = pathlib.Path(self.tmp.name) / 'home'
        (self.base / 'data').mkdir(parents=True)
        self.native = '00000000-0000-0000-0000-000000000001'
        con = sqlite3.connect(self.base / 'data/auth.db')
        con.executescript('CREATE TABLE users(id,username,is_active); INSERT INTO users VALUES(1,"appuser",1); CREATE TABLE cc_projects(user_id,cwd,legacy); INSERT INTO cc_projects VALUES(1,"/sample/project",0); CREATE TABLE sessions(session_id,provider_session_id,project_path,jsonl_path);')
        con.execute('INSERT INTO sessions VALUES(?,?,?,?)', ('app', self.native, '/sample/project', 'old'))
        con.commit(); con.close()
        self.source = self.base / 'data/tenants/1/home/.claude/projects/-sample-project'
        self.source.mkdir(parents=True)
        (self.source / f'{self.native}.jsonl').write_text('preserved-history')
        (self.source / 'memory').mkdir()
        (self.source / 'memory/MEMORY.md').write_text('project-memory')
        self.target = self.home / '.claude/projects/-sample-project'

    def test_dry_run_copy_memory_and_idempotent_migration(self):
        self.assertEqual(migrate(self.base, self.home)['files'], 2)
        self.assertFalse(self.target.exists())
        migrate(self.base, self.home, True)
        self.assertEqual((self.target / 'memory/MEMORY.md').read_text(), 'project-memory')
        self.assertTrue((self.source / f'{self.native}.jsonl').exists())
        self.assertEqual(migrate(self.base, self.home, True)['files'], 0)
        (self.target / f'{self.native}.jsonl').write_text('new-native-turn')
        self.assertEqual(migrate(self.base, self.home, True)['files'], 0)
        self.assertEqual((self.target / f'{self.native}.jsonl').read_text(), 'new-native-turn')
        con = sqlite3.connect(self.base / 'data/auth.db')
        self.assertEqual(con.execute('SELECT jsonl_path FROM sessions').fetchone()[0], str(self.target / f'{self.native}.jsonl'))
        con.close()

    def test_conflict_leaves_both_histories_and_database_unchanged(self):
        self.target.mkdir(parents=True)
        (self.target / f'{self.native}.jsonl').write_text('different')
        with self.assertRaisesRegex(RuntimeError, 'conflicts'):
            migrate(self.base, self.home, True)
        self.assertEqual((self.target / f'{self.native}.jsonl').read_text(), 'different')
        con = sqlite3.connect(self.base / 'data/auth.db')
        self.assertEqual(con.execute('SELECT jsonl_path FROM sessions').fetchone()[0], 'old')
        con.close()

    def test_second_account_is_left_alone(self):
        con = sqlite3.connect(self.base / 'data/auth.db')
        con.execute('INSERT INTO users VALUES(2,"other",1)'); con.execute('INSERT INTO cc_projects VALUES(2,"/other/project",0)'); con.commit(); con.close()
        self.assertEqual(migrate(self.base, self.home, True)['applied'], True)
        self.assertTrue((self.target / f'{self.native}.jsonl').is_file())

    def test_missing_anti_account_refuses_migration(self):
        con = sqlite3.connect(self.base / 'data/auth.db')
        con.execute('UPDATE users SET username="someone"'); con.commit(); con.close()
        with self.assertRaisesRegex(RuntimeError, 'one active appuser'):
            migrate(self.base, self.home, True)


if __name__ == '__main__':
    unittest.main()
