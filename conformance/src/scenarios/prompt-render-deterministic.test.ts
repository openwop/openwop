/**
 * prompt-render-deterministic — RFC 0028 §A deterministic-hash invariant.
 *
 * Asserts: two calls to `POST /v1/prompts:render` with identical
 * `(ref, variables, contentTrust)` inputs MUST produce identical
 * `hash` AND identical `variableHashes`. Different variables MUST
 * produce different `variableHashes` for the changed keys (and a
 * different overall `hash`). The deterministic-render invariant
 * mirrors the `prompt.composed` replay invariant per RFC 0027 §F.
 *
 * Capability-gated: skips when the host doesn't advertise
 * `capabilities.prompts.endpointsSupported: true`.
 *
 * HTTP-driven: skips when no `OPENWOP_BASE_URL` is configured.
 *
 * Under `OPENWOP_REQUIRE_BEHAVIOR=true`, the capability gate hardens
 * from SKIP to FAIL.
 *
 * @see spec/v1/prompts.md §"Discovery & distribution" — Deterministic-render invariant
 * @see RFCS/0028-prompt-library-endpoints.md §A
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';

interface DiscoveryDoc {
  capabilities?: {
    prompts?: {
      supported?: unknown;
      endpointsSupported?: unknown;
    };
  };
}

interface RenderResponse {
  composed?: string;
  hash: string;
  refs: string[];
  variableHashes: Record<string, string>;
  contentTrust?: 'trusted' | 'untrusted';
}

interface PromptTemplate {
  templateId: string;
  version: string;
  kind: string;
  text: string;
  variables?: Array<{ name: string; required?: boolean; source?: string }>;
}

interface ListResponse {
  items: PromptTemplate[];
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  const res = await driver.get('/.well-known/openwop');
  if (res.status !== 200) return null;
  return res.json as DiscoveryDoc;
}

function endpointsSupported(d: DiscoveryDoc | null): boolean {
  return d?.capabilities?.prompts?.endpointsSupported === true;
}

/** Pick a template that has at least one input-source variable
 *  (so we can vary the binding). Prefer host-source so we don't
 *  depend on user-created templates from prior runs. Skip
 *  secret-source variables — those need BYOK provisioning. */
async function pickTemplateWithInputVar(): Promise<PromptTemplate | null> {
  const res = await driver.get('/v1/prompts?source=host&limit=200');
  if (res.status !== 200) return null;
  const body = res.json as ListResponse;
  for (const t of body.items) {
    const hasInputVar = (t.variables ?? []).some(
      (v) => v.source !== 'secret' && v.required === true,
    );
    if (hasInputVar) return t;
  }
  // Fall back: any template (even with no required vars works for the
  // identity-of-hash assertion; just no negative-control sub-test).
  return body.items[0] ?? null;
}

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

describe.skipIf(HTTP_SKIP)('prompt-render-deterministic: hash stable across identical inputs (RFC 0028 §A)', () => {
  it('identical (ref, variables) inputs produce identical hash + variableHashes', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-endpoints', endpointsSupported(d))) return;

    const template = await pickTemplateWithInputVar();
    if (!template) return;

    const variableNames = (template.variables ?? [])
      .filter((v) => v.source !== 'secret')
      .map((v) => v.name);

    // Build a binding set that satisfies every non-secret variable.
    const variables: Record<string, unknown> = {};
    for (const name of variableNames) variables[name] = `conformance-${name}-value`;

    const ref = `prompt:${template.templateId}@${template.version}`;
    const first = await driver.post('/v1/prompts:render', { ref, variables });
    if (first.status !== 200) return;
    const second = await driver.post('/v1/prompts:render', { ref, variables });
    expect(second.status).toBe(200);

    const a = first.json as RenderResponse;
    const b = second.json as RenderResponse;

    expect(
      a.hash,
      driver.describe(
        'spec/v1/prompts.md §Discovery & distribution',
        'render hash MUST be stable across identical (ref, variables) inputs',
      ),
    ).toBe(b.hash);
    expect(
      Object.keys(a.variableHashes).sort(),
      driver.describe(
        'spec/v1/prompts.md §Discovery & distribution',
        'variableHashes key set MUST be stable',
      ),
    ).toEqual(Object.keys(b.variableHashes).sort());
    for (const k of Object.keys(a.variableHashes)) {
      expect(a.variableHashes[k]).toBe(b.variableHashes[k]);
    }
  });

  it('different variable values produce different hash + at least one different variableHash', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-endpoints', endpointsSupported(d))) return;

    const template = await pickTemplateWithInputVar();
    if (!template) return;
    const requiredVars = (template.variables ?? []).filter(
      (v) => v.source !== 'secret' && v.required === true,
    );
    if (requiredVars.length === 0) return; // no required var to toggle

    const variables: Record<string, unknown> = {};
    for (const v of template.variables ?? []) {
      if (v.source === 'secret') continue;
      variables[v.name] = `conformance-${v.name}-baseline`;
    }

    const ref = `prompt:${template.templateId}@${template.version}`;
    const baseline = await driver.post('/v1/prompts:render', { ref, variables });
    if (baseline.status !== 200) return;

    // Toggle one required variable.
    const toggled = { ...variables, [requiredVars[0]!.name]: 'conformance-toggled-value' };
    const altered = await driver.post('/v1/prompts:render', { ref, variables: toggled });
    expect(altered.status).toBe(200);

    const a = baseline.json as RenderResponse;
    const b = altered.json as RenderResponse;

    expect(
      a.hash,
      driver.describe(
        'spec/v1/prompts.md §Discovery & distribution',
        'render hash MUST differ when any variable binding differs',
      ),
    ).not.toBe(b.hash);
    expect(
      a.variableHashes[requiredVars[0]!.name],
      driver.describe(
        'spec/v1/prompts.md §Discovery & distribution',
        'variableHashes[name] MUST differ when name binding differs',
      ),
    ).not.toBe(b.variableHashes[requiredVars[0]!.name]);
  });

  it('hash + variableHashes MUST match sha256:<hex64> pattern', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-endpoints', endpointsSupported(d))) return;

    const template = await pickTemplateWithInputVar();
    if (!template) return;
    const variables: Record<string, unknown> = {};
    for (const v of template.variables ?? []) {
      if (v.source === 'secret') continue;
      variables[v.name] = `conformance-${v.name}-shape`;
    }
    const ref = `prompt:${template.templateId}@${template.version}`;
    const res = await driver.post('/v1/prompts:render', { ref, variables });
    if (res.status !== 200) return;
    const r = res.json as RenderResponse;

    expect(
      /^sha256:[0-9a-f]{64}$/.test(r.hash),
      driver.describe(
        'schemas/run-event-payloads.schema.json §promptComposed.hash',
        'hash MUST match `^sha256:[0-9a-f]{64}$`',
      ),
    ).toBe(true);
    for (const [name, h] of Object.entries(r.variableHashes)) {
      expect(
        /^sha256:[0-9a-f]{64}$/.test(h),
        `variableHashes[${name}] MUST match sha256:<hex64>; got ${h}`,
      ).toBe(true);
    }
  });

  it('renders few-shot + schema-hint kinds with non-empty `composed` body', async () => {
    // RFC 0028 §A says `composed` is the full body regardless of kind.
    // Regression pin for the rendering-bug fix: few-shot and
    // schema-hint templates SHOULD surface a body, not the empty
    // string (which the kind-specific systemPrompt/userPrompt fields
    // would yield by themselves for these kinds).
    const d = await readDiscovery();
    if (!behaviorGate('prompts-endpoints', endpointsSupported(d))) return;
    const list = await driver.get('/v1/prompts?source=host&limit=200');
    if (list.status !== 200) return;
    const body = list.json as ListResponse;
    const nonSystemUser = body.items.find(
      (t) => t.kind === 'few-shot' || t.kind === 'schema-hint',
    );
    if (!nonSystemUser) return; // host doesn't ship one — soft-skip

    const variables: Record<string, unknown> = {};
    for (const v of nonSystemUser.variables ?? []) {
      if (v.source === 'secret') continue;
      variables[v.name] = 'conformance-value';
    }
    const ref = `prompt:${nonSystemUser.templateId}@${nonSystemUser.version}`;
    const res = await driver.post('/v1/prompts:render', { ref, variables });
    if (res.status !== 200) return;
    const r = res.json as RenderResponse;
    expect(
      typeof r.composed === 'string' && r.composed.length > 0,
      driver.describe(
        'spec/v1/prompts.md §Discovery & distribution',
        '`composed` body MUST populate for every PromptKind under observability: full',
      ),
    ).toBe(true);
  });
});
