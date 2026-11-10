import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertTrashable} from '../../integrations/cloudcli/session-trash.mjs';
import {generatedCandidates} from '../../integrations/cloudcli/generated-files.mjs';

test('delete guards reject live, background, terminal and in-flight admissions',async()=>{
  const row={session_id:'s',provider_session_id:'native'};
  const idle={terminalOwns:async()=>false,isProcessing:()=>false,hasBackgroundWork:()=>false,isAdmitting:()=>false};
  await assertTrashable(row,idle);
  for(const check of ['isProcessing','hasBackgroundWork','isAdmitting'])
    await assert.rejects(assertTrashable(row,{...idle,[check]:()=>true}),e=>e.statusCode===409);
  await assert.rejects(assertTrashable(row,{...idle,terminalOwns:async()=>({pid:123})}),e=>e.statusCode===409);
  let admission=false;
  await assert.rejects(assertTrashable(row,{...idle,terminalOwns:async()=>{admission=true;return false;},isAdmitting:()=>admission}),e=>e.statusCode===409);
});
test('download candidates require a successful write or a scoped assistant link',()=>{
  const p={id:'work',cwd:'/home/appuser/work'};
  const write=(id,file,name='Write')=>({kind:'tool_use',toolId:id,toolName:name,toolInput:{file_path:file}});
  const result=(id,isError=false)=>({kind:'tool_result',toolId:id,content:'done',isError});
  const candidates=generatedCandidates(p,[write('good','outputs/报告 #&.md'),result('good'),
    write('failed','failed.md'),result('failed',true),write('pending','pending.md'),
    write('read','original.md','Read'),result('read'),write('secret','.claude/settings.json'),result('secret'),
    write('escape','/home/other/private.md'),result('escape'),
    {kind:'text',role:'user',content:'/download?project=work&file=user.md'},
    {kind:'text',role:'assistant',content:'[下载](/download?project=other&file=other.md) [下载](/download?project=work&file=summary.pdf)'}]);
  assert.deepEqual(candidates.sort(),['outputs/报告 #&.md','summary.pdf'].sort());
});
test('candidate discovery is bounded and never treats thinking as a file instruction',()=>{
  const messages=Array.from({length:200},(_,i)=>({kind:'text',role:'assistant',content:`/download?project=p&file=${i}.md`}));
  messages.push({kind:'thinking',content:'/download?project=p&file=hidden.md'});
  const candidates=generatedCandidates({id:'p',cwd:'/home/project'},messages);
  assert.equal(candidates.length,128);assert(!candidates.includes('hidden.md'));
});
