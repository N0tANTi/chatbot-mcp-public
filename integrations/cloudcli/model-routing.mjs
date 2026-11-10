export function effortCapabilities(model) {
  if(/^claude-(?:(?:opus|sonnet|fable)-5(?:-\d)?|haiku-5-5)(?:-\d{8})?$/.test(model)||/^claude-opus-4-7(?:-|$)/.test(model))
    return {levels:['low','medium','high','xhigh','max'],default:null};
  if(/^claude-opus-4-6(?:-|$)/.test(model))return {levels:['low','medium','high','max'],default:null};
  if(/^claude-(?:opus-4-5|sonnet-4-6)(?:-|$)/.test(model))return {levels:['low','medium','high'],default:null};
  return {levels:[],default:null};
}
// Validate at the boundary and again at invocation. Never silently map a stale
// UI choice to a different effort level on model switches.
export function resolveEffort(model, requested='auto', config=effortCapabilities(model)) {
  if(requested==='auto')return config.default ?? undefined;
  if(typeof requested!=='string'||!config.levels.includes(requested))throw new Error('当前模型不支持此推理强度，请重新选择');
  return requested;
}
export function reasoningOptions(model, requested, options, env, config) {
  const effort=resolveEffort(model,requested,config);
  const next={...options,env:{...env,CLAUDE_CODE_EFFORT_LEVEL:effort ?? 'auto'}};
  delete next.effort; // Do not inherit CloudCLI's model-specific default.
  if(effort)next.effort=effort;
  return next;
}
