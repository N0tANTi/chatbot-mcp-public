"""Copy appuser's web histories to native CC storage without overwriting any file.

Run only while the web service is stopped, after a consistent auth.db backup.
Sources remain intact. No settings, credentials or project workspaces are moved.
"""
import argparse
import hashlib
import pathlib
import re
import shutil
import sqlite3


def digest(file):
    return hashlib.sha256(file.read_bytes()).digest()


def migrate(base, home, apply=False):
    con = sqlite3.connect(base / 'data/auth.db')
    try:
        # Only appuser ever ran in the old sandbox; a second login starts on the host
        # with its own config root and has nothing to migrate.
        users = con.execute("SELECT id FROM users WHERE is_active=1 AND username='appuser'").fetchall()
        if len(users) != 1:
            raise RuntimeError('Expected exactly one active appuser account')
        uid = users[0][0]
        projects = con.execute('SELECT cwd,legacy FROM cc_projects WHERE user_id=?', (uid,)).fetchall()
        copies, updates = [], []
        for cwd, legacy in projects:
            if legacy:
                continue
            encoded = re.sub(r'[^a-zA-Z0-9]', '-', cwd)
            source = base / f'data/tenants/{uid}/home/.claude/projects' / encoded
            target = home / '.claude/projects' / encoded
            if source.is_symlink() or target.is_symlink():
                raise RuntimeError('Unexpected history directory link')
            sessions = con.execute('SELECT session_id,provider_session_id,jsonl_path FROM sessions WHERE project_path=? AND provider_session_id IS NOT NULL', (cwd,)).fetchall()
            if sessions and all(old == str(target / f'{native}.jsonl') for _, native, old in sessions):
                if not all((target / f'{native}.jsonl').is_file() for _, native, _ in sessions):
                    raise RuntimeError('Migrated native transcript missing')
                # Later native turns/auto memory may have advanced. Never replay
                # the intentionally-retained, now-stale sandbox copies over them.
                continue
            if source.exists():
                for file in source.rglob('*'):
                    if file.is_symlink():
                        raise RuntimeError('Unexpected history link')
                    if not file.is_file():
                        continue
                    dest = target / file.relative_to(source)
                    if any(parent.is_symlink() for parent in [dest, *dest.parents]):
                        raise RuntimeError('Unexpected native history link')
                    if dest.exists():
                        if digest(file) != digest(dest):
                            raise RuntimeError('Native history conflicts; nothing overwritten')
                    else:
                        copies.append((file, dest))
            for sid, native, _ in sessions:
                if not native:
                    continue
                if not re.fullmatch(r'[a-fA-F0-9-]{36}', native):
                    raise RuntimeError('Unexpected native session identifier')
                dest = target / f'{native}.jsonl'
                if not dest.is_file() and not any(d == dest for _, d in copies):
                    raise RuntimeError('Native transcript missing')
                updates.append((str(dest), sid))
        size = sum(file.stat().st_size for file, _ in copies)
        if apply:
            for file, dest in copies:
                dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                # Exclusive create also protects against a new conflicting file.
                with file.open('rb') as src, dest.open('xb') as dst:
                    shutil.copyfileobj(src, dst)
                dest.chmod(0o600)
                if digest(file) != digest(dest):
                    raise RuntimeError('History copy checksum mismatch')
            con.executemany('UPDATE sessions SET jsonl_path=? WHERE session_id=?', updates)
            con.commit()
        return {'files': len(copies), 'bytes': size, 'sessionPointers': len(updates), 'applied': apply}
    finally:
        con.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    print(migrate(pathlib.Path('/home/appuser/cloudcli-runtime'), pathlib.Path('/home/appuser'), args.apply))
