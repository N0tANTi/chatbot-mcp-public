import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Folder,
  ChatCircle,
  Plus,
  CaretDown,
  CaretRight,
  CaretUp,
  BookOpen,
  ArrowUp,
  Square,
  SidebarSimple,
  MagnifyingGlass,
  UserCircle,
  X,
  Asterisk,
  DotsThree,
  Circle,
  Paperclip,
  File,
  Image,
  Trash,
  DownloadSimple,
  PencilSimple,
  ArrowClockwise,
  Bell,
  Sparkle,
  NotePencil,
  UsersThree,
  SignOut,
  ChartPie,
} from "@phosphor-icons/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {rehypeCodeHighlight} from "./highlight.mjs";
import {ActivityGroup, ActivityRow, Arrival, PermissionRequest, RunStatus, ToolDetails, useArrival} from './ActivityFeed.jsx';
import {collapseTurns, filesByTurn, groupFeed, historyMessages, mergeMessage, withTurnFiles} from './activity.mjs';
import {CommandPalette} from './CommandPalette.jsx';
import {MemoryDrawer} from './MemoryDrawer.jsx';
import {FileActions, ImageViewer, MarkdownImage, MarkdownLink, MessageImages, TurnFiles, startDownload} from './FileParts.jsx';
import {formatDuration, groupByRecency, isPreviewable, parseDownloadLink} from './files.mjs';
import {ModelControls} from './ModelControls.jsx';
import {needsShrink, shrinkImage} from './image-shrink.mjs';
import {CodeBlock, CopyButton, Toast} from './MessageParts.jsx';
import {SubscriptionUsage} from './SubscriptionUsage.jsx';
const remarkPlugins=[remarkGfm],rehypePlugins=[rehypeCodeHighlight],markdownComponents={pre:CodeBlock,a:MarkdownLink,img:MarkdownImage};
// On touch screens (phones, tablets) the keyboard's return key adds a line; the send button sends.
const touchTyping=()=>matchMedia('(hover: none) and (pointer: coarse)').matches;
const sendsOnEnter=e=>e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&!touchTyping();
// Each tab keeps its own login (two accounts can sit side by side); the latest login also
// persists so a new tab or a phone browser that dropped the tab opens signed in.
const saveLogin=t=>{sessionStorage.setItem('cc-token',t);localStorage.setItem('cc-token',t);};
const forgetLogin=()=>{const t=sessionStorage.getItem('cc-token');sessionStorage.removeItem('cc-token');if(!t||localStorage.getItem('cc-token')===t)localStorage.removeItem('cc-token');};
const displayText=m=>m.content==="No response requested."?"已停止回复。":String(m.content||"");
// Memoized so streaming into the last message does not re-parse every earlier message's Markdown.
// App supplies edit/regenerate handlers; the value is stable so memoized messages are unaffected.
const ChatActions=React.createContext(null);
const tokens=n=>n>=10000?`${(n/10000).toFixed(1)} 万`:String(n);
const isCompactCommand=m=>m.role==='user'&&(m.isLocalCommand&&m.commandName==='compact'||String(m.content).trim()==='/compact');
const isOrdinaryReply=m=>m.kind==='text'&&m.role!=='user'&&!m.compact&&!m.isCompactSummary&&!m.isLocalCommandStdout;
// Claude Code compaction (manual or automatic) shown as a divider rather than an English reply.
function CompactNotice({compact:c,text,summary}){
  const label=c.phase==='running'?'正在压缩上下文…':c.phase==='failed'?`上下文压缩失败${c.error?`：${c.error}`:''}`
    :`已${c.trigger==='manual'?'手动':'自动'}压缩上下文${c.preTokens?` · ${tokens(c.preTokens)}${c.postTokens?` → ${tokens(c.postTokens)}`:''} tokens`:''}${c.durationMs?` · 用时 ${Math.round(c.durationMs/1000)} 秒`:''}`;
  return <>
    <div className={`compact-notice ${c.phase||''}`} role="note" title={text}><span>{label}</span></div>
    {summary&&<details className="compact-summary"><summary>查看压缩摘要（Claude 接下来记住的内容）</summary><div className="message-body"><Markdown remarkPlugins={remarkPlugins} components={markdownComponents}>{displayText(summary)}</Markdown></div></details>}
  </>;
}
function MessageEditor({message:m,onCancel}){
  const actions=React.useContext(ChatActions),[text,setText]=useState(displayText(m));
  return <div className="message-editor">
    <textarea autoFocus aria-label="编辑消息" value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onCancel();}if(sendsOnEnter(e)){e.preventDefault();actions.submitEdit(m,text);}}}/>
    <p>从这条消息重新开始，之后的回复会被替换（原记录仍保留在对话文件中）。</p>
    <div><button onClick={onCancel}>取消</button><button className="primary-small" disabled={!text.trim()} onClick={()=>actions.submitEdit(m,text)}>发送</button></div>
  </div>;
}
const MessageArticle=React.memo(function MessageArticle({message:m,canEdit=false,editing=false,canRegenerate=false}){
  const actions=React.useContext(ChatActions),arrive=useArrival();
  return <article className={`message ${m.role || "assistant"} ${editing?'editing':''} ${arrive}`}>
    {m.images?.length>0&&<MessageImages images={m.images}/>}
    {editing?<MessageEditor message={m} onCancel={actions.cancelEdit}/>:<div className="message-body"><Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={markdownComponents}>{displayText(m)}</Markdown></div>}
    {m.content&&m.kind==='text'&&!editing&&<div className="message-actions"><CopyButton getText={()=>displayText(m)} label={m.role==='user'?'复制消息':'复制回复'}/>
      {canEdit&&<button type="button" className="copy-button" onClick={()=>actions.startEdit(m.id)}><PencilSimple size={15}/><span>编辑</span></button>}
      {canRegenerate&&<button type="button" className="copy-button" onClick={actions.regenerate}><ArrowClockwise size={15}/><span>重新生成</span></button>}
    </div>}
    {m.role!=='user'&&<img className="assistant-mark" src="/assets/welcome-mark.png" alt="Claude"/>}
  </article>;
});
function ProjectActions({provider,openMemory,openFiles,openGenerated,permissionMode,setPermissionMode,busy,hasProject,deleteChat,locked,detailed,setDetailed}) {
  return <details className="chat-actions"><summary aria-label="对话菜单"><DotsThree size={25}/></summary><div onClick={e=>{if(e.target.closest('button')&&!e.target.closest('.view-switch'))e.currentTarget.closest('details').open=false;}}>
    <button disabled={!hasProject} onClick={openMemory}><BookOpen size={18}/>项目记忆</button>
    <button disabled={!hasProject} onClick={openFiles}><Paperclip size={18}/>项目资料</button>
    <button disabled={!hasProject} onClick={openGenerated}><File size={18}/>生成文件</button>
    {deleteChat&&<button className="delete-chat" disabled={busy||Boolean(locked)} title={locked?'请先在终端退出这段对话':undefined} onClick={deleteChat}><Trash size={18}/>删除对话</button>}
    <div className="permission-setting"><span>过程显示</span><div className="view-switch" role="group" aria-label="活动显示方式">{[false,true].map(value=><button key={String(value)} title={value?'展开所有步骤并预览工具输出':'把思考和工具步骤折叠成一行摘要；点击可展开'} aria-pressed={detailed===value} onClick={()=>setDetailed(value)}>{value?'详细':'简洁'}</button>)}</div></div>
    <label className="permission-setting"><span>权限模式</span><select className="permission-select" aria-label="权限模式" value={permissionMode} disabled={busy} onChange={e=>setPermissionMode(e.target.value)}><option value="bypassPermissions">完全访问</option><option value="auto">自动判断</option><option value="default">逐次确认</option></select><small>默认完全访问，以 appuser 的服务器权限运行，不额外限制项目目录或逐项授权。下一次任务生效。</small></label>
    <label className="permission-setting"><span>{provider==='packy'?'Packy Code API · 直连':'官方账号 · 强制代理'}</span><small>{provider==='packy'?'按 API 用量计费；请求上下文经过 Packy Code。':'当前使用服务器原生 CC 环境。代理不可用时暂停请求，不直连、不自动重新登录。'}</small></label>
  </div></details>;
}
export function App() {
  const authEpoch=useRef(0);
  const [projectsLoaded,setProjectsLoaded]=useState(false);
  const [generated,setGenerated]=useState(null);
  const [sessionFiles,setSessionFiles]=useState({}),[trashDrawer,setTrashDrawer]=useState(null),[deleteTarget,setDeleteTarget]=useState(null),[deleting,setDeleting]=useState(false),[trashError,setTrashError]=useState(''),[notice,setNotice]=useState(null);
  const [activity,setActivity]=useState({}),[stopping,setStopping]=useState({});
  const [detailed,setDetailed]=useState(localStorage.getItem('cc-activity-view')==='detailed'),[openGroups,setOpenGroups]=useState({});
  const chooseView=value=>{setDetailed(value);setOpenGroups({});localStorage.setItem('cc-activity-view',value?'detailed':'compact');};
  const [permissionMode,setPermissionMode]=useState('bypassPermissions');
  const [effortConfigs,setEffortConfigs]=useState({}),[effortChoices,setEffortChoices]=useState({}),[runEfforts,setRunEfforts]=useState({});
  const [token, setToken] = useState(()=>{const t=sessionStorage.getItem("cc-token")||localStorage.getItem("cc-token")||"";if(t)sessionStorage.setItem("cc-token",t);return t;});
  const [projects, setProjects] = useState([]),
    [project, setProject] = useState(
      localStorage.getItem("cc-project") || "work",
    );
  const [selected, setSelected] = useState(
    localStorage.getItem("cc-session") || null,
  );
  const [feeds, setFeeds] = useState({}),
    [running, setRunning] = useState({}),
    [approvals, setApprovals] = useState({}),
    [drafts, setDrafts] = useState({});
  const [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [memory, setMemory] = useState(null),
    [file, setFile] = useState(null);
  const [sidebar, setSidebar] = useState(innerWidth >= 760),
    [palette, setPalette] = useState(false),
    [viewer, setViewer] = useState(null),
    [queues, setQueues] = useState({}),
    [editingId, setEditingId] = useState(null),
    [unread, setUnread] = useState({}),
    [usage, setUsage] = useState({}),
    [notify, setNotify] = useState(localStorage.getItem('cc-notify')==='on'),
    [historyMeta, setHistoryMeta] = useState({}),
    [loadingEarlier, setLoadingEarlier] = useState(false),
    [setup, setSetup] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const mainRef=useRef(null);
  useLayoutEffect(()=>{if(!matchMedia('(prefers-reduced-motion: reduce)').matches)mainRef.current?.animate([{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'none'}],{duration:200,easing:'cubic-bezier(.2,.7,.3,1)'});},[selected,project]);
  const [projectMenu, setProjectMenu] = useState(false),[usageOpen,setUsageOpen]=useState(false);
  // Several projects can be open at once in the sidebar; the set is remembered per login.
  const [expanded,setExpanded]=useState([]);
  const toggleExpanded=slug=>setExpanded(list=>{const next=list.includes(slug)?list.filter(x=>x!==slug):[...list,slug];if(me?.id)localStorage.setItem(`cc-${me.id}-expanded`,JSON.stringify(next));return next;});
  const [sidebarWidth,setSidebarWidth]=useState(()=>Number(localStorage.getItem('cc-sidebar-width'))||null);
  const resizeSidebar=event=>{
    event.preventDefault();
    const handle=event.currentTarget,left=handle.parentElement.getBoundingClientRect().left;let width=sidebarWidth;
    const move=e=>{width=Math.round(Math.min(560,Math.max(220,e.clientX-left)));setSidebarWidth(width);};
    const up=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',up);document.body.classList.remove('resizing');if(width)localStorage.setItem('cc-sidebar-width',String(width));};
    handle.setPointerCapture(event.pointerId);document.body.classList.add('resizing');
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',up);
  };
  const nudgeSidebar=event=>{
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();
    const width=Math.min(560,Math.max(220,(sidebarWidth||event.currentTarget.parentElement.offsetWidth)+(event.key==='ArrowRight'?20:-20)));
    setSidebarWidth(width);localStorage.setItem('cc-sidebar-width',String(width));
  };
  const [me,setMe]=useState(null),[models,setModels]=useState([]),[model,setModel]=useState('default'),[modelLabels,setModelLabels]=useState({}),[defaultModel,setDefaultModel]=useState('default');
  useEffect(()=>{if(!selected&&models.length&&!models.includes(model))setModel(defaultModel);},[selected,models,model,defaultModel]);
  const modelReady=Object.hasOwn(effortConfigs,model);
  const effortConfig=effortConfigs[model]||{levels:[],default:null,pending:true};
  // Each conversation keeps its own model and effort; the latest choice is also the default for new chats.
  const [sessionEfforts,setSessionEfforts]=useState({});
  const validEffort=(id,value)=>value==='auto'||Boolean(effortConfigs[id]?.levels.includes(value));
  const modelEffort=id=>validEffort(id,effortChoices[id])?effortChoices[id]:'auto';
  const preferredEffort=selected&&validEffort(model,sessionEfforts[selected])?sessionEfforts[selected]:modelEffort(model);
  const effort=running[selected]?(runEfforts[selected]||'auto'):preferredEffort;
  const rememberDefaults=(nextModel,value)=>{
    const next={...effortChoices,[nextModel]:value};setEffortChoices(next);
    if(me?.id){localStorage.setItem(`cc-${me.id}-efforts`,JSON.stringify(next));localStorage.setItem(`cc-${me.id}-model`,nextModel);}
  };
  const saveSessionSettings=(id,nextModel,value)=>{
    setSessionEfforts(e=>({...e,[id]:value}));
    api(`/api/core/sessions/${id}`,{method:'PATCH',body:JSON.stringify({model:nextModel,effort:value})}).catch(e=>{setError(e.message);history(id,false).catch(()=>{});});
  };
  const setEffort=value=>{rememberDefaults(model,value);if(selected)saveSessionSettings(selected,model,value);};
  const changeModel=next=>{
    const value=selected&&validEffort(next,sessionEfforts[selected])?sessionEfforts[selected]:modelEffort(next);
    setModel(next);rememberDefaults(next,value);
    if(selected)saveSessionSettings(selected,next,value);
  };
  const [modal,setModal]=useState(null),[formName,setFormName]=useState(''),[accountPassword,setAccountPassword]=useState(''),[accounts,setAccounts]=useState([]);
  const [attachments,setAttachments]=useState({}),[uploading,setUploading]=useState(false),[uploadProgress,setUploadProgress]=useState(0),[dragging,setDragging]=useState(false),[projectFiles,setProjectFiles]=useState(null);
  const [locked,setLocked]=useState({}),[away,setAway]=useState(false),[accountMenu,setAccountMenu]=useState(false);
  // Pop-up menus close when the pointer goes down anywhere outside them.
  useEffect(()=>{
    const dismiss=event=>{
      for(const menu of document.querySelectorAll('details.chat-actions[open]'))if(!menu.contains(event.target))menu.open=false;
      if(!event.target.closest('.sidebar footer'))setAccountMenu(false);
    };
    document.addEventListener('pointerdown',dismiss);return()=>document.removeEventListener('pointerdown',dismiss);
  },[]);
  const projectsRef=useRef([]),notifyRef=useRef(false),queuesRef=useRef({}),pageFrom=useRef({}),restoreScroll=useRef(null),flushing=useRef({}),connectedRef=useRef(false),scroller=useRef(null),stick=useRef(true),picker=useRef(null),accountId=useRef(null),composerInput=useRef(null),quietUntil=useRef({});
  const activeProject=useRef(project);activeProject.current=project;
  const sending = useRef(false);
  const runKeys = useRef({});
  const ws = useRef(null),
    seq = useRef({}),
    selection = useRef(selected),
    loading = useRef(0),
    bottom = useRef(null);
  selection.current = selected;
  connectedRef.current = connected;
  queuesRef.current = queues;
  projectsRef.current = projects;
  notifyRef.current = notify;
  const api = async (url, options = {}) => {
    const epoch=authEpoch.current;
    const res = await fetch(url, {
      ...options,
      headers: {
        ...(options.body instanceof FormData?{}:{"Content-Type": "application/json"}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    if(epoch!==authEpoch.current)throw new Error('账号已切换');
    const refreshed = res.headers.get("X-Refreshed-Token");
    if (refreshed) {
      saveLogin(refreshed);
      setToken(refreshed);
    }
    const data = await res.json();
    if(epoch!==authEpoch.current)throw new Error('账号已切换');
    if (res.status === 401 && token) {
      forgetLogin();
      setToken("");
    }
    if (!res.ok)
      throw new Error(data.error?.message || data.error || "请求失败");
    return data;
  };
  const refreshProjects = async () => {
    const p = await api("/api/core/projects");
    setProjects(p);
    setProjectsLoaded(true);
    if(!p.some(x=>x.slug===activeProject.current)) {setProject(p[0]?.slug||'');setSelected(null);}
    return p;
  };
  const history = async (id, subscribe = true) => {
    const from = pageFrom.current[id];
    const version = ++loading.current,
      data = await api(`/api/core/sessions/${id}${from === undefined ? '' : `?from=${from}`}`);
    if (version !== loading.current) return;
    pageFrom.current[id] = data.from ?? 0;
    setHistoryMeta(h=>({...h,[id]:{from:data.from??0,previousFrom:data.previousFrom??null,hasMore:Boolean(data.hasMore)}}));
    setLocked(l=>({...l,[id]:data.locked}));
    setSessionFiles(files=>({...files,[id]:data.generatedFiles||[]}));
    // Usage comes from the last reply; a compaction after it is the better estimate of what is left.
    {const rows=data.messages??[],compactAt=rows.findLastIndex(m=>m.compact?.phase==='done'&&m.compact.postTokens>0),replyAt=rows.findLastIndex(isOrdinaryReply);
     const used=compactAt>replyAt?rows[compactAt].compact.postTokens:data.tokenUsage?.used;
     if(Number.isFinite(used))setUsage(u=>({...u,[id]:used}));}
    if(selection.current===id&&data.model)setModel(data.model);
    if(data.effort)setSessionEfforts(e=>e[id]===data.effort?e:{...e,[id]:data.effort});
    // A loaded history appears at once; only rows that arrive after it ease in.
    quietUntil.current[id]=Date.now()+400;
    setFeeds((f) => ({
      ...f,
      [id]: historyMessages(data.messages ?? data.data?.messages ?? []),
    }));
    if (subscribe) seq.current[id] = 0;
    if (subscribe && ws.current?.readyState === 1)
      ws.current.send(
        JSON.stringify({
          type: "chat.subscribe",
          sessions: [{ sessionId: id, lastSeq: 0 }],
        }),
      );
  };
  useEffect(() => {
    api("/api/auth/status")
      .then((d) => setSetup(d.needsSetup))
      .catch((e) => setError(e.message));
    if (!token) return;
    let disposed = false,
      reconnect,
      attempts = 0;
    api('/api/core/me').then(user=>{
      if(disposed)return;
      setMe(user);
      api('/api/core/download-auth',{method:'POST',body:'{}'}).catch(()=>{});
      if(accountId.current!==user.id){
        accountId.current=user.id;
        setSessionFiles({});setTrashDrawer(null);setDeleteTarget(null);setNotice(null);
        try {const kept=JSON.parse(localStorage.getItem(`cc-${user.id}-drafts`)||'{}');if(kept&&typeof kept==='object'&&!Array.isArray(kept))setDrafts(d=>({...kept,...d}));}catch{}
        try {const queued=JSON.parse(sessionStorage.getItem(`cc-${user.id}-queues`)||'{}');setQueues(queued&&typeof queued==='object'&&!Array.isArray(queued)?queued:{});}catch{setQueues({});}
        try {const open=JSON.parse(localStorage.getItem(`cc-${user.id}-expanded`)||'[]');setExpanded(e=>[...new Set([...(Array.isArray(open)?open.filter(x=>typeof x==='string'):[]),...e])]);}catch{}
        try {const saved=JSON.parse(localStorage.getItem(`cc-${user.id}-efforts`)||'{}');setEffortChoices(saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{});}catch{setEffortChoices({});}
        const savedProject=localStorage.getItem(`cc-${user.id}-project`),savedSession=localStorage.getItem(`cc-${user.id}-session`),savedModel=localStorage.getItem(`cc-${user.id}-model`);
        api('/api/core/projects').then(p=>{
          if(disposed)return;
          setProjects(p);setProjectsLoaded(true);const own=p.find(x=>x.slug===savedProject)||p[0];
          setProject(own?.slug||'');if(own&&localStorage.getItem(`cc-${user.id}-expanded`)===null)setExpanded(e=>e.includes(own.slug)?e:[...e,own.slug]);
          const id=own?.sessions.some(s=>s.id===savedSession)?savedSession:null;
          setSelected(id);selection.current=id;if(id)history(id).catch(e=>setError(e.message));else if(savedModel)setModel(savedModel);
        }).catch(e=>setError(e.message));
      }
    }).catch(e=>setError(e.message));
    api('/api/core/models').then(d=>{if(disposed)return;setModels(d.models);setModelLabels(d.labels||{});setDefaultModel(d.default);setEffortConfigs(d.efforts||{});}).catch(e=>setError(e.message));
    const connect = () => {
      const socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?token=${encodeURIComponent(token)}`,
      );
      ws.current = socket;
      socket.onopen = () => {
        attempts = 0;
        setConnected(true);
        if (selection.current && accountId.current)
          history(selection.current).catch((e) => setError(e.message));
      };
      socket.onclose = () => {
        setConnected(false);
        // Retry at once after a single drop, then back off so a down server is not hammered.
        if (!disposed) reconnect = setTimeout(connect, attempts++ ? Math.min(10000, 1000 * 2 ** (attempts - 2)) : 300);
      };
      socket.onmessage = ({ data }) => {
        const m = JSON.parse(data),
          id = m.sessionId;
        if (!id) return;
        if (m.runKey) {
          if (m.runKey < (runKeys.current[id] || 0)) return;
          if (m.runKey !== runKeys.current[id]) {
            runKeys.current[id] = m.runKey;
            seq.current[id] = 0;
          }
        }
        if (m.seq) {
          if (m.seq <= (seq.current[id] || 0)) return;
          seq.current[id] = m.seq;
        }
        if (!['chat_subscribed','status'].includes(m.kind)) setActivity(a=>({...a,[id]:{
          ...(a[id]||{}),runKey:m.runKey||a[id]?.runKey,
          startedAt:m.runKey||a[id]?.startedAt||Date.now(),lastEventAt:m.eventAt||Date.now(),
          ...(m.kind==='complete'?{completedAt:m.eventAt||Date.now(),aborted:m.aborted,outcome:m.success?0:1}:{completedAt:null}),
        }}));
        if (m.kind === "chat_subscribed") {
          setRunning((r) => ({ ...r, [id]: m.isProcessing }));
          setApprovals((a) => ({ ...a, [id]: m.pendingPermissions ?? [] }));
          return;
        }
        if(['stream_delta','thinking_delta','thinking','tool_use','tool_result','task_status','permission_request'].includes(m.kind))setRunning(r=>r[id]?r:{...r,[id]:true});
        if (["protocol_error", "error"].includes(m.kind)) {
          setError(m.error || m.content || "请求失败");
          setRunning((r) => ({ ...r, [id]: false }));
        }
        if (m.kind === "permission_request")
          setApprovals((a) => ({
            ...a,
            [id]: [
              ...(a[id] || []).filter((p) => p.requestId !== m.requestId),
              m,
            ],
          }));
        if (["permission_cancelled", "permission_resolved"].includes(m.kind))
          setApprovals((a) => ({
            ...a,
            [id]: (a[id] || []).filter((p) => p.requestId !== m.requestId),
          }));
        setFeeds(f=>({...f,[id]:mergeMessage(f[id]||[],m)}));
        if (m.kind === "complete") {
          // A run that finishes out of sight is flagged in the tab title, sidebar and (optionally) a notification.
          if (document.hidden || selection.current !== id) {
            setUnread(u=>({...u,[id]:true}));
            const title=projectsRef.current.flatMap(p=>p.sessions).find(s=>s.id===id)?.title||'对话';
            if (notifyRef.current && document.hidden && 'Notification' in window && Notification.permission === 'granted')
              try { new Notification(m.aborted ? 'Claude 已停止' : 'Claude 已完成', {body: title, tag: id}); } catch {}
          }
          setStopping(s=>({...s,[id]:false}));
          setRunning((r) => ({ ...r, [id]: false }));
          setApprovals((a) => ({ ...a, [id]: [] }));
          refreshProjects().catch(() => {});
          titleIfPending(id);
          if (selection.current === id)
            history(id, false).catch((e) => setError(e.message));
        }
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnect);
      ws.current?.close();
    };
  }, [token]);
  useEffect(() => {
    if(!me)return;
    localStorage.setItem(`cc-${me.id}-project`, project);
    if (selected) localStorage.setItem(`cc-${me.id}-session`, selected);
    else localStorage.removeItem(`cc-${me.id}-session`);
  }, [project, selected,me]);
  useEffect(() => {
    if(stick.current&&scroller.current)scroller.current.scrollTop=scroller.current.scrollHeight;
  }, [feeds[selected], selected]);
  // Keep the reader's place when earlier turns are prepended above them.
  useLayoutEffect(()=>{const saved=restoreScroll.current,el=scroller.current;if(!saved||!el||saved.id!==selected)return;restoreScroll.current=null;el.scrollTop=el.scrollHeight-saved.height+saved.top;},[feeds[selected],selected]);
  const loadEarlier=async()=>{
    const id=selected,meta=historyMeta[id],el=scroller.current;
    if(!id||!meta?.hasMore||meta.previousFrom===null||loadingEarlier)return;
    setLoadingEarlier(true);stick.current=false;
    try{pageFrom.current[id]=meta.previousFrom;if(el)restoreScroll.current={id,height:el.scrollHeight,top:el.scrollTop};await history(id,false);}
    catch(e){restoreScroll.current=null;setError(e.message);}finally{setLoadingEarlier(false);}
  };
  useEffect(() => {
    if (!selected || !token) return;
    let cancelled = false,
      wasRunning = false,
      timer;
    const poll = async () => {
      try {
        const state = await api(`/api/core/sessions/${selected}/state`);
        if (cancelled) return;
        setApprovals(a=>JSON.stringify(a[selected]||[])===JSON.stringify(state.pendingPermissions||[])?a:{...a,[selected]:state.pendingPermissions||[]});
        setRunning(r=>r[selected]===state.processing?r:{...r,[selected]:state.processing});
        if(state.activity)setActivity(a=>({...a,[selected]:state.activity}));
        if(state.processing&&['bypassPermissions','auto','default'].includes(state.permissionMode))setPermissionMode(state.permissionMode);
        if(state.processing)setRunEfforts(previous=>previous[selected]===state.effort?previous:{...previous,[selected]:state.effort});
        if(!state.processing)setStopping(s=>s[selected]?{...s,[selected]:false}:s);
        setLocked(l=>JSON.stringify(l[selected])===JSON.stringify(state.locked)?l:{...l,[selected]:state.locked});
        if (wasRunning && !state.processing)
          history(selected, false).catch((e) => setError(e.message));
        wasRunning = state.processing;
      } catch (err) {
        console.error("Session state recovery failed:", err.message);
      }
    };
    // WebSocket carries live events; polling is recovery, so it slows down while idle and connected.
    const loop = async () => {
      await poll();
      if (!cancelled) timer = setTimeout(loop, wasRunning || !connectedRef.current ? 2000 : 10000);
    };
    loop();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selected, token]);
  useEffect(()=>{
    const key=e=>{if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==='k'&&token){e.preventDefault();setPalette(open=>!open);}};
    addEventListener('keydown',key);return()=>removeEventListener('keydown',key);
  },[token]);
  const keyLatest=useRef(null);
  useEffect(()=>{const handler=e=>keyLatest.current?.(e);addEventListener('keydown',handler);return()=>removeEventListener('keydown',handler);},[]);
  const current = projects.find((p) => p.slug === project),
    session = current?.sessions.find((s) => s.id === selected),
    key = selected || `new-${project}`,
    draft = drafts[key] || "";
  const activeLock=selected?(locked[selected]??session?.locked):false;
  // Grow with the draft up to 40% of the viewport, then scroll inside the textarea. Measuring
  // briefly collapses the box, which lets the browser clamp both scroll positions; put them back
  // so the conversation and the draft stay where the reader left them.
  useLayoutEffect(()=>{
    const el=composerInput.current,list=scroller.current;if(!el)return;
    const top=list?.scrollTop,inner=el.scrollTop,atEnd=el.selectionEnd===el.value.length;
    el.style.height='auto';el.style.height=`${Math.min(el.scrollHeight,Math.round(innerHeight*.4))}px`;
    el.scrollTop=atEnd?el.scrollHeight:inner;
    if(list)list.scrollTop=stick.current?list.scrollHeight:top;
  },[draft,selected]);
  const pendingFiles=attachments[key]||[];
  // The server names a conversation once, after its first reply, unless it was renamed by hand.
  // Opening a chat retries, so one whose title step was missed still gets named.
  const titleIfPending=id=>api(`/api/core/sessions/${id}/title`,{method:'POST',body:'{}'}).then(d=>{if(!d.skipped)refreshProjects().catch(()=>{});}).catch(()=>{});
  const choose = (slug, id = null) => {
    loading.current++;
    if (id) { delete pageFrom.current[id]; quietUntil.current[id]=Infinity; setUnread(u=>u[id]?{...u,[id]:false}:u); }
    setEditingId(null);
    setProject(slug);
    setSelected(id);
    setProjectMenu(false);
    setExpanded(list=>list.includes(slug)?list:[...list,slug]);
    setError("");
    stick.current=true;setAway(false);
    const listed=id&&projects.find(p=>p.slug===slug)?.sessions.find(s=>s.id===id);
    setModel(id?listed?.model||'claude-opus-5-5':model);
    if(listed?.effort)setSessionEfforts(e=>e[id]?e:{...e,[id]:listed.effort});
    if (innerWidth < 760) setSidebar(false);
    if (id) { history(id).catch((e) => setError(e.message)); if (!running[id]) titleIfPending(id); }
  };
  // Starts a turn now; callers make sure the session is idle.
  const dispatch=(id,item)=>{
    setFeeds((f) => ({...f,[id]:[...(f[id] || []),{id:"local-"+Date.now(),kind:"text",role:"user",_local:true,
      images:item.files.filter(f=>f.preview).map(f=>({src:f.preview})),
      content:item.content+(item.files.length?'\n\n📎 '+item.files.map(f=>f.name).join('、'):'')}]}));
    loading.current++;
    setRunning((r) => ({ ...r, [id]: true }));
    setActivity(a=>({...a,[id]:{startedAt:Date.now(),lastEventAt:Date.now(),label:'等待服务响应'}}));
    ws.current.send(JSON.stringify({type:"chat.send",sessionId:id,content:item.content.trim()||'请阅读附加的资料。',model:item.model,permissionMode:item.permissionMode,effort:item.effort,attachmentIds:item.files.map(f=>f.id)}));
  };
  const send = async () => {
    if ((!draft.trim()&&!pendingFiles.length) || !current || !connected || !modelReady || !me || activeLock || uploading || sending.current)
      return;
    const item={qid:'q-'+Date.now(),content:draft,files:pendingFiles,model,permissionMode,effort:preferredEffort};
    setError("");setNotice(null);
    stick.current=true;setAway(false);
    // Like Claude Code: messages typed during a run wait their turn instead of being rejected.
    if (selected && running[selected]) {
      setQueues(q=>({...q,[selected]:[...(q[selected]||[]),item]}));
      setDrafts((d) => ({ ...d, [key]: "" }));setAttachments(a=>({...a,[key]:[]}));
      return;
    }
    sending.current = true;
    try {
      let id = selected;
      if (!id) {
        const d = await api("/api/core/sessions", {
          method: "POST",
          body: JSON.stringify({ project, content: draft }),
        });
        id = d.sessionId;
        setSelected(id);
        await refreshProjects();
      }
      setDrafts((d) => ({ ...d, [key]: "" }));
      setAttachments(a=>({...a,[key]:[]}));
      dispatch(id,item);
    } catch (e) {
      setError(e.message);
    } finally {
      sending.current = false;
    }
  };
  // Sends the next queued message once the server confirms the session is idle.
  useEffect(()=>{
    if(!connected)return;
    for(const [id,list] of Object.entries(queues)){
      if(!list?.length||running[id]||stopping[id]||flushing.current[id])continue;
      flushing.current[id]=true;
      api(`/api/core/sessions/${id}/state`).then(state=>{
        if(state.processing||state.admitting||state.locked){setTimeout(()=>{flushing.current[id]=false;setQueues(q=>({...q}));},1500);return;}
        const [next]=queuesRef.current[id]||[];flushing.current[id]=false;
        if(!next)return;
        setQueues(q=>({...q,[id]:(q[id]||[]).filter(x=>x.qid!==next.qid)}));dispatch(id,next);
      }).catch(e=>{flushing.current[id]=false;setError(e.message);});
    }
  },[queues,running,stopping,connected]);
  useEffect(()=>{if(me?.id)sessionStorage.setItem(`cc-${me.id}-queues`,JSON.stringify(Object.fromEntries(Object.entries(queues).map(([id,l])=>[id,l.map(({files,...q})=>({...q,files:files.map(({preview,...f})=>f)}))]))));},[queues,me]);
  // Re-runs the conversation from an earlier user message (upstream chat.edit-send).
  const editSend=(m,text)=>{
    const id=selected;
    if(!id||!text.trim()||!m.transcriptAnchorId||running[id]||!connected||activeLock||!modelReady)return;
    setEditingId(null);setError('');stick.current=true;setAway(false);
    setFeeds(f=>{const rows=f[id]||[],at=rows.findIndex(x=>x.id===m.id);return {...f,[id]:[...(at>=0?rows.slice(0,at):rows),{id:'local-'+Date.now(),kind:'text',role:'user',_local:true,content:text}]};});
    loading.current++;
    setRunning(r=>({...r,[id]:true}));
    setActivity(a=>({...a,[id]:{startedAt:Date.now(),lastEventAt:Date.now(),label:'等待服务响应'}}));
    ws.current.send(JSON.stringify({type:'chat.edit-send',sessionId:id,anchorId:m.transcriptAnchorId,content:text,model,permissionMode,effort:preferredEffort}));
  };
  const lastUserMessage=()=>(feeds[selected]||[]).findLast(x=>x.kind==='text'&&x.role==='user'&&x.transcriptAnchorId&&!isCompactCommand(x)&&!x.isLocalCommand);
  const chatLatest=useRef(null);chatLatest.current={submitEdit:editSend,startEdit:setEditingId,cancelEdit:()=>setEditingId(null),regenerate:()=>{const m=lastUserMessage();if(m)editSend(m,displayText(m));}};
  const [chatActions]=useState(()=>({submitEdit:(m,t)=>chatLatest.current.submitEdit(m,t),startEdit:id=>chatLatest.current.startEdit(id),cancelEdit:()=>chatLatest.current.cancelEdit(),regenerate:()=>chatLatest.current.regenerate()}));
  // Unread completions show in the tab title until seen.
  const unreadCount=Object.values(unread).filter(Boolean).length;
  useEffect(()=>{document.title=unreadCount?`(${unreadCount}) ✓ Claude 项目中心`:'Claude 项目中心';},[unreadCount]);
  useEffect(()=>{const seen=()=>{if(!document.hidden&&selection.current)setUnread(u=>u[selection.current]?{...u,[selection.current]:false}:u);};addEventListener('visibilitychange',seen);return()=>removeEventListener('visibilitychange',seen);},[]);
  // Unsent drafts survive a reload (text only; attachments are re-picked).
  useEffect(()=>{if(!me?.id)return;const t=setTimeout(()=>{const kept=Object.fromEntries(Object.entries(drafts).filter(([,v])=>v&&v.trim()));localStorage.setItem(`cc-${me.id}-drafts`,JSON.stringify(kept));},400);return()=>clearTimeout(t);},[drafts,me]);
  const toggleNotify=async()=>{
    if(notify){setNotify(false);localStorage.setItem('cc-notify','off');return;}
    if(!('Notification' in window)){setError('此浏览器不支持通知');return;}
    const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
    if(permission!=='granted'){setError('浏览器未允许通知；可在网站设置中开启');return;}
    setNotify(true);localStorage.setItem('cc-notify','on');
  };
  keyLatest.current=e=>{
    if(e.isComposing||!token)return;
    if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='o'){e.preventDefault();choose(project);setTimeout(()=>composerInput.current?.focus());return;}
    if(e.key!=='Escape'||viewer||palette)return;
    const closers=[[modal,()=>{setModal(null);setAccountPassword('');setError('');}],[deleteTarget&&!deleting,()=>setDeleteTarget(null)],[memory,()=>setMemory(null)],[projectFiles,()=>setProjectFiles(null)],[generated,()=>setGenerated(null)],[trashDrawer,()=>setTrashDrawer(null)],[accountMenu,()=>setAccountMenu(false)],[editingId,()=>setEditingId(null)]];
    const open=closers.find(([when])=>when);
    if(open){e.preventDefault();open[1]();return;}
    if(selected&&running[selected]&&!stopping[selected]){e.preventDefault();stop();}
  };
  const unqueue=(id,item)=>{setQueues(q=>({...q,[id]:(q[id]||[]).filter(x=>x.qid!==item.qid)}));if(!draft.trim()&&!pendingFiles.length){setDrafts(d=>({...d,[key]:item.content}));setAttachments(a=>({...a,[key]:item.files}));}};
  const stop = () => {
    if(ws.current?.readyState!==1)return;
    setStopping(s=>({...s,[selected]:true}));
    ws.current.send(JSON.stringify({type:'chat.abort',sessionId:selected}));
  };
  const openMemory = async () => {
    try {
      const d = await api(`/api/core/memory/${project}`);
      setMemory(d);
    } catch (e) {
      setError(e.message);
    }
  };
  const saveMemory=async(source,name,content,reference)=>{const d=await api(`/api/core/memory/${project}`,{method:'PUT',body:JSON.stringify({source,name,content,reference})});setMemory(d);};
  const enableMemoryHabit=async()=>setMemory(await api(`/api/core/memory/${project}/habit`,{method:'POST',body:'{}'}));
  const runModel=()=>models.includes(model)?model:defaultModel;
  // On-demand review: a visible new conversation reads an excerpt of recent ones and updates automatic memory.
  const organizeMemory=async()=>{
    if(!current||!connected||!me)throw new Error('连接未就绪，请稍后再试');
    const digest=await api(`/api/core/memory/${project}/digest`,{method:'POST',body:'{}'});
    const title=`整理记忆 · ${new Date().toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'})}`;
    const created=await api('/api/core/sessions',{method:'POST',body:JSON.stringify({project,content:title,autoTitle:false})});
    await api(`/api/core/sessions/${created.sessionId}`,{method:'PATCH',body:JSON.stringify({title})});
    await refreshProjects();
    setMemory(null);setSelected(created.sessionId);selection.current=created.sessionId;stick.current=true;
    dispatch(created.sessionId,{content:`请整理这个项目的记忆。\n\n1. 先阅读 ${digest.path}，这是本项目最近 ${digest.conversations} 段对话的摘录（新的在前）。\n2. 再查看你现有的自动记忆。\n3. 把对这个项目长期有用的信息（目标与背景、我的偏好、关键决定及原因、进展与待办、重要的人和资料位置）写入或更新到自动记忆：补充遗漏、合并重复、修正或删除过时的内容。不要记录一次性的细节、临时数据、密码或密钥。\n4. 完成后用几句话说明新增、修改、删除了哪些记忆。`,files:[],model:runModel(),permissionMode,effort:preferredEffort});
  };
  // Manual compaction through Claude Code's own /compact command.
  const compactContext=()=>{if(selected&&!running[selected]&&connected&&!activeLock)dispatch(selected,{content:'/compact',files:[],model,permissionMode,effort:preferredEffort});};
  // XHR rather than fetch so the composer can show real upload progress.
  const postWithProgress=(url,body,onProgress)=>new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open('POST',url);
    if(token)xhr.setRequestHeader('Authorization',`Bearer ${token}`);
    xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(e.loaded/e.total);};
    xhr.onload=()=>{let data={};try{data=JSON.parse(xhr.responseText);}catch{}
      if(xhr.status>=200&&xhr.status<300)resolve(data);else reject(new Error(data.error?.message||data.error||'上传失败'));};
    xhr.onerror=()=>reject(new Error('上传失败，请检查网络后重试'));
    xhr.send(body);
  });
  const uploadFiles=async(files)=>{
    if(!current||!files?.length||uploading)return;
    const targetKey=key,targetProject=project;
    if(files.length+pendingFiles.length>10){setError('每次最多附加 10 个文件');return;}
    const tooBig=files.filter(f=>f.size>100*1024*1024&&!needsShrink(f));
    if(tooBig.length){setError(`单个文件不能超过 100 MB：${tooBig.map(f=>f.name).join('、')}`);return;}
    setUploading(true);setUploadProgress(0);setError('');
    try{files=await Promise.all(files.map(f=>shrinkImage(f).catch(()=>f)));
    const body=new FormData();for(const f of files)body.append('files',f);const d=await postWithProgress(`/api/core/projects/${targetProject}/files`,body,setUploadProgress);const local=[...files];const withPreview=d.files.map(f=>{const source=local.find(x=>x.name===f.name&&x.type?.startsWith('image/')&&isPreviewable(x.name));return source?{...f,preview:URL.createObjectURL(source)}:f;});setAttachments(a=>({...a,[targetKey]:[...(a[targetKey]||[]),...withPreview]}));}
    catch(e){setError(e.message);}finally{setUploading(false);}
  };
  const download=async f=>{
    try{const r=await fetch(`/api/core/files/${f.id}`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error('文件不可用');const u=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=u;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}catch(e){setError(e.message);}
  };
  const downloadFile=async link=>{try{await api('/api/core/download-auth',{method:'POST',body:'{}'});startDownload(link);}catch(e){setError(e.message);}};
  // Stable context value: memoized messages must not re-render just because App did.
  const fileActionsLatest=useRef(null);fileActionsLatest.current={download:downloadFile,view:setViewer,details:toolId=>api(`/api/core/sessions/${selection.current}/tool-details/${encodeURIComponent(toolId)}`)};
  const [toolDetails]=useState(()=>toolId=>fileActionsLatest.current.details(toolId));
  const [arrival]=useState(()=>()=>Date.now()>(quietUntil.current[selection.current]??0));
  const [fileActions]=useState(()=>({download:link=>fileActionsLatest.current.download(link),view:link=>fileActionsLatest.current.view(link)}));
  const openFiles=async()=>{try{setProjectFiles(await api(`/api/core/projects/${project}/files`));}catch(e){setError(e.message);}};
  const openGenerated=async()=>{try{setGenerated(await api(`/api/core/generated/${project}`));}catch(e){setError(e.message);}};
  const openTrash=async()=>{try{setTrashError('');setTrashDrawer(await api('/api/core/session-trash'));}catch(e){setError(e.message);}};
  const restoreChat=async item=>{
    setDeleting(true);setTrashError('');
    try{await api(`/api/core/sessions/${item.id}/restore`,{method:'POST',body:'{}'});await refreshProjects();setTrashDrawer(d=>d?{...d,sessions:d.sessions.filter(s=>s.id!==item.id)}:null);setNotice(null);}
    catch(e){setTrashError(e.message);if(!trashDrawer)setError(e.message);}finally{setDeleting(false);}
  };
  const removeChat=async()=>{
    const target=deleteTarget;if(!target||deleting)return;setDeleting(true);setTrashError('');
    try{
      await api(`/api/core/sessions/${target.id}`,{method:'DELETE'});
      if(selection.current===target.id){loading.current++;selection.current=null;setSelected(null);setMemory(null);setFile(null);}
      setFeeds(f=>{const next={...f};delete next[target.id];return next;});
      setSessionFiles(f=>{const next={...f};delete next[target.id];return next;});
      await refreshProjects();setNotice(target);setDeleteTarget(null);
    }catch(e){setTrashError(e.message);}finally{setDeleting(false);}
  };
  const logout=async()=>{
    try{await fetch('/api/core/download-auth',{method:'DELETE',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(3000)});}catch{}
    setGenerated(null);
    setSessionFiles({});setTrashDrawer(null);setDeleteTarget(null);setNotice(null);setTrashError('');
    setActivity({});setStopping({});runKeys.current={};seq.current={};
    setPermissionMode('bypassPermissions');
    authEpoch.current++;setProjectsLoaded(false);
    loading.current++;ws.current?.close();selection.current=null;accountId.current=null;
    forgetLogin();setToken('');setSelected(null);setProjects([]);setFeeds({});setApprovals({});setRunning({});setDrafts({});setAttachments({});setLocked({});setMemory(null);setFile(null);setProjectFiles(null);setMe(null);setModal(null);setAccountMenu(false);setModel('claude-opus-5-5');setEffortChoices({});setRunEfforts({});setSessionEfforts({});
  };
  const submitModal=async e=>{
    e.preventDefault();setError('');
    try{
      if(modal==='account'){await api('/api/core/accounts',{method:'POST',body:JSON.stringify({username:formName,password:accountPassword})});setAccountPassword('');setAccounts(await api('/api/core/accounts'));setFormName('');return;}
      if(modal==='create'){const p=await api('/api/core/projects',{method:'POST',body:JSON.stringify({name:formName})});await refreshProjects();choose(p.id);}
      if(modal==='rename'){await api(`/api/core/projects/${project}`,{method:'PATCH',body:JSON.stringify({name:formName})});await refreshProjects();}
      if(modal?.type==='renameChat'){await api(`/api/core/sessions/${modal.id}`,{method:'PATCH',body:JSON.stringify({title:formName})});await refreshProjects();setModal(null);return;}
      if(modal==='takeover'){await api(`/api/core/sessions/${selected}/takeover`,{method:'POST',body:'{}'});setLocked(l=>({...l,[selected]:false}));await history(selected);}
      setModal(null);
    }catch(e){setError(e.message);}
  };
  const [suggesting,setSuggesting]=useState(false);
  const suggestTitle=async()=>{
    setSuggesting(true);setError('');
    try{const d=await api(`/api/core/sessions/${modal.id}/title`,{method:'POST',body:JSON.stringify({force:true})});setFormName(d.title);}
    catch(e){setError(e.message);}finally{setSuggesting(false);}
  };
  const approve = async (p, allow) => {
    try {
      await api(`/api/core/permissions/${p.requestId}`, {
        method: "POST",
        body: JSON.stringify({ sessionId: selected, allow }),
      });
      setApprovals((a) => ({
        ...a,
        [selected]: (a[selected] || []).filter(
          (x) => x.requestId !== p.requestId,
        ),
      }));
    } catch (e) {
      setError(e.message);
    }
  };
  const login = async (e) => {
    e.preventDefault();
    try {
      const d = await api(`/api/auth/${setup ? "register" : "login"}`, {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      saveLogin(d.token);
      authEpoch.current++;
      setSelected(null);selection.current=null;setProjects([]);setFeeds({});accountId.current=null;
      setToken(d.token);
      setPassword("");
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  if (!token)
    return (
      <main className="login">
        <h1>Claude 项目中心</h1>
        <p>{setup ? "设置你的访问账号" : "登录后继续你的项目与对话"}</p>
        <form onSubmit={login}>
          <label>
            账号
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            密码
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              minLength={6}
              autoComplete={setup ? "new-password" : "current-password"}
              required
            />
          </label>
          <button className="primary">
            {setup ? "创建账号并进入" : "进入项目中心"}
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  if(!projectsLoaded)return <main className="login"><h1>Claude 项目中心</h1><p role="status">正在加载你的项目…</p>{error&&<p role="alert">{error}</p>}</main>;
  const feed=feeds[selected]||[],pendingApprovals=approvals[selected]||[],lastUserIndex=feed.findLastIndex(x=>x.role==='user'),feedGroups=groupFeed(feed);
  const isWaiting=m=>pendingApprovals.some(p=>p.toolName===m.toolName&&JSON.stringify(p.input)===JSON.stringify(m.toolInput));
  const isActive=(m,i)=>Boolean(running[selected]&&i>lastUserIndex&&!m.toolResult&&m.kind!=='tool_result'&&(m.kind!=='thinking'||m._stream));
  const activityRow=({message:m,index:i})=><ActivityRow key={m._key||m.toolId||m.id||i} message={m} detailed={detailed} waiting={isWaiting(m)} active={isActive(m,i)}/>;
  const meta=historyMeta[selected],queued=queues[selected]||[];
  const lastReplyId=lastUserIndex>=0&&feed[lastUserIndex]?.transcriptAnchorId&&!isCompactCommand(feed[lastUserIndex])?feed.findLast((x,i)=>i>lastUserIndex&&isOrdinaryReply(x))?.id:null;
  const displayGroups=withTurnFiles(collapseTurns(feedGroups,{keepLast:Boolean(running[selected])}),filesByTurn(feed,current?.path,sessionFiles[selected],{complete:!meta?.hasMore}));
  const toggleKey=(key,fallback)=>()=>setOpenGroups(o=>({...o,[key]:!(o[key]??fallback)}));
  const renderGroup=g=>{
    if(g.type==='files')return <TurnFiles key={g.key} files={g.files}/>;
    if(g.type==='process'){
      const key=`${selected}:${g.key}`,duration=g.startedAt&&g.endedAt?formatDuration(g.endedAt-g.startedAt):'';
      return <ActivityGroup key={g.key} title="处理过程" meta={duration&&`用时 ${duration}`} messages={g.messages} open={openGroups[key]??detailed} onToggle={toggleKey(key,detailed)}>{g.groups.map(renderGroup)}</ActivityGroup>;
    }
    if(g.type==='activity'){
      if(g.items.length===1)return activityRow(g.items[0]);
      const key=`${selected}:${g.key}`,waiting=g.items.some(({message})=>isWaiting(message));
      return <ActivityGroup key={g.key} messages={g.items.map(x=>x.message)} live={g.items.some(x=>isActive(x.message,x.index))} waiting={waiting} open={openGroups[key]??(detailed||waiting)} onToggle={toggleKey(key,detailed||waiting)}>{g.items.map(activityRow)}</ActivityGroup>;
    }
    const m=g.message,idle=!running[selected]&&!activeLock&&connected;
    // Local slash commands and their raw output stay hidden; compaction shows as a divider with its summary folded.
    if(isCompactCommand(m)||m.isLocalCommandStdout)return null;
    if(m.compact)return <CompactNotice key={m.id||g.index} compact={m.compact} text={m.content} summary={[feed[g.index-1],feed[g.index-2]].find(x=>x?.isCompactSummary)}/>;
    if(m.isCompactSummary)return null;
    return <MessageArticle key={m._key||m.id||g.index} message={m} editing={editingId===m.id} canEdit={idle&&m.role==='user'&&Boolean(m.transcriptAnchorId)} canRegenerate={idle&&m.id===lastReplyId}/>;
  };
  return (
    <FileActions.Provider value={fileActions}><ToolDetails.Provider value={toolDetails}><Arrival.Provider value={arrival}><ChatActions.Provider value={chatActions}>
    <div className={`app ${sidebar ? "" : "sidebar-hidden"}`} style={sidebarWidth?{'--sidebar-w':`${sidebarWidth}px`}:undefined}>
      <aside className={`sidebar ${sidebarWidth?'sized':''}`}>
        <div className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="调整侧栏宽度" tabIndex={0} title="拖动调整宽度，双击恢复默认" onPointerDown={resizeSidebar} onKeyDown={nudgeSidebar} onDoubleClick={()=>{setSidebarWidth(null);localStorage.removeItem('cc-sidebar-width');}}/>
        <header>
          <span className="wordmark">Claude</span>
          <div>
            <button aria-label="收起侧栏" onClick={() => setSidebar(false)}>
              <SidebarSimple size={22} />
            </button>
            <button
              aria-label="搜索对话"
              title="搜索对话（Ctrl+K）"
              onClick={() => setPalette(true)}
            >
              <MagnifyingGlass size={22} />
            </button>
          </div>
        </header>
        <button className="home" title="在当前项目中新建对话（Ctrl+Shift+O）" onClick={() => choose(project)}>
          <NotePencil size={22} />
          新建对话
        </button>
        <div className="section-label">项目 <button aria-label="创建项目" onClick={()=>{setFormName('');setModal('create');}}><Plus size={18}/></button></div>
        <nav>
          {projects.map(({slug, name, sessions: projectSessions}) => (
            <div key={slug} className="project-row">
              <div className="project-head">
              <button className="project-new" aria-label={`在 ${name} 中新建对话`} title="在此项目中新建对话" onClick={() => choose(slug)}><Plus size={16} /></button>
              <button
                className={`project ${project === slug ? "active" : ""}`}
                aria-expanded={expanded.includes(slug)}
                title={expanded.includes(slug)?'收起':'展开'}
                onClick={() => toggleExpanded(slug)}
              >
                <Folder size={26} />
                <span>{name}</span>
                {expanded.includes(slug) ? (
                  <CaretUp size={17} />
                ) : (
                  <CaretRight size={17} />
                )}
              </button>
              </div>
              {expanded.includes(slug) && (
                <div className="sessions">
                  {groupByRecency(projectSessions || []).map((group) => (
                    <React.Fragment key={group.label}>
                      <p className="session-group">{group.label}</p>
                      {group.sessions.map((s) => (
                        <div className={`session-row ${selected === s.id ? "selected" : ""}`} key={s.id}>
                          <button
                            title={s.title}
                            className={selected === s.id ? "selected" : ""}
                            onClick={() => choose(slug, s.id)}
                          >
                            <ChatCircle size={21} />
                            <span>{s.title}</span>
                            {running[s.id] ? <span className="running-dot" /> : unread[s.id] && <span className="unread-dot" aria-label="有新回复" />}
                          </button>
                          <span className="session-row-actions">
                            <button aria-label={`重命名 ${s.title}`} title="重命名" onClick={()=>{setFormName(s.title);setModal({type:'renameChat',id:s.id});}}><PencilSimple size={15}/></button>
                            <button aria-label={`删除 ${s.title}`} title="删除" disabled={Boolean(running[s.id]||s.locked)} onClick={()=>{setTrashError('');setDeleteTarget({id:s.id,title:s.title,project:slug});}}><Trash size={15}/></button>
                          </span>
                        </div>
                      ))}
                    </React.Fragment>
                  ))}
                  {projectSessions?.length === 0 && (
                    <p className="no-history">还没有对话</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </nav>
        <SubscriptionUsage key={me?.id||'pending'} api={api} accountId={me?.id} open={usageOpen} onOpenChange={setUsageOpen}/>
        <footer>
          <UserCircle size={27} />
          <span>{me?.username || '连接中'}<small>{connected ? "已连接" : "重新连接中…"}</small></span>
          <button
            title="账号菜单"
            aria-label="账号菜单"
            onClick={()=>setAccountMenu(!accountMenu)}
          >
            <CaretDown size={18} />
          </button>
          {accountMenu&&<div className="account-menu">{me?.admin&&<button onClick={async()=>{try{setAccounts(await api('/api/core/accounts'));setFormName('');setAccountPassword('');setModal('account');setAccountMenu(false);}catch(e){setError(e.message);}}}><UsersThree size={16}/>管理登录账号</button>}{me?.modelProvider!=='packy'&&<button onClick={()=>{setAccountMenu(false);setUsageOpen(true);}}><ChartPie size={16}/>订阅额度</button>}<button onClick={()=>{setAccountMenu(false);openTrash();}}><Trash size={16}/>回收站</button><button onClick={toggleNotify}><Bell size={16}/>完成时通知：{notify?'开':'关'}</button><button onClick={logout}><SignOut size={16}/>退出登录</button></div>}
        </footer>
      </aside>
      <main
        ref={mainRef}
        data-session-id={selected || ""}
        className={selected ? "chat" : "welcome"}
        onDragEnter={e=>{if(current&&!activeLock&&[...e.dataTransfer.types].includes('Files'))setDragging(true);}}
      >
        {dragging&&<div className="drop-overlay" onDragOver={e=>e.preventDefault()} onDragLeave={e=>{if(e.currentTarget===e.target)setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);uploadFiles([...e.dataTransfer.files]);}}><div><Paperclip size={30}/><strong>松开即可附加文件</strong><small>任意格式（含 zip、tar.gz 压缩包），单个 100 MB 以内，每次最多 10 个</small></div></div>}
        {!sidebar && (
          <button
            className="show-sidebar"
            aria-label="展开侧栏"
            onClick={() => setSidebar(true)}
          >
            <SidebarSimple size={24} />
          </button>
        )}
        {selected && (
          <div className="chat-header">
            <span className="chat-breadcrumb">
              <Folder size={21}/><b>{current?.name}</b>
              <CaretRight size={15} />
              {session?.title || "新对话"}
            </span>
            <div className="chat-header-actions">
              <span className={`connection-state ${connected?'online':''}`}><Circle size={8} weight="fill"/>{connected?'已连接':'重连中'}</span>
              <ProjectActions provider={me?.modelProvider} openMemory={openMemory} openFiles={openFiles} openGenerated={openGenerated} permissionMode={permissionMode} setPermissionMode={setPermissionMode} busy={running[selected]} hasProject={Boolean(current)} detailed={detailed} setDetailed={chooseView} locked={activeLock} deleteChat={()=>{setTrashError('');setDeleteTarget({id:selected,title:session?.title||'未命名对话',project});}}/>
            </div>
          </div>
        )}
        {!selected && (
          <div className="welcome-settings"><ProjectActions provider={me?.modelProvider} openMemory={openMemory} openFiles={openFiles} openGenerated={openGenerated} permissionMode={permissionMode} setPermissionMode={setPermissionMode} busy={false} hasProject={Boolean(current)} detailed={detailed} setDetailed={chooseView}/></div>
        )}
        {!selected && (
          <div className="welcome-heading">
            <h1>
              <img
                className="welcome-mark"
                src="/assets/welcome-mark.png"
                alt=""
              />
              今天想推进什么？
            </h1>
            <div className="context">
              <button
                aria-expanded={projectMenu}
                onClick={() => setProjectMenu(!projectMenu)}
              >
                <Folder size={27} />
                {current?.name || "还没有项目"}
                <CaretDown size={14} />
              </button>
              {projectMenu && (
                <div className="project-menu">
                  {projects.map((p) => (
                    <button key={p.slug} onClick={() => choose(p.slug)}>
                      <Folder size={20} />
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
              <span />
              <button className="memory-button" onClick={openMemory}>
                <BookOpen size={25} />
                项目记忆
              </button>
              {current&&<button onClick={openFiles}>项目资料</button>}
              {current&&<button onClick={openGenerated}>生成文件</button>}
              {current&&<button onClick={()=>{setFormName(current.name);setModal('rename');}}>重命名</button>}
            </div>
          </div>
        )}
        {selected && (
          <div className="messages" ref={scroller} onScroll={()=>{const el=scroller.current;stick.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;setAway(!stick.current);if(el.scrollTop<160&&!restoreScroll.current)loadEarlier();}}>
            {meta?.hasMore&&<button className="load-earlier" disabled={loadingEarlier} onClick={loadEarlier}>{loadingEarlier?'正在加载更早的消息…':'加载更早的消息'}</button>}
            {displayGroups.map(renderGroup)}
            {(approvals[selected] || []).map((p) => <PermissionRequest key={p.requestId} request={p} onDecide={allow=>approve(p,allow)}/>)}
            <div ref={bottom} />
          </div>
        )}
        <div className="composer-area">
          {selected&&<RunStatus running={running[selected]} pending={(approvals[selected]||[]).length>0} connected={connected} activity={activity[selected]} onStop={stop} stopping={stopping[selected]} onJump={()=>{stick.current=false;scroller.current?.querySelector('.permission')?.scrollIntoView({behavior:'smooth',block:'center'});}}/>}
          {away&&<button className="return-bottom" onClick={()=>{stick.current=true;setAway(false);scroller.current?.scrollTo({top:scroller.current.scrollHeight,behavior:'smooth'});}}>回到最新消息 ↓</button>}
          {!current&&<div className="notice">此账号还没有项目。<button onClick={()=>{setFormName('');setModal('create');}}>创建第一个项目</button></div>}
          {selected&&models.length>0&&!models.includes(model)&&<div className="notice">当前通道暂不支持此对话的模型，记录和文件已保留，可在下方选择可用模型。<button onClick={()=>choose(project)}>新建对话</button></div>}
          {activeLock && (
            <p className="notice">
              终端里的 Claude {activeLock.status==='waiting'?'正在等待确认':activeLock.status==='busy'?'正在处理任务':'仍在运行'}。关闭窗口会保留 tmux 会话。可以查看记录，或
              <button onClick={()=>setModal('takeover')}>转到网页继续</button>。
            </p>
          )}
          {queued.length>0&&<div className="queued" aria-label="排队中的消息">{queued.map((q,i)=><div className="queued-item" key={q.qid}>
            <span className="queued-label">{i===0?'下一条':'排队中'}</span><span className="queued-text">{q.content.trim()||q.files.map(f=>f.name).join('、')}</span>
            {i===0&&running[selected]&&<button disabled={stopping[selected]} onClick={stop}>中断并发送</button>}
            <button onClick={()=>unqueue(selected,q)}>撤回</button>
          </div>)}</div>}
          <div className="composer">
            {pendingFiles.length>0&&<div className="attachment-list">{pendingFiles.map(f=><span key={f.id} className={`attachment-chip ${f.preview?'with-thumb':''}`}>{f.preview?<img className="attachment-thumb" src={f.preview} alt=""/>:f.mime.startsWith('image/')?<Image size={17}/>:<File size={17}/>} {f.name}<button aria-label={`移除 ${f.name}`} onClick={()=>setAttachments(a=>({...a,[key]:(a[key]||[]).filter(x=>x.id!==f.id)}))}><X size={15}/></button></span>)}</div>}
            {uploading&&<p role="status" className="upload-status"><span className="upload-bar"><span style={{width:`${Math.round(uploadProgress*100)}%`}}/></span>{uploadProgress<1?`正在上传 ${Math.round(uploadProgress*100)}%`:'上传完成，正在解析资料…'}</p>}
            <textarea
              rows={1}
              ref={composerInput}
              aria-label="消息"
              placeholder={
                selected
                  ? running[selected] ? "Claude 正在处理，可以继续输入，发送后排队…" : "回复这段对话…"
                  : `发送消息，开始新的${project === "work" ? "工作" : ""}对话。`
              }
              value={draft}
              onChange={(e) =>
                setDrafts((d) => ({ ...d, [key]: e.target.value }))
              }
              onPaste={e=>{const files=[...e.clipboardData.files];if(files.length){e.preventDefault();uploadFiles(files);}}}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" && !draft && !e.nativeEvent.isComposing && selected && !running[selected]) {
                  const last = lastUserMessage();
                  if (last) { e.preventDefault(); setEditingId(last.id); return; }
                }
                if (sendsOnEnter(e)) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={Boolean(activeLock)||!current}
            />
            <div className="composer-tools">
              <div>
                <button
                  className="tool"
                  title="上传图片或文件"
                  aria-label="上传图片或文件"
                  disabled={!current||uploading||Boolean(activeLock)}
                  onClick={()=>picker.current?.click()}
                >
                  <Plus size={25} />
                </button>
                <input ref={picker} type="file" multiple hidden onChange={e=>{uploadFiles([...e.target.files]);e.target.value='';}}/>
                <button
                  className="tool"
                  title="新建对话"
                  aria-label="新建对话"
                  onClick={() => choose(project)}
                >
                  <ChatCircle size={24} />
                </button>
              </div>
              <div>
                {selected&&usage[selected]>0&&<button type="button" className={`context-usage ${usage[selected]>=500000?'high':usage[selected]>=150000?'mid':'low'}`} disabled={Boolean(running[selected]||activeLock||!connected)} onClick={compactContext} title={`当前上下文约 ${usage[selected].toLocaleString()} tokens。点击压缩：Claude Code 会把之前的对话总结成摘要继续，记录仍完整保留。`}><span className="usage-label">上下文 {usage[selected]>=10000?`${(usage[selected]/10000).toFixed(1)} 万`:usage[selected]}</span><span className="usage-action">压缩上下文</span></button>}
                <ModelControls model={model} models={models} labels={modelLabels} effort={effort} config={effortConfig} onEffortChange={setEffort} busy={Boolean(uploading||running[selected])} inChat={Boolean(selected)} usage={selected?usage[selected]:0} onModelChange={changeModel}/>
                {running[selected] && !draft.trim() && !pendingFiles.length ? (
                  <button
                    className="send"
                    aria-label="停止回复"
                    disabled={!connected||stopping[selected]}
                    onClick={stop}
                  >
                    <Square size={21} weight="fill" />
                  </button>
                ) : (
                  <button
                    className="send"
                    aria-label={running[selected]?"排队发送":"发送消息"}
                    title={running[selected]?"本轮结束后自动发送":undefined}
                    disabled={(!draft.trim()&&!pendingFiles.length) || !current || !connected || !modelReady || !me || Boolean(activeLock)||uploading}
                    onClick={send}
                  >
                    <ArrowUp size={26} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
      <div className="toasts">
        {error&&!modal&&<Toast key={error} tone="error" duration={10000} onClose={()=>setError('')}>{error}</Toast>}
        {notice&&<Toast key={notice.id} busy={deleting} action={{label:'撤销',onClick:()=>restoreChat(notice)}} onClose={()=>setNotice(null)}>已将对话移至回收站，项目文件已保留。</Toast>}
      </div>
      {deleteTarget&&<div className="drawer-backdrop" onClick={()=>{if(!deleting)setDeleteTarget(null);}}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-chat-title" onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape'&&!deleting)setDeleteTarget(null);}}><header><h2 id="delete-chat-title">删除这段对话？</h2></header><p className="delete-title">{deleteTarget.title}</p><p>聊天将移入回收站，可随时恢复。</p><p>上传资料、生成文件和项目记忆都会保留，不会随对话删除。</p><div className="dialog-actions"><button autoFocus disabled={deleting} onClick={()=>setDeleteTarget(null)}>取消</button><button className="danger-action" disabled={deleting} onClick={removeChat}>{deleting?'正在处理…':'移至回收站'}</button></div>{trashError&&<p role="alert" className="error">{trashError}</p>}</section></div>}
      {trashDrawer&&<div className="drawer-backdrop" onClick={()=>setTrashDrawer(null)}><section className="memory-drawer" role="dialog" aria-modal="true" aria-labelledby="trash-title" onClick={e=>e.stopPropagation()}><header><h2 id="trash-title">回收站</h2><button autoFocus aria-label="关闭回收站" onClick={()=>setTrashDrawer(null)}><X size={24}/></button></header><p>删除的聊天可在这里恢复。项目文件和记忆始终保留，回收站不会自动清空。</p>{!trashDrawer.sessions.length&&<p>回收站是空的。</p>}{trashDrawer.sessions.map(s=><div className="file-row" key={s.id}><div><strong>{s.title||'未命名对话'}</strong><small>{s.projectName} · {s.deletedAt}</small></div><button disabled={deleting} aria-label={`恢复对话：${s.title||'未命名对话'}`} onClick={()=>restoreChat(s)}>恢复</button></div>)}{trashDrawer.truncated&&<p>仅显示最近 200 段对话。</p>}{trashError&&<p role="alert" className="error">{trashError}</p>}</section></div>}
      {generated&&<div className="drawer-backdrop" onClick={()=>setGenerated(null)}><section className="memory-drawer" role="dialog" aria-modal="true" aria-labelledby="generated-title" onClick={e=>e.stopPropagation()}><header><h2 id="generated-title">生成文件</h2><button autoFocus aria-label="关闭生成文件" onClick={()=>setGenerated(null)}><X size={24}/></button></header><p>包含终端和网页 Claude 保存在此项目中的文档。点击文件打开下载；修改文件后可刷新列表。</p><button onClick={openGenerated}>刷新列表</button>{!generated.files.length&&<p>还没有可下载的文件。可以让 Claude 把文档保存在当前项目或 outputs 文件夹。</p>}{generated.truncated&&<p>文件较多，仅显示部分结果；已知文件仍可通过下载链接访问。</p>}{generated.files.map(f=><div className="file-row" key={f.path}><button className="file-link" onClick={()=>{const link=parseDownloadLink(f.url,location.origin);if(link)downloadFile({...link,name:f.name});}}>{f.path}</button><small>{Math.ceil(f.size/1024)} KB<br/>{new Date(f.modifiedAt).toLocaleDateString()}</small><button onClick={async()=>{try{await navigator.clipboard.writeText(location.origin+f.url);}catch{setError('复制未成功，请右键文件链接复制地址');}}}>复制链接</button></div>)}</section></div>}
      {modal&&<div className="drawer-backdrop" onClick={()=>{setModal(null);setAccountPassword('');setError('');}}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={e=>e.stopPropagation()}><header><h2 id="dialog-title">{modal?.type==='renameChat'?'重命名对话':{create:'创建项目',rename:'重命名项目',account:'管理登录账号',takeover:'转到网页继续'}[modal]}</h2><button aria-label="关闭弹窗" onClick={()=>{setModal(null);setAccountPassword('');setError('');}}><X size={22}/></button></header><form onSubmit={submitModal}>{modal==='takeover'?<p>这会正常结束此对话的空闲终端进程，再在网页继续已保存的记录。终端中尚未发送的输入可能丢失；正在执行任务时会拒绝接管。</p>:<>{modal==='account'&&<><p>两个账号都以完全访问在这台服务器上运行，共用当前配置的模型通道。项目、上传资料、对话记录，以及 CC 的记忆、全局 CLAUDE.md、设置和 MCP 配置各自独立；第二个账号从空项目开始。</p><ul>{accounts.map(a=><li key={a.id}>{a.username}{a.id===me?.id?'（当前账号）':''}</li>)}</ul></>}{(modal!=='account'||accounts.length<2)&&<><label>{modal==='account'?'新账号名称':modal?.type==='renameChat'?'对话名称':'项目名称'}<input value={formName} onChange={e=>setFormName(e.target.value)} maxLength={modal==='account'?40:modal?.type==='renameChat'?100:60} autoComplete="off" required/></label>{modal?.type==='renameChat'&&<button type="button" className="suggest-title" disabled={suggesting} onClick={suggestTitle}><Sparkle size={15}/>{suggesting?'正在生成…':'让 Claude 起个标题'}</button>}{modal==='account'&&<label>新账号密码<input type="password" value={accountPassword} onChange={e=>setAccountPassword(e.target.value)} minLength={10} autoComplete="new-password" required/></label>}</>}</>}{(modal!=='account'||accounts.length<2)&&<button className="primary">{modal==='takeover'?'确认转到网页':modal==='account'?'创建第二个账号':'保存'}</button>}{error&&<p role="alert" className="error">{error}</p>}</form></section></div>}
      {projectFiles&&<div className="drawer-backdrop" onClick={()=>setProjectFiles(null)}><section className="memory-drawer" role="dialog" aria-modal="true" aria-labelledby="files-title" onClick={e=>e.stopPropagation()}><header><h2 id="files-title">项目资料</h2><button autoFocus aria-label="关闭项目资料" onClick={()=>setProjectFiles(null)}><X size={24}/></button></header><p>此项目上传的文件。点击文件下载；点击“附加”用于当前消息，可连续附加多个。单文件 100 MB，每次 10 个。</p>{projectFiles.length===0&&<p>还没有上传资料。使用输入框的 + 添加。</p>}{projectFiles.map(f=><div className="file-row" key={f.id}><button onClick={()=>download(f)}>{f.name}</button><small>{Math.ceil(f.size/1024)} KB</small>{pendingFiles.some(x=>x.id===f.id)?<button className="attached" onClick={()=>setAttachments(a=>({...a,[key]:(a[key]||[]).filter(x=>x.id!==f.id)}))}>已附加 ✓</button>:<button onClick={()=>{if(pendingFiles.length>=10){setError('每次最多 10 个附件');return;}setAttachments(a=>({...a,[key]:[...(a[key]||[]),f]}));}}>附加</button>}</div>)}</section></div>}
      {memory&&<MemoryDrawer key={project} files={memory.files} habit={memory.habit} onSave={saveMemory} onEnableHabit={enableMemoryHabit} onOrganize={organizeMemory} onClose={()=>setMemory(null)}/>}
      {viewer&&<ImageViewer image={viewer} onClose={()=>setViewer(null)}/>}
      {palette&&<CommandPalette projects={projects} onChoose={choose} onClose={()=>setPalette(false)}/>}
    </div>
    </ChatActions.Provider></Arrival.Provider></ToolDetails.Provider></FileActions.Provider>
  );
}
