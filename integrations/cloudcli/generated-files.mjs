import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {fail} from './tenant-store.mjs';

const extensions=new Set(['.md','.txt','.pdf','.docx','.xlsx','.pptx','.csv','.json','.png','.jpg','.jpeg','.gif','.webp','.html','.htm','.svg','.epub','.odt']);
const excluded=new Set(['memory','node_modules','CLAUDE.md','AGENTS.md','DOCUMENTS.md','package.json','package-lock.json','settings.json','credentials.json']);
const MAX_SIZE=100*1024**2;
const MAX_PREVIEW=20*1024**2,previewTypes={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'};
export function validName(relative){
  return typeof relative==='string'&&relative.length>0&&relative.length<=1024&&!relative.includes('\\')&&!/[\x00-\x1f\x7f]/.test(relative)&&!path.posix.isAbsolute(relative)&&relative.split('/').every(s=>s&&s!=='.'&&s!=='..'&&!s.startsWith('.')&&!excluded.has(s))&&extensions.has(path.extname(relative).toLowerCase());
}
const contained=(root,file)=>file.startsWith(root+path.sep);
export async function openGenerated(project,relative){
  if(!validName(relative))throw fail('文件不存在或不允许下载',404);
  const root=await fs.realpath(project.cwd);
  if(root!==path.resolve(project.cwd))throw fail('项目目录不可用',404);
  let target=root;
  try{
    for(const segment of relative.split('/')){target=path.join(target,segment);if((await fs.lstat(target)).isSymbolicLink())throw fail('不提供链接文件下载',404);}
    const handle=await fs.open(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{
      // Validate the opened inode, not a path checked before an attacker changed it.
      const actual=await fs.realpath(`/proc/self/fd/${handle.fd}`),stat=await handle.stat();
      if(!contained(root,actual)||!validName(path.relative(root,actual).split(path.sep).join('/'))||!stat.isFile()||stat.nlink!==1||stat.size>MAX_SIZE)throw fail('文件不存在或超出 100 MB 下载限制',404);
      return {handle,stat,name:path.basename(relative),relative};
    }catch(e){await handle.close();throw e;}
  }catch(e){if(e.statusCode)throw e;throw fail('文件不存在或不可读取',404);}
}
export async function listGenerated(project){
  const files=[];let entries=0,truncated=false;
  async function visit(dir,relative='',depth=0){
    if(depth>8){truncated=true;return;}
    const iterator=await fs.opendir(dir);
    for await(const item of iterator){
      if(++entries>5000||files.length>=500){truncated=true;break;}
      if(item.name.startsWith('.')||excluded.has(item.name)||item.isSymbolicLink())continue;
      const rel=relative?`${relative}/${item.name}`:item.name;
      if(item.isDirectory()){
        // Re-open directories via O_NOFOLLOW and traverse the held descriptor.
        let held;
        try{held=await fs.open(path.join(dir,item.name),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);const actual=await fs.realpath(`/proc/self/fd/${held.fd}`),root=await fs.realpath(project.cwd);if(contained(root,actual))await visit(`/proc/self/fd/${held.fd}`,rel,depth+1);}catch{}finally{await held?.close();}
      }else if(item.isFile()&&validName(rel)){
        try{const f=await openGenerated(project,rel);files.push({name:f.name,path:rel,size:f.stat.size,modifiedAt:f.stat.mtime.toISOString(),url:`/download?project=${encodeURIComponent(project.id)}&file=${encodeURIComponent(rel)}`});await f.handle.close();}catch{}
      }
    }
  }
  const heldRoot=await fs.open(project.cwd,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{if(await fs.realpath(`/proc/self/fd/${heldRoot.fd}`)!==path.resolve(project.cwd))throw fail('项目目录不可用',404);await visit(`/proc/self/fd/${heldRoot.fd}`);}finally{await heldRoot.close();}
  files.sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));return {files,truncated};
}
export function generatedCandidates(project,messages){
  const recent=Array.isArray(messages)?messages.slice(-1000):[],results=new Map(),candidates=[];
  for(const m of recent)if(m.kind==='tool_result'&&m.toolId)results.set(m.toolId,m);
  let textBudget=512000;
  const add=target=>{
    if(typeof target!=='string'||target.length>4096||candidates.length>=128)return;
    const relative=path.posix.relative(project.cwd,path.posix.resolve(project.cwd,target));
    if(validName(relative)&&!candidates.includes(relative))candidates.push(relative);
  };
  for(const m of [...recent].reverse()){
    if(['tool_use','tool'].includes(m.kind)&&['Write','Edit','NotebookEdit'].includes(m.toolName)){
      const result=m.toolResult||results.get(m.toolId);
      if(result&&!result.isError&&!result.is_error)add(m.toolInput?.file_path||m.toolInput?.notebook_path);
    }
    if(m.kind==='text'&&m.role!=='user'&&typeof m.content==='string'&&textBudget>0){
      const text=m.content.slice(0,Math.min(50000,textBudget));textBudget-=text.length;
      for(const match of text.matchAll(/\/download\?[^\s)<>"`]+/g)){
        try{const url=new URL(match[0],'http://local.invalid');if(url.searchParams.get('project')===project.id)add(url.searchParams.get('file'));}catch{}
      }
    }
  }
  return candidates.slice(0,128);
}
export async function sessionGeneratedFiles(project,messages){
  const files=[];
  for(const relative of generatedCandidates(project,messages)){
    try{
      const f=await openGenerated(project,relative);
      try{files.push({name:f.name,path:relative,size:f.stat.size,modifiedAt:f.stat.mtime.toISOString(),url:`/download?project=${encodeURIComponent(project.id)}&file=${encodeURIComponent(relative)}`});}
      finally{await f.handle.close();}
    }catch{/* A transcript reference is not proof of a downloadable file. */}
    if(files.length>=20)break;
  }
  return files;
}
export function installGeneratedRoutes(app,{auth,tenants,uid,wrap}){
  const cookieName='cc_generated_session',cookieOptions={httpOnly:true,sameSite:'strict',path:'/api/core/generated',maxAge:8*60*60*1000};
  // Cookie is accepted only for this read-only generated-file surface.
  app.use('/api/core/generated',(req,_res,next)=>{
    if(req.method==='GET'&&!req.headers.authorization){const raw=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='));if(raw)req.headers.authorization=`Bearer ${raw.slice(cookieName.length+1)}`;}next();
  });
  app.use('/api/core',auth.authenticateToken);
  app.post('/api/core/download-auth',(req,res)=>{res.cookie(cookieName,req.headers.authorization.slice(7),{...cookieOptions,secure:req.secure});res.json({success:true});});
  app.delete('/api/core/download-auth',(req,res)=>{res.clearCookie(cookieName,{...cookieOptions,secure:req.secure,maxAge:undefined});res.json({success:true});});
  app.get('/api/core/generated/:project',wrap(async(req,res)=>res.json(await listGenerated(tenants.getProject(uid(req),req.params.project)))));
  app.get('/api/core/generated/:project/item',wrap(async(req,res)=>{
    const project=tenants.getProject(uid(req),req.params.project),f=await openGenerated(project,req.query.file);
    try{const text=['.md','.txt','.csv','.json'].includes(path.extname(f.name).toLowerCase())&&f.stat.size<=512*1024?await f.handle.readFile('utf8'):null;
      res.json({name:f.name,project:project.name,size:f.stat.size,modifiedAt:f.stat.mtime.toISOString(),text});
    }finally{await f.handle.close();}
  }));
  // Inline preview for raster images only (SVG can carry script); typed, sandboxed and size-bounded.
  app.get('/api/core/generated/:project/preview',wrap(async(req,res)=>{
    const f=await openGenerated(tenants.getProject(uid(req),req.params.project),req.query.file);
    try{
      const type=previewTypes[path.extname(f.name).toLowerCase()];
      if(!type||f.stat.size>MAX_PREVIEW)throw fail('此文件不支持预览',415);
      res.setHeader('Content-Type',type);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
      res.setHeader('Cache-Control','private, max-age=60');res.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(f.name)}`);res.setHeader('Content-Length',f.stat.size);
      if(f.stat.size===0)res.end();else await pipeline(f.handle.createReadStream({end:f.stat.size-1}),res);
    }finally{await f.handle.close().catch(()=>{});}
  }));
  app.get('/api/core/generated/:project/content',wrap(async(req,res)=>{
    const f=await openGenerated(tenants.getProject(uid(req),req.params.project),req.query.file);
    res.setHeader('Content-Type','application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);res.setHeader('Content-Length',f.stat.size);
    try{if(f.stat.size===0){res.end();}else await pipeline(f.handle.createReadStream({end:f.stat.size-1}),res);}finally{await f.handle.close().catch(()=>{});}
  }));
}
