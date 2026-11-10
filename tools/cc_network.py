#!/usr/bin/env python3
"""CC proxy switch and private Mihomo diagnostics. No credential output."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request
import urllib.error

ROOT = Path.home() / '.local/cc-proxy'
PROXY = 'http://127.0.0.1:17890'
API = 'http://127.0.0.1:19090'
KEYS = ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
        'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy')


def mode():
    value = (ROOT / 'mode').read_text().strip() if (ROOT / 'mode').exists() else None
    if value != 'on':
        raise SystemExit('CC requires the owned proxy; launch blocked')
    return value


def api(path, method='GET', data=None):
    secret = json.loads((ROOT / 'control.json').read_text())['secret']
    body = json.dumps(data).encode() if data is not None else None
    request = urllib.request.Request(API + path, data=body, method=method,
        headers={'Authorization': 'Bearer ' + secret, 'Content-Type': 'application/json'})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=5) as response:
        result = response.read()
    return json.loads(result) if result else {}


def run(args):
    selected = mode()
    if args and args[0] in ('--proxy', '--direct'):
        if args.pop(0) == '--direct':
            raise SystemExit('Direct CC access is disabled by server policy')
    env = os.environ.copy()
    for key in list(env):
        if key.startswith(('ANTHROPIC_', 'CLAUDE_CODE_OAUTH', 'CLAUDE_CODE_USE_', 'CLAUDE_CODE_SUBAGENT_MODEL')):
            env.pop(key)
    # Trusted helper keeps the refresh token outside tool sandboxes and performs
    # a credential-free proxy probe before reading/refreshing authorization.
    manual_login = args[:2] == ['auth', 'login']
    helper = subprocess.run(['/usr/bin/python3', str(ROOT / 'official-account.py'), *(['--probe'] if manual_login else [])],
                            capture_output=True, text=True, timeout=45)
    if helper.returncode:
        raise SystemExit('Official account unavailable: check proxy traffic/node and authorization. No direct retry or automatic login.')
    if manual_login:
        # Explicit human reauthorization must work even if the old refresh token
        # was revoked, but only after the same fail-closed proxy preflight.
        env['CLAUDE_CONFIG_DIR'] = '/home/appuser/cloudcli-runtime/data/official-account'
    else:
        env.update(json.loads(helper.stdout))
    for key in KEYS:
        env.pop(key, None)
    if selected == 'on':
        with socket.create_connection(('127.0.0.1', 17890), timeout=2):
            pass
        env.update(HTTPS_PROXY=PROXY, HTTP_PROXY=PROXY, NO_PROXY='localhost,127.0.0.1,::1')
    print(f'CC network: {"proxy " + PROXY if selected == "on" else "direct"}', file=sys.stderr, flush=True)
    # Also installed as the ordinary claude entry; never recurse through it.
    executable = str(Path.home() / '.local/claude-code/node_modules/@anthropic-ai/claude-code/bin/claude.exe')
    os.execve(executable, [executable, *args], env)


def check():
    nodes = api('/proxies/CC-NODE')
    print('Default for new CC processes:', mode())
    print('Selected node:', nodes['now'])
    # Run only network probes; no Claude account credentials are sent.
    passed = True
    for url in ('https://www.cloudflare.com/cdn-cgi/trace', 'https://api.anthropic.com/'):
        response = subprocess.run(['curl', '--silent', '--show-error', '--max-time', '20',
            '--noproxy', '', '--proxy', PROXY, '--output', '/dev/null',
            '--write-out', '%{http_code}', url], capture_output=True, text=True)
        print(url, 'HTTP', response.stdout.strip(), 'transport_ok=', response.returncode == 0)
        passed = passed and response.returncode == 0 and response.stdout.strip() not in ('000', '403')
    if not passed:
        raise SystemExit('Proxy access check failed; do not treat service active as network success.')


def connections():
    result = api('/connections')
    active = result.get('connections') or []
    if not active:
        print('No active proxy connections; run during a request.')
    for connection in active:
        metadata = connection.get('metadata', {})
        # Never output query strings, headers, endpoints with credentials, or node addresses.
        print(json.dumps({'host': metadata.get('host'), 'source_port': metadata.get('sourcePort'),
            'chains': connection.get('chains'), 'rule': connection.get('rule'),
            'upload': connection.get('upload'), 'download': connection.get('download')}, ensure_ascii=False))


def verify():
    """Prove routing with an isolated minimal model request and matching socket PID."""
    print('Runs one minimal official Haiku request through the proxy; no tools or saved conversation.', flush=True)
    command = [str(Path.home() / '.local/bin/claude-net'), '--proxy', '--model', 'haiku',
        '-p', 'Reply with exactly CONNECTION_OK.', '--tools', '', '--max-turns', '1',
        '--no-session-persistence', '--output-format', 'json']
    observed = {}
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.monotonic() + 90
        while process.poll() is None and time.monotonic() < deadline:
            sockets = subprocess.check_output(['ss', '-tnpH', 'dst', '127.0.0.1:17890'], text=True)
            for connection in api('/connections').get('connections') or []:
                metadata = connection.get('metadata') or {}
                port = str(metadata.get('sourcePort'))
                matched = any(':' + port + ' ' in line and
                    'pid=' + str(process.pid) + ',' in line for line in sockets.splitlines())
                if matched:
                    host = metadata.get('host', '')
                    observed[host] = {'host': host, 'chains': connection.get('chains') or [],
                        'rule': connection.get('rule'), 'cc_pid_matched': True}
            time.sleep(.08)
        if process.poll() is None:
            process.terminate()
        output, _ = process.communicate(timeout=10)
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()
    try:
        result = json.loads(output)
        success = process.returncode == 0 and not result.get('is_error') and result.get('result', '').strip() == 'CONNECTION_OK'
    except (ValueError, AttributeError):
        success = False
    routed = any('CC-NODE' in item['chains'] and any(x.startswith('Node-') for x in item['chains']) for item in observed.values())
    print('CC model request successful:', success)
    print('PID-matched upstream evidence:', json.dumps(list(observed.values()), ensure_ascii=False))
    if not (success and routed):
        raise SystemExit('CC proxy verification not proven; inspect connection/provider before changing defaults.')
    print('VERIFIED: this CC request used the local proxy and selected upstream node.')


def main():
    args = sys.argv[1:]
    if Path(sys.argv[0]).name in ('claude-net','claude'):
        run(args)
        return
    command = args[0] if args else 'status'
    if command in ('on', 'off'):
        if command == 'off':
            raise SystemExit('CC proxy is mandatory; off is disabled')
        if command == 'on':
            api('/version')  # Fail before changing the preference if service is unavailable.
        temporary = ROOT / f'mode.{os.getpid()}.tmp'
        temporary.write_text(command + '\n')
        temporary.chmod(0o600)
        temporary.replace(ROOT / 'mode')
        print('New CC processes:', command, '(running CC processes keep their current mode)')
    elif command == 'run':
        run(args[1:])
    elif command == 'status':
        print('Default for new CC processes:', mode())
        try:
            print('Mihomo:', api('/version').get('version'))
            print('Selected node:', api('/proxies/CC-NODE')['now'])
        except (OSError, urllib.error.URLError):
            print('Proxy service unavailable')
        print('Live CC processes:')
        for path in Path('/proc').glob('[0-9]*/environ'):
            try:
                if (path.parent / 'comm').read_text().strip() != 'claude':
                    continue
                values = dict(item.split(b'=', 1) for item in path.read_bytes().split(b'\0') if b'=' in item)
                value = next((values[k.encode()] for k in ('https_proxy','HTTPS_PROXY','http_proxy','HTTP_PROXY') if k.encode() in values), b'')
                label = 'proxy via cc-proxy' if value == PROXY.encode() else ('other proxy configured' if value else 'no proxy in startup environment')
                print(' PID', path.parent.name, label)
            except (OSError, ValueError):
                continue
    elif command == 'check':
        check()
    elif command == 'verify':
        verify()
    elif command == 'connections':
        connections()
    elif command == 'nodes':
        result = api('/proxies/CC-NODE')
        for node in result['all']:
            print(node, '*' if node == result['now'] else '')
    elif command == 'node' and len(args) == 2:
        if args[1] not in api('/proxies/CC-NODE')['all']:
            raise SystemExit('Unknown node; run cc-proxy nodes')
        api('/proxies/CC-NODE', 'PUT', {'name': args[1]})
        print('Selected node:', args[1], '(new connections use this node)')
    else:
        raise SystemExit('Usage: cc-proxy on|off|status|check|verify|connections|nodes|node Node-N; claude-net [--proxy|--direct] [Claude arguments]')


if __name__ == '__main__':
    try:
        main()
    except (OSError, urllib.error.URLError):
        raise SystemExit('Network/service unavailable. Check: systemctl status cc-proxy')
