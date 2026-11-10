import test from 'node:test';
import assert from 'node:assert/strict';
import {assertActiveAccount,claudeConfigDir,hostQueryOptions,HOST_CLI,MAX_ACCOUNTS,watchProviderSession} from '../../integrations/cloudcli/host-execution.mjs';

test('any active login may run; unknown or excess accounts may not',()=>{
  const users=[{id:1,username:'appuser'},{id:2,username:'personal'}];
  assert.equal(assertActiveAccount(users,2).username,'personal');
  assert.equal(MAX_ACCOUNTS,2);
  for(const [list,id] of [[users,3],[[],1],[[...users,{id:3,username:'x'}],1]])assert.throws(()=>assertActiveAccount(list,id),{statusCode:403});
});
test('each login gets its own Claude Code config root; appuser keeps the native one',()=>{
  assert.equal(claudeConfigDir({id:1,username:'appuser'}),'/home/appuser/.claude');
  assert.equal(claudeConfigDir({id:2,username:'personal'}),'/home/appuser/cloudcli-runtime/data/tenants/2/claude');
  assert.equal(claudeConfigDir({id:'7',username:'appuser-work'}),'/home/appuser/cloudcli-runtime/data/tenants/7/claude');
  assert.throws(()=>claudeConfigDir(null));
  const second=hostQueryOptions({},{},claudeConfigDir({id:2,username:'personal'}));
  assert.equal(second.env.CLAUDE_CONFIG_DIR,'/home/appuser/cloudcli-runtime/data/tenants/2/claude');
  assert.equal(second.env.HOME,'/home/appuser');assert.equal(second.permissionMode,'bypassPermissions');
});
test('native execution preserves resume, MCP, hooks and effort without inherited tool restrictions',()=>{
  const mcpServers={example:{command:'example'}},hooks={Notification:[]};
  const options=hostQueryOptions({resume:'original',mcpServers,hooks,disallowedTools:['Bash'],maxTurns:1,effort:'high'},
    {PATH:'/home/appuser/.local/bin:/usr/bin',CLAUDE_CODE_EFFORT_LEVEL:'high',HTTPS_PROXY:'http://127.0.0.1:17890',CCWEB_SANDBOX:'old'});
  assert.equal(options.pathToClaudeCodeExecutable,HOST_CLI);
  assert.equal(options.permissionMode,'bypassPermissions');assert.equal(options.allowDangerouslySkipPermissions,true);
  assert.equal(options.sandbox.enabled,false);assert.equal(options.env.HOME,'/home/appuser');
  assert.equal(options.env.CLAUDE_CONFIG_DIR,'/home/appuser/.claude');
  assert.equal(options.env.CCWEB_SANDBOX,undefined);assert.equal(options.disallowedTools,undefined);assert.equal(options.maxTurns,undefined);
  assert.equal(options.mcpServers,mcpServers);assert.equal(options.hooks,hooks);assert.equal(options.resume,'original');assert.equal(options.effort,'high');
  assert.equal(options.env.HTTPS_PROXY,'http://127.0.0.1:17890');assert.equal(options.env.CLAUDE_CODE_EFFORT_LEVEL,'high');
  assert.equal(hostQueryOptions({permissionMode:'default'},{}).permissionMode,'default');
});

test('a restarted first prompt reports its new provider session once and keeps Query methods',async()=>{
  async function* stream(){yield {type:'system'};yield {type:'system',session_id:'new-1'};yield {type:'assistant',session_id:'new-1'};}
  const query=Object.assign(stream(),{interrupt(){return 'interrupted-'+this.marker;},marker:'q'});
  const seen=[],wrapped=watchProviderSession(query,id=>seen.push(id));
  const types=[];for await(const m of wrapped)types.push(m.type);
  assert.deepEqual(seen,['new-1']);assert.deepEqual(types,['system','system','assistant']);
  assert.equal(wrapped.interrupt(),'interrupted-q');
});
