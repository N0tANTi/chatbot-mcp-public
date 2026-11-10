import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {downloadRule} from './download-rule.mjs';
import {claudeConfigDir} from './host-execution.mjs';
import {projectClaudeMd} from './project-template.mjs';
export const DATA='/home/appuser/cloudcli-runtime/data';
export const ASSETS='/home/appuser/.cloudcli/assets';
export const legacy=[['work','工作'],['interest','示例项目二'],['about','示例项目三']];
export const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export function initTenants(db){
  const sql=db.getConnection();
  sql.exec(`CREATE TABLE IF NOT EXISTS cc_projects(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,name TEXT NOT NULL,cwd TEXT UNIQUE NOT NULL,legacy INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS cc_uploads(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,project_id TEXT NOT NULL,name TEXT NOT NULL,path TEXT UNIQUE NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,text_path TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS cc_turn_files(session_id TEXT NOT NULL,upload_id TEXT NOT NULL,PRIMARY KEY(session_id,upload_id));
    CREATE TABLE IF NOT EXISTS cc_session_trash(session_id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,project_id TEXT NOT NULL,deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS cc_session_titles(session_id TEXT PRIMARY KEY,seed TEXT NOT NULL);`);
  const owner=db.userDb.getFirstUser();
  if(owner)for(const[id,name]of legacy)sql.prepare('INSERT OR IGNORE INTO cc_projects(id,user_id,name,cwd,legacy) VALUES(?,?,?,?,1)').run(id,owner.id,name,`/home/appuser/claude-projects/${id}`);
  const getProject=(uid,id)=>{const p=sql.prepare('SELECT * FROM cc_projects WHERE id=? AND user_id=?').get(id,uid);if(!p)throw fail('项目不存在',404);return p;};
  const session=(uid,id,{includeTrash=false}={})=>{const s=db.sessionsDb.getSessionById(id);if(!s||s.provider!=='claude')throw fail('对话不存在',404);const p=sql.prepare('SELECT * FROM cc_projects WHERE cwd=? AND user_id=?').get(s.project_path,uid);if(!p||(!includeTrash&&(s.isArchived||sql.prepare('SELECT 1 FROM cc_session_trash WHERE session_id=?').get(id))))throw fail('对话不存在',404);return {...s,project:p};};
  return {sql,getProject,session,
    projects:(uid,archived=0)=>sql.prepare('SELECT * FROM cc_projects WHERE user_id=? AND archived=? ORDER BY rowid').all(uid,archived),
    isAdmin:(uid)=>Number(db.userDb.getFirstUser()?.id)===Number(uid),
    createProject:async(uid,name)=>{name=String(name||'').trim();if(!name||name.length>60)throw fail('项目名称须为 1–60 个字');const id=randomUUID(),cwd=`${DATA}/tenants/${uid}/projects/${id}`;await fs.mkdir(cwd,{recursive:true,mode:0o700});await fs.mkdir(path.join(cwd,'memory'),{mode:0o700});await fs.writeFile(path.join(cwd,'CLAUDE.md'),projectClaudeMd(name),{mode:0o600});await fs.mkdir(path.join(cwd,'.claude/rules'),{recursive:true,mode:0o700});await fs.writeFile(path.join(cwd,'.claude/rules/generated-downloads.md'),downloadRule(id),{mode:0o600});sql.prepare('INSERT INTO cc_projects(id,user_id,name,cwd) VALUES(?,?,?,?)').run(id,uid,name,cwd);return getProject(uid,id);},
    attachment:(uid,id,projectId)=>{const a=sql.prepare('SELECT * FROM cc_uploads WHERE id=? AND user_id=? AND project_id=?').get(id,uid,projectId);if(!a)throw fail('附件不存在',404);return a;},
    // Native transcripts live under each login's own Claude Code config root.
    configDir:uid=>claudeConfigDir(sql.prepare('SELECT id,username FROM users WHERE id=?').get(uid)),
    transcript:(p,uid,native)=>`${claudeConfigDir(sql.prepare('SELECT id,username FROM users WHERE id=?').get(uid))}/projects/${p.cwd.replace(/[^a-zA-Z0-9]/g,'-')}/${native}.jsonl`
  };
}
