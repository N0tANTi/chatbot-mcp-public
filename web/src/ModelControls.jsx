import React, {useEffect, useRef} from 'react';
import {CaretDown} from '@phosphor-icons/react';

const names={auto:'默认',low:'低',medium:'中',high:'高',xhigh:'更高',max:'最高'};
const descriptions={low:'低 · 更快',medium:'中 · 均衡',high:'高 · 深入',xhigh:'更高',max:'最高 · 较慢'};
export const modelLabel=model=>model==='deepseek-flash'?'DeepSeek Flash':model.replace('claude-','').replace(/-\d{8}$/,'').replace(/^(\w+)-(\d)(?:-(\d))?$/,(_,family,major,minor)=>family[0].toUpperCase()+family.slice(1)+' '+major+(minor?'.'+minor:''));

// Display the selected setting beside the model; keep native selects and the
// existing account/model preference + per-run validation owned by App/server.
export function ModelControls({model,models,labels={},onModelChange,effort,config,onEffortChange,busy,inChat,usage=0}) {
  const label=id=>labels[id]||modelLabel(id);
  const menu=useRef(null);
  useEffect(()=>{
    const dismiss=event=>{if(menu.current&&!menu.current.contains(event.target))menu.current.open=false;};
    document.addEventListener('pointerdown',dismiss);
    return ()=>document.removeEventListener('pointerdown',dismiss);
  },[]);
  return <details className="model-controls" ref={menu} onKeyDown={event=>{
    if(event.key==='Escape'){menu.current.open=false;menu.current.querySelector('summary').focus();event.stopPropagation();}
  }}>
    <summary aria-label="模型与推理强度" title={`${modelLabel(model)} · ${config.pending?'正在读取设置':names[effort]}${effort==='auto'&&config.default?`（${names[config.default]}）`:''}`}>
      <span className="selected-model">{label(model)}</span><span className="selected-effort">{models.length&&!models.includes(model)?'已停用':config.pending?'读取中':names[effort]}</span><CaretDown size={13}/>
    </summary>
    <div className="model-settings">
      <label><span>可用模型</span><select aria-label="选择模型" value={model} disabled={busy} onChange={event=>onModelChange(event.target.value)}>{(()=>{const all=[...new Set([...models,model])],option=id=><option key={id} value={id} disabled={!models.includes(id)}>{label(id)}{models.length&&!models.includes(id)?'（历史记录，已停用）':''}</option>;
        const latest=all.filter(id=>!id.startsWith('claude-')),pinned=all.filter(id=>id.startsWith('claude-'));
        return pinned.length&&latest.length?<><optgroup label="最新版本">{latest.map(option)}</optgroup><optgroup label="指定型号">{pinned.map(option)}</optgroup></>:all.map(option);})()}</select></label>
      <p>{inChat?'只改这段对话，下一条消息生效；新对话会沿用最近的选择。':'新对话使用这里的选择。'}</p>
      {inChat&&usage>150000&&<p className="model-warning">这段对话已用约 {(usage/10000).toFixed(0)} 万 tokens。换成上下文较小的模型（如 Haiku）前，建议先压缩上下文。</p>}
      <label><span>推理强度</span><select aria-label="推理强度" value={effort} disabled={busy||!config.levels.length} onChange={event=>onEffortChange(event.target.value)}><option value="auto">{config.pending?'正在读取设置…':config.default?`模型默认（${names[config.default]}）`:'模型默认'}</option>{config.levels.map(level=><option key={level} value={level}>{descriptions[level]}</option>)}</select></label>
      <p>{config.pending?'正在读取模型设置，完成后即可发送。':config.levels.length?`${inChat?'每段对话分别记住，':''}下一条消息生效。默认使用模型本身的强度；更高档通常更慢、使用更多 token。`:'此模型尚未确认支持调节，使用模型默认。'}</p>
    </div>
  </details>;
}
