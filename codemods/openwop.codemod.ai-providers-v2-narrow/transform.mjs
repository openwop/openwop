/**
 * openwop.codemod.ai-providers-v2-narrow — RFC 0169 rows C2.11 and C2.12: v2
 * narrows four `aiProviders` facets and renames `supported` to `providers`
 * (spec/v2/core/host-services.md §aiProviders). Rewrites the root `aiProviders`
 * record of a v1 discovery document:
 *   - `supported` → `providers` (C2.12); REFUSES a record carrying both with
 *     different values;
 *   - `selfHosted: string[]` → `true` when non-empty; dropped when empty;
 *   - `realtimeVoice: {transcription, synthesis, turnDetection?, bargeIn?}` →
 *     `true` when both `transcription` and `synthesis` are present; dropped when
 *     neither is; REFUSES exactly one (v2 `true` claims both, and the codemod
 *     will not over-claim or silently withdraw one);
 *   - `promptPrefixCache: {supported, providers?}` → `supported`, dropped when false;
 *   - `authModes: {provider: mode[]}` → the union of the modes, known modes in
 *     schema order, then any others sorted.
 * Refuses a facet whose value is neither the v1 shape nor already the v2 one.
 * Runs after discovery-document-v2 and the wrapper removal. Idempotent. Pure.
 */
export const id = 'openwop.codemod.ai-providers-v2-narrow';
export const inputSchema = 'schemas/capabilities.schema.json';

const MODES = ['apiKey', 'oauth-pkce', 'oauth-device', 'none', 'subscription'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const refuse = (why) => { throw new Error(`${id}: ${why}; refusing to guess`); };

export function transform(doc) {
  if (!isObj(doc)) throw new TypeError(`${id}: input must be a discovery document object`);
  if (!isObj(doc.aiProviders)) return doc;
  let ai = { ...doc.aiProviders };

  if ('supported' in ai) {
    if ('providers' in ai && JSON.stringify(ai.providers) !== JSON.stringify(ai.supported)) refuse('aiProviders carries both `supported` and `providers` with different values');
    const { supported, ...rest } = ai;
    ai = { providers: supported, ...rest };
  }

  if ('selfHosted' in ai && typeof ai.selfHosted !== 'boolean') {
    if (!Array.isArray(ai.selfHosted)) refuse(`selfHosted is ${JSON.stringify(ai.selfHosted)}`);
    if (ai.selfHosted.length > 0) ai.selfHosted = true; else delete ai.selfHosted;
  }

  if ('realtimeVoice' in ai && typeof ai.realtimeVoice !== 'boolean') {
    const rv = ai.realtimeVoice;
    if (!isObj(rv)) refuse(`realtimeVoice is ${JSON.stringify(rv)}`);
    const t = 'transcription' in rv; const s = 'synthesis' in rv;
    if (t !== s) refuse(`realtimeVoice advertises ${t ? 'transcription' : 'synthesis'} only; v2 \`true\` claims both`);
    if (t) ai.realtimeVoice = true; else delete ai.realtimeVoice;
  }

  if ('promptPrefixCache' in ai && typeof ai.promptPrefixCache !== 'boolean') {
    const pc = ai.promptPrefixCache;
    if (!isObj(pc) || typeof pc.supported !== 'boolean') refuse(`promptPrefixCache is ${JSON.stringify(pc)}`);
    if (pc.supported) ai.promptPrefixCache = true; else delete ai.promptPrefixCache;
  }

  if ('authModes' in ai && !Array.isArray(ai.authModes)) {
    if (!isObj(ai.authModes)) refuse(`authModes is ${JSON.stringify(ai.authModes)}`);
    const all = new Set();
    for (const [p, modes] of Object.entries(ai.authModes)) {
      if (!Array.isArray(modes) || modes.some((m) => typeof m !== 'string')) refuse(`authModes.${p} is not a list of modes`);
      for (const m of modes) all.add(m);
    }
    ai.authModes = [...MODES.filter((m) => all.has(m)), ...[...all].filter((m) => !MODES.includes(m)).sort()];
  }

  return { ...doc, aiProviders: ai };
}
