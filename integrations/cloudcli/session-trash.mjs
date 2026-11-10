import {fail} from './tenant-store.mjs';

export async function assertTrashable(row,{terminalOwns,isProcessing,hasBackgroundWork,isAdmitting}) {
  if(await terminalOwns(row.provider_session_id))throw fail('这段对话仍在终端打开，请先在终端退出 Claude',409);
  // Recheck after the asynchronous terminal lookup. Send admission is held from
  // before its first await until the upstream handler has accepted/completed it.
  if(isProcessing(row.session_id)||hasBackgroundWork(row.session_id)||isAdmitting(row.session_id))
    throw fail('对话仍在运行或正在提交，请停止并等待结束后再删除',409);
}
export function installSessionTrashRoutes(app,{tenants,db,uid,wrap,...checks}) {
  const sql=tenants.sql;
  app.get('/api/core/session-trash',wrap(async(req,res)=>{
    const rows=sql.prepare(`SELECT t.session_id AS id,t.deleted_at AS deletedAt,s.custom_name AS title,
      p.id AS project,p.name AS projectName FROM cc_session_trash t
      JOIN sessions s ON s.session_id=t.session_id JOIN cc_projects p ON p.id=t.project_id AND p.cwd=s.project_path
      WHERE t.user_id=? AND p.user_id=? ORDER BY t.deleted_at DESC,t.session_id LIMIT 201`).all(uid(req),uid(req));
    res.json({sessions:rows.slice(0,200),truncated:rows.length>200});
  }));
  app.delete('/api/core/sessions/:id',wrap(async(req,res)=>{
    if(Object.keys(req.body||{}).length||Object.keys(req.query).length)throw fail('此操作仅将对话移入回收站，文件会保留');
    const row=tenants.session(uid(req),req.params.id);
    await assertTrashable(row,checks);
    sql.transaction(()=>{
      tenants.session(uid(req),req.params.id);
      sql.prepare('INSERT INTO cc_session_trash(session_id,user_id,project_id) VALUES(?,?,?)').run(row.session_id,uid(req),row.project.id);
      db.sessionsDb.updateSessionIsArchived(row.session_id,true);
    })();
    res.json({success:true,sessionId:row.session_id,recoverable:true,filesKept:true});
  }));
  app.post('/api/core/sessions/:id/restore',wrap(async(req,res)=>{
    const row=tenants.session(uid(req),req.params.id,{includeTrash:true});
    const mark=sql.prepare('SELECT 1 FROM cc_session_trash WHERE session_id=? AND user_id=? AND project_id=?').get(row.session_id,uid(req),row.project.id);
    if(!mark)throw fail('回收站中没有这段对话',404);
    sql.transaction(()=>{
      db.sessionsDb.updateSessionIsArchived(row.session_id,false);
      sql.prepare('DELETE FROM cc_session_trash WHERE session_id=? AND user_id=?').run(row.session_id,uid(req));
    })();
    res.json({success:true,sessionId:row.session_id});
  }));
}
