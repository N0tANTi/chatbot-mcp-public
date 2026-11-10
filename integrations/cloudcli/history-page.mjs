// History loads in whole user turns: the latest few by default, earlier ones on request.
export const PAGE_TURNS=3;
const userTurnStarts=messages=>messages.flatMap((m,i)=>m.kind==='text'&&m.role==='user'?[i]:[]);
export function historyPage(messages,requested){
  const starts=userTurnStarts(messages);
  const snap=n=>{let at=0;for(const i of starts)if(i<=n)at=i;return at;};
  const value=Number.parseInt(requested,10);
  const from=Number.isInteger(value)&&value>=0?snap(Math.min(value,messages.length)):starts.length>PAGE_TURNS?starts.at(-PAGE_TURNS):0;
  const before=starts.filter(i=>i<from);
  return {messages:messages.slice(from),from,previousFrom:before.length?before.at(-Math.min(PAGE_TURNS,before.length)):null};
}
// Pasted images stay in the transcript; the API returns links so history loads without the image bytes.
export const withImageLinks=(m,sessionId)=>Array.isArray(m.images)&&m.images.length&&m.id?{...m,images:m.images.map((image,index)=>({mime:/^data:([^;,]+)/.exec(image?.data||'')?.[1]||null,url:`/api/core/generated/session-images/${encodeURIComponent(sessionId)}/${encodeURIComponent(m.id)}/${index}`}))}:m;
// History pages carry bounded tool output; the full value is fetched on demand when a row is expanded.
export const DETAIL_LIMIT=8000;
const flatten=value=>typeof value==='string'?value:Array.isArray(value)?value.map(x=>x?.type==='text'?x.text:x?.type==='image'?'[图片结果]':JSON.stringify(x)).join('\n'):JSON.stringify(value,null,2);
export function compactMessage(m,sessionId){
  let out=withImageLinks(m,sessionId);
  if(out.toolResult){
    const {toolUseResult,...result}=out.toolResult,text=result.content==null?'':flatten(result.content);
    out={...out,toolResult:text.length>DETAIL_LIMIT?{...result,content:text.slice(0,DETAIL_LIMIT),truncated:text.length}:result};
  }
  if(out.toolInput&&typeof out.toolInput==='object'&&!Array.isArray(out.toolInput)){
    let cut=false;const input=Object.fromEntries(Object.entries(out.toolInput).map(([k,v])=>typeof v==='string'&&v.length>DETAIL_LIMIT?(cut=true,[k,v.slice(0,DETAIL_LIMIT)]):[k,v]));
    if(cut)out={...out,toolInput:input,toolInputTruncated:true};
  }
  return out;
}
export const toolDetails=(messages,toolId)=>{const m=messages.find(x=>(x.toolId||x.id)===toolId&&(x.toolResult||x.toolInput));return m?{toolInput:m.toolInput??null,content:m.toolResult?flatten(m.toolResult.content??''):null}:null;};
