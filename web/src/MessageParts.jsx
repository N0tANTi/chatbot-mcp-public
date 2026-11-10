import React, {useEffect, useRef, useState} from 'react';
import {Check, Copy, WarningCircle, X} from '@phosphor-icons/react';

// Clipboard API needs a secure context and may still be denied by the browser; fall back to a selection copy.
export async function copyText(text) {
  if(navigator.clipboard&&window.isSecureContext){try{await navigator.clipboard.writeText(text);return;}catch{}}
  const area=document.createElement('textarea');
  area.value=text;area.setAttribute('readonly','');area.style.cssText='position:fixed;top:0;opacity:0;';
  document.body.append(area);area.select();
  const ok=document.execCommand('copy');area.remove();
  if(!ok)throw new Error('复制未成功');
}

export function CopyButton({getText,label='复制'}) {
  const [state,setState]=useState(null);
  useEffect(()=>{if(!state)return;const timer=setTimeout(()=>setState(null),1600);return()=>clearTimeout(timer);},[state]);
  const text=state==='ok'?'已复制':state==='fail'?'复制失败':'复制';
  return <button type="button" className={`copy-button ${state||''}`} title={label} aria-label={state?text:label} onClick={async()=>{try{await copyText(getText());setState('ok');}catch{setState('fail');}}}>
    {state==='ok'?<Check size={15}/>:<Copy size={15}/>}<span>{text}</span>
  </button>;
}

// Markdown `pre` renderer: language label + copy button; copies the rendered text, not highlight markup.
export function CodeBlock({node,children,...props}) {
  const ref=useRef(null);
  const className=[].concat(node?.children?.[0]?.properties?.className||[]).join(' ');
  const language=/language-([\w+#.-]+)/.exec(className)?.[1];
  return <div className="code-block">
    <div className="code-header"><span>{language||'代码'}</span><CopyButton getText={()=>ref.current?.textContent||''} label="复制代码"/></div>
    <pre ref={ref} {...props}>{children}</pre>
  </div>;
}

// Transient notice; hover/focus pauses dismissal so actions like undo stay reachable.
export function Toast({tone='info',duration=8000,busy=false,action,onClose,children}) {
  const [paused,setPaused]=useState(false);
  useEffect(()=>{if(paused||busy)return;const timer=setTimeout(onClose,duration);return()=>clearTimeout(timer);},[paused,busy,duration]);
  return <div className={`toast ${tone==='error'?'toast-error':''}`} role={tone==='error'?'alert':'status'} onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)} onFocus={()=>setPaused(true)} onBlur={()=>setPaused(false)}>
    {tone==='error'&&<WarningCircle size={18} className="toast-icon"/>}
    <span>{children}</span>
    {action&&<button className="toast-action" disabled={busy} onClick={action.onClick}>{action.label}</button>}
    <button className="toast-close" aria-label="关闭提示" onClick={onClose}><X size={15}/></button>
  </div>;
}
