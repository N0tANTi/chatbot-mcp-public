import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import {providerJSON} from './network-policy.mjs';
import {effortCapabilities} from './model-routing.mjs';

// Private runtime configuration only. Loading once pins each backend to one
// provider; activation/rollback is an idle, explicit service restart.
export async function loadModelProvider(file=process.env.CCWEB_PROVIDER_CONFIG||'/home/appuser/cloudcli-runtime/config/model-provider.json'){
  let stat;
  try{stat=await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return {provider:'official'};throw new Error('模型通道配置不可读');}
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw new Error('模型通道配置权限无效');
  let config;try{config=JSON.parse(await fs.readFile(file,'utf8'));}catch{throw new Error('模型通道配置格式无效');}
  return validateModelProvider(config);
}
export function validateModelProvider(config){
  if(config?.provider==='official')return {provider:'official'};
  if(config?.provider!=='packy'||config.baseUrl!=='https://cf.api.fan'||typeof config.apiKey!=='string'||!config.apiKey.trim()||/[\r\n]/.test(config.apiKey))throw new Error('模型通道配置无效');
  return {provider:'packy',baseUrl:config.baseUrl,apiKey:config.apiKey};
}
export async function providerEnvironment(config){
  if(config.provider==='official')return officialEnvironment();
  const c=validateModelProvider(config);
  return {ANTHROPIC_BASE_URL:c.baseUrl,ANTHROPIC_AUTH_TOKEN:c.apiKey,
    ANTHROPIC_DEFAULT_OPUS_MODEL:'claude-opus-5-5',ANTHROPIC_DEFAULT_SONNET_MODEL:'claude-sonnet-5-5',ANTHROPIC_DEFAULT_HAIKU_MODEL:'claude-haiku-5-5',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1',
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS:'1',ENABLE_TOOL_SEARCH:'false'};
}
export function packyModelDetails(data){
  const ids=[...new Set((data?.data||[]).map(x=>x.id).filter(id=>typeof id==='string'&&/^claude-[a-z0-9-]+$/.test(id)))];
  const details=ids.map(value=>({value,displayName:value.replace(/^claude-/,'').replace(/-/g,' '),supportedEffortLevels:effortCapabilities(value).levels}));
  for(const [value,resolvedModel] of Object.entries({default:'claude-opus-5-5',opus:'claude-opus-5-5',sonnet:'claude-sonnet-5-5',haiku:'claude-haiku-5-5'})){
    if(ids.includes(resolvedModel))details.push({value,resolvedModel,displayName:resolvedModel.replace(/^claude-/,'').replace(/-/g,' '),supportedEffortLevels:effortCapabilities(resolvedModel).levels});
  }
  return details;
}
export async function packyModels(config){
  const c=validateModelProvider(config);
  return packyModelDetails(await providerJSON(c.baseUrl+'/v1/models',{mode:'packy-direct',headers:{Authorization:`Bearer ${c.apiKey}`,'anthropic-version':'2023-06-01'}}));
}

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
