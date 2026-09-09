/**
 * openwop.codemod.configurable-v2 — RFC 0171 §D.1 / row C4.12: the v1
 * `RunOptions.configurable` open map (15 reserved keys, 6 typed, four dotted)
 * becomes the closed, nested, versioned v2 object
 *   { version: 1, run: {…}, ai: {…}, distillation: {…}, budget, extensions: { <org>: {…} } }.
 * Input: a `configurable` object, or any object carrying one under
 * `configurable`. Reserved keys move to their section; a dotted `ai.x` or
 * `distillation.x` key nests; a vendor key `<org>.<name>` moves to
 * `extensions.<org>.<name>`; an unknown UNDOTTED key is refused (no org to
 * file it under — a codemod never invents a namespace). Idempotent. Pure.
 */
export const id = 'openwop.codemod.configurable-v2';
export const inputSchema = 'schemas/run-options.schema.json';
const RUN = new Set(['recursionLimit', 'runTimeoutMs', 'maxLoopIterations', 'escalationThreshold']);
const AI = new Set(['provider', 'model', 'temperature', 'maxTokens', 'credentialRef', 'promptOverrides', 'mockProvider', 'reasoningVerbosity', 'maxRefusals']);
const V2_KEYS = new Set(['version', 'run', 'ai', 'distillation', 'budget', 'extensions']);
function isV2(c) { return c.version === 1 && Object.keys(c).every((k) => V2_KEYS.has(k)); }
export function convert(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new TypeError(`${id}: configurable must be an object`);
  if (isV2(c)) return c;
  const out = { version: 1 }; const run = {}, ai = {}, dist = {}, ext = {};
  for (const [k, v] of Object.entries(c)) {
    if (RUN.has(k)) run[k] = v;
    else if (AI.has(k)) ai[k] = v;
    else if (k === 'budget') out.budget = v;
    else if (k.startsWith('ai.') && AI.has(k.slice(3))) ai[k.slice(3)] = v;
    else if (k === 'distillation.tokenBudget') dist.tokenBudget = v;
    else if (k.includes('.')) { const [org, ...rest] = k.split('.'); (ext[org] ??= {})[rest.join('.')] = v; }
    else throw new Error(`${id}: unknown undotted configurable key ${JSON.stringify(k)} — no org to file it under; refusing`);
  }
  if (Object.keys(run).length) out.run = run; if (Object.keys(ai).length) out.ai = ai; if (Object.keys(dist).length) out.distillation = dist; if (Object.keys(ext).length) out.extensions = ext;
  return out;
}
export function transform(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new TypeError(`${id}: input must be a configurable object or an object carrying one`);
  if ('configurable' in doc && doc.configurable && typeof doc.configurable === 'object') return { ...doc, configurable: convert(doc.configurable) };
  return convert(doc);
}
