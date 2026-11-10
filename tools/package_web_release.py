"""Package committed integration source and the local client build; no runtime data."""
import pathlib, subprocess, tarfile
root=pathlib.Path(__file__).resolve().parents[1]
revision=subprocess.check_output(['git','rev-parse','--short','HEAD'],cwd=root,text=True).strip()
files=['package.json','package-lock.json','server.mjs','tenant-store.mjs','host-execution.mjs','subscription-usage.mjs','extract-document.py','generated-files.mjs','download-rule.mjs','activity-events.mjs','model-routing.mjs','session-trash.mjs','network-policy.mjs','official-account.mjs','history-page.mjs','memory-files.mjs','project-template.mjs','session-titles.mjs']
payload=[(f'integrations/cloudcli/{name}',name) for name in files]+[(f'tools/{name}',name) for name in ['run_cloudcli.mjs','install_web_release.py','migrate_web_host_history.py']]+[('deploy/cloudcli-host-execution.conf','cloudcli-host-execution.conf')]
for source,_ in payload:
    expected=subprocess.check_output(['git','show',f'HEAD:{source}'],cwd=root)
    assert (root/source).read_bytes().replace(b'\r\n',b'\n')==expected.replace(b'\r\n',b'\n'),f'Uncommitted payload: {source}'
out=root/'private/web-releases';out.mkdir(parents=True,exist_ok=True)
archive=out/f'{revision}.tar.gz'
with tarfile.open(archive,'w:gz') as bundle:
    for source,target in payload:bundle.add(root/source,arcname=target)
    bundle.add(root/'web/dist/client',arcname='client')
print(revision)
