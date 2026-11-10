// Canonical activity model shared by history and live replay. No HTML from tools.
export const visibleKinds = new Set(['text', 'error', 'thinking', 'tool', 'tool_use', 'tool_result', 'task_status']);
const identity = m => m.toolId || m.id;
export function mergeMessage(previous, message) {
  const rows = [...previous];
  const m = {...message};
  if (m.kind === 'stream_delta' || m.kind === 'thinking_delta') {
    const kind = m.kind === 'thinking_delta' ? 'thinking' : 'text';
    const last = rows.at(-1);
    if (last?._stream && last.kind === kind) rows[rows.length - 1] = {...last, content: last.content + (m.content || '')};
    else rows.push({...m, id: `stream-${m.runKey || ''}-${m.seq || m.id || rows.length}`, kind, role: 'assistant', _stream: true});
    return rows;
  }
  if (!visibleKinds.has(m.kind)) return rows;
  if (m.kind === 'task_status' && m.toolUseId) {
    const at = rows.findIndex(x => ['tool','tool_use'].includes(x.kind) && identity(x) === m.toolUseId);
    if (at >= 0) { rows[at] = {...rows[at], progress:m}; return rows; }
  }
  if (m.kind === 'tool_result') {
    const at = rows.findIndex(x => ['tool', 'tool_use'].includes(x.kind) && identity(x) === m.toolId);
    if (at >= 0) {
      rows[at] = {...rows[at], toolResult: {content: m.content, isError: m.isError, toolUseResult: m.toolUseResult}, completedAt: m.eventAt || m.timestamp};
      return rows;
    }
  }
  if (['text', 'thinking'].includes(m.kind) && m.role !== 'user') {
    // Final blocks replace their provisional stream, even when tool events arrived
    // between them. A user boundary stops us touching an earlier turn.
    for (let i = rows.length - 1; i >= 0 && rows[i].role !== 'user'; i--) {
      // The final block keeps the stream's render key, so it replaces the text in place.
      if (rows[i]._stream && rows[i].kind === m.kind) { m._key = rows[i]._key || rows[i].id; rows.splice(i, 1); break; }
    }
  }
  // SDK echoes an optimistic user prompt once. Do not duplicate it on reconnect.
  if (m.kind === 'text' && m.role === 'user') {
    const at = rows.findIndex(x => x._local && x.content === m.content);
    if (at >= 0) { rows[at] = {...m, _key: rows[at]._key || rows[at].id}; return rows; }
  }
  const at = rows.findIndex(x => (m.id && x.id === m.id) ||
    (m.kind === 'task_status' && m.taskId && x.kind === m.kind && x.taskId === m.taskId) ||
    (m.toolId && ['tool_use', 'tool'].includes(m.kind) && ['tool_use', 'tool'].includes(x.kind) && identity(x) === m.toolId));
  if (at >= 0) rows[at] = {...rows[at], ...m};
  else rows.push(m);
  // A reconnect may replay a result before its tool call is fetched.
  if (['tool_use', 'tool'].includes(m.kind)) {
    const result = rows.find(x => x.kind === 'tool_result' && x.toolId === identity(m));
    if (result) {
      const index = rows.findIndex(x => identity(x) === identity(m) && x.kind !== 'tool_result');
      rows[index] = {...rows[index], toolResult: {content: result.content, isError: result.isError}};
      return rows.filter(x => x !== result);
    }
  }
  return rows;
}
export function historyMessages(messages) {
  return messages.reduce((rows, m) => mergeMessage(rows, m), []);
}
export function toolSummary(m) {
  const input = m.toolInput || {};
  if (typeof input === 'string') return input;
  return input.description || (input.file_path ? String(input.file_path).split(/[\\/]/).at(-1) : '') || input.path || input.pattern || input.query || input.command || input.subject || m.toolName || '工具活动';
}
export function outputText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(x => x?.type === 'text' ? x.text : x?.type === 'image' ? '[图片结果]' : JSON.stringify(x)).join('\n');
  return JSON.stringify(value, null, 2);
}
// Consecutive non-text activity between messages collapses into one group, like Claude's web UI.
export function groupFeed(rows) {
  const out = [];
  rows.forEach((message, index) => {
    if (message.kind === 'text' || message.kind === 'error') { out.push({type: 'message', message, index}); return; }
    const last = out.at(-1);
    if (last?.type === 'activity') last.items.push({message, index});
    else out.push({type: 'activity', key: `activity-${message._key || message.toolId || message.id || index}`, items: [{message, index}]});
  });
  return out;
}
const phrases = {
  thinking: n => `思考 ${n} 次`, task_status: n => `后台任务 ${n} 项`,
  Bash: n => `执行 ${n} 个命令`, Read: n => `读取 ${n} 个文件`, Write: n => `写入 ${n} 个文件`, Edit: n => `修改文件 ${n} 次`,
  MultiEdit: n => `修改文件 ${n} 次`, Grep: n => `搜索内容 ${n} 次`, Glob: n => `查找文件 ${n} 次`, WebSearch: n => `搜索网页 ${n} 次`,
  WebFetch: n => `读取 ${n} 个网页`, TodoWrite: n => `更新任务 ${n} 次`, Agent: n => `启动 ${n} 个子任务`, Task: n => `启动 ${n} 个子任务`,
};
// Summary counts only what actually happened, in first-seen order; long tails become "等".
export function activitySummary(messages) {
  const counts = new Map();
  for (const m of messages) {
    const key = m.kind === 'thinking' || m.kind === 'task_status' ? m.kind : m.toolName || '工具';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const parts = [...counts].map(([key, n]) => phrases[key]?.(n) || `${key} ×${n}`);
  return parts.length > 3 ? `${parts.slice(0, 3).join('，')} 等` : parts.join('，');
}
const isUser = g => g.type === 'message' && g.message.role === 'user';
const time = m => { const t = Date.parse(m?.timestamp || m?.eventAt || ''); return Number.isNaN(t) ? null : t; };
// A finished turn folds everything before its final answer into one process block, like
// Claude's "Worked for …". The live turn (keepLast) stays expanded so progress is visible.
export function collapseTurns(groups, {keepLast = false} = {}) {
  const out = [];
  for (let i = 0; i < groups.length;) {
    if (isUser(groups[i])) { out.push(groups[i++]); continue; }
    let j = i;
    while (j < groups.length && !isUser(groups[j])) j++;
    const segment = groups.slice(i, j), last = j === groups.length;
    const finalAt = segment.findLastIndex(g => g.type === 'message' && g.message.kind === 'text' && g.message.role !== 'user');
    const before = segment.slice(0, Math.max(finalAt, 0));
    if (finalAt > 0 && before.some(g => g.type === 'activity') && !(keepLast && last)) {
      const first = before[0], user = out.at(-1)?.message;
      out.push({type: 'process', key: `process-${first.type === 'activity' ? first.key : first.message._key || first.message.id || first.index}`, groups: before,
        messages: before.flatMap(g => g.type === 'activity' ? g.items.map(x => x.message) : []),
        startedAt: time(user), endedAt: time(segment[finalAt].message)}, ...segment.slice(finalAt));
    } else out.push(...segment);
    i = j;
  }
  return out;
}
const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
// Assigns each validated generated file to the latest loaded turn that wrote or cited it,
// so cards sit under the answer that produced them. Keys are the turn's user-row index.
export function filesByTurn(rows, projectPath, files, {complete = true} = {}) {
  const known = new Map((files || []).map(f => [f.path, f])), owner = new Map();
  const relative = p => typeof p !== 'string' ? null : projectPath && p.startsWith(projectPath + '/') ? p.slice(projectPath.length + 1) : p.replace(/^\.\//, '');
  let turn = -1, lastTurn = -1;
  rows.forEach((m, i) => {
    if (m.kind === 'text' && m.role === 'user') { turn = lastTurn = i; return; }
    const refs = [];
    if (['tool_use', 'tool'].includes(m.kind) && WRITE_TOOLS.includes(m.toolName) && m.toolResult && !m.toolResult.isError) refs.push(relative(m.toolInput?.file_path || m.toolInput?.notebook_path));
    if (m.kind === 'text' && typeof m.content === 'string')
      for (const match of m.content.matchAll(/\/download\?[^\s)<>"`]+/g)) {
        try { refs.push(new URL(match[0], 'http://local.invalid').searchParams.get('file')); } catch {}
      }
    for (const ref of refs) if (known.has(ref)) owner.set(ref, turn);
  });
  // Files from turns that are not loaded yet appear once those turns load; with full history, keep them visible.
  if (complete) for (const path of known.keys()) if (!owner.has(path)) owner.set(path, lastTurn);
  const out = new Map();
  for (const [path, at] of owner) out.set(at, [...(out.get(at) || []), known.get(path)]);
  return out;
}
// Inserts a files group after the last display group of each turn.
export function withTurnFiles(groups, byTurn) {
  if (!byTurn.size) return groups;
  const out = [];let turn = -1;
  const flush = () => { const files = byTurn.get(turn); if (files?.length) out.push({type: 'files', key: `files-${turn}`, files}); };
  for (const g of groups) {
    if (g.type === 'message' && g.message.role === 'user') { flush(); turn = g.index; }
    out.push(g);
  }
  flush();
  return out;
}
