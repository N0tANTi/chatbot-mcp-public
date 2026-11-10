import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fail} from './tenant-store.mjs';

// Three places shape a project's long-term context: its CLAUDE.md (always loaded), its memory/
// folder (loaded where CLAUDE.md imports it) and Claude Code's automatic memory under the
// login's config root. Only Markdown inside them is exposed.
export const MAX_MEMORY_BYTES=512*1024;
export const memoryRoots=(project,configDir)=>({instructions:project.cwd,project:path.join(project.cwd,'memory'),auto:path.join(configDir,'projects',project.cwd.replace(/[^a-zA-Z0-9]/g,'-'),'memory')});
export function validMemoryName(name){
  return typeof name==='string'&&name.length>0&&name.length<=200&&name.endsWith('.md')&&!name.includes('\\')&&!/[\x00-\x1f\x7f]/.test(name)&&!path.posix.isAbsolute(name)
    &&name.split('/').every(s=>s&&s!=='.'&&s!=='..'&&!s.startsWith('.'));
}
export async function listMemory(roots){
  const files=[];
  for(const [source,root] of Object.entries(roots)){
    if(source==='instructions'){
      const full=path.join(root,'CLAUDE.md'),stat=await fs.lstat(full).catch(()=>null);
      if(stat?.isFile()&&stat.size<=MAX_MEMORY_BYTES)files.push({source,name:'CLAUDE.md',content:await fs.readFile(full,'utf8'),modifiedAt:stat.mtime.toISOString()});
      continue;
    }
    const visit=async(dir,relative,depth)=>{
      if(depth>3||files.length>=200)return;
      let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}
      for(const entry of entries){
        if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;
        const rel=relative?`${relative}/${entry.name}`:entry.name;
        if(entry.isDirectory())await visit(path.join(dir,entry.name),rel,depth+1);
        else if(entry.isFile()&&validMemoryName(rel)){
          const full=path.join(dir,entry.name),stat=await fs.stat(full);
          if(stat.size<=MAX_MEMORY_BYTES)files.push({source,name:rel,content:await fs.readFile(full,'utf8'),modifiedAt:stat.mtime.toISOString()});
        }
      }
    };
    await visit(root,'',0);
  }
  return files;
}
// Atomic write inside one memory root; refuses links anywhere on the path.
export async function writeMemory(root,name,content){
  if(!validMemoryName(name))throw fail('记忆文件名须为 .md，且不能包含隐藏或上级目录',400);
  if(typeof content!=='string'||Buffer.byteLength(content)>MAX_MEMORY_BYTES)throw fail('记忆内容须为文本且不超过 512 KB',400);
  await fs.mkdir(root,{recursive:true,mode:0o700});
  const realRoot=await fs.realpath(root);
  let dir=realRoot;
  for(const segment of name.split('/').slice(0,-1)){
    dir=path.join(dir,segment);
    const stat=await fs.lstat(dir).catch(()=>null);
    if(stat?.isSymbolicLink()||(stat&&!stat.isDirectory()))throw fail('记忆路径不可用',400);
    if(!stat)await fs.mkdir(dir,{mode:0o700});
  }
  const target=path.join(dir,path.basename(name)),existing=await fs.lstat(target).catch(()=>null);
  if(existing&&!existing.isFile())throw fail('记忆路径不可用',400);
  if(!(await fs.realpath(dir)).startsWith(realRoot))throw fail('记忆路径不可用',400);
  const temporary=`${target}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary,content,{mode:0o600,flag:'wx'});await fs.rename(temporary,target);
}
// Saves one memory file; instructions accept only CLAUDE.md. A new project memory file can be
// imported from CLAUDE.md so Claude Code actually loads it in every conversation.
export async function saveMemory(roots,{source,name,content,reference}){
  if(!Object.hasOwn(roots,source))throw fail('记忆位置无效',400);
  if(source==='instructions'&&name!=='CLAUDE.md')throw fail('项目说明只能是 CLAUDE.md',400);
  if(source==='instructions'){
    const existing=await fs.lstat(path.join(roots.instructions,'CLAUDE.md')).catch(()=>null);
    if(existing&&!existing.isFile())throw fail('记忆路径不可用',400);
  }
  await writeMemory(roots[source],name,content);
  if(source==='project'&&reference){
    const file=path.join(roots.instructions,'CLAUDE.md'),line=`@memory/${name}`;
    const current=await fs.readFile(file,'utf8').catch(()=>'');
    if(!current.split('\n').some(l=>l.trim()===line))await writeMemory(roots.instructions,'CLAUDE.md',`${current.replace(/\n*$/,'')}${current?'\n\n':''}${line}\n`);
  }
}
// Plain-text excerpt of recent conversations (newest first) for an on-demand memory review.
// Only user/assistant text: no tool output, compaction notices or slash commands.
export function conversationDigest(conversations,{limit=80000,perMessage=1500}={}){
  const parts=[];let chars=0,used=0;
  for(const c of conversations){
    const lines=(c.messages||[]).filter(m=>m.kind==='text'&&typeof m.content==='string'&&m.content.trim()&&!m.compact&&!/^\/\w+\s*$/.test(m.content.trim()))
      .map(m=>`**${m.role==='user'?'我':'Claude'}**：${m.content.trim().slice(0,perMessage)}${m.content.trim().length>perMessage?'…':''}`);
    if(!lines.length)continue;
    const block=`## ${c.title||'未命名对话'}${c.updatedAt?`（${String(c.updatedAt).slice(0,10)}）`:''}\n\n${lines.join('\n\n')}\n`;
    if(chars+block.length>limit){if(!used)parts.push(block.slice(0,limit));used+=used?0:1;break;}
    parts.push(block);chars+=block.length;used++;
  }
  return {text:parts.join('\n'),conversations:used,chars:parts.join('\n').length};
}
