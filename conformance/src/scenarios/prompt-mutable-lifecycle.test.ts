/**
 * prompt-mutable-lifecycle — RFC 0028 §A `create` / `update` /
 * `delete` round-trip for user-source templates.
 *
 * Asserts the full mutating lifecycle:
 *   1. POST /v1/prompts creates a user-source template; returns 201
 *      with a Location header.
 *   2. GET /v1/prompts/{templateId} returns the newly-created
 *      template with `meta.source: "user"`.
 *   3. POST /v1/prompts with the same (templateId, version) returns
 *      409 (duplicate).
 *   4. PUT /v1/prompts/{templateId} with a strictly-greater SemVer
 *      replaces the template; the stored version reflects the bump.
 *   5. PUT /v1/prompts/{templateId} with a non-monotonic SemVer
 *      returns 409.
 *   6. DELETE /v1/prompts/{templateId} returns 204; subsequent GET
 *      returns 404.
 *   7. DELETE on a host-built-in (meta.source: "host") template
 *      returns 403.
 *
 * Capability-gated: skips when the host doesn't advertise BOTH
 * `capabilities.prompts.endpointsSupported: true` AND
 * `capabilities.prompts.mutableLibrary: true`.
 *
 * HTTP-driven: skips when no `OPENWOP_BASE_URL` is configured.
 *
 * Under `OPENWOP_REQUIRE_BEHAVIOR=true`, the capability gate hardens
 * from SKIP to FAIL when the host advertises mutableLibrary but
 * fails to round-trip the lifecycle.
 *
 * @see spec/v1/prompts.md §"Discovery & distribution"
 * @see RFCS/0028-prompt-library-endpoints.md §A
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

interface DiscoveryDoc {
  capabilities?: {
    prompts?: {
      endpointsSupported?: unknown;
      mutableLibrary?: unknown;
    };
  };
}

interface PromptTemplate {
  templateId: string;
  version: string;
  kind: 'system' | 'user' | 'few-shot' | 'schema-hint';
  text: string;
  meta?: { source?: 'host' | 'pack' | 'user' };
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  const res = await driver.get('/.well-known/openwop');
  if (res.status !== 200) return null;
  return res.json as DiscoveryDoc;
}

function mutableSupport(d: DiscoveryDoc | null): boolean {
  const p = capabilityFamily(d, 'prompts');
  return p?.endpointsSupported === true && p?.mutableLibrary === true;
}

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

// Stable per-suite-run templateId so retries don't accumulate state.
const TEMPLATE_ID = `conformance.user.lifecycle-${Math.random().toString(36).slice(2, 10)}`;

describe.skipIf(HTTP_SKIP)('prompt-mutable-lifecycle: user-source create/update/delete round-trip (RFC 0028 §A)', () => {
  it('POST /v1/prompts creates a user-source template (201 + Location)', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-mutable', mutableSupport(d))) return;
    const body: PromptTemplate = {
      templateId: TEMPLATE_ID,
      version: '1.0.0',
      kind: 'system',
      text: 'You are a conformance probe. {{tone}}',
    };
    const res = await driver.post('/v1/prompts', body);
    expect(
      res.status,
      req('openwop.it.prompt-mutable-lifecycle.post-v1-prompts-creates-a-user-source-template-201-location', 
        'spec/v1/prompts.md §Discovery & distribution',
        'POST /v1/prompts MUST return 201 on successful user-source create',
      ),
    ).toBe(201);
    const location = res.headers?.get?.('location');
    expect(
      typeof location === 'string' && location.includes(TEMPLATE_ID),
      req('openwop.it.prompt-mutable-lifecycle.post-v1-prompts-creates-a-user-source-template-201-location', 
        'spec/v1/prompts.md §Discovery & distribution',
        '201 response MUST set a Location header referencing the new templateId',
      ),
    ).toBe(true);
  });

  it('GET /v1/prompts/{templateId} returns the new template with meta.source: "user"', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-mutable', mutableSupport(d))) return;
    const res = await driver.get(`/v1/prompts/${encodeURIComponent(TEMPLATE_ID)}`);
    expect(res.status).toBe(200);
    const tpl = res.json as PromptTemplate;
    expect(tpl.templateId).toBe(TEMPLATE_ID);
    expect(
      tpl.meta?.source,
      req('openwop.it.prompt-mutable-lifecycle.get-v1-prompts-templateid-returns-the-new-template-with-meta-source-user', 
        'spec/v1/prompts.md §PromptTemplate',
        'host MUST stamp meta.source: "user" on POST-created templates',
      ),
    ).toBe('user');
  });

  it('POST /v1/prompts with same (templateId, version) returns 409', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-mutable', mutableSupport(d))) return;
    const body: PromptTemplate = {
      templateId: TEMPLATE_ID,
      version: '1.0.0',
      kind: 'system',
      text: 'duplicate',
    };
    const res = await driver.post('/v1/prompts', body);
    expect(
      res.status,
      req('openwop.it.prompt-mutable-lifecycle.post-v1-prompts-with-same-templateid-version-returns-409', 
        'spec/v1/prompts.md §Discovery & distribution',
        'POST /v1/prompts MUST return 409 on (templateId, version) duplicate',
      ),
    ).toBe(409);
  });

  it('PUT /v1/prompts/{templateId} with strictly-greater SemVer replaces the template', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-mutable', mutableSupport(d))) return;
    const body: PromptTemplate = {
      templateId: TEMPLATE_ID,
      version: '1.1.0',
      kind: 'system',
      text: 'You are a conformance probe v1.1. {{tone}}',
    };
    const res = await driver.put(`/v1/prompts/${encodeURIComponent(TEMPLATE_ID)}`, body);
    expect(
      res.status,
      req('openwop.it.prompt-mutable-lifecycle.put-v1-prompts-templateid-with-strictly-greater-semver-replaces-the-template', 
        'spec/v1/prompts.md §Discovery & distribution',
        'PUT /v1/prompts/{templateId} MUST return 200 on monotonic-SemVer update',
      ),
    ).toBe(200);
    // Latest fetch reflects the bumped version.
    const fetched = await driver.get(`/v1/prompts/${encodeURIComponent(TEMPLATE_ID)}`);
    expect((fetched.json as PromptTemplate).version).toBe('1.1.0');
  });

  it('PUT /v1/prompts/{templateId} with non-monotonic SemVer returns 409', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-mutable', mutableSupport(d))) return;
    const body: PromptTemplate = {
      templateId: TEMPLATE_ID,
      version: '0.9.0',
      kind: 'system',
      text: 'cannot replay',
    };
    const res = await driver.put(`/v1/prompts/${encodeURIComponent(TEMPLATE_ID)}`, body);
    expect(
      res.status,
      req('openwop.it.prompt-mutable-lifecycle.put-v1-prompts-templateid-with-non-monotonic-semver-returns-409', 
        'spec/v1/prompts.md §Discovery & distribution',
        'PUT MUST return 409 when submitted version does not exceed stored',
      ),
    ).toBe(409);
  });

  it('DELETE /v1/prompts/{templateId} returns 204 and subsequent GET returns 404', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-mutable', mutableSupport(d))) return;
    const del = await driver.delete(`/v1/prompts/${encodeURIComponent(TEMPLATE_ID)}`);
    expect(
      del.status,
      req('openwop.it.prompt-mutable-lifecycle.delete-v1-prompts-templateid-returns-204-and-subsequent-get-returns-404', 
        'spec/v1/prompts.md §Discovery & distribution',
        'DELETE /v1/prompts/{templateId} MUST return 204 on successful delete',
      ),
    ).toBe(204);
    const after = await driver.get(`/v1/prompts/${encodeURIComponent(TEMPLATE_ID)}`);
    expect(
      after.status,
      req('openwop.it.prompt-mutable-lifecycle.delete-v1-prompts-templateid-returns-204-and-subsequent-get-returns-404', 
        'spec/v1/prompts.md §Discovery & distribution',
        'GET after DELETE MUST return 404',
      ),
    ).toBe(404);
  });

  it('DELETE on a host-built-in template returns 403', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-mutable', mutableSupport(d))) return;
    // Find a host-built-in to probe; the conformance-fixture set
    // is the standard source for this test.
    const list = await driver.get('/v1/prompts?source=host&limit=1');
    if (list.status !== 200) return softSkip('blocked', 'precondition not met — `list.status !== 200` returned early (seam, prior step, or fixture unavailable)');
    const body = list.json as { items: PromptTemplate[] };
    if (body.items.length === 0) return softSkip('blocked', 'precondition not met — `body.items.length === 0` returned early (seam, prior step, or fixture unavailable)');
    const hostTemplate = body.items[0]!;
    const res = await driver.delete(`/v1/prompts/${encodeURIComponent(hostTemplate.templateId)}`);
    expect(
      res.status,
      req('openwop.it.prompt-mutable-lifecycle.delete-on-a-host-built-in-template-returns-403', 
        'spec/v1/prompts.md §Discovery & distribution',
        'DELETE on a host-built-in template MUST return 403 (read-only)',
      ),
    ).toBe(403);
  });
});
