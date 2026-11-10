import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUsage,createUsageService,fetchOfficialUsage} from '../../integrations/cloudcli/subscription-usage.mjs';
import {percentage,timeUntil,localTime} from '../src/usage.mjs';

test('usage normalization whitelists fields and distinguishes unknown, zero and exhausted',()=>{
  const windows=normalizeUsage({five_hour:{utilization:0,resets_at:'2026-10-19T12:00:00Z',token:'secret'},
    seven_day:{utilization:100,resets_at:'invalid'},seven_day_opus:null,seven_day_sonnet:{utilization:'3'},email:'private',extra_usage:{balance:99}});
  assert.equal(windows.length,3);assert.equal(windows[0].usedPercent,0);assert.equal(windows[0].remainingPercent,100);
  assert.equal(windows[1].remainingPercent,0);assert.equal(windows[1].resetsAt,null);
  assert.equal(windows[2].usedPercent,null);assert.equal(windows[2].remainingPercent,null);
  assert(!JSON.stringify(windows).includes('secret'));assert(!JSON.stringify(windows).includes('private'));assert(!JSON.stringify(windows).includes('balance'));
  assert.equal(normalizeUsage({five_hour:null})[0].usedPercent,null);
  assert.equal(normalizeUsage({five_hour:{utilization:102}})[0].remainingPercent,0);
  assert.throws(()=>normalizeUsage({unrecognized:1}));
});
test('model-scoped weekly limits from the limits list become their own window once',()=>{
  const fable={kind:'weekly_scoped',percent:12.5,resets_at:'2026-11-17T07:00:00+00:00',scope:{model:{id:null,display_name:'Fable'},surface:null}};
  const windows=normalizeUsage({five_hour:{utilization:13},seven_day:{utilization:4},limits:[
    {kind:'session',percent:13,scope:null},{kind:'weekly_all',percent:4,scope:null},fable,{...fable,percent:99},
    {kind:'weekly_scoped',percent:5,scope:{model:{display_name:'<img src=x>'}}},{kind:'weekly_scoped',percent:5,scope:{surface:{display_name:'Cowork'}}}]});
  assert.deepEqual(windows.map(w=>w.key),['five_hour','seven_day','seven_day_fable']);
  assert.equal(windows[2].label,'Fable 每周额度');assert.equal(windows[2].usedPercent,12.5);assert.equal(windows[2].remainingPercent,87.5);
  assert.equal(windows[2].resetsAt,'2026-11-17T07:00:00.000Z');
  assert.equal(normalizeUsage({five_hour:{},seven_day_fable:{utilization:1},limits:[fable]}).filter(w=>w.key==='seven_day_fable').length,1);
  assert.equal(normalizeUsage({five_hour:{},limits:'bad'}).length,2);
});
test('concurrent reads coalesce; cache, manual cooldown and TTL prevent repeated requests',async()=>{
  let clock=Date.parse('2026-10-19T00:00Z'),calls=0,release;
  const service=createUsageService({now:()=>clock,read:()=>{calls++;return new Promise(r=>{release=r;});}});
  const first=service.get(),second=service.get({refresh:true});assert.equal(calls,1);
  release(normalizeUsage({five_hour:{utilization:25},seven_day:{utilization:60}}));
  assert.deepEqual(await first,await second);assert.equal((await service.get({refresh:true})).windows[0].remainingPercent,75);assert.equal(calls,1);
  clock+=61000;await service.get();assert.equal(calls,1);
  const manual=service.get({refresh:true});assert.equal(calls,2);release(normalizeUsage({five_hour:{utilization:30}}));await manual;
  clock+=301000;const expired=service.get();assert.equal(calls,3);release(normalizeUsage({five_hour:{utilization:35}}));await expired;
});
test('429 backoff retains last good data, honors Retry-After and expires stale values',async()=>{
  let clock=Date.parse('2026-10-19T00:00Z'),calls=0,failed=false;
  const service=createUsageService({now:()=>clock,read:async()=>{calls++;if(failed)throw Object.assign(new Error('must not leak token'),{usageCode:'rate_limited',retryAfter:'600'});return normalizeUsage({five_hour:{utilization:80}});}});
  await service.get();clock+=61000;failed=true;
  const stale=await service.get({refresh:true});assert.equal(stale.state,'stale');assert.equal(stale.windows[0].usedPercent,80);
  assert.equal(Date.parse(stale.nextRefreshAt),clock+600000);assert(!JSON.stringify(stale).includes('token'));
  await service.get({refresh:true});assert.equal(calls,2);
  clock+=3600001;const expired=await service.get();assert.equal(expired.state,'unavailable');assert.deepEqual(expired.windows,[]);
});
test('failure without a sample never invents zero usage or retries automatically',async()=>{
  let calls=0;
  const service=createUsageService({read:async()=>{calls++;throw Object.assign(new Error('private provider body'),{usageCode:'authorization'});}});
  const data=await service.get();assert.equal(data.state,'unavailable');assert.deepEqual(data.windows,[]);assert.equal(data.fetchedAt,null);
  await service.get({refresh:true});assert.equal(calls,1);assert(!JSON.stringify(data).includes('private'));
  await assert.rejects(fetchOfficialUsage({mode:'off',token:'fixture'}));
});
test('usage formatting handles reset boundaries and never turns missing percentages into zero',()=>{
  assert.equal(percentage(null),'未知');assert.equal(percentage(0),'0%');assert.equal(percentage(12.34),'12.3%');
  const now=Date.parse('2026-10-19T00:00Z');assert.equal(timeUntil('2026-10-19T01:01Z',now),'1 小时 1 分钟');
  assert.equal(timeUntil('2026-10-19T00:00Z',now),'时间已到');assert.equal(timeUntil('bad',now),null);
  assert.equal(localTime(null),'官方未提供恢复时间');
});
