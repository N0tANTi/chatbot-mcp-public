import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {listMemory,memoryRoots,saveMemory,validMemoryName,writeMemory} from '../../integrations/cloudcli/memory-files.mjs';

test('memory names stay Markdown inside their root',()=>{
  for(const ok of ['MEMORY.md','notes/a.md'])assert.ok(validMemoryName(ok),ok);
  for(const bad of ['../x.md','/etc/x.md','.hidden.md','a/.b/c.md','x.txt','a\\\\b.md','',`${'a'.repeat(200)}.md`])assert.ok(!validMemoryName(bad),bad);
});
test('roots separate the project folder from each login automatic memory',()=>{
  const roots=memoryRoots({cwd:'/data/tenants/2/projects/p1'},'/data/tenants/2/claude');
  assert.equal(roots.instructions,'/data/tenants/2/projects/p1');
  assert.equal(roots.project,'/data/tenants/2/projects/p1/memory');
  assert.equal(roots.auto,'/data/tenants/2/claude/projects/-data-tenants-2-projects-p1/memory');
});
test('write is atomic, lists both sources and refuses links',async()=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'memory-test-'));
  try{
    const roots={project:path.join(base,'p'),auto:path.join(base,'a')};
    await writeMemory(roots.project,'MEMORY.md','# 项目\n');await writeMemory(roots.auto,'sub/x.md','auto');
    await writeMemory(roots.project,'MEMORY.md','# 改过\n');
    const files=await listMemory(roots);
    assert.deepEqual(files.map(f=>[f.source,f.name,f.content]),[['project','MEMORY.md','# 改过\n'],['auto','sub/x.md','auto']]);
    assert.equal((await fs.stat(path.join(roots.project,'MEMORY.md'))).mode&0o777,0o600);
    await fs.symlink('/etc',path.join(roots.project,'link'));
    await assert.rejects(writeMemory(roots.project,'link/x.md','x'),{statusCode:400});
    await assert.rejects(writeMemory(roots.project,'../escape.md','x'),{statusCode:400});
    assert.deepEqual((await fs.readdir(roots.project)).sort(),['MEMORY.md','link']);
  }finally{await fs.rm(base,{recursive:true,force:true});}
});

test('CLAUDE.md is the always-loaded entry; new project memory can be imported once',async()=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'memory-test-'));
  try{
    const roots={instructions:base,project:path.join(base,'memory'),auto:path.join(base,'auto')};
    await fs.writeFile(path.join(base,'CLAUDE.md'),'# 项目\n');await fs.writeFile(path.join(base,'other.md'),'not memory');
    await saveMemory(roots,{source:'project',name:'背景.md',content:'长期背景',reference:true});
    await saveMemory(roots,{source:'project',name:'背景.md',content:'改过',reference:true});
    assert.equal(await fs.readFile(path.join(base,'CLAUDE.md'),'utf8'),'# 项目\n\n@memory/背景.md\n');
    await assert.rejects(saveMemory(roots,{source:'instructions',name:'other.md',content:'x'}),{statusCode:400});
    await assert.rejects(saveMemory(roots,{source:'elsewhere',name:'a.md',content:'x'}),{statusCode:400});
    const files=await listMemory(roots);
    assert.deepEqual(files.map(f=>[f.source,f.name]),[['instructions','CLAUDE.md'],['project','背景.md']]);
  }finally{await fs.rm(base,{recursive:true,force:true});}
});

test('new projects carry the memory habit; adding it twice is a no-op',async()=>{
  const {projectClaudeMd,withMemoryHabit,hasMemoryHabit,MEMORY_HABIT_HEADING}=await import('../../integrations/cloudcli/project-template.mjs');
  const md=projectClaudeMd('周报\n项目');
  assert.ok(md.startsWith('# 周报 项目\n'));assert.ok(hasMemoryHabit(md));
  const old='# 旧项目\n\n仅处理当前项目中的资料。\n';
  const once=withMemoryHabit(old);assert.ok(once.startsWith(old.trimEnd()+'\n\n'+MEMORY_HABIT_HEADING));
  assert.equal(withMemoryHabit(once),once);assert.ok(hasMemoryHabit(withMemoryHabit('')));
});
test('conversation digest keeps only dialogue, newest first, within limits',async()=>{
  const {conversationDigest}=await import('../../integrations/cloudcli/memory-files.mjs');
  const conv=(title,texts)=>({title,updatedAt:'2026-10-19 08:00:00',messages:texts});
  const d=conversationDigest([
    conv('新',[{kind:'text',role:'user',content:'代号 TEAL'},{kind:'tool_use',toolName:'Bash'},{kind:'text',role:'assistant',content:'好的'},{kind:'text',role:'user',content:'/compact'},{kind:'text',role:'assistant',content:'Compacted',compact:{phase:'done'}}]),
    conv('空',[{kind:'tool_use',toolName:'Read'}]),
    conv('旧',[{kind:'text',role:'user',content:'x'.repeat(3000)}]),
  ]);
  assert.equal(d.conversations,2);
  assert.ok(d.text.indexOf('## 新（2026-10-19）')<d.text.indexOf('## 旧'));
  assert.ok(d.text.includes('**我**：代号 TEAL')&&d.text.includes('**Claude**：好的'));
  assert.ok(!d.text.includes('/compact')&&!d.text.includes('Compacted'));
  assert.ok(d.text.includes('x'.repeat(1500)+'…')&&!d.text.includes('x'.repeat(1501)));
  assert.equal(conversationDigest([conv('a',[{kind:'text',role:'user',content:'y'.repeat(1400)}]),conv('b',[{kind:'text',role:'user',content:'z'}])],{limit:1000}).conversations,1);
});
