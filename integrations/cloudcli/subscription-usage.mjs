import https from 'node:https';
import {PROXY_URL} from './network-policy.mjs';

const labels={five_hour:'5 小时额度',seven_day:'每周总额度',seven_day_opus:'Opus 每周额度',
  seven_day_sonnet:'Sonnet 每周额度',seven_day_fable:'Fable 每周额度',
  seven_day_oauth_apps:'OAuth 应用每周额度',seven_day_cowork:'Cowork 每周额度'};
const reset=value=>{
  const parsed=typeof value==='string'&&value.length<=64?Date.parse(value):NaN;
  return Number.isFinite(parsed)?new Date(parsed).toISOString():null;
};
const windowOf=(key,label,used,resetsAt)=>{
  const usedPercent=typeof used==='number'&&Number.isFinite(used)&&used>=0?used:null;
  return {key,label,usedPercent,remainingPercent:usedPercent===null?null:Math.max(0,100-usedPercent),resetsAt:reset(resetsAt)};
};
// Model-scoped weekly limits (Fable since 5.2) arrive only in the newer `limits` list.
function scopedLimits(limits,taken){
  if(!Array.isArray(limits))return [];
  return limits.flatMap(item=>{
    const name=item?.kind==='weekly_scoped'?item.scope?.model?.display_name:null;
    if(typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9 .-]{0,23}$/.test(name))return [];
    const key=`seven_day_${name.toLowerCase().replace(/[^a-z0-9]+/g,'_')}`;
    if(taken.has(key))return [];
    taken.add(key);
    return [windowOf(key,`${name} 每周额度`,item.percent,item.resets_at)];
  });
}
export function normalizeUsage(data){
  if(!data||typeof data!=='object'||!['five_hour','seven_day'].some(key=>Object.hasOwn(data,key)))
    throw Object.assign(new Error('Invalid usage response'),{usageCode:'invalid_response'});
  const windows=Object.entries(labels).filter(([key])=>['five_hour','seven_day'].includes(key)||data[key]&&typeof data[key]==='object')
    .map(([key,label])=>windowOf(key,label,data[key]?.utilization,data[key]?.resets_at));
  return [...windows,...scopedLimits(data.limits,new Set(windows.map(w=>w.key)))];
}

// Same endpoint used by the installed native /usage command. Fixed destination,
// explicit CONNECT agent, verified TLS, bounded response and no direct retry.
export function fetchOfficialUsage({mode,token,HttpsProxyAgent}){
  if(mode!=='on'||typeof token!=='string'||!token)
    return Promise.reject(Object.assign(new Error('Usage unavailable'),{usageCode:'unavailable'}));
  return new Promise((resolve,reject)=>{
    const fail=(code='network',retryAfter)=>reject(Object.assign(new Error('Usage unavailable'),{usageCode:code,retryAfter}));
    const request=https.get('https://api.anthropic.com/api/oauth/usage',{
      agent:new HttpsProxyAgent(PROXY_URL),signal:AbortSignal.timeout(15000),
      headers:{Authorization:`Bearer ${token}`,'anthropic-beta':'oauth-2025-04-20','User-Agent':'chatbot-mcp-web/1.0'},
    },response=>{
      if(response.statusCode!==200){
        response.resume();
        return fail(response.statusCode===429?'rate_limited':[401,403].includes(response.statusCode)?'authorization':'unavailable',response.headers['retry-after']);
      }
      let body='',bytes=0;
      response.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536){request.destroy();fail('invalid_response');return;}body+=chunk;});
      response.on('error',()=>fail());
      response.on('end',()=>{try{resolve(normalizeUsage(JSON.parse(body)));}catch{fail('invalid_response');}});
    });
    request.on('error',()=>fail());
  });
}

const messages={rate_limited:'官方额度查询暂时限流，请稍后刷新。',authorization:'暂时无法读取官方订阅额度，请检查授权状态。',
  network:'额度查询连接失败，请稍后刷新。',invalid_response:'官方暂未返回可识别的额度数据。',unavailable:'暂时无法读取订阅额度，请稍后刷新。'};
export function createUsageService({read,now=Date.now}){
  let cache=null,inflight=null,nextAllowed=0,lastError=null;
  const snapshot=()=>{
    const available=cache&&now()-cache.at<3600000;
    return {state:available?(lastError?'stale':'ready'):'unavailable',
      windows:available?cache.windows.map(window=>({...window})):[],
      fetchedAt:available?new Date(cache.at).toISOString():null,
      nextRefreshAt:new Date(nextAllowed).toISOString(),message:lastError?messages[lastError]:null};
  };
  return {get:async({refresh=false}={})=>{
    if(inflight)return inflight;
    if(now()<nextAllowed||(!refresh&&cache&&now()-cache.at<300000&&!lastError))return snapshot();
    inflight=(async()=>{
      try{
        const windows=await read();
        cache={windows,at:now()};lastError=null;nextAllowed=now()+60000;
      }catch(error){
        lastError=Object.hasOwn(messages,error.usageCode)?error.usageCode:'unavailable';
        const raw=error.retryAfter,seconds=typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw)*1000:NaN;
        const delay=Number.isFinite(seconds)?seconds:typeof raw==='string'?Date.parse(raw)-now():0;
        nextAllowed=now()+Math.max(300000,Math.min(Number.isFinite(delay)?delay:0,7*86400000));
      }
      return snapshot();
    })();
    try{return await inflight;}finally{inflight=null;}
  }};
}
