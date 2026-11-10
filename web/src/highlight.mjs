import {createLowlight} from 'lowlight';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

// A small explicit grammar set keeps the bundle lean; other fenced languages render as plain text.
const lowlight=createLowlight({bash,css,diff,go,ini,javascript,json,markdown,python,rust,shell,sql,typescript,xml,yaml});

const text=node=>node.type==='text'?node.value:(node.children||[]).map(text).join('');

// Rehype plugin: highlight only fenced blocks that name a registered language; never guess.
export function rehypeCodeHighlight() {
  const walk=node=>{
    for(const child of node.children||[]){
      if(node.tagName==='pre'&&child.tagName==='code'){
        const classes=[].concat(child.properties?.className||[]);
        const language=classes.map(c=>/^language-(.+)$/.exec(c)?.[1]).find(Boolean);
        if(language&&lowlight.registered(language)){
          child.children=lowlight.highlight(language,text(child)).children;
          child.properties={...child.properties,className:[...classes,'hljs']};
        }
      }else walk(child);
    }
  };
  return walk;
}
