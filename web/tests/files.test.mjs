import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDownloadLink,isPreviewable,previewUrl,groupByRecency,parseTimestamp,formatDuration} from '../src/files.mjs';

test('download links are recognized only on this origin and /download path',()=>{
  const href='https://claude.example.com/download?project=p-1&file=outputs%2F%E5%9B%BE.png';
  assert.deepEqual(parseDownloadLink(href),{project:'p-1',file:'outputs/图.png',name:'图.png'});
  assert.deepEqual(parseDownloadLink('/download?project=p&file=a.md'),{project:'p',file:'a.md',name:'a.md'});
  assert.equal(parseDownloadLink('https://evil.example/download?project=p&file=a.md'),null);
  assert.equal(parseDownloadLink('https://claude.example.com/other?project=p&file=a.md'),null);
  assert.equal(parseDownloadLink('/download?project=p'),null);
  assert.equal(parseDownloadLink('https://claude.example.com/download?project=p&file=a.md','http://127.0.0.1:13107')?.file,'a.md');
  assert.equal(parseDownloadLink('/download?project=p&file=a.md','http://127.0.0.1:13107')?.file,'a.md');
  assert.equal(previewUrl('p 1','a/b.png'),'/api/core/generated/p%201/preview?file=a%2Fb.png');
});

test('only raster images are previewable',()=>{
  for(const n of ['a.png','B.JPG','c.jpeg','d.gif','e.webp'])assert.ok(isPreviewable(n),n);
  for(const n of ['x.svg','y.pdf','z.png.html',''])assert.ok(!isPreviewable(n),n);
});

test('sessions group by local recency in a fixed order',()=>{
  const now=new Date(2026,9,19,15,0).getTime(),iso=d=>new Date(now-d*86400000).toISOString();
  const groups=groupByRecency([{id:1,updatedAt:iso(0)},{id:2,updatedAt:iso(1)},{id:3,updatedAt:iso(3)},{id:4,updatedAt:iso(20)},{id:5,updatedAt:iso(90)},{id:6}],now);
  assert.deepEqual(groups.map(g=>[g.label,g.sessions.map(s=>s.id)]),[['今天',[1]],['昨天',[2]],['最近 7 天',[3]],['最近 30 天',[4]],['更早',[5,6]]]);
  assert.equal(parseTimestamp('2026-10-19 07:00:00'),Date.parse('2026-10-19T07:00:00Z'));
  assert.equal(formatDuration(192000),'3 分 12 秒');assert.equal(formatDuration(500),'');assert.equal(formatDuration(3720000),'1 小时 2 分');
});
