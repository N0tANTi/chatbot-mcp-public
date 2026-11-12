import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {initTenants, ASSETS, fail} from './tenant-store.mjs';
import {installGeneratedRoutes,sessionGeneratedFiles} from './generated-files.mjs';
import {webClientNote} from './download-rule.mjs';
import {compactMessage,historyPage,toolDetails} from './history-page.mjs';
import {conversationDigest,listMemory,memoryRoots,saveMemory} from './memory-files.mjs';
import {hasMemoryHabit,withMemoryHabit} from './project-template.mjs';
import {createActivityNormalizer, runActivity} from './activity-events.mjs';
import {effortCapabilities, resolveEffort, reasoningOptions} from './model-routing.mjs';
import {installSessionTrashRoutes} from './session-trash.mjs';
import {firstExchange,generateTitle,upstreamSessionName} from './session-titles.mjs';
import {networkMode,networkEnvironment} from './network-policy.mjs';
import {officialEnvironment,checkOfficialStartup,cleanProviderEnvironment,loadModelProvider,providerEnvironment,packyModels} from './official-account.mjs';
import {assertActiveAccount,claudeConfigDir,hostQueryOptions,HOST_MODES,MAX_ACCOUNTS,watchProviderSession} from './host-execution.mjs';
import {createUsageService,fetchOfficialUsage} from './subscription-usage.mjs';
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
// This VPS needs longer than Node's 250 ms address-family race for direct TLS.
// Keep both IP families and normal certificate verification; no proxy fallback.
net.setDefaultAutoSelectFamilyAttemptTimeout(1000);
const require = createRequire(
  path.join(root, "node_modules/@cloudcli-ai/cloudcli/package.json"),
);
const express = require("express");
const { WebSocketServer } = require("ws");
const upstream = (p) =>
  import(
    pathToFileURL(
      path.join(
        root,
        "node_modules/@cloudcli-ai/cloudcli/dist-server/server",
        p,
      ),
    ).href
  );
const db = await upstream("modules/database/index.js");
await db.initializeDatabase();
const auth = await upstream("modules/auth/index.js");
const {JWT_SECRET} = await upstream("modules/auth/auth.middleware.js");
const jwt = require("jsonwebtoken");
const providers = await upstream("modules/providers/index.js");
const tenants = initTenants(db);
const uid = req => Number(req.user.id ?? req.user.userId);
const requireHostOwner=id=>assertActiveAccount(db.getConnection().prepare('SELECT id,username FROM users WHERE is_active=1').all(),id);
const sendAdmissions=new Set();
const {providerRegistry} = await upstream('modules/providers/provider.registry.js');
const {createProviderRuntimeService} = await upstream('modules/providers/services/provider-runtime.service.js');
const {query} = await import(pathToFileURL(require.resolve('@anthropic-ai/claude-agent-sdk')).href);
// Never inherit API credentials from systemd or an old launcher.
process.env=cleanProviderEnvironment(process.env);
const modelProvider=await loadModelProvider();
// The SDK also inherits process.env. Clear ambient proxy variables before any
// Packy subprocess is created, not only the explicit per-query overrides.
if(modelProvider.provider==='packy')process.env=networkEnvironment('packy-direct',process.env);
const modelNetworkMode=()=>networkMode(modelProvider.provider);
const runtime = createProviderRuntimeService({resolveProvider: name => {
  const provider = providerRegistry.resolveProvider(name);
  return {...provider, runtime:{...provider.runtime, run:async(command,options,writer,context)=>{
    const run=chatRunRegistry.getRun(options.sessionId);
    if(run){run.permissionMode=options.permissionMode;run.effort=options.ccEffort;}
    const row=tenants.session(options.ccUserId,options.sessionId);
    const account=requireHostOwner(options.ccUserId),configDir=claudeConfigDir(account);
    await fs.mkdir(configDir,{recursive:true,mode:0o700});
    const mode=await modelNetworkMode();
    const credential=await providerEnvironment(modelProvider);
    const original=writer.options.onProviderSessionId;
    writer.options.onProviderSessionId=(native)=>{
      original?.(native);
      db.getConnection().prepare('UPDATE sessions SET jsonl_path=? WHERE session_id=?').run(tenants.transcript(row.project,options.ccUserId,native),options.sessionId);
    };
    return provider.runtime.run(command,options,writer,{...context,normalizeMessage:createActivityNormalizer(context.normalizeMessage),createQuery:input=>{
      const env=networkEnvironment(mode,{PATH:process.env.PATH,LANG:'C.UTF-8',...credential});
      const nativeOptions=reasoningOptions(options.model,options.ccEffort,{...input.options,includePartialMessages:true},env,options.ccEffortConfig);
      const hostOptions=hostQueryOptions(nativeOptions,nativeOptions.env,configDir);
      hostOptions.systemPrompt={...(hostOptions.systemPrompt||{type:'preset',preset:'claude_code'}),append:webClientNote};
      const sdk=query({...input,options:hostOptions});
      return options.resumeFromScratch?watchProviderSession(sdk,native=>writer.captureProviderSessionId(native)):sdk;
    }});
  }}};
}});
const { getProjectsWithSessions } = await upstream(
  "modules/projects/services/projects-with-sessions-fetch.service.js",
);
const { handleChatConnection } = await upstream(
  "modules/websocket/services/chat-websocket.service.js",
);
const { chatRunRegistry } = await upstream("modules/websocket/index.js");
// Upstream seq restarts for every turn. Label turns so late events and replay
// cannot make a new turn's permission request look like a duplicate old event.
const upstreamStartRun = chatRunRegistry.startRun.bind(chatRunRegistry);
let lastRunKey = 0;
chatRunRegistry.startRun = (input) => {
  const run = upstreamStartRun(input);
  if (run) {
    const runKey = (lastRunKey = Math.max(Date.now(), lastRunKey + 1));
    run.runKey = runKey;
    const decorate = run.writer.options.decorateOutboundEvent;
    run.writer.options.decorateOutboundEvent = (message) => {
      const event = decorate(message);
      if (event) { event.runKey = runKey; event.eventAt = Date.now(); }
      return event;
    };
  }
  return run;
};
const app = express();
app.set('trust proxy','loopback');
app.use(express.json({ limit: "1mb" }));
// Loopback binding plus Origin validation: no cross-site requests to the tunnel.
app.use((req, res, next) => {
  if (
    req.headers.origin &&
    new URL(req.headers.origin).host !== req.headers.host
  )
    return res.status(403).json({ error: "来源不匹配" });
  res.setHeader("Cache-Control", "no-store");
  next();
});
// Logins last 30 days instead of upstream's 7 and renew while in use (upstream re-signs past
// half-life; that renewal is lengthened too). Deactivated users are still refused per request.
const LOGIN_LIFETIME = "30d";
const longLogin = (token) => {
  const claims = jwt.decode(String(token || ""));
  return claims?.userId ? jwt.sign({ userId: claims.userId, username: claims.username }, JWT_SECRET, { expiresIn: LOGIN_LIFETIME }) : token;
};
app.use((req, res, next) => {
  const setHeader = res.setHeader.bind(res);
  res.setHeader = (name, value) => setHeader(name, String(name).toLowerCase() === "x-refreshed-token" ? longLogin(value) : value);
  if (req.method === "POST" && req.path === "/api/auth/login") {
    const json = res.json.bind(res);
    res.json = (body) => json(body?.token ? { ...body, token: longLogin(body.token) } : body);
  }
  next();
});
app.get("/health", (_req, res) =>
  res.json({ status: "ok", upstream: "1.37.4" }),
);
// Existing installation only: account creation is the authenticated admin route.
app.post(['/api/auth/register','/api/auth/setup'],(_req,res)=>res.status(403).json({error:'请由管理员创建账号'}));
app.use("/api/auth", auth.authRoutes);
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
installGeneratedRoutes(app,{auth,tenants,uid,wrap});
const getSession=(userId,id)=>tenants.session(userId,id);
// Tool-less helper runs (model list, titles) use the shared official account outside any project.
const officialQueryBase=async mode=>({pathToClaudeCodeExecutable:'/home/appuser/.local/claude-code/node_modules/@anthropic-ai/claude-code/bin/claude.exe',
  cwd:modelProvider.provider==='packy'?'/home/appuser/cloudcli-runtime/data/packy-account':'/home/appuser/cloudcli-runtime/data/official-account',
  env:networkEnvironment(mode,{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/home/appuser',CLAUDE_CONFIG_DIR:modelProvider.provider==='packy'?'/home/appuser/cloudcli-runtime/data/packy-account':'/home/appuser/cloudcli-runtime/data/official-account',...await providerEnvironment(modelProvider)})});
let modelCache={at:0,ids:[],details:[]},modelLoading;
async function models(){
  const mode=await modelNetworkMode();
  if(Date.now()-modelCache.at<(modelCache.complete?300000:30000))return modelCache.ids;
  if(modelLoading)return modelLoading;
  const read=async()=>{
    if(modelProvider.provider==='packy')return packyModels(modelProvider);
    let release;
    // An empty streaming input permits native initialization/control requests
    // without submitting a user prompt or spending inference tokens.
    const hold=new Promise(resolve=>{release=resolve;});
    async function* empty(){await hold;}
    const q=query({prompt:empty(),options:{...await officialQueryBase(mode),settingsSources:[],allowedTools:[]}});
    try{
      const details=await Promise.race([q.supportedModels(),new Promise((_,reject)=>{const t=setTimeout(()=>reject(fail('官方模型列表读取超时',503)),30000);t.unref();})]);
      return details.filter(x=>typeof x.value==='string'&&/^(?:[a-z]+|claude-[a-z0-9-]+)$/.test(x.value));
    }finally{release();q.close();}
  };
  // Right after a credential refresh or a fresh start Claude Code may answer from its built-in
  // alias list (unversioned names, no specific models) before the account catalog arrives.
  // Ask once more; failing that keep the last full list, and never cache the stand-in for long.
  const complete=list=>list.some(x=>x.value.startsWith('claude-'));
  modelLoading=(async()=>{
    let valid=await read();
    if(!complete(valid)){await new Promise(r=>setTimeout(r,3000));valid=await read();}
    if(!valid.length)throw fail('当前通道未返回可用模型',503);
    if(!complete(valid)&&modelCache.complete){modelCache={...modelCache,at:Date.now()-270000};return modelCache.ids;}
    const ids=valid.map(x=>x.value);
    modelCache={at:Date.now(),ids,details:valid,complete:complete(valid)};return ids;
  })();
  try{return await modelLoading;}finally{modelLoading=null;}
}
const subscriptionUsage=createUsageService({read:async()=>{
  const mode=await networkMode(),credential=await officialEnvironment();
  return fetchOfficialUsage({mode,token:credential.CLAUDE_CODE_OAUTH_TOKEN,HttpsProxyAgent:require('https-proxy-agent').HttpsProxyAgent});
}});
app.get('/api/core/usage',wrap(async(req,res)=>{
  requireHostOwner(uid(req));
  if(modelProvider.provider==='packy')return res.json({state:'unavailable',windows:[],fetchedAt:null,nextRefreshAt:null,message:'当前使用 Packy Code API，费用和余额请在 Packy 控制台查看。'});
  res.json(await subscriptionUsage.get({refresh:req.query.refresh==='1'}));
}));
app.get('/api/core/me',wrap(async(req,res)=>res.json({...db.userDb.getUserById(uid(req)),admin:tenants.isAdmin(uid(req)),execution:'host',maxAccounts:MAX_ACCOUNTS,modelProvider:modelProvider.provider})));
app.get('/api/core/models',wrap(async(_req,res)=>{
  const ids=await models();
  const named=id=>modelCache.details.find(x=>x.value!=='default'&&x.resolvedModel===id)?.displayName;
  res.json({models:ids,labels:Object.fromEntries(modelCache.details.map(x=>[x.value,x.value==='default'?`账号默认${modelCache.complete&&named(x.resolvedModel)?`（${named(x.resolvedModel)}）`:'（推荐）'}`:x.displayName||x.value])),
    efforts:Object.fromEntries(modelCache.details.map(x=>[x.value,{levels:x.supportedEffortLevels||effortCapabilities(x.value).levels,default:null}])),
    default:ids.includes('default')?'default':ids[0],provider:modelProvider.provider==='packy'?'packy':'claude.ai',proxy:modelProvider.provider==='packy'?'direct':'required'});
}));
app.get('/api/core/accounts',wrap(async(req,res)=>{
  if(!tenants.isAdmin(uid(req)))throw fail('仅主账号可以管理登录账号',403);
  res.json(tenants.sql.prepare('SELECT id,username FROM users WHERE is_active=1 ORDER BY id').all());
}));
app.post('/api/core/accounts',wrap(async(req,res)=>{
  if(!tenants.isAdmin(uid(req)))throw fail('仅主账号可以管理登录账号',403);
  const {username,password}=req.body;
  if(typeof username!=='string'||! /^[\p{L}\p{N}_-]{2,40}$/u.test(username)||typeof password!=='string'||password.length<10||Buffer.byteLength(password)>72)throw fail('账号须为 2–40 个字母、数字或下划线；密码须至少 10 位且不超过 72 字节');
  if(tenants.sql.prepare('SELECT COUNT(*) AS n FROM users WHERE is_active=1').get().n>=MAX_ACCOUNTS)throw fail(`当前最多支持 ${MAX_ACCOUNTS} 个账号`,409);
  if(tenants.sql.prepare('SELECT id FROM users WHERE username=?').get(username))throw fail('账号名称已存在',409);
  const hash=await require('bcrypt').hash(password,12);
  res.status(201).json(db.userDb.createUser(username,hash));
}));
app.post('/api/core/projects',wrap(async(req,res)=>res.status(201).json(await tenants.createProject(uid(req),req.body.name))));
app.patch('/api/core/projects/:id',wrap(async(req,res)=>{
  const p=tenants.getProject(uid(req),req.params.id),name=String(req.body.name??p.name).trim();
  if(!name||name.length>60)throw fail('项目名称须为 1–60 个字');
  tenants.sql.prepare('UPDATE cc_projects SET name=? WHERE id=? AND user_id=?').run(name,p.id,uid(req));res.json({success:true});
}));
app.post('/api/core/sessions/:id/takeover',wrap(async(req,res)=>{
  const row=getSession(uid(req),req.params.id);
  let record=await terminalOwns(row.provider_session_id);
  if(record){
    if(record.status!=='idle')throw fail(record.status==='waiting'?'终端正在等待确认，请先在终端处理或退出 Claude':'终端仍在处理任务，请先等待或在终端停止',409);
    // Revalidate immediately before signalling; a reused PID must never be killed.
    const latest=await terminalOwns(row.provider_session_id);
    if(latest?.pid!==record.pid||latest?.procStart!==record.procStart)throw fail('终端状态已变化，请重试',409);
    process.kill(record.pid,'SIGTERM');
    for(let i=0;i<20&&await terminalOwns(row.provider_session_id);i++)await new Promise(r=>setTimeout(r,100));
    if(await terminalOwns(row.provider_session_id))throw fail('终端尚未退出，请稍后重试',409);
  }
  res.json({success:true});
}));
const fileKinds={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','.txt':'text/plain','.md':'text/plain','.csv':'text/plain','.json':'text/plain','.html':'text/plain','.htm':'text/plain','.odt':'application/vnd.oasis.opendocument.text','.epub':'application/epub+zip'};
// Archives are kept as uploaded (Claude unpacks them with unzip/tar when needed); the server only
// lists their contents. Any other file type is accepted too and read by Claude's own tools.
const archiveKinds={'.zip':'application/zip','.tar':'application/x-tar','.gz':'application/gzip','.tgz':'application/gzip','.xz':'application/x-xz','.bz2':'application/x-bzip2','.zst':'application/zstd'};
const unsupportedKinds={'.7z':'服务器暂时不能解压 7z，请改用 zip 或 tar.gz','.rar':'服务器暂时不能解压 rar，请改用 zip 或 tar.gz','.heic':'HEIC 照片 Claude 无法查看，请在相册里导出为 JPG 后上传','.heif':'HEIF 照片 Claude 无法查看，请在相册里导出为 JPG 后上传'};
const UPLOAD_FILE_LIMIT=100*1024**2,ACCOUNT_UPLOAD_QUOTA=3*1024**3;
// Images are sent to the model inline, which accepts at most 5 MB each; the browser shrinks larger photos first.
const INLINE_IMAGE_LIMIT=5*1024**2;
await fs.mkdir(ASSETS,{recursive:true,mode:0o700});
const upload=require('multer')({storage:require('multer').diskStorage({destination:ASSETS,filename:(_req,_file,cb)=>cb(null,randomUUID())}),limits:{fileSize:UPLOAD_FILE_LIMIT,files:10}}).array('files',10);
const publicFile=a=>({id:a.id,name:a.name,mime:a.mime,size:a.size,createdAt:a.created_at});
app.get('/api/core/projects/:id/files',wrap(async(req,res)=>{
  tenants.getProject(uid(req),req.params.id);res.json(tenants.sql.prepare('SELECT * FROM cc_uploads WHERE user_id=? AND project_id=? ORDER BY created_at DESC').all(uid(req),req.params.id).map(publicFile));
}));
app.post('/api/core/projects/:id/files',wrap(async(req,res)=>{
  const p=tenants.getProject(uid(req),req.params.id);
  const stat=await fs.statfs(ASSETS),free=stat.bavail*stat.bsize,total=stat.blocks*stat.bsize;
  const used=tenants.sql.prepare('SELECT COALESCE(SUM(size),0) AS n FROM cc_uploads WHERE user_id=?').get(uid(req)).n;
  if(free<6*1024**3||free/total<.15||used+200*1024**2>ACCOUNT_UPLOAD_QUOTA)throw fail('存储余量不足或已达到账号资料额度（3 GB）',413);
  const received=[],derived=[];
  try{
    await new Promise((resolve,reject)=>upload(req,res,err=>{received.push(...(req.files||[]));err?reject(err):resolve();}));
    const rows=[];
    for(const f of received){
      const name=Buffer.from(f.originalname,'latin1').toString('utf8').replace(/[\r\n]/g,' ').slice(0,240);
      const ext=path.extname(name).toLowerCase();
      if(unsupportedKinds[ext])throw fail(`${name}：${unsupportedKinds[ext]}`);
      let mime=fileKinds[ext]||archiveKinds[ext]||'application/octet-stream',textPath=null;
      if(!mime.startsWith('image/')){
        // A text copy (documents) or a contents list (archives) helps Claude; without one it reads the file itself.
        const extracted=await promisify(execFile)('python3',[path.join(root,'extract-document.py'),f.path,ext||'.bin',name],{timeout:60000,maxBuffer:24*1024**2}).then(r=>JSON.parse(r.stdout),()=>({}));
        if(extracted.text){textPath=`${f.path}.txt`;derived.push(textPath);await fs.writeFile(textPath,extracted.text,{mode:0o600});if(mime==='application/octet-stream')mime='text/plain';}
      }else{
        if(f.size>INLINE_IMAGE_LIMIT)throw fail(`${name}：图片超过 5 MB，Claude 无法直接查看。请刷新页面后重新上传（网页会先自动压缩）`);
        const b=await fs.readFile(f.path);
        const valid=ext==='.png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='.gif'?b.subarray(0,3).toString()==='GIF':ext==='.webp'?b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP':b[0]===255&&b[1]===216;
        if(!valid)throw fail('图片内容与格式不匹配');
      }
      rows.push({id:f.filename,user_id:uid(req),project_id:p.id,name,path:f.path,mime,size:f.size,text_path:textPath});
    }
    tenants.sql.transaction(()=>{for(const a of rows)tenants.sql.prepare('INSERT INTO cc_uploads(id,user_id,project_id,name,path,mime,size,text_path) VALUES(@id,@user_id,@project_id,@name,@path,@mime,@size,@text_path)').run(a);})();
    res.status(201).json({files:rows.map(publicFile)});
  }catch(err){await Promise.all([...received.map(f=>f.path),...derived].map(f=>fs.unlink(f).catch(()=>{})));throw fail(err.code==='LIMIT_FILE_SIZE'?'单个文件不能超过 100 MB':err.statusCode?err.message:'上传失败，请检查文件后重试',err.code==='LIMIT_FILE_SIZE'?413:err.statusCode||400);}
}));
app.get('/api/core/files/:id',wrap(async(req,res)=>{
  const a=tenants.sql.prepare('SELECT * FROM cc_uploads WHERE id=? AND user_id=?').get(req.params.id,uid(req));if(!a)throw fail('文件不存在',404);
  res.setHeader('Content-Type',a.mime);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`);res.sendFile(a.path);
}));
// Read CLI-owned registry only. Any live terminal owner (including idle) blocks resume.
async function terminalOwns(nativeId) {
  if (!nativeId) return false;
  const dir = "/home/appuser/.claude/sessions";
  for (const file of (await fs.readdir(dir).catch(() => []))
    .filter((x) => x.endsWith(".json"))
    .slice(0, 256)) {
    try {
      const record = JSON.parse(
        await fs.readFile(path.join(dir, file), "utf8"),
      );
      if (record.sessionId !== nativeId || !Number.isInteger(record.pid))
        continue;
      process.kill(record.pid, 0);
      if((await fs.readFile(`/proc/${record.pid}/comm`,'utf8')).trim()!=='claude')continue;
      const stat = await fs.readFile(`/proc/${record.pid}/stat`, "utf8");
      if (
        record.procStart &&
        stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] !==
          record.procStart
      )
        continue;
      let pid = record.pid,
        owned = false;
      for (let i = 0; i < 32 && pid > 1; i++) {
        if (pid === process.pid) {
          owned = true;
          break;
        }
        const parentStat = await fs.readFile(`/proc/${pid}/stat`, "utf8");
        pid = Number(
          parentStat.slice(parentStat.lastIndexOf(")") + 2).split(" ")[1],
        );
      }
      if (!owned) return {pid:record.pid,procStart:record.procStart,status:record.status};
    } catch {
      /* dead or partially written registry */
    }
  }
  return false;
}
// Upstream sets updated_at only when a run first binds its Claude session, so a conversation
// kept going for weeks still looked as old as its first day. The transcript is written on every
// exchange (web or terminal); its mtime is the last activity. Newest first.
const utcTime = (value) => { const text = String(value || ""); return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(" ", "T")}Z`) || 0; };
async function byLastActivity(rows) {
  const timed = await Promise.all(rows.map(async (r) => {
    const written = r.jsonl_path ? await fs.stat(r.jsonl_path).then((s) => s.mtimeMs, () => 0) : 0;
    const last = Math.max(utcTime(r.updated_at), written);
    return { ...r, lastActivity: last ? new Date(last).toISOString() : r.updated_at };
  }));
  return timed.sort((a, b) => utcTime(b.lastActivity) - utcTime(a.lastActivity));
}
app.get(
  "/api/core/projects",
  wrap(async (req, res) => {
    const all = await getProjectsWithSessions({ sessionsLimit: 200 });
    res.json(
      await Promise.all(
        tenants.projects(uid(req)).map(async (project) => {
          const {id:slug,name,cwd:projectPath}=project;
          const p = all.find(
            (x) => (x.fullPath ?? x.path ?? x.actualPath) === projectPath,
          );
          const rows = await byLastActivity(db.sessionsDb.getSessionsByProjectPathPage(
            projectPath,
            200,
            0,
          ));
          return {
            slug,
            name,
            path: projectPath,
            projectId: p?.id,
            sessions: await Promise.all(
              rows.filter(r=>!tenants.sql.prepare('SELECT 1 FROM cc_session_trash WHERE session_id=?').get(r.session_id)).map(async (r) => ({
                id: r.session_id,
                title: r.custom_name || "未命名对话",
                updatedAt: r.lastActivity,
                locked: await terminalOwns(r.provider_session_id),
                model:r.model || 'claude-opus-5-5',
                effort:r.effort || null,
              })),
            ),
          };
        }),
      ),
    );
  }),
);
app.post(
  "/api/core/sessions",
  wrap(async (req, res) => {
    const p=tenants.getProject(uid(req),req.body.project);
    if(p.archived)throw fail('请先恢复项目');
    const projectPath=p.cwd,seed=String(req.body.content ?? "").slice(0, 80);
    const created=providers.sessionsService.createAppSession("claude",projectPath,seed);
    // Remember the name upstream actually stored (it keeps four words), so the title step can tell it from a rename.
    if(req.body.autoTitle!==false)tenants.sql.prepare('INSERT OR REPLACE INTO cc_session_titles(session_id,seed) VALUES(?,?)').run(created.sessionId,created.sessionName??seed);
    res.status(201).json(created);
  }),
);
const IMAGE_TYPES=new Set(['image/png','image/jpeg','image/gif','image/webp']);
app.get('/api/core/sessions/:id/tool-details/:tool',wrap(async(req,res)=>{
  getSession(uid(req),req.params.id);
  const history=await providers.sessionsService.fetchHistory(req.params.id,{limit:null,offset:0});
  const details=toolDetails(history.messages??history.data?.messages??[],req.params.tool);
  if(!details)throw fail('找不到这一步的记录',404);
  res.json(details);
}));
app.get('/api/core/generated/session-images/:id/:message/:index',wrap(async(req,res)=>{
  getSession(uid(req),req.params.id);
  const history=await providers.sessionsService.fetchHistory(req.params.id,{limit:null,offset:0});
  const message=(history.messages??history.data?.messages??[]).find(m=>m.id===req.params.message);
  const match=/^data:([^;,]+);base64,(.*)$/s.exec(message?.images?.[Number(req.params.index)]?.data||'');
  if(!match||!IMAGE_TYPES.has(match[1]))throw fail('图片不存在',404);
  res.setHeader('Content-Type',match[1]);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
  res.setHeader('Cache-Control','private, max-age=86400');res.end(Buffer.from(match[2],'base64'));
}));
app.get(
  "/api/core/sessions/:id",
  wrap(async (req, res) => {
    const row = getSession(uid(req),req.params.id);
    const history = await providers.sessionsService.fetchHistory(
      req.params.id,
      { limit: null, offset: 0 },
    );
    const all=history.messages??history.data?.messages??[];
    const page=historyPage(all,req.query.from);
    res.json({
      ...history,
      messages:page.messages.map(m=>compactMessage(m,req.params.id)),
      from:page.from,previousFrom:page.previousFrom,total:all.length,hasMore:page.from>0,offset:page.from,limit:null,
      generatedFiles:await sessionGeneratedFiles(row.project,all),
      locked: await terminalOwns(row.provider_session_id),
      sessionId: row.session_id,
      model:row.model || 'claude-opus-5-5',
      effort:row.effort || null,
    });
  }),
);
// Rename, or remember this conversation's own model and reasoning effort for its next turn.
app.patch('/api/core/sessions/:id',wrap(async(req,res)=>{
  const row=getSession(uid(req),req.params.id),body=req.body||{},out={id:row.session_id};
  if('title' in body){
    const title=typeof body.title==='string'?body.title.replace(/[\r\n\t]+/g,' ').trim():'';
    if(!title||title.length>100)throw fail('对话名称须为 1–100 个字');
    db.getConnection().prepare('UPDATE sessions SET custom_name=? WHERE session_id=?').run(title,row.session_id);
    tenants.sql.prepare('DELETE FROM cc_session_titles WHERE session_id=?').run(row.session_id);
    out.title=title;
  }
  if('model' in body||'effort' in body){
    if(chatRunRegistry.isProcessing(row.session_id))throw fail('请等这一轮完成后再切换',409);
    const model='model' in body?body.model:(row.model||'default'),effort='effort' in body?body.effort:(row.effort||'auto');
    if(typeof model!=='string'||!(await models()).includes(model))throw fail('不支持此模型');
    const detail=modelCache.details.find(x=>x.value===model);
    if(typeof effort!=='string')throw fail('推理强度无效');
    resolveEffort(model,effort,{levels:detail.supportedEffortLevels||effortCapabilities(model).levels,default:null});
    db.getConnection().prepare('UPDATE sessions SET model=?,effort=? WHERE session_id=?').run(model,effort,row.session_id);
    Object.assign(out,{model,effort});
  }
  res.json(out);
}));
// After the first reply: a short claude.ai-style title, unless the user renamed it meanwhile.
// force=true only suggests a title for the rename dialog; saving stays with the user.
const titling=new Set();
app.post('/api/core/sessions/:id/title',wrap(async(req,res)=>{
  const row=getSession(uid(req),req.params.id),force=req.body?.force===true;
  const pending=tenants.sql.prepare('SELECT seed FROM cc_session_titles WHERE session_id=?').get(row.session_id);
  const current=()=>db.getConnection().prepare('SELECT custom_name FROM sessions WHERE session_id=?').get(row.session_id)?.custom_name;
  const unrenamed=name=>pending&&[pending.seed,upstreamSessionName(pending.seed)].includes(name);
  if(!force&&!unrenamed(row.custom_name))return res.json({id:row.session_id,title:row.custom_name,skipped:true});
  if(titling.has(row.session_id))return res.json({id:row.session_id,title:row.custom_name,skipped:true});
  const history=await providers.sessionsService.fetchHistory(row.session_id,{limit:null,offset:0});
  const exchange=firstExchange(history.messages??history.data?.messages??[]);
  if(!exchange)return res.json({id:row.session_id,title:row.custom_name,skipped:true});
  titling.add(row.session_id);
  try{
    const ids=await models();
    const title=await generateTitle({query,exchange,options:{...await officialQueryBase(await modelNetworkMode()),model:ids.includes('haiku')?'haiku':ids[0]}});
    if(!title)throw fail('没有生成可用的标题，请稍后再试',502);
    if(force)return res.json({id:row.session_id,title,suggested:true});
    if(!unrenamed(current()))return res.json({id:row.session_id,title:current(),skipped:true});
    db.getConnection().prepare('UPDATE sessions SET custom_name=? WHERE session_id=?').run(title,row.session_id);
    tenants.sql.prepare('DELETE FROM cc_session_titles WHERE session_id=?').run(row.session_id);
    res.json({id:row.session_id,title});
  }finally{titling.delete(row.session_id);}
}));
app.get(
  "/api/core/sessions/:id/state",
  wrap(async (req, res) => {
    const row=getSession(uid(req),req.params.id);
    res.json({
      locked:await terminalOwns(row.provider_session_id),
      model:row.model || 'claude-opus-5-5',
      processing: chatRunRegistry.isProcessing(req.params.id),
      admitting: sendAdmissions.has(req.params.id),
      background: runtime.hasBackgroundWork(req.params.id),
      activity: runActivity(chatRunRegistry.getRun(req.params.id)),
      permissionMode:chatRunRegistry.getRun(req.params.id)?.permissionMode || 'bypassPermissions',
      effort:chatRunRegistry.getRun(req.params.id)?.effort ?? 'auto',
      pendingPermissions:
        providers.providerRuntimeService.getPendingApprovalsForSession(
          req.params.id,
        ),
    });
  }),
);
app.post(
  "/api/core/permissions/:id",
  wrap(async (req, res) => {
    getSession(uid(req),req.body.sessionId);
    const pending =
      providers.providerRuntimeService.getPendingApprovalsForSession(
        req.body.sessionId,
      );
    if (!pending.some((p) => p.requestId === req.params.id))
      return res.status(409).json({ error: "此权限请求已结束，请刷新对话。" });
    providers.providerRuntimeService.resolveToolApproval(req.params.id, {
      allow: req.body.allow === true,
    });
    res.json({ success: true });
  }),
);
app.get('/api/core/memory/:slug',wrap(async(req,res)=>{
  const project=tenants.getProject(uid(req),req.params.slug);
  res.json(await memoryState(project,uid(req)));
}));
// Adds the memory habit to an existing project's CLAUDE.md once.
app.post('/api/core/memory/:slug/habit',wrap(async(req,res)=>{
  const project=tenants.getProject(uid(req),req.params.slug),roots=memoryRoots(project,tenants.configDir(uid(req)));
  const current=await fs.readFile(path.join(project.cwd,'CLAUDE.md'),'utf8').catch(()=>'');
  if(!hasMemoryHabit(current))await saveMemory(roots,{source:'instructions',name:'CLAUDE.md',content:withMemoryHabit(current)});
  res.json(await memoryState(project,uid(req)));
}));
// Writes an excerpt of this login's recent conversations in the project for a memory review turn.
app.post('/api/core/memory/:slug/digest',wrap(async(req,res)=>{
  const project=tenants.getProject(uid(req),req.params.slug),configDir=tenants.configDir(uid(req));
  const rows=(await byLastActivity(db.sessionsDb.getSessionsByProjectPathPage(project.cwd,200,0)
    .filter(r=>!tenants.sql.prepare('SELECT 1 FROM cc_session_trash WHERE session_id=?').get(r.session_id)&&!String(r.custom_name||'').startsWith('整理记忆'))))
    .slice(0,12);
  const conversations=[];
  for(const r of rows){
    const history=await providers.sessionsService.fetchHistory(r.session_id,{limit:null,offset:0}).catch(()=>null);
    if(history)conversations.push({title:r.custom_name,updatedAt:r.lastActivity,messages:history.messages??history.data?.messages??[]});
  }
  const digest=conversationDigest(conversations);
  if(!digest.conversations)throw fail('这个项目还没有可以整理的对话',400);
  const dir=path.join(configDir,'projects',project.cwd.replace(/[^a-zA-Z0-9]/g,'-'));
  await fs.mkdir(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,'memory-review.md'),temporary=`${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary,`# 本项目最近的对话摘录\n\n${digest.text}`,{mode:0o600,flag:'wx'});await fs.rename(temporary,file);
  res.json({path:file,conversations:digest.conversations,chars:digest.chars});
}));
const memoryState=async(project,user)=>{
  const files=await listMemory(memoryRoots(project,tenants.configDir(user)));
  return {files,habit:hasMemoryHabit(files.find(f=>f.source==='instructions')?.content)};
};
app.put('/api/core/memory/:slug',wrap(async(req,res)=>{
  const project=tenants.getProject(uid(req),req.params.slug),roots=memoryRoots(project,tenants.configDir(uid(req)));
  await saveMemory(roots,req.body||{});
  res.json(await memoryState(project,uid(req)));
}));
installSessionTrashRoutes(app,{tenants,db,uid,wrap,terminalOwns,
  isProcessing:id=>chatRunRegistry.isProcessing(id),hasBackgroundWork:id=>runtime.hasBackgroundWork(id),isAdmitting:id=>sendAdmissions.has(id)});
app.use(express.static(path.join(root, "client")));
app.use('/api',(_req,res)=>res.status(404).json({error:'接口不存在'}));
app.get("*", (_req, res) => res.sendFile(path.join(root, "client/index.html")));
app.use((err, _req, res, _next) => {
  if(res.headersSent){res.destroy();return;}
  res
    .status(err.statusCode || 500)
    .json({ error: err.message || "服务暂时不可用" });
});
const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  maxPayload:1024*1024,
  verifyClient: (info) => {
    const url = new URL(info.req.url, "http://localhost");
    if (url.pathname !== "/ws") return false;
    if (info.origin && new URL(info.origin).host !== info.req.headers.host)
      return false;
    const user = auth.authenticateWebSocket(url.searchParams.get("token"));
    if (!user) return false;
    info.req.user = user;
    return true;
  },
});
chatRunRegistry.setRetentionGuard((id) =>
  runtime.hasBackgroundWork(id),
);
// Idle sockets were cut after ~60s somewhere between browser and server; ping keeps them
// active (browsers answer automatically) and terminates half-open ones, as upstream's gateway does.
const WS_HEARTBEAT_MS=25_000;
setInterval(()=>{
  for(const ws of wss.clients){
    if(ws.readyState!==ws.OPEN)continue;
    if(ws.ccAlive===false){ws.terminate();continue;}
    ws.ccAlive=false;
    try{ws.ping();}catch{ws.terminate();}
  }
},WS_HEARTBEAT_MS).unref();
wss.on("connection", (ws, req) => {
  ws.ccAlive=true;ws.on('pong',()=>{ws.ccAlive=true;});
  // Keep upstream protocol/replay, but validate every client frame before dispatch.
  const guarded = new Proxy(ws, {
    get(target, key) {
      if (key === "on")
        return (event, handler) => {
          if (event !== "message") return target.on(event, handler);
          return target.on(event, async (raw) => {
            let admissionId=null;
            try {
              if(!db.userDb.getUserById(uid(req)))throw fail('请重新登录',401);
              const frame = JSON.parse(String(raw));
              if (
                ![
                  "chat.send",
                  "chat.edit-send",
                  "chat.subscribe",
                  "chat.abort",
                  "chat.permission-response",
                ].includes(frame.type)
              )
                throw new Error("不支持此操作");
              if (frame.type === "chat.subscribe")
                for (const item of frame.sessions ?? [])
                  getSession(uid(req),item.sessionId);
              else {
                const row = getSession(uid(req),frame.sessionId);
                if(frame.type==='chat.permission-response'&&!runtime.getPendingApprovalsForSession(frame.sessionId).some(p=>p.requestId===frame.requestId))throw fail('权限请求不存在',404);
                // An edit re-runs the conversation from one earlier user message; it is admitted like a send.
                if (frame.type === "chat.edit-send"&&(typeof frame.anchorId!=='string'||!frame.anchorId||frame.anchorId.length>200))throw fail('找不到要编辑的消息',400);
                if (frame.type === "chat.send"||frame.type === "chat.edit-send") {
                  if(sendAdmissions.has(frame.sessionId))throw fail('对话正在提交，请稍后再试',409);
                  admissionId=frame.sessionId;sendAdmissions.add(admissionId);
                  requireHostOwner(uid(req));
                  if(frame.permissionMode&&!HOST_MODES.includes(frame.permissionMode))throw fail('不支持此权限模式');
                  if (await terminalOwns(row.provider_session_id))
                    throw new Error(
                      "这段对话仍在终端打开。请先在终端退出 Claude，或新建一段网页对话。",
                    );
                  if (
                    typeof frame.content !== "string" ||
                    !frame.content.trim() ||
                    frame.content.length > 100000
                  )
                    throw new Error("消息无效");
                  if(row.project.archived)throw fail('请先恢复项目');
                  const model=frame.model || row.model || 'default';
                  const requestedEffort=frame.effort ?? 'auto';
                  if(!(await models()).includes(model))throw fail('当前通道不支持该历史模型，请在对话设置中选择可用模型；原记录保持不变');
                  const detail=modelCache.details.find(x=>x.value===model);
                  const effortConfig={levels:detail.supportedEffortLevels||effortCapabilities(model).levels,default:null};
                  resolveEffort(model,requestedEffort,effortConfig);
                  db.getConnection().prepare('UPDATE sessions SET effort=? WHERE session_id=?').run(requestedEffort,row.session_id);
                  const ids=Array.isArray(frame.attachmentIds)?frame.attachmentIds:[];
                  if(ids.length>10)throw fail('每次最多附加 10 个文件');
                  const files=ids.map(id=>tenants.attachment(uid(req),id,row.project.id));
                  // Earlier-turn attachments remain available when the same conversation resumes.
                  for(const a of files)tenants.sql.prepare('INSERT OR IGNORE INTO cc_turn_files(session_id,upload_id) VALUES(?,?)').run(row.session_id,a.id);
                  const storedIds=tenants.sql.prepare('SELECT upload_id FROM cc_turn_files WHERE session_id=?').all(row.session_id).map(x=>x.upload_id);
                  frame.options = {
                    ccUserId:uid(req),ccAttachmentIds:storedIds,ccEffort:requestedEffort,ccEffortConfig:effortConfig,
                    attachments:files.flatMap(a=>[{path:a.path,mimeType:a.mime,name:a.name},...(a.text_path?[{path:a.text_path,mimeType:'text/plain',name:`${a.name}（${archiveKinds[path.extname(a.name).toLowerCase()]?'内容清单':'提取的文本'}）`}]:[])]),
                    model,
                    permissionMode: frame.permissionMode||'bypassPermissions',
                    cwd: row.project_path,
                    projectPath: row.project_path,
                  };
                }
              }
              await handler(Buffer.from(JSON.stringify(frame)));
            } catch (err) {
              target.send(
                JSON.stringify({
                  kind: "protocol_error",
                  error: err.message,
                  sessionId: (() => {
                    try {
                      return JSON.parse(String(raw)).sessionId;
                    } catch {
                      return null;
                    }
                  })(),
                }),
              );
            } finally {
              if(admissionId)sendAdmissions.delete(admissionId);
            }
          });
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  handleChatConnection(guarded, req, {
    runtime,
  });
});
// Once per backend process, not per browser login, message or SDK subprocess.
// Keep history available if the proxy is down; inference still has no direct
// route, and credential refresh has its own mandatory network preflight.
if(modelProvider.provider==='official')await checkOfficialStartup().then(()=>console.log('CC proxy startup probe passed')).catch(error=>console.warn(error.message));
server.listen(Number(process.env.CCWEB_PORT||3107), "127.0.0.1", () =>
  console.log("Claude project center ready on loopback:3107"),
);
process.on("SIGTERM", () => {
  for (const client of wss.clients) client.close();
  server.close(() => process.exit(0));
});
