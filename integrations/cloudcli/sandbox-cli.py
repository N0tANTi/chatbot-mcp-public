#!/usr/bin/env python3
"""Per-run filesystem/PID sandbox. Never fall back to unsandboxed execution."""
import json, os, pathlib, sys, re
cfg=json.loads(os.environ.pop('CCWEB_SANDBOX'))
home=pathlib.Path(cfg['home']); cwd=pathlib.Path(cfg['cwd'])
if not re.fullmatch(r'/home/appuser/cloudcli-runtime/data/tenants/[1-9]\d*/home',str(home)): raise SystemExit('Invalid sandbox home')
cmd=['/usr/bin/bwrap','--unshare-user','--unshare-pid','--unshare-ipc','--unshare-uts','--die-with-parent','--new-session','--cap-drop','ALL','--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--symlink','usr/lib','/lib','--symlink','usr/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp']
for item in ['/etc/ssl','/etc/ca-certificates','/etc/resolv.conf','/etc/hosts','/etc/nsswitch.conf','/etc/passwd','/etc/group','/etc/localtime','/etc/ld.so.cache']:
    if pathlib.Path(item).exists(): cmd+=['--ro-bind',item,item]
cmd+=['--ro-bind','/home/appuser/.local/claude-code','/home/appuser/.local/claude-code','--bind',str(home),str(home),'--bind',str(cwd),str(cwd)]
for binding in cfg.get('extras',[]): cmd+=['--ro-bind',binding['source'],binding['target']]
if cfg.get('legacy'):
    current=os.readlink('/home/appuser/claude-projects/current')
    cmd+=['--symlink',current,'/home/appuser/claude-projects/current']
target=str(home/'.claude/projects'/cfg['encoded'])
cmd+=['--bind',cfg['history'],target]
for filename in cfg.get('files',[]):
    if not str(filename).startswith('/home/appuser/.cloudcli/assets/'): raise SystemExit('Invalid attachment mount')
    cmd+=['--ro-bind',filename,filename]
cmd+=['--setenv','HOME',str(home),'--setenv','CLAUDE_CONFIG_DIR',str(home/'.claude'),'--chdir',str(cwd)]
for key in list(os.environ):
    if key.upper() in ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY']: del os.environ[key]
network=cfg.get('networkMode')
if network!='on': raise SystemExit('Proxy is required; sandbox launch refused')
if network=='on':
    os.environ.update(HTTP_PROXY='http://127.0.0.1:17890',HTTPS_PROXY='http://127.0.0.1:17890',NO_PROXY='localhost,127.0.0.1,::1')
if len(sys.argv)>1 and sys.argv[1]=='--probe': cmd+=sys.argv[2:]
else: cmd+=['/home/appuser/.local/claude-code/node_modules/@anthropic-ai/claude-code/bin/claude.exe',*sys.argv[1:]]
os.execvpe(cmd[0],cmd,os.environ)
