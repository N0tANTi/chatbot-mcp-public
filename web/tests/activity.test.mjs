import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeMessage,historyMessages} from '../src/activity.mjs';
import {createActivityNormalizer,runActivity} from '../../integrations/cloudcli/activity-events.mjs';
import {effortCapabilities,resolveEffort,reasoningOptions} from '../../integrations/cloudcli/model-routing.mjs';

test('official capabilities validate aliases and apply effort per invocation',()=>{
  const config={levels:['low','medium','high','max'],default:null};
  assert.equal(resolveEffort('opus','max',config),'max');
  assert.throws(()=>resolveEffort('opus','xhigh',config));
  assert.equal(resolveEffort('opus','auto',config),undefined);
  assert.equal(effortCapabilities('unknown').levels.length,0);
  const options={effort:'medium',resume:'original-native-id',permissionMode:'auto'};
  const automatic=reasoningOptions('opus','auto',options,{},config);
  assert.equal(automatic.effort,undefined);assert.equal(automatic.env.CLAUDE_CODE_EFFORT_LEVEL,'auto');
  const high=reasoningOptions('opus','high',options,{},config);
  assert.equal(high.effort,'high');assert.equal(high.resume,'original-native-id');
  assert.equal(options.effort,'medium');
});

test('live tool and replay merge with output; history uses the same model',()=>{
  const call={kind:'tool_use',id:'call',toolId:'t1',toolName:'Read',toolInput:{file_path:'资料.md'}};
  const result={kind:'tool_result',id:'result',toolId:'t1',content:'文件内容',isError:false};
  let rows=mergeMessage([],call);
  rows=mergeMessage(rows,result);rows=mergeMessage(rows,call);rows=mergeMessage(rows,result);
  assert.equal(rows.length,1);assert.equal(rows[0].toolResult.content,'文件内容');
  assert.deepEqual(historyMessages([call,result]),rows);
  const reversed=historyMessages([result,call]);assert.equal(reversed.length,1);assert.equal(reversed[0].toolResult.content,'文件内容');
});
test('failure is retained and final stream blocks replace provisional content across tool events',()=>{
  let rows=mergeMessage([],{kind:'stream_delta',seq:1,content:'正在'});
  rows=mergeMessage(rows,{kind:'tool_use',id:'t',toolId:'t',toolName:'Bash'});
  rows=mergeMessage(rows,{kind:'text',role:'assistant',id:'answer',content:'正在检查'});
  assert.equal(rows.filter(x=>x.kind==='text').length,1);
  rows=mergeMessage(rows,{kind:'tool_result',toolId:'t',isError:true,content:'exit 1'});
  assert.equal(rows.find(x=>x.toolId==='t').toolResult.isError,true);
});
test('SDK user echo replaces optimistic input; separate user turns remain distinct',()=>{
  const local={kind:'text',role:'user',id:'local',_local:true,content:'hello'};
  const echo={...local,id:'echo',_local:false};
  let rows=mergeMessage([local],echo);assert.equal(rows.length,1);assert.equal(rows[0].id,'echo');
  rows=mergeMessage(rows,{...echo,id:'another'});assert.equal(rows.length,2);
});
test('background progress updates its call and never duplicates it on replay',()=>{
  const call={kind:'tool_use',id:'call',toolId:'t1',toolName:'Bash'};
  const progress={kind:'task_status',id:'progress',toolUseId:'t1',taskId:'t1',elapsedSeconds:20};
  let rows=historyMessages([call,progress,{...progress,elapsedSeconds:30}]);
  assert.equal(rows.length,1);assert.equal(rows[0].progress.elapsedSeconds,30);
  rows=mergeMessage(rows,{kind:'tool_result',toolId:'t1',content:'done'});
  assert.equal(rows[0].toolResult.content,'done');
});
test('SDK partial stream unwraps and only actual thinking content is exposed',()=>{
  const normalize=createActivityNormalizer(raw=>raw.type==='content_block_delta'?[{kind:'stream_delta',content:raw.delta.text}]:[]);
  assert.equal(normalize({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'hello'}}},'s')[0].content,'hello');
  assert.equal(normalize({type:'stream_event',event:{type:'content_block_delta',delta:{type:'thinking_delta',thinking:'实际内容'}}},'s')[0].kind,'thinking_delta');
  assert.deepEqual(normalize({type:'unknown',privateKey:'do-not-expose'},'s'),[]);
});
test('runtime snapshot uses original times, pending tools and real abort outcome',()=>{
  const run={runKey:1000,startedAt:1000,events:[{kind:'tool_use',toolId:'t',toolName:'Read',eventAt:1200}]};
  assert.equal(runActivity(run).label,'正在执行 Read');
  run.events.push({kind:'tool_result',toolId:'t',eventAt:1500});assert.equal(runActivity(run).label,'工具已返回，等待下一步');
  run.completedAt=2000;run.events.push({kind:'complete',aborted:true,eventAt:2000,exitCode:0});
  assert.equal(runActivity(run).aborted,true);assert.equal(runActivity(run).startedAt,1000);
});

test('groups consecutive activity between messages and summarizes it honestly',async()=>{
  const {groupFeed,activitySummary}=await import('../src/activity.mjs');
  const rows=[
    {kind:'text',role:'user',content:'hi'},
    {kind:'thinking',content:'…'},
    {kind:'tool_use',toolName:'Bash',toolId:'a'},
    {kind:'tool_use',toolName:'Bash',toolId:'b'},
    {kind:'text',role:'assistant',content:'mid'},
    {kind:'tool_use',toolName:'Edit',toolId:'c'},
    {kind:'error',content:'x'},
  ];
  const groups=groupFeed(rows);
  assert.deepEqual(groups.map(g=>g.type==='activity'?g.items.map(x=>x.index):g.index),[0,[1,2,3],4,[5],6]);
  assert.equal(groups[1].key,'activity-1');
  assert.equal(activitySummary(groups[1].items.map(x=>x.message)),'思考 1 次，执行 2 个命令');
  const many=['Read','Grep','Write','mcp__x'].map(toolName=>({kind:'tool_use',toolName}));
  assert.equal(activitySummary(many),'读取 1 个文件，搜索内容 1 次，写入 1 个文件 等');
  assert.equal(activitySummary([{kind:'tool_use',toolName:'mcp__x'},{kind:'tool_use',toolName:'mcp__x'}]),'mcp__x ×2');
});

test('finished turns fold their process before the final answer; the live turn stays open',async()=>{
  const {groupFeed,collapseTurns}=await import('../src/activity.mjs');
  const rows=[
    {kind:'text',role:'user',content:'q1',timestamp:'2026-10-19T08:00:00Z'},
    {kind:'text',role:'assistant',content:'let me check'},
    {kind:'tool_use',toolName:'Bash',toolId:'a'},
    {kind:'text',role:'assistant',content:'answer 1',timestamp:'2026-10-19T08:03:12Z'},
    {kind:'text',role:'user',content:'q2'},
    {kind:'text',role:'assistant',content:'plain answer, no tools'},
    {kind:'text',role:'user',content:'q3'},
    {kind:'thinking',content:'…'},
    {kind:'text',role:'assistant',content:'partial'},
  ];
  const shape=list=>list.map(g=>g.type==='process'?`P(${g.groups.length})`:g.type==='activity'?'A':g.message.content);
  const out=collapseTurns(groupFeed(rows));
  assert.deepEqual(shape(out),['q1','P(2)','answer 1','q2','plain answer, no tools','q3','P(1)','partial']);
  assert.equal(out[1].endedAt-out[1].startedAt,192000);
  assert.equal(out[1].messages.length,1);
  assert.deepEqual(shape(collapseTurns(groupFeed(rows),{keepLast:true})).slice(-3),['q3','A','partial']);
  // A turn that stopped mid-way (no final text) is never hidden.
  assert.deepEqual(shape(collapseTurns(groupFeed(rows.slice(0,3)))),['q1','let me check','A']);
});

test('generated files attach to the latest turn that wrote or cited them',async()=>{
  const {groupFeed,collapseTurns,filesByTurn,withTurnFiles}=await import('../src/activity.mjs');
  const P='/p/proj';
  const rows=[
    {kind:'text',role:'user',content:'q1'},
    {kind:'tool_use',toolName:'Write',toolInput:{file_path:P+'/a.md'},toolResult:{content:'ok'}},
    {kind:'tool_use',toolName:'Write',toolInput:{file_path:P+'/failed.md'},toolResult:{content:'x',isError:true}},
    {kind:'text',role:'assistant',content:'done'},
    {kind:'text',role:'user',content:'q2'},
    {kind:'text',role:'assistant',content:'see [b.png](https://claude.example.com/download?project=x&file=outputs%2Fb.png) and [a](/download?project=x&file=a.md)'},
  ];
  const files=['a.md','outputs/b.png','failed.md','old.xlsx'].map(path=>({path,name:path}));
  const map=filesByTurn(rows,P,files);
  assert.deepEqual([...map].map(([k,v])=>[k,v.map(f=>f.path)]),[[4,['a.md','outputs/b.png','failed.md','old.xlsx']]]);
  const partial=filesByTurn(rows.slice(0,4),P,files,{complete:false});
  assert.deepEqual([...partial].map(([k,v])=>[k,v.map(f=>f.path)]),[[0,['a.md']]]);
  const shape=withTurnFiles(collapseTurns(groupFeed(rows.slice(0,4))),partial).map(g=>g.type==='files'?`F${g.files.length}`:g.type==='process'?'P':g.message.content);
  assert.deepEqual(shape,['q1','P','done','F1']);
});
