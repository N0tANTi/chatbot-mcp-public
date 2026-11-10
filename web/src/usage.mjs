export function percentage(value){
  return typeof value==='number'&&Number.isFinite(value)?`${Number(value.toFixed(1))}%`:'未知';
}
export function timeUntil(value,now=Date.now()){
  const milliseconds=Date.parse(value)-now;
  if(!Number.isFinite(milliseconds))return null;
  if(milliseconds<=0)return '时间已到';
  const minutes=Math.ceil(milliseconds/60000),days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),rest=minutes%60;
  return [days?`${days} 天`:null,hours?`${hours} 小时`:null,rest?`${rest} 分钟`:null].filter(Boolean).join(' ');
}
export function localTime(value){
  const date=new Date(value);
  if(!value||!Number.isFinite(date.getTime()))return '官方未提供恢复时间';
  return new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(date);
}
