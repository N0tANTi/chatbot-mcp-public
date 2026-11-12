"""Install an explicit source release on the authorized host; no runtime overwrite."""
import argparse, os, pathlib, shutil, subprocess, tarfile
p=argparse.ArgumentParser();p.add_argument('--archive',required=True);p.add_argument('--release',required=True);p.add_argument('--stage-only',action='store_true');a=p.parse_args()
base=pathlib.Path('/home/appuser/cloudcli-runtime')
identity=subprocess.check_output(['findmnt','-n','-o','UUID','/'],text=True).strip()
if identity!='00000000-0000-0000-0000-000000000000': raise SystemExit('Unexpected root mount')
usage=shutil.disk_usage('/'); stat=os.statvfs('/')
if usage.free<6*1024**3 or usage.used/usage.total>=.85 or stat.f_favail<100000: raise SystemExit('Insufficient storage headroom')
if not a.release.replace('-','').isalnum(): raise SystemExit('Invalid release id')
os.umask(0o077)
for name in ['releases','data','config','cache']: (base/name).mkdir(parents=True,exist_ok=True)
destination=base/'releases'/a.release
destination.mkdir()
with tarfile.open(a.archive) as archive:
    if sum(x.size for x in archive.getmembers())>100*1024**2: raise SystemExit('Payload too large')
    archive.extractall(destination,filter='data')
home=pathlib.Path('/home/appuser/.cloudcli')
if home.exists() or home.is_symlink():
    if not home.is_symlink() or home.resolve()!=(base/'config').resolve(): raise SystemExit('Existing CloudCLI home must be reviewed')
else: home.symlink_to(base/'config',target_is_directory=True)
cache=base/'cache'/a.release
previous=base/'current'
if previous.exists() and (previous/'package-lock.json').read_bytes().replace(b'\r\n',b'\n')==(destination/'package-lock.json').read_bytes().replace(b'\r\n',b'\n'):
    # Pinned dependencies are immutable; reuse verified files, never runtime data.
    shutil.copytree(previous/'node_modules',destination/'node_modules',copy_function=os.link,symlinks=True)
else:
    subprocess.run(['npm','ci','--omit=dev','--omit=optional','--no-audit','--no-fund','--cache',str(cache)],cwd=destination,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=384'},check=True)
subprocess.run(['node','--check',str(destination/'server.mjs')],check=True)
if not (destination/'host-execution.mjs').is_file(): raise SystemExit('Native host execution module missing')
if not a.stage_only:
    shutil.copyfile(destination/'run_cloudcli.mjs',base/'run_cloudcli.mjs')
    link=base/'current.next';link.symlink_to(destination,target_is_directory=True);link.replace(base/'current')
if cache.exists(): shutil.rmtree(cache) # only this installer-owned disposable cache
print('RELEASE_READY',a.release)
