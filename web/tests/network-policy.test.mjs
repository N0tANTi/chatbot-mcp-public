import {test} from 'node:test';
import assert from 'node:assert/strict';
import {networkEnvironment,providerJSON,PROXY_URL} from '../../integrations/cloudcli/network-policy.mjs';

test('CC proxy mode replaces conflicting inherited proxies without changing provider credentials',()=>{
  const original={https_proxy:'http://wrong',HTTP_PROXY:'http://wrong',ALL_PROXY:'socks://wrong',no_proxy:'*',ANTHROPIC_AUTH_TOKEN:'fixture-only',ANTHROPIC_BASE_URL:'https://provider.invalid'};
  const on=networkEnvironment('on',original);
  assert.throws(()=>networkEnvironment('off',original));
  assert.equal(on.HTTPS_PROXY,PROXY_URL);assert.equal(on.HTTP_PROXY,PROXY_URL);assert.equal(on.NO_PROXY,'localhost,127.0.0.1,::1');
  assert(!('https_proxy' in on));assert(!('ALL_PROXY' in on));assert(!('no_proxy' in on));
assert.equal(on.ANTHROPIC_AUTH_TOKEN,original.ANTHROPIC_AUTH_TOKEN);
assert.equal(original.no_proxy,'*');
  assert.throws(()=>networkEnvironment('unexpected',original));
});
test('model discovery rejects unsupported transport and malformed proxy policy before opening a connection',()=>{
  assert.throws(()=>providerJSON('http://provider.invalid',{mode:'on'}));
  assert.throws(()=>providerJSON('https://provider.invalid',{mode:'unknown'}));
});

import {validateModelProvider,providerEnvironment,packyModelDetails,cleanProviderEnvironment} from '../../integrations/cloudcli/official-account.mjs';
import {networkMode} from '../../integrations/cloudcli/network-policy.mjs';
test('Packy direct transport cannot carry OAuth or inherited proxies',async()=>{
  const config=validateModelProvider({provider:'packy',baseUrl:'https://cf.api.fan',apiKey:'synthetic-fixture-key'});
  assert.equal(await networkMode('packy'),'packy-direct');
  const ambient=cleanProviderEnvironment({CLAUDE_CODE_OAUTH_TOKEN:'synthetic-oauth',ANTHROPIC_API_KEY:'stale-key',HTTPS_PROXY:'http://invalid',all_proxy:'http://invalid',PATH:'test'});
  const env=networkEnvironment('packy-direct',{...ambient,...await providerEnvironment(config)});
  assert.equal(env.ANTHROPIC_AUTH_TOKEN,'synthetic-fixture-key');
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN,undefined);assert.equal(env.ANTHROPIC_API_KEY,undefined);
  assert(!Object.keys(env).some(k=>/proxy/i.test(k)));assert.equal(env.PATH,'test');
  assert.throws(()=>validateModelProvider({...config,baseUrl:'https://unrelated.example'}));
  assert.throws(()=>validateModelProvider({...config,apiKey:''}));
  assert.throws(()=>validateModelProvider({provider:'unknown'}));
  assert.throws(()=>providerJSON('https://api.anthropic.com/v1/models',{mode:'packy-direct'}));
});
test('Packy catalog retains exact historical model IDs and advertises only available aliases',()=>{
  const details=packyModelDetails({data:[{id:'claude-opus-5-5'},{id:'claude-opus-5-5'},{id:'claude-haiku-5-5'},{id:'unrelated'},{id:'bad/id'}]});
  assert.deepEqual(details.map(x=>x.value),['claude-opus-5-5','claude-haiku-5-5','default','opus','haiku']);
  assert.equal(details.find(x=>x.value==='opus').resolvedModel,'claude-opus-5-5');
  assert.deepEqual(packyModelDetails({}),[]);
});
