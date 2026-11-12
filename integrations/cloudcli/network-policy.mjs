import fs from 'node:fs/promises';
import https from 'node:https';

export const PROXY_URL='http://127.0.0.1:17890';
export async function networkMode(provider='official'){
  if(provider==='packy')return 'packy-direct';
  if(provider!=='official')throw new Error('未知模型通道');
  const mode=(await fs.readFile('/home/appuser/.local/cc-proxy/mode','utf8')).trim();
  if(mode!=='on')throw new Error('CC 必须使用代理，当前已停止请求');
  return mode;
}
export function networkEnvironment(mode,original={}){
  if(!['on','packy-direct'].includes(mode))throw new Error('CC 网络通道无效');
  const env={...original};
  for(const key of Object.keys(env))if(/^(HTTP|HTTPS|ALL|NO)_PROXY$/i.test(key))delete env[key];
  if(mode==='on')Object.assign(env,{HTTP_PROXY:PROXY_URL,HTTPS_PROXY:PROXY_URL,NO_PROXY:'localhost,127.0.0.1,::1'});
  return env;
}
// Node fetch does not automatically honor the CLI's proxy variables. Apply the
// same policy explicitly for server-side model discovery, with no direct retry.
export function providerJSON(url,{headers,mode,HttpsProxyAgent}){
  if(!['on','packy-direct'].includes(mode)||new URL(url).protocol!=='https:'||(mode==='packy-direct'&&url!=='https://cf.api.fan/v1/models'))throw new Error('模型网络配置无效');
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{headers,agent:mode==='on'?new HttpsProxyAgent(PROXY_URL):new https.Agent(),signal:AbortSignal.timeout(15000)},res=>{
      let body='',bytes=0;
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>1024*1024){req.destroy(new Error('模型列表超出限制'));return;}body+=chunk;});
      res.on('error',reject);
      res.on('end',()=>{if(res.statusCode<200||res.statusCode>=300)return reject(new Error('暂时无法获取模型列表'));try{resolve(JSON.parse(body));}catch{reject(new Error('模型列表格式无效'));}});
    });
    req.on('error',()=>reject(new Error('模型列表连接失败，请检查当前通道')));
  });
}
