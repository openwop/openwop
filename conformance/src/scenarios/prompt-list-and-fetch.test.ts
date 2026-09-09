/**
 * prompt-list-and-fetch — RFC 0028 §A `listPromptTemplates` +
 * `getPromptTemplate` shape contract.
 *
 * Asserts:
 *   1. `GET /v1/prompts` returns `{ items: PromptTemplate[],
 *      nextCursor?: string }`.
 *   2. Each item validates against `prompt-template.schema.json`.
 *   3. Filters (`?kind`, `?source`) narrow the result set without
 *      breaking the envelope.
 *   4. `GET /v1/prompts/{templateId}` returns a single template,
 *      sets an `ETag` header, and honors `If-None-Match` with 304.
 *   5. Unknown templateId returns 404 with the canonical
 *      ErrorEnvelope shape.
 *
 * Capability-gated: skips when the host doesn't advertise
 * `capabilities.prompts.endpointsSupported: true`.
 *
 * Under `OPENWOP_REQUIRE_BEHAVIOR=true`, the capability gate hardens
 * from SKIP to FAIL when the host advertises `endpointsSupported`
 * but doesn't serve the routes.
 *
 * HTTP-driven: skips when no `OPENWOP_BASE_URL` is configured.
 *
 * @see spec/v1/prompts.md §"Discovery & distribution"
 * @see RFCS/0028-prompt-library-endpoints.md §A
 */

import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver } from '../lib/driver.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

interface DiscoveryDoc {
  capabilities?: {
    prompts?: {
      supported?: unknown;
      endpointsSupported?: unknown;
    };
  };
}

interface PromptTemplate {
  templateId: string;
  version: string;
  kind: 'system' | 'user' | 'few-shot' | 'schema-hint';
  text: string;
  name?: string;
  meta?: { source?: 'host' | 'pack' | 'user' };
}

interface ListResponse {
  items: PromptTemplate[];
  nextCursor?: string;
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  const res = await driver.get('/.well-known/openwop');
  if (res.status !== 200) return null;
  return res.json as DiscoveryDoc;
}

function endpointsSupported(d: DiscoveryDoc | null): boolean {
  return capabilityFamily(d, 'prompts')?.endpointsSupported === true;
}

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

describe.skipIf(HTTP_SKIP)('prompt-list-and-fetch: REST surface shape (RFC 0028 §A)', () => {
  // Pre-load schemas so cross-ref validation works against responses.
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const promptKindSchema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'prompt-kind.schema.json'), 'utf8'));
  ajv.addSchema(promptKindSchema, 'prompt-kind.schema.json');
  ajv.addSchema(promptKindSchema, './prompt-kind.schema.json');
  const promptTemplateSchema = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'prompt-template.schema.json'), 'utf8'));
  const validate = ajv.compile(promptTemplateSchema);

  it('GET /v1/prompts returns { items: PromptTemplate[], nextCursor? } when endpointsSupported is true', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-endpoints', endpointsSupported(d))) return;

    const res = await driver.get('/v1/prompts');
    expect(res.status, req('openwop.it.prompt-list-and-fetch.get-v1-prompts-returns-items-prompttemplate-nextcursor-when-endpointssupported-i', 'spec/v1/prompts.md §Discovery & distribution', 'GET /v1/prompts MUST return 200 when endpointsSupported: true')).toBe(200);
    const body = res.json as ListResponse;
    expect(
      Array.isArray(body.items),
      req('openwop.it.prompt-list-and-fetch.get-v1-prompts-returns-items-prompttemplate-nextcursor-when-endpointssupported-i', 'spec/v1/prompts.md §Discovery & distribution', 'response MUST contain an `items` array'),
    ).toBe(true);
    for (const item of body.items) {
      const ok = validate(item);
      expect(
        ok,
        req('openwop.it.prompt-list-and-fetch.get-v1-prompts-returns-items-prompttemplate-nextcursor-when-endpointssupported-i', 
          'spec/v1/prompts.md §PromptTemplate',
          `every list item MUST validate against prompt-template.schema.json; errors: ${JSON.stringify(validate.errors)}`,
        ),
      ).toBe(true);
    }
  });

  it('GET /v1/prompts?source=host narrows to host-built-in templates', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-endpoints', endpointsSupported(d))) return;
    const res = await driver.get('/v1/prompts?source=host');
    expect(res.status).toBe(200);
    const body = res.json as ListResponse;
    for (const item of body.items) {
      expect(
        item.meta?.source,
        req('openwop.it.prompt-list-and-fetch.get-v1-prompts-source-host-narrows-to-host-built-in-templates', 
          'spec/v1/prompts.md §Discovery & distribution',
          'source filter MUST narrow to templates whose meta.source matches',
        ),
      ).toBe('host');
    }
  });

  it('GET /v1/prompts?kind=system narrows to system-kind templates', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-endpoints', endpointsSupported(d))) return;
    const res = await driver.get('/v1/prompts?kind=system');
    expect(res.status, req('openwop.it.prompt-list-and-fetch.get-v1-prompts-kind-system-narrows-to-system-kind-templates', 'RFC 0028 §A', 'GET /v1/prompts?kind=system narrows to system-kind templates')).toBe(200);
    const body = res.json as ListResponse;
    for (const item of body.items) {
      expect(item.kind).toBe('system');
    }
  });

  it('GET /v1/prompts/{templateId} returns the template + ETag header for a known fixture', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-endpoints', endpointsSupported(d))) return;

    // List first to discover a known templateId we can fetch.
    const list = await driver.get('/v1/prompts?source=host&limit=1');
    if (list.status !== 200) return softSkip('blocked', 'precondition not met — `list.status !== 200` returned early (seam, prior step, or fixture unavailable)');
    const body = list.json as ListResponse;
    if (body.items.length === 0) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `body.items.length === 0` returned early (host advertises endpoints but ships no fixtures — tolerable)'); // host advertises endpoints but ships no fixtures — tolerable
    const known = body.items[0]!;

    const fetched = await driver.get(`/v1/prompts/${encodeURIComponent(known.templateId)}`);
    expect(fetched.status).toBe(200);
    const tpl = fetched.json as PromptTemplate;
    expect(tpl.templateId).toBe(known.templateId);

    // Headers.get() is case-insensitive per the Fetch spec, so one call
     // covers both "etag" and "ETag" wire spellings.
    const etag = fetched.headers?.get('etag');
    expect(
      typeof etag === 'string' && etag.length > 0,
      req('openwop.it.prompt-list-and-fetch.get-v1-prompts-templateid-returns-the-template-etag-header-for-a-known-fixture', 
        'spec/v1/prompts.md §Discovery & distribution',
        'GET /v1/prompts/{templateId} SHOULD set an ETag header (RFC 0028 §A cache semantics)',
      ),
    ).toBe(true);
  });

  it('GET /v1/prompts/{templateId} with If-None-Match returns 304 when ETag matches', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-endpoints', endpointsSupported(d))) return;
    const list = await driver.get('/v1/prompts?source=host&limit=1');
    if (list.status !== 200) return softSkip('blocked', 'precondition not met — `list.status !== 200` returned early (seam, prior step, or fixture unavailable)');
    const body = list.json as ListResponse;
    if (body.items.length === 0) return softSkip('blocked', 'precondition not met — `body.items.length === 0` returned early (seam, prior step, or fixture unavailable)');
    const known = body.items[0]!;

    const first = await driver.get(`/v1/prompts/${encodeURIComponent(known.templateId)}`);
    if (first.status !== 200) return softSkip('blocked', 'precondition not met — `first.status !== 200` returned early (seam, prior step, or fixture unavailable)');
    const etag = first.headers?.get('etag') ?? undefined;
    if (!etag) return softSkip('blocked', 'precondition not met — `!etag` returned early (ETag is SHOULD, not MUST — soft-skip when absent) (seam, prior step, or fixture unavailable)'); // ETag is SHOULD, not MUST — soft-skip when absent

    const second = await driver.get(`/v1/prompts/${encodeURIComponent(known.templateId)}`, {
      headers: { 'If-None-Match': etag },
    });
    expect(
      second.status,
      req('openwop.it.prompt-list-and-fetch.get-v1-prompts-templateid-with-if-none-match-returns-304-when-etag-matches', 
        'spec/v1/prompts.md §Discovery & distribution',
        'conditional revalidation MUST return 304 when ETag matches',
      ),
    ).toBe(304);
  });

  it('GET /v1/prompts/unknown-template returns 404 with ErrorEnvelope', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-endpoints', endpointsSupported(d))) return;
    const res = await driver.get('/v1/prompts/conformance-unknown-template-deadbeef');
    expect(res.status).toBe(404);
    // Canonical ErrorEnvelope per `schemas/error-envelope.schema.json`:
    // FLAT `{ error: <code-string>, message: <human> }`. NOT the nested
    // `{ error: { code, message } }` shape — the schema's
    // `additionalProperties: false` rules that out.
    const body = res.json as { error?: unknown; message?: unknown };
    expect(
      typeof body.error,
      req('openwop.it.prompt-list-and-fetch.get-v1-prompts-unknown-template-returns-404-with-errorenvelope', 
        'schemas/error-envelope.schema.json',
        '404 response MUST carry canonical ErrorEnvelope: `error` is a machine-readable code STRING (flat shape per the schema, not nested)',
      ),
    ).toBe('string');
    expect(typeof body.message).toBe('string');
  });
});
