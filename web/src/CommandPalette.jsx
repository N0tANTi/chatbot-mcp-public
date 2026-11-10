import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ChatCircle, Folder, MagnifyingGlass} from '@phosphor-icons/react';
import {parseTimestamp} from './files.mjs';

// Ctrl/Cmd+K: jump to any project or conversation by title across all projects.
export function CommandPalette({projects, onChoose, onClose}) {
  const [query,setQuery]=useState(''),[active,setActive]=useState(0);
  const list=useRef(null);
  const results=useMemo(()=>{
    const q=query.trim().toLowerCase();
    const sessions=projects.flatMap(p=>p.sessions.map(s=>({type:'session',project:p,session:s,time:parseTimestamp(s.updatedAt)??0})));
    if(!q)return sessions.sort((a,b)=>b.time-a.time).slice(0,12);
    const hits=sessions.filter(x=>x.session.title.toLowerCase().includes(q)).sort((a,b)=>b.time-a.time);
    const folders=projects.filter(p=>p.name.toLowerCase().includes(q)).map(project=>({type:'project',project}));
    return [...folders,...hits].slice(0,50);
  },[projects,query]);
  useEffect(()=>setActive(0),[query]);
  useEffect(()=>{list.current?.children[active]?.scrollIntoView({block:'nearest'});},[active]);
  const pick=item=>{if(!item)return;onChoose(item.project.slug,item.type==='session'?item.session.id:null);onClose();};
  const onKeyDown=e=>{
    if(e.key==='ArrowDown'){e.preventDefault();setActive(i=>Math.min(i+1,results.length-1));}
    else if(e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(i-1,0));}
    else if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();pick(results[active]);}
    else if(e.key==='Escape'){e.preventDefault();onClose();}
  };
  return <div className="drawer-backdrop palette-backdrop" onClick={onClose}>
    <section className="palette" role="dialog" aria-modal="true" aria-label="搜索对话" onClick={e=>e.stopPropagation()}>
      <label className="palette-input"><MagnifyingGlass size={20}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={onKeyDown} placeholder="搜索所有项目的对话标题…" aria-label="搜索对话" role="combobox" aria-expanded="true" aria-controls="palette-results" aria-activedescendant={results.length?`palette-${active}`:undefined}/><kbd>Esc</kbd></label>
      {!query.trim()&&<p className="palette-hint">最近的对话</p>}
      <div id="palette-results" role="listbox" ref={list}>
        {results.map((item,i)=><button id={`palette-${i}`} role="option" aria-selected={i===active} key={item.type+(item.session?.id||item.project.slug)} className={i===active?'active':''} onMouseEnter={()=>setActive(i)} onClick={()=>pick(item)}>
          {item.type==='session'?<ChatCircle size={19}/>:<Folder size={19}/>}
          <span>{item.type==='session'?item.session.title:item.project.name}</span>
          <small>{item.type==='session'?item.project.name:'项目'}</small>
        </button>)}
        {!results.length&&<p className="palette-empty">没有找到匹配的对话</p>}
      </div>
      <footer className="palette-footer"><span><kbd>Ctrl</kbd>+<kbd>K</kbd> 搜索</span><span><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> 新对话</span><span><kbd>Esc</kbd> 停止运行</span><span><kbd>↑</kbd> 编辑上一条</span></footer>
    </section>
  </div>;
}
