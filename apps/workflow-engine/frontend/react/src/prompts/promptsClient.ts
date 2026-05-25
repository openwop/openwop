/**
 * Client for the prompt library — proposed `GET /v1/prompts` + related
 * surfaces from RFC 0028. Until a host advertises `capabilities.prompts`,
 * every method falls back to the local sample library in `samplePrompts.ts`.
 *
 * When the backend lands, the only behavioral change visible to callers
 * is that `listPrompts()` starts returning host-resident templates instead
 * of the sample list. Component callsites don't change.
 */

import { authedHeaders, config, fetchOpts } from '../client/config.js';
import { getCapabilities } from '../client/runsClient.js';
import { SAMPLE_PROMPTS } from './samplePrompts.js';
import { listUserPrompts } from './userPrompts.js';
import type { PromptKind, PromptRef, PromptTemplate } from './types.js';
import { parseRef } from './types.js';

interface ListResponse {
  items: PromptTemplate[];
  nextCursor?: string;
}

export interface ListPromptsFilter {
  kind?: PromptKind;
  tag?: string;
  modelClass?: string;
  source?: 'host' | 'pack' | 'user';
}

const ENDPOINT_BASE = `${config.baseUrl}/v1/prompts`;

/** Returns true when the host advertises RFC 0027 prompts support. The
 *  result is cached for the page lifetime — the capability is a wire-shape
 *  decision the host makes at boot time, so it shouldn't change mid-session.
 *
 *  Known limitation: if a sign-in flow swaps the auth identity (anon →
 *  signed-in) and per-tenant capability advertisement actually differs
 *  between identities, the cache will return stale results until the
 *  next page reload. That's an acceptable simplification because (a)
 *  the workflow-engine sample doesn't currently advertise differently
 *  per-tenant, and (b) the openwop spec treats capability advertisement
 *  as a host-boot decision, not a per-request one. If a future host
 *  does need tenant-scoped capabilities, clear the cache from
 *  `setCurrentIdToken` in `client/config.ts`. */
let cachedSupport: boolean | null = null;
async function hostSupportsPrompts(): Promise<boolean> {
  if (cachedSupport !== null) return cachedSupport;
  try {
    // Routes through the SDK's `client.discovery.capabilities()` per
    // `sdk/PARITY.md` (Discovery row, always-on helper). The SDK handles
    // auth headers + cookie credentials + the response-shape contract.
    const caps = (await getCapabilities()) as {
      capabilities?: { prompts?: { supported?: boolean } };
    };
    cachedSupport = caps?.capabilities?.prompts?.supported === true;
  } catch {
    cachedSupport = false;
  }
  return cachedSupport;
}

export async function listPrompts(filter: ListPromptsFilter = {}): Promise<PromptTemplate[]> {
  if (await hostSupportsPrompts()) {
    const params = new URLSearchParams();
    if (filter.kind) params.set('kind', filter.kind);
    if (filter.tag) params.set('tag', filter.tag);
    if (filter.modelClass) params.set('modelClass', filter.modelClass);
    if (filter.source) params.set('source', filter.source);
    const query = params.toString();
    const url = `${ENDPOINT_BASE}${query ? `?${query}` : ''}`;
    try {
      const res = await fetch(url, fetchOpts({ headers: authedHeaders() }));
      if (res.ok) {
        const body = (await res.json()) as ListResponse;
        // BE has canonical entries → return them merged with user
        // prompts (user prompts ride along regardless of BE state).
        if (body.items.length > 0) {
          return applyFilter([...listUserPrompts(), ...body.items], filter);
        }
        // BE returned empty — same as the old "no canonical set yet"
        // fallback. Drop through to the sample-library merge below.
      }
    } catch {
      /* fall through to samples */
    }
  }
  // No host support OR BE empty OR fetch errored — merge user prompts
  // on top of the bundled samples so users see both groups in one list.
  // Without this fallback, a user with no user-prompts and a BE that
  // returns `{items:[]}` would see an empty prompt library.
  return applyFilter([...listUserPrompts(), ...SAMPLE_PROMPTS], filter);
}

export async function getPrompt(templateId: string, version?: string): Promise<PromptTemplate | null> {
  if (await hostSupportsPrompts()) {
    const params = new URLSearchParams();
    if (version) params.set('version', version);
    const url = `${ENDPOINT_BASE}/${encodeURIComponent(templateId)}${
      params.toString() ? `?${params.toString()}` : ''
    }`;
    try {
      const res = await fetch(url, fetchOpts({ headers: authedHeaders() }));
      if (res.ok) {
        return (await res.json()) as PromptTemplate;
      }
    } catch {
      /* fall through to samples */
    }
  }
  return resolveLocal(templateId, version);
}

export async function getPromptByRef(ref: PromptRef): Promise<PromptTemplate | null> {
  const parsed = typeof ref === 'string'
    ? parseRef(ref)
    : { templateId: ref.templateId, version: ref.version };
  if (!parsed) return null;
  return getPrompt(parsed.templateId, parsed.version);
}

function resolveLocal(templateId: string, version?: string): PromptTemplate | null {
  // User-authored prompts shadow same-id samples (rare given the
  // `user:` prefix on user-ids, but coherent if a future BE adds a
  // canonical store that happens to collide).
  const pool = [...listUserPrompts(), ...SAMPLE_PROMPTS];
  const matches = pool.filter((p) => p.templateId === templateId);
  if (matches.length === 0) return null;
  if (!version) return matches[0]!;
  return matches.find((p) => p.version === version) ?? null;
}

function applyFilter(prompts: PromptTemplate[], filter: ListPromptsFilter): PromptTemplate[] {
  return prompts.filter((p) => {
    if (filter.kind && p.kind !== filter.kind) return false;
    if (filter.tag && !(p.tags ?? []).includes(filter.tag)) return false;
    if (filter.modelClass && p.modelHints?.modelClass !== filter.modelClass) return false;
    if (filter.source && p.meta?.source !== filter.source) return false;
    return true;
  });
}

/** Local-only template rendering for the inspector preview. Substitutes
 *  `{{var}}` placeholders with the supplied bindings; unresolved required
 *  variables raise; unresolved optional variables render as empty string
 *  (matching RFC 0027's `onUnresolved: 'empty'` semantics). Computes a
 *  sha256 hash of the rendered body so the preview stays consistent with
 *  the future `POST /v1/prompts:render` deterministic-render invariant. */
export function renderLocal(
  template: PromptTemplate,
  variables: Record<string, unknown>,
): { rendered: string; missingRequired: string[] } {
  const missingRequired: string[] = [];
  const rendered = template.text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    if (name in variables) return String(variables[name] ?? '');
    const decl = (template.variables ?? []).find((v) => v.name === name);
    if (decl) {
      if (decl.required) missingRequired.push(name);
      if (decl.defaultValue !== undefined) return String(decl.defaultValue);
    }
    return '';
  });
  return { rendered, missingRequired };
}
