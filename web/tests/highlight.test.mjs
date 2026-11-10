import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {rehypeCodeHighlight} from '../src/highlight.mjs';

const render=source=>renderToStaticMarkup(React.createElement(Markdown,{remarkPlugins:[remarkGfm],rehypePlugins:[rehypeCodeHighlight]},source));

test('highlights fenced blocks with a registered language and keeps the exact text',()=>{
  const html=render('```js\nconst a = "x"; // note\n```');
  assert.match(html,/class="language-js hljs"/);
  assert.match(html,/<span class="hljs-keyword">const<\/span>/);
  assert.match(html,/<span class="hljs-comment">\/\/ note<\/span>/);
  assert.equal(html.replace(/<[^>]+>/g,''),'const a = &quot;x&quot;; // note\n');
});

test('leaves unknown, unlabeled and inline code as plain escaped text',()=>{
  for(const source of ['```brainfuck\n+[<b>]\n```','```\n<b>x</b>\n```']){
    const html=render(source);
    assert.doesNotMatch(html,/hljs/);
    assert.match(html,/&lt;b&gt;/);
  }
  assert.equal(render('use `npm ci` first'),'<p>use <code>npm ci</code> first</p>');
});

test('aliases such as sh, ts and html resolve to bundled grammars',()=>{
  for(const lang of ['sh','ts','html','py','yml'])assert.match(render(`\`\`\`${lang}\nx\n\`\`\``),/hljs/,lang);
});
