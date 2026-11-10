// Helpers for generated-file links and conversation lists; no DOM access so they stay testable.
const raster = /\.(png|jpe?g|gif|webp)$/i;

// Accepts relative /download?project=&file= links, or absolute ones on this page's origin or the
// public site (Claude writes public URLs; a loopback tunnel entry must still recognize them).
const PUBLIC_ORIGIN = 'https://claude.example.com';
export function parseDownloadLink(href, origin = PUBLIC_ORIGIN) {
  try {
    const url = new URL(href, origin);
    if (![new URL(origin).origin, PUBLIC_ORIGIN].includes(url.origin) || url.pathname !== '/download') return null;
    const project = url.searchParams.get('project'), file = url.searchParams.get('file');
    return project && file ? {project, file, name: file.split('/').at(-1)} : null;
  } catch { return null; }
}
export const isPreviewable = name => raster.test(name || '');
const base = (project, kind, file) => `/api/core/generated/${encodeURIComponent(project)}/${kind}?file=${encodeURIComponent(file)}`;
export const previewUrl = (project, file) => base(project, 'preview', file);
export const contentUrl = (project, file) => base(project, 'content', file);

// SQLite CURRENT_TIMESTAMP is UTC without a zone marker.
export function parseTimestamp(value) {
  if (!value) return null;
  const text = String(value);
  const time = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : text.replace(' ', 'T') + 'Z');
  return Number.isNaN(time) ? null : time;
}
// Buckets by local calendar day, keeping the incoming order inside each bucket.
export function groupByRecency(sessions, now = Date.now()) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const today = start.getTime(), day = 86400000;
  const label = time => time === null ? '更早' : time >= today ? '今天' : time >= today - day ? '昨天' : time >= today - 6 * day ? '最近 7 天' : time >= today - 29 * day ? '最近 30 天' : '更早';
  const groups = [];
  for (const session of sessions) {
    const name = label(parseTimestamp(session.updatedAt));
    let group = groups.find(g => g.label === name);
    if (!group) groups.push(group = {label: name, sessions: []});
    group.sessions.push(session);
  }
  const order = ['今天', '昨天', '最近 7 天', '最近 30 天', '更早'];
  return groups.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
}
export function formatDuration(ms) {
  if (!(ms >= 1000)) return '';
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return h ? `${h} 小时 ${m} 分` : m ? `${m} 分 ${sec} 秒` : `${sec} 秒`;
}
