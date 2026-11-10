// The owner runs every web login as ordinary host execution with full access (2026-10-19).
// Logins are the same person's work/personal spaces: each gets its own Claude Code config
// root (memory, CLAUDE.md, settings, MCP, history) while sharing the host and subscription.
// HTTP authentication/ownership remains separate from the CLI's host privileges.
export const HOST_HOME='/home/appuser';
export const HOST_CLI=`${HOST_HOME}/.local/claude-code/node_modules/@anthropic-ai/claude-code/bin/claude.exe`;
export const HOST_MODES=['bypassPermissions','auto','default'];
export const MAX_ACCOUNTS=2;
const DATA_ROOT='/home/appuser/cloudcli-runtime/data';
// appuser keeps the native ~/.claude shared with its terminal; other logins never read it.
export function claudeConfigDir(user){
  if(!user||!Number.isInteger(Number(user.id)))throw new Error('账号无效');
  return user.username==='appuser'?`${HOST_HOME}/.claude`:`${DATA_ROOT}/tenants/${Number(user.id)}/claude`;
}
export function assertActiveAccount(users,id){
  const user=users.find(u=>Number(u.id)===Number(id));
  if(!user||users.length>MAX_ACCOUNTS)throw Object.assign(new Error('此账号未启用网页运行'),{statusCode:403});
  return user;
}
export function hostQueryOptions(options,env,configDir=`${HOST_HOME}/.claude`){
  const mode=options.permissionMode??'bypassPermissions';
  if(!HOST_MODES.includes(mode))throw new Error('不支持此权限模式');
  const next={...options,env:{...env,HOME:HOST_HOME,CLAUDE_CONFIG_DIR:configDir},
    pathToClaudeCodeExecutable:HOST_CLI,settingSources:['user','project','local'],
    permissionMode:mode,allowDangerouslySkipPermissions:true,sandbox:{enabled:false},
    tools:{type:'preset',preset:'claude_code'}};
  // Do not inherit CloudCLI tool lists or turn/budget caps. Native user/project
  // settings, MCP configuration and hooks are loaded normally and not rewritten.
  for(const key of ['allowedTools','disallowedTools','maxTurns','maxBudgetUsd'])delete next[key];
  delete next.env.CCWEB_SANDBOX;
  return next;
}
// Upstream records a provider session id only for brand-new sessions, so when the first prompt
// is edited (the SDK starts a fresh session) the new id was lost and history kept the old
// transcript. This wraps the SDK query to report the first session id it emits; every other
// Query method (interrupt, permission changes, …) still reaches the original object.
export function watchProviderSession(query,onSessionId){
  const source=query[Symbol.asyncIterator]();let seen=false;
  const iterator={
    async next(...args){const result=await source.next(...args);if(!seen&&result.value?.session_id){seen=true;onSessionId(result.value.session_id);}return result;},
    return:(...args)=>source.return?source.return(...args):Promise.resolve({done:true,value:undefined}),
    throw:(...args)=>source.throw?source.throw(...args):Promise.reject(args[0]),
    [Symbol.asyncIterator](){return iterator;},
  };
  return new Proxy(query,{get(target,key){
    if(key===Symbol.asyncIterator)return ()=>iterator;
    if(key==='next'||key==='return'||key==='throw')return iterator[key];
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
}
