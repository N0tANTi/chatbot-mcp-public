import {test} from 'node:test';
import assert from 'node:assert/strict';
import {historyPage,withImageLinks} from '../../integrations/cloudcli/history-page.mjs';

const u=id=>({id,kind:'text',role:'user',content:id}),a=id=>({id,kind:'tool_use',toolName:'Bash'});
const rows=[u('u0'),a('a0'),u('u1'),a('a1'),a('a1b'),u('u2'),a('a2'),u('u3'),a('a3'),u('u4'),a('a4')];

test('default page holds the last three whole user turns',()=>{
  const p=historyPage(rows);
  assert.equal(p.from,5);assert.deepEqual(p.messages.map(m=>m.id),['u2','a2','u3','a3','u4','a4']);
  assert.equal(p.previousFrom,0);
});
test('explicit from snaps back to a turn start and never splits a turn',()=>{
  assert.equal(historyPage(rows,'4').from,2);
  assert.equal(historyPage(rows,'0').previousFrom,null);
  assert.equal(historyPage(rows,'999').from,9);
  assert.equal(historyPage(rows,'abc').from,5);
  assert.equal(historyPage(rows.slice(0,4)).from,0);
  assert.equal(historyPage([]).from,0);
});
test('pasted image bytes are replaced by owner-checked links',()=>{
  const m=withImageLinks({id:'m/1',kind:'text',role:'user',images:[{data:'data:image/png;base64,AAAA'},{data:'bogus'}]},'s 1');
  assert.deepEqual(m.images,[{mime:'image/png',url:'/api/core/generated/session-images/s%201/m%2F1/0'},{mime:null,url:'/api/core/generated/session-images/s%201/m%2F1/1'}]);
  assert.ok(!JSON.stringify(m).includes('AAAA'));
  const plain={id:'x',kind:'text'};assert.equal(withImageLinks(plain,'s'),plain);
});

test('history rows drop duplicate structured results and bound long tool text',async()=>{
  const {compactMessage,toolDetails,DETAIL_LIMIT}=await import('../../integrations/cloudcli/history-page.mjs');
  const long='x'.repeat(DETAIL_LIMIT+5);
  const m={id:'t',toolId:'t1',kind:'tool_use',toolInput:{command:'ls',content:long},toolResult:{content:[{type:'text',text:long}],isError:false,toolUseResult:{stdout:long}}};
  const c=compactMessage(m,'s');
  assert.equal(c.toolResult.toolUseResult,undefined);
  assert.equal(c.toolResult.content.length,DETAIL_LIMIT);assert.equal(c.toolResult.truncated,DETAIL_LIMIT+5);
  assert.equal(c.toolInput.command,'ls');assert.equal(c.toolInput.content.length,DETAIL_LIMIT);assert.equal(c.toolInputTruncated,true);
  const small=compactMessage({id:'u',toolId:'t2',kind:'tool_use',toolInput:{command:'pwd'},toolResult:{content:'ok',isError:false,toolUseResult:{}}},'s');
  assert.deepEqual(small.toolResult,{content:'ok',isError:false});assert.equal(small.toolInputTruncated,undefined);
  assert.deepEqual(toolDetails([m],'t1'),{toolInput:m.toolInput,content:long});
  assert.equal(toolDetails([m],'missing'),null);
});
