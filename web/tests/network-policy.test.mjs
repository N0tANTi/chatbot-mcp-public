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
