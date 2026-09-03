/**
 * a2ui-surface-version-refusal — RFC 0102 §A.3 (C3): catalog version is a
 * host-enumerated set, not a free string. A `catalogVersion` the host does
 * not advertise MUST be refused with `unknown_schema_version`
 * (ai-envelope.md §"Schema version advertisement"), and the stored surface
 * MUST be self-contained for deterministic `:fork`/replay.
 *
 * Always-on (server-free): the core schema enumerates `catalogVersion`
 * (closed set), so a non-advertised version fails validation; the schema
 * carries no external `$ref` (surface is self-contained).
 * Capability-gated (HTTP): a live host refuses an unadvertised version.
 *
 * @see RFCS/0102-a2ui-agent-authored-interface-surfaces.md §A.3
 * @see spec/v1/ai-envelope.md §"A2UI surfaces", §"Schema version advertisement"
 */

import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { driver } from '../lib/driver.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;
const schema = JSON.parse(
  readFileSync(join(SCHEMAS_DIR, 'envelopes/ui.a2ui-surface.schema.json'), 'utf8'),
) as Record<string, unknown>;

function hasAbsoluteRef(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(hasAbsoluteRef);
  const obj = node as Record<string, unknown>;
  if (typeof obj['$ref'] === 'string' && !(obj['$ref'] as string).startsWith('#')) return true;
  return Object.values(obj).some(hasAbsoluteRef);
}

describe('a2ui-surface-version-refusal: enumerated catalogVersion (RFC 0102 §A.3)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(schema);

  it('catalogVersion is a closed enum — an unadvertised version fails validation', () => {
    const ok = validate({ catalogVersion: '9.9.9', surface: { components: [] } });
    expect(
      ok,
      req('openwop.it.a2ui-surface-version-refusal.catalogversion-is-a-closed-enum-an-unadvertised-version-fails-validation', 'RFC 0102 §A.3', 'RFC 0102 §A.3: a catalogVersion outside the host-enumerated set MUST fail (→ unknown_schema_version at runtime)'),
    ).toBe(false);
  });

  it('surface payload is self-contained — no external $ref (replay determinism)', () => {
    expect(
      hasAbsoluteRef(schema),
      req('openwop.it.a2ui-surface-version-refusal.surface-payload-is-self-contained-no-external-ref-replay-determinism', 'RFC 0102 §A.3', 'RFC 0102 §A.3: the surface MUST be self-contained, never a live external-catalog reference'),
    ).toBe(false);
  });
});

describe.skipIf(HTTP_SKIP)('a2ui-surface-version-refusal: live host refuses unadvertised version (RFC 0102 §A.3)', () => {
  it('ui.a2ui-surface with an unadvertised catalogVersion → refused', async () => {
    const res = await driver.post('/v1/host/sample/envelope/accept', {
      envelope: {
        type: 'ui.a2ui-surface',
        schemaVersion: 1,
        envelopeId: 'env-a2ui-ver-1',
        correlationId: 'run-a2ui:node-1:turn-0:ver',
        payload: { catalogVersion: '9.9.9', surface: { components: [] } },
        meta: { source: 'ai-generation', ts: '2026-06-15T10:00:00Z' },
      },
      hostSupportedEnvelopes: ['ui.a2ui-surface'],
    });
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam absent — soft-skip) (seam, prior step, or fixture unavailable)'); // seam absent — soft-skip
    const body = res.json as { status?: string; reason?: string };
    expect(
      body.status === 'invalid' || body.status === 'refused',
      req('openwop.it.a2ui-surface-version-refusal.ui-a2ui-surface-with-an-unadvertised-catalogversion-refused', 'RFC 0102 §A.3', 'an unadvertised catalogVersion MUST be refused'),
    ).toBe(true);
  });
});
