import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
export async function checkOfficialStartup(){
  try{
    await execute('/usr/bin/python3',['/home/appuser/.local/cc-proxy/official-account.py','--probe'],{timeout:45000,maxBuffer:65536});
  }catch{
    throw new Error('启动时代理连接检查失败；网页记录仍可访问，模型请求仅走代理，不会自动登录或直连。');
  }
}
export async function officialEnvironment(){
  try{
    const {stdout}=await execute('/usr/bin/python3',['/home/appuser/.local/cc-proxy/official-account.py','--web-run'],{timeout:45000,maxBuffer:65536});
    const env=JSON.parse(stdout);
    if(typeof env.CLAUDE_CODE_OAUTH_TOKEN!=='string'||!env.CLAUDE_CODE_OAUTH_TOKEN)throw new Error();
    return {CLAUDE_CODE_OAUTH_TOKEN:env.CLAUDE_CODE_OAUTH_TOKEN};
  }catch{
    throw Object.assign(new Error('官方账号连接暂不可用。请检查代理流量、节点和授权；不会直连或自动重新登录。'),{statusCode:503});
  }
}
export function cleanProviderEnvironment(original={}){
  return Object.fromEntries(Object.entries(original).filter(([key])=>! /^(ANTHROPIC_|CLAUDE_CODE_(OAUTH|USE_|SUBAGENT_MODEL)|CLAUDE_CONFIG_DIR|CLAUDE_API_KEY)/i.test(key)));
}
