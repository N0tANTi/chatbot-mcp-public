import React,{useEffect,useRef,useState} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function DownloadPage(){
  const params=new URLSearchParams(location.search),project=params.get('project'),file=params.get('file');
  const base=`/api/core/generated/${encodeURIComponent(project||'')}`,query=`?file=${encodeURIComponent(file||'')}`;
  const [item,setItem]=useState(null),[needsLogin,setNeedsLogin]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState(false),[started,setStarted]=useState(false);
  const [username,setUsername]=useState(''),[password,setPassword]=useState('');
  const auto=useRef(false),mounted=useRef(true);
  const download=()=>{const a=document.createElement('a');a.href=base+'/content'+query;a.download=item?.name||'';document.body.append(a);a.click();a.remove();setStarted(true);};
  const load=async()=>{
    if(!project||!file){setError('下载链接不完整，请向 Claude 索取完整链接。');return;}
    try{
      const r=await fetch(base+'/item'+query);if(!mounted.current)return;
      if(r.status===401||r.status===403){setNeedsLogin(true);return;}
      const d=await r.json();if(!mounted.current)return;
      if(!r.ok)throw new Error(d.error||'文件不可用');
      setItem(d);setNeedsLogin(false);setError('');
      if(!auto.current){auto.current=true;const a=document.createElement('a');a.href=base+'/content'+query;a.download=d.name;document.body.append(a);a.click();a.remove();setStarted(true);}
    }catch(e){if(mounted.current)setError(e.message);}
  };
  useEffect(()=>{mounted.current=true;load();return()=>{mounted.current=false;};},[]);
  const login=async e=>{
    e.preventDefault();setBusy(true);setError('');
    try{
      const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const d=await r.json();if(!r.ok)throw new Error(typeof d.error==='string'?d.error:'登录失败，请检查账号与密码');
      const auth=await fetch('/api/core/download-auth',{method:'POST',headers:{Authorization:`Bearer ${d.token}`,'Content-Type':'application/json'},body:'{}'});if(!auth.ok)throw new Error('下载登录未成功，请重试');
      setPassword('');await load();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <main className="download-page"><section className="download-card"><a className="download-home" href="/">Claude 项目中心</a><h1>{needsLogin?'登录后下载':item?.name||(error?'文件暂不可用':'正在准备下载…')}</h1>
    {needsLogin?<><p>登录后自动回到此文件，无需进入项目查找。</p><form onSubmit={login}><label>账号<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" required/></label><label>密码<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required/></label><button className="primary" disabled={busy}>{busy?'正在登录…':'登录并下载'}</button></form></>:item?<><p>{item.project} · {Math.ceil(item.size/1024)} KB · {new Date(item.modifiedAt).toLocaleString()}</p><p role="status">{started?'已发起下载，请查看浏览器的下载列表。':'文件已准备好。'}</p><div className="download-actions"><button className="primary" onClick={download}>再次下载</button>{item.text!==null&&<button onClick={()=>setPreview(!preview)}>{preview?'收起预览':'预览内容'}</button>}</div>{preview&&<div className="download-preview"><Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown></div>}</>:null}
    {error&&<><p className="error" role="alert">{error}</p><button onClick={()=>{setNeedsLogin(true);setItem(null);auto.current=false;setError('');}}>换个账号登录</button></>}
    <small>链接需要登录，只能访问所属账号的项目文件。</small></section></main>;
}
