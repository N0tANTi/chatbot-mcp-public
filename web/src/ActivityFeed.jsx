import React, {createContext, useContext, useEffect, useState} from 'react';
import {CheckCircle, Circle, WarningCircle, CaretDown, Square, ArrowClockwise} from '@phosphor-icons/react';
import {activitySummary, outputText, toolSummary} from './activity.mjs';

// App supplies a loader for tool rows whose history copy was truncated.
export const ToolDetails = createContext(null);
// App reports whether something mounting now is a new arrival (eases in) or part of a loaded
// history (appears at once). Decided once at mount, so later renders never replay it.
export const Arrival = createContext(() => false);
export function useArrival() { const [on] = useState(useContext(Arrival)); return on ? 'arrive' : ''; }
// The run-status card carries the one moving indicator; a live step only glows softly.
const LiveDot = () => <span className="live-dot" aria-hidden="true"/>;
const labels = {Read:'读取文件', Write:'写入文件', Edit:'修改文件', Bash:'执行命令', Grep:'搜索内容', Glob:'查找文件', WebSearch:'搜索网页', WebFetch:'读取网页', TodoWrite:'更新任务'};
// Memoized: rows are immutable objects in the feed, so streaming only re-renders the row that changed.
export const ActivityRow = React.memo(function ActivityRow({message:m, active=false, waiting=false, detailed=true}) {
  const result = m.toolResult || (m.kind === 'tool_result' ? {content:m.content, isError:m.isError} : null);
  const failed = Boolean(result?.isError);
  const thinking = m.kind === 'thinking';
  const task = m.kind === 'task_status';
  const title = thinking ? '思考过程' : task ? (m.description || m.summary || '后台任务状态') : labels[m.toolName] || m.toolName || '工具结果';
  const description = thinking ? '模型返回的思考内容' : task ? (m.status || '') : toolSummary(m);
  const state = failed ? '失败' : result ? '已返回' : waiting ? '等待授权' : active ? '执行中' : '已记录';
  const Icon = failed || waiting ? WarningCircle : result ? CheckCircle : active ? null : Circle;
  const loadDetails = useContext(ToolDetails);
  const [full,setFull] = useState(null),[loadingFull,setLoadingFull] = useState(false);
  const content = full?.content ?? (thinking ? outputText(m.content) : task ? outputText(m.output || m.content) : outputText(result?.content));
  const [open,setOpen] = useState(false);
  const input = outputText(full?.toolInput ?? m.toolInput);
  const arrive = useArrival();
  const truncated = !full && (result?.truncated || m.toolInputTruncated) && (m.toolId || m.id);
  return <section className={`activity-row ${failed?'failed':''} ${active?'live':''} ${arrive}`} aria-label={`${title} ${state}`}>
    <div className="activity-rail">{Icon?<Icon size={22} weight={result?'fill':'regular'}/>:<LiveDot/>}</div>
    <div className="activity-main">
      <button className="activity-heading" title={m.toolInput?.file_path || m.toolInput?.command || title} aria-expanded={open} onClick={()=>setOpen(!open)}>
        <strong>{title}</strong><span className="activity-target">{description}</span><small>{state}</small><CaretDown size={15} className={open?'flipped':''}/>
      </button>
      {detailed && !open && content && !thinking && <pre className="activity-preview">{content.slice(0,240)}{content.length>240?'…':''}</pre>}
      {detailed && !open && !content && input && <p className="activity-caption">{m.toolInput?.command || m.toolInput?.description || '展开查看输入与详情'}</p>}
      {open && <div className="activity-details">{truncated&&loadDetails&&<button className="load-full" disabled={loadingFull} onClick={async()=>{setLoadingFull(true);try{setFull(await loadDetails(m.toolId||m.id));}catch{}finally{setLoadingFull(false);}}}>{loadingFull?'正在加载…':`内容较长，当前只显示部分${result?.truncated?`（共 ${result.truncated.toLocaleString()} 字符）`:''}，加载完整内容`}</button>}{input&&<><span className="detail-label">输入</span><pre>{input}</pre></>}{content&&<><span className="detail-label">{thinking?'内容':'结果'}</span><pre>{content.slice(0,40000)}{content.length>40000?'\n…结果较长，仅展示前 40,000 字符':''}</pre></>}{!input&&!content&&<p>暂时没有更多输出。</p>}</div>}
    </div>
  </section>;
});

// Collapsed summary of several steps; the live step stays visible in the header while running.
export function ActivityGroup({messages, open, onToggle, live=false, waiting=false, title, meta, children}) {
  const failed=messages.filter(m=>m.toolResult?.isError||(m.kind==='tool_result'&&m.isError)).length;
  const current=live?messages.findLast(m=>!m.toolResult&&m.kind!=='tool_result')||messages.at(-1):null;
  const currentLabel=!current?'':current.kind==='thinking'?'正在思考':`${labels[current.toolName]||current.toolName||'处理中'} · ${toolSummary(current)}`;
  // A failed step inside the process is usually Claude probing and moving on, so the summary
  // stays neutral; the step itself still shows its error when the group is opened.
  const Icon=waiting?WarningCircle:live?null:CheckCircle,arrive=useArrival();
  return <>
    <section className={`activity-row activity-group ${live?'live':''} ${arrive}`} aria-label={`${messages.length} 个步骤`}>
      <div className="activity-rail">{Icon?<Icon size={22} weight={waiting?'regular':'fill'}/>:<LiveDot/>}</div>
      <div className="activity-main">
        <button className="activity-heading" aria-expanded={open} onClick={onToggle}>
          <strong>{title||activitySummary(messages)}</strong>
          <span className="activity-target">{waiting?'等待你的授权':title?activitySummary(messages):currentLabel}</span>
          <small>{meta?`${meta} · `:''}{messages.length} 步{failed?` · 其中 ${failed} 步报错`:''}</small>
          <CaretDown size={15} className={open?'flipped':''}/>
        </button>
      </div>
    </section>
    {open&&<div className="activity-group-items">{children}</div>}
  </>;
}

export function RunStatus({running, pending, connected, activity, onStop, stopping, onJump}) {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(!running)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[running]);
  if(!running&&!activity?.completedAt)return null;
  const start=activity?.startedAt;
  const end=running?now:activity.completedAt;
  const elapsed=start?Math.max(0,Math.floor((end-start)/1000)):null;
  const quiet=running&&activity?.lastEventAt?Math.max(0,Math.floor((now-activity.lastEventAt)/1000)):0;
  const label=!connected&&running?'连接已断开，正在重连':stopping?'正在停止':pending?'等待你的授权':running?(activity?.label||'等待服务响应'):activity.aborted?'已停止':activity.outcome==='error'||Number(activity.outcome)>0?'本次运行未成功':'本次运行已结束';
  const failed=!running&&(activity.aborted||activity.outcome==='error'||Number(activity.outcome)>0);
  const Icon=!connected?ArrowClockwise:pending||failed?WarningCircle:CheckCircle;
  // Finished runs keep their honest outcome and elapsed time, but as one quiet line instead of a card.
  if(!running)return <div className={`run-status finished ${failed?'failed':''}`} role="status">
    <Icon size={15}/><span>{label}</span>{elapsed!==null&&<small>· 用时 {elapsed} 秒</small>}
  </div>;
  return <div className={`run-status ${pending?'needs-action':''}`} role="status">
    {connected&&!pending?<span className="run-spark" aria-hidden="true"><img src="/assets/welcome-mark.png" alt=""/></span>:<Icon size={20}/>}<div><span>{label}</span><small>{elapsed!==null?`${running?'已运行':'用时'} ${elapsed} 秒`:''}{quiet>=15&&!pending?` · ${quiet} 秒没有新输出，仍在等待`:''}</small></div>
    {pending&&onJump&&<button className="jump-approval" onClick={onJump}>查看</button>}
    {running&&<button onClick={onStop} disabled={!connected||stopping}><Square size={14} weight="fill"/>{stopping?'停止中':'停止'}</button>}
  </div>;
}

// Readable approval card: the decisive field first (command, file, change), raw input on demand.
export function PermissionRequest({request:p, onDecide}) {
  const input=p.input&&typeof p.input==='object'?p.input:{};
  const name=labels[p.toolName]||p.toolName||'工具';
  const file=input.file_path||input.notebook_path||input.path;
  return <section className="permission">
    <strong>需要你的确认：{name}</strong>
    {input.description&&<p className="permission-why">{input.description}</p>}
    {p.toolName==='Bash'&&input.command&&<pre className="permission-command">{input.command}</pre>}
    {p.toolName!=='Bash'&&file&&<p className="permission-file">{file}</p>}
    {typeof input.old_string==='string'&&<div className="permission-diff"><pre className="removed">{input.old_string.slice(0,2000)}</pre><pre className="added">{String(input.new_string??'').slice(0,2000)}</pre></div>}
    {p.toolName==='Write'&&typeof input.content==='string'&&<pre className="permission-preview">{input.content.slice(0,1200)}{input.content.length>1200?'\n…':''}</pre>}
    {!['Bash','Edit','Write','MultiEdit','NotebookEdit'].includes(p.toolName)&&!file&&<p className="permission-file">{toolSummary({toolName:p.toolName,toolInput:p.input})}</p>}
    <details><summary>查看完整参数</summary><pre>{JSON.stringify(p.input,null,2)}</pre></details>
    <div className="permission-actions"><button onClick={()=>onDecide(true)}>本次允许</button><button onClick={()=>onDecide(false)}>拒绝</button></div>
  </section>;
}
