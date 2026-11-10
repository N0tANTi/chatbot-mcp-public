import React, {useState} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {PencilSimple, Plus, Sparkle, X} from '@phosphor-icons/react';

const SOURCES = {instructions: '项目说明', project: '项目记忆', auto: 'CC 自动记忆'};
const keyOf = f => f && `${f.source}:${f.name}`;

// Both memory places for this project, readable and editable; links between files stay in-drawer.
export function MemoryDrawer({files, habit, onSave, onEnableHabit, onOrganize, onClose}) {
  const [selected, setSelected] = useState(keyOf(files[0]));
  const [editing, setEditing] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirming, setConfirming] = useState(false);
  const act = async run => { setBusy(true); setError(''); try { await run(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const file = files.find(f => keyOf(f) === selected);
  const save = async () => {
    const name = editing.name.trim();
    setBusy(true); setError('');
    try { await onSave(editing.source, name, editing.content, Boolean(editing.reference)); setSelected(`${editing.source}:${name}`); setEditing(null); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <div className="drawer-backdrop" onClick={onClose}>
    <section className="memory-drawer" role="dialog" aria-modal="true" aria-labelledby="memory-title" onClick={e => e.stopPropagation()}>
      <header><h2 id="memory-title">项目记忆</h2><button autoFocus aria-label="关闭项目记忆" onClick={onClose}><X size={24}/></button></header>
      <p>项目说明（CLAUDE.md）每次对话都会加载；项目记忆是 memory 文件夹，在 CLAUDE.md 中引用后加载；CC 自动记忆是 Claude 自己记下的内容，按登录账号分开。</p>
      {editing ? <div className="memory-editor">
        {editing.isNew && <><label>文件名（保存在 memory 文件夹）<input value={editing.name} onChange={e => setEditing({...editing, name: e.target.value})} placeholder="例如 背景.md" autoFocus/></label>
          <label className="memory-reference"><input type="checkbox" checked={editing.reference} onChange={e => setEditing({...editing, reference: e.target.checked})}/>在 CLAUDE.md 中引用，让每次对话都加载</label></>}
        {!editing.isNew && <strong>{SOURCES[editing.source]} / {editing.name}</strong>}
        <textarea aria-label="记忆内容" value={editing.content} onChange={e => setEditing({...editing, content: e.target.value})} autoFocus={!editing.isNew}/>
        {error && <p role="alert" className="error">{error}</p>}
        <div><button onClick={() => { setEditing(null); setError(''); }} disabled={busy}>取消</button><button className="primary-small" onClick={save} disabled={busy || !editing.name.trim().endsWith('.md')}>{busy ? '正在保存…' : '保存'}</button></div>
      </div> : <>
        {!habit && <div className="memory-callout"><p><strong>记忆习惯未开启。</strong>开启后会在 CLAUDE.md 加一段说明，让 Claude 在对话中主动记下目标、偏好、决定和进展，并更新过时内容。</p><button disabled={busy} onClick={() => act(onEnableHabit)}>开启记忆习惯</button></div>}
        {confirming ? <div className="memory-callout"><p><strong>整理记忆</strong>会新开一段对话：Claude 读取这个项目最近的对话摘录，补充、合并和修正自动记忆，完成后说明改了什么。这会运行一轮模型、消耗一些额度。</p>
          <div><button disabled={busy} onClick={() => setConfirming(false)}>取消</button><button className="primary-small" disabled={busy} onClick={() => act(onOrganize)}>{busy ? '正在准备…' : '开始整理'}</button></div></div>
          : <button className="memory-organize" onClick={() => setConfirming(true)}><Sparkle size={16}/>整理记忆</button>}
        {error && <p role="alert" className="error">{error}</p>}
        <div className="memory-toolbar">
          {files.length > 0 && <select aria-label="选择记忆文件" value={selected} onChange={e => setSelected(e.target.value)}>
            {Object.entries(SOURCES).map(([source, label]) => files.some(f => f.source === source) && <optgroup key={source} label={label}>
              {files.filter(f => f.source === source).map(f => <option key={keyOf(f)} value={keyOf(f)}>{f.name}</option>)}
            </optgroup>)}
          </select>}
          {file && <button onClick={() => setEditing({source: file.source, name: file.name, content: file.content})}><PencilSimple size={16}/>编辑</button>}
          <button onClick={() => setEditing({source: 'project', name: '', content: '', isNew: true, reference: true})}><Plus size={16}/>新建</button>
        </div>
        <div className="memory-content">
          <Markdown remarkPlugins={[remarkGfm]} components={{a: ({href, children}) => {
            const relative = new URL(href || '', `https://memory.local/${file?.name || ''}`).pathname.slice(1);
            const target = files.find(item => item.source === file?.source && item.name === decodeURIComponent(relative));
            return target ? <a href={href} onClick={e => { e.preventDefault(); setSelected(keyOf(target)); }}>{children}</a> : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
          }}}>{file?.content || '这个项目还没有记忆文件。可以点“新建”写下长期背景，并在 CLAUDE.md 中引用。'}</Markdown>
        </div>
      </>}
    </section>
  </div>;
}
