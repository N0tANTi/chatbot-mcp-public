// Short conversation titles, like claude.ai: one small model call after the first reply.
// Pure helpers are exported for tests; the caller supplies the SDK query and its options.
const text = m => typeof m?.content === 'string' ? m.content : '';
const ordinary = m => m?.kind === 'text' && !m.compact && !m.isCompactSummary && !m.isLocalCommand && !m.isLocalCommandStdout && text(m).trim() && !text(m).trim().startsWith('/');

// First user message and the start of the first reply after it; null until both exist.
export function firstExchange(messages, {user = 2000, reply = 800} = {}) {
  const at = messages.findIndex(m => ordinary(m) && m.role === 'user');
  if (at < 0) return null;
  const answer = messages.slice(at + 1).find(m => ordinary(m) && m.role === 'assistant');
  if (!answer) return null;
  return {user: text(messages[at]).trim().slice(0, user), reply: text(answer).trim().slice(0, reply)};
}

// Upstream's placeholder name for a new chat (buildCloudCliSessionName): the first four
// whitespace-separated words. Chats created before the seed stored it hold the raw 80 characters.
export const upstreamSessionName = seed => String(seed ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 4).join(' ') || 'Untitled Session';

export const titlePrompt = ({user, reply}) =>
  `下面是一段对话的开头。写一个简短的标题，概括用户想做的事或讨论的主题（不要复述助手的回答）：用与用户相同的语言；中文不超过 14 个字，英文不超过 6 个词；不要引号、句末标点或“标题：”之类的前缀。只输出标题本身。\n\n<用户>\n${user}\n</用户>\n\n<助手>\n${reply}\n</助手>`;

const WRAPS = [['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'], ['「', '」'], ['『', '』']];
export function cleanTitle(raw) {
  let line = String(raw || '').split('\n').map(s => s.trim()).find(Boolean) || '';
  line = line.replace(/^(?:标题|title)\s*[:：]\s*/i, '').replace(/^[#*\s]+|[*\s]+$/g, '').replace(/[。.!！?？,，;；:：]+$/, '').trim();
  // Quotes wrapping the whole title go; book-title marks inside it stay.
  for (const [open, close] of WRAPS) if (line.length > 2 && line.startsWith(open) && line.endsWith(close)) line = line.slice(1, -1).trim();
  line = line.replace(/[。.!！?？,，;；:：]+$/, '');
  return line ? [...line].slice(0, 40).join('') : '';
}

// Runs one tool-less turn and returns the cleaned title, or '' if the model gave nothing usable.
export async function generateTitle({query, options, exchange, timeoutMs = 45000}) {
  const abortController = new AbortController(), timer = setTimeout(() => abortController.abort(), timeoutMs);
  timer.unref?.();
  try {
    let result = '';
    for await (const m of query({prompt: titlePrompt(exchange), options: {...options, abortController, maxTurns: 1, allowedTools: [], tools: [], settingSources: [], persistSession: false,
      systemPrompt: '你为对话起简短的标题。只输出标题。'}})) {
      if (m.type === 'result' && m.subtype === 'success') result = m.result;
    }
    return cleanTitle(result);
  } finally { clearTimeout(timer); }
}
