// Adapt the public SDK stream, without exposing raw SDK envelopes or credentials.
export function createActivityNormalizer(normalize) {
  return (raw, sessionId) => {
    const event = raw?.type === 'stream_event' ? raw.event : raw;
    if (event?.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
      return [{kind:'thinking_delta', content:event.delta.thinking || '', sessionId}];
    }
    if (raw?.type === 'tool_progress') {
      return [{kind:'task_status', id:`tool-progress-${raw.tool_use_id}`, taskId:raw.tool_use_id, toolUseId:raw.tool_use_id,
        toolName:raw.tool_name, status:'running', description:'工具仍在执行',
        elapsedSeconds:raw.elapsed_time_seconds, sessionId}];
    }
    return normalize(event, sessionId);
  };
}
export function runActivity(run) {
  if (!run) return null;
  const events = run.events || [];
  const last = [...events].reverse().find(e => ['stream_delta','thinking_delta','thinking','tool_use','tool','tool_result','task_status','permission_request','permission_resolved','text','error','complete'].includes(e.kind));
  const tools = new Map();
  for (const e of events) {
    if (e.kind === 'tool_use' || e.kind === 'tool') tools.set(e.toolId || e.id, e.toolName);
    if (e.kind === 'tool_result') tools.delete(e.toolId);
  }
  let label = '等待服务响应';
  if (tools.size) label = `正在执行 ${[...tools.values()].at(-1)}`;
  else if (last?.kind === 'tool_result') label = '工具已返回，等待下一步';
  else if (['thinking','thinking_delta'].includes(last?.kind)) label = '正在思考';
  else if (['text','stream_delta'].includes(last?.kind)) label = '正在回复';
  return {runKey:run.runKey, startedAt:run.startedAt, completedAt:run.completedAt,
    lastEventAt:last?.eventAt || run.startedAt, label,
    aborted:Boolean(events.findLast(e=>e.kind === 'complete')?.aborted),
    outcome:events.some(e=>e.kind === 'error')?'error':events.findLast(e=>e.kind === 'complete')?.exitCode,
  };
}
