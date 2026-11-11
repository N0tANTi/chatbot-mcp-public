import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanTitle,firstExchange,generateTitle,titlePrompt,upstreamSessionName} from '../../integrations/cloudcli/session-titles.mjs';

test('first exchange skips slash commands, compaction rows and tool rows', () => {
  const rows = [
    {kind: 'text', role: 'user', content: '/compact'},
    {kind: 'text', role: 'user', content: '帮我比较这几本书'},
    {kind: 'tool_use', toolName: 'Read'},
    {kind: 'text', role: 'assistant', content: '这次压缩的摘要', isCompactSummary: true},
    {kind: 'text', role: 'assistant', content: '好的，先说结论。'},
  ];
  assert.deepEqual(firstExchange(rows), {user: '帮我比较这几本书', reply: '好的，先说结论。'});
  assert.equal(firstExchange(rows.slice(0, 3)), null);
  assert.equal(firstExchange([]), null);
});

test('titles are trimmed to one clean line', () => {
  assert.equal(cleanTitle('标题：“亲密关系的文本阅读”。\n其他'), '亲密关系的文本阅读');
  assert.equal(cleanTitle('**Comparing Essay Collections**'), 'Comparing Essay Collections');
  assert.equal(cleanTitle('《论调情》书单评价'), '《论调情》书单评价');
  assert.equal(cleanTitle('"Reading List".'), 'Reading List');
  assert.equal([...cleanTitle('长'.repeat(80))].length, 40);
  assert.equal(cleanTitle('  \n '), '');
  assert.match(titlePrompt({user: 'U', reply: 'R'}), /<用户>\nU\n<\/用户>[\s\S]*<助手>\nR\n<\/助手>/);
});

test('generation runs one tool-less turn and reads the result', async () => {
  let seen;
  const query = ({prompt, options}) => { seen = {prompt, options}; return (async function* () {
    yield {type: 'assistant'}; yield {type: 'result', subtype: 'success', result: '书单深度评估\n'};
  })(); };
  const title = await generateTitle({query, options: {model: 'haiku', cwd: '/x'}, exchange: {user: 'U', reply: 'R'}});
  assert.equal(title, '书单深度评估');
  assert.equal(seen.options.model, 'haiku');
  assert.deepEqual([seen.options.maxTurns, seen.options.allowedTools, seen.options.tools, seen.options.settingSources, seen.options.persistSession], [1, [], [], [], false]);
  assert.ok(seen.options.abortController instanceof AbortController);
});

test('placeholder name matches what upstream stores for a new chat', () => {
  assert.equal(upstreamSessionName('Leo Bersani & Adam Phillips 的书'), 'Leo Bersani & Adam');
  assert.equal(upstreamSessionName('测算  第一个 2026 年数据'), '测算 第一个 2026 年数据');
  assert.equal(upstreamSessionName('第一行\n\n第二行'), '第一行 第二行');
  assert.equal(upstreamSessionName('整段中文没有空格'), '整段中文没有空格');
  assert.equal(upstreamSessionName('  '), 'Untitled Session');
});
