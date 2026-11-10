#!/usr/bin/env python3
"""Private official-account broker. No login initiation or direct transport.

Only the trusted host bridge/launcher may invoke this helper. Its stdout is a
secret channel to their memory, never a log or an HTTP response. The refresh
token and profile stay outside every tenant sandbox.
"""
import fcntl
import http.client
import json
import os
from pathlib import Path
import ssl
import sys
import time

PROFILE = Path('/home/appuser/cloudcli-runtime/data/official-account')
MODE = Path('/home/appuser/.local/cc-proxy/mode')
CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'  # installed native CLI public client


def control(path):
    key = json.loads((MODE.parent / 'control.json').read_text())['secret']
    conn = http.client.HTTPConnection('127.0.0.1', 19090, timeout=3)
    try:
        conn.request('GET', path, headers={'Authorization': 'Bearer ' + key})
        response = conn.getresponse()
        if response.status != 200:
            raise RuntimeError('proxy control unavailable')
        raw = response.read(1048577)
        if len(raw) > 1048576:
            raise RuntimeError('invalid proxy policy')
        return json.loads(raw)
    finally:
        conn.close()


def proxy_policy():
    if control('/configs').get('mode') != 'rule':
        raise RuntimeError('proxy may bypass upstream')
    rules = control('/rules').get('rules', [])
    if len(rules) != 1 or rules[0].get('type') != 'Match' or rules[0].get('proxy') != 'CC-NODE':
        raise RuntimeError('proxy rules allow a different route')
    group = control('/proxies/CC-NODE')
    selected = group.get('now', '')
    if not selected.startswith('Node-') or any(x.upper() == 'DIRECT' for x in group.get('all', [])):
        raise RuntimeError('direct fallback forbidden')
    if control('/proxies/' + selected).get('type', '').lower() not in ('vmess', 'vless', 'trojan', 'shadowsocks', 'socks5', 'http'):
        raise RuntimeError('invalid upstream node')


def request(host, path, body=None):
    # CONNECT explicitly to the owned proxy. Environment/NO_PROXY cannot bypass
    # this transport. TLS verifies the final destination, including refresh.
    conn = http.client.HTTPSConnection('127.0.0.1', 17890, timeout=15,
                                      context=ssl.create_default_context())
    conn.set_tunnel(host, 443)
    try:
        data = None if body is None else json.dumps(body).encode()
        conn.request('GET' if body is None else 'POST', path, body=data,
                     headers={'Content-Type': 'application/json'} if data else {})
        response = conn.getresponse()
        raw = response.read(65537)
        if len(raw) > 65536:
            raise RuntimeError('response too large')
        return response.status, raw
    finally:
        conn.close()


def require_proxy_policy():
    if MODE.read_text().strip() != 'on':
        raise RuntimeError('proxy policy disabled')
    proxy_policy()


def preflight():
    require_proxy_policy()
    status, _ = request('api.anthropic.com', '/')
    if status not in (200, 404):
        raise RuntimeError('proxy route unavailable')


def credential(probe=True):
    # Terminal startup probes once. A web turn uses the backend's startup probe,
    # retaining local mandatory-route checks without another external request.
    if probe:
        preflight()
    else:
        require_proxy_policy()
    os.umask(0o077)
    with (PROFILE / '.broker.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        target = PROFILE / '.credentials.json'
        stat = target.stat()
        if stat.st_uid != os.getuid() or stat.st_mode & 0o077 or target.is_symlink():
            raise RuntimeError('credential permissions invalid')
        document = json.loads(target.read_text())
        token = document['claudeAiOauth']
        if token.get('expiresAt', 0) < (time.time() + 600) * 1000:
            if not token.get('refreshToken'):
                raise RuntimeError('official authorization expired')
            if not probe:
                # Recheck under the credential lock, immediately before sending
                # a refresh token. Concurrent turns see the fresh saved token.
                preflight()
            status, raw = request('platform.claude.com', '/v1/oauth/token', {
                'grant_type': 'refresh_token', 'refresh_token': token['refreshToken'],
                'client_id': CLIENT_ID,
            })
            if status != 200:
                raise RuntimeError('official refresh unavailable')
            fresh = json.loads(raw)
            if not isinstance(fresh.get('access_token'), str) or not 60 < fresh.get('expires_in', 0) <= 31536000:
                raise RuntimeError('invalid refresh response')
            token.update(accessToken=fresh['access_token'],
                         refreshToken=fresh.get('refresh_token') or token['refreshToken'],
                         expiresAt=int((time.time() + fresh['expires_in']) * 1000))
            if fresh.get('scope'):
                token['scopes'] = fresh['scope'].split()
            temporary = PROFILE / f'.credentials.broker-{os.getpid()}.tmp'
            try:
                with temporary.open('x') as output:
                    json.dump(document, output)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)
        if not isinstance(token.get('accessToken'), str) or not token['accessToken']:
            raise RuntimeError('official account not authorized')
        return {'CLAUDE_CODE_OAUTH_TOKEN': token['accessToken']}


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['--probe']:
            preflight()
            print('PROXY_READY')
        elif not sys.argv[1:]:
            print(json.dumps(credential()))
        elif sys.argv[1:] == ['--web-run']:
            print(json.dumps(credential(probe=False)))
        else:
            raise RuntimeError('invalid invocation')
    except Exception:
        # Do not forward provider bodies, URLs, exception details or tokens.
        sys.exit('官方账号连接暂不可用：请检查代理流量、节点和授权；已阻止请求，不会直连或自动重新登录。')
