import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowClockwise,X} from '@phosphor-icons/react';
import {percentage,timeUntil,localTime} from './usage.mjs';

// Opened from the account menu; the parent owns the open state.
export function SubscriptionUsage({api,accountId,open,onOpenChange}){
  const setOpen=onOpenChange;
  const [data,setData]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[now,setNow]=useState(Date.now());
  const apiRef=useRef(api),generation=useRef(0),closeButton=useRef(null);apiRef.current=api;
  const load=async(refresh=false)=>{
    const version=++generation.current;setLoading(true);setError('');
    try{const result=await apiRef.current('/api/core/usage'+(refresh?'?refresh=1':''));if(version===generation.current){setData(result);setNow(Date.now());}}
    catch{if(version===generation.current)setError('额度暂时读取失败，请稍后重试。');}
    finally{if(version===generation.current)setLoading(false);}
  };
  const close=()=>{setOpen(false);generation.current++;setLoading(false);};
  useEffect(()=>{if(!open)return;load();closeButton.current?.focus();
    const timer=setInterval(()=>setNow(Date.now()),1000); // Display clock only; no network polling.
    const key=event=>{if(event.key==='Escape')close();};document.addEventListener('keydown',key);
    return()=>{clearInterval(timer);document.removeEventListener('keydown',key);generation.current++;};
  },[open,accountId]);
  const wait=data?.nextRefreshAt&&Date.parse(data.nextRefreshAt)>now?timeUntil(data.nextRefreshAt,now):null;
  return <>
    {open&&createPortal(<div className="drawer-backdrop" onClick={close}><section className="memory-drawer usage-drawer" role="dialog" aria-modal="true" aria-labelledby="usage-title" onClick={event=>event.stopPropagation()}>
      <header><h2 id="usage-title">订阅额度</h2><button ref={closeButton} aria-label="关闭订阅额度" onClick={close}><X size={24}/></button></header>
      <p className="usage-description">当前官方订阅的共享额度，包含网页、终端和其他设备的使用。</p>
      <div className="usage-toolbar"><span>{data?.fetchedAt?`更新于 ${localTime(data.fetchedAt)}`:'尚未取得额度数据'}</span><button onClick={()=>load(true)} disabled={loading||Boolean(wait)}><ArrowClockwise size={16}/>{loading?'读取中…':'刷新'}</button></div>
      {loading&&!data&&<p role="status">正在读取官方额度…</p>}
      {(error||data?.message)&&<p className="usage-message" role="status">{error||data.message}{data?.state==='stale'||error&&data?.fetchedAt?' 下方保留的是上次成功读取的数据。':''}</p>}
      {data?.windows?.map(window=><section className="usage-window" key={window.key} aria-label={window.label}>
        <h3>{window.label}</h3>
        <div className="usage-numbers"><span>已用 <strong>{percentage(window.usedPercent)}</strong></span><span>剩余 <strong>{percentage(window.remainingPercent)}</strong></span></div>
        {window.usedPercent===null?<div className="usage-unknown">官方暂未提供使用比例</div>:<div className={`usage-track ${window.remainingPercent===0?'exhausted':''}`} role="progressbar" aria-label={`${window.label}已用比例`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100,window.usedPercent)} aria-valuetext={`已用 ${percentage(window.usedPercent)}，剩余 ${percentage(window.remainingPercent)}`}><span style={{width:`${Math.min(100,window.usedPercent)}%`}}/></div>}
        <div className="usage-reset"><span>{window.resetsAt?`恢复于 ${localTime(window.resetsAt)}`:'官方未提供恢复时间'}</span>{window.resetsAt&&<small>{Date.parse(window.resetsAt)<=now?'恢复时间已到，请刷新确认额度':`约 ${timeUntil(window.resetsAt,now)}后恢复`}</small>}</div>
      </section>)}
      {!loading&&data?.state==='unavailable'&&<div className="usage-empty">当前无法确认已用和剩余额度。<a href="https://claude.ai/settings/usage" target="_blank" rel="noopener noreferrer">前往官方用量页面</a></div>}
      <p className="usage-footnote">按官方百分比显示，不换算为可发送条数。时间使用此设备时区；恢复后以官方最新数据为准。{wait?`约 ${wait}后可再次刷新。`:'打开时读取，支持手动刷新。'}</p>
    </section></div>,document.body)}
  </>;
}
