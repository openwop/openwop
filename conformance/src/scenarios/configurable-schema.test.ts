/**
 * Track 13: per-workflow `configurableSchema` (run-options.md v1.1).
 *
 * Verifies that hosts which surface `configurableSchema` on a workflow
 * definition (a) reject runs whose `configurable` violates the schema
 * with `validation_error`, and (b) surface the schema on
 * `GET /v1/workflows/{workflowId}`.
 *
 * Capability gating: skips when no advertised fixture declares
 * `configurableSchema`. Hosts that don't yet support per-workflow
 * configurableSchema return absence of the field on the manifest, in
 * which case this scenario skips.
 *
 * @see spec/v1/run-options.md §"Per-workflow configurableSchema"
 * @see schemas/workflow-definition.schema.json §configurableSchema
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

// Re-use `conformance-identity` if it advertises a configurableSchema;
// otherwise the scenario soft-skips. Hosts adopting v1.1 SHOULD seed a
// dedicated `conformance-configurable-schema` fixture; until that lands,
// reuse what's available.
const CANDIDATES = ['conformance-configurable-schema', 'conformance-identity'] as const;

async function pickFixture(): Promise<string | null> {
  for (const id of CANDIDATES) {
    if (!isFixtureAdvertised(id)) continue;
    const manifest = await driver.get(`/v1/workflows/${encodeURIComponent(id)}`);
    if (manifest.status !== 200) continue;
    const def = manifest.json as { configurableSchema?: unknown };
    if (def.configurableSchema && typeof def.configurableSchema === 'object') return id;
  }
  return null;
}

describe('configurable-schema: per-workflow schema enforced', () => {
  it('manifest surfaces configurableSchema; mismatched configurable is rejected', async () => {
    const fixture = await pickFixture();
    if (!fixture) {
      // eslint-disable-next-line no-console
      console.warn(
        '[configurable-schema] no advertised fixture declares configurableSchema; skipping',
      );
      return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!fixture` returned early ([configurable-schema] no advertised fixture declares configurableSchema; skipping)');
    }

    const manifest = await driver.get(`/v1/workflows/${encodeURIComponent(fixture)}`);
    const schema = (manifest.json as { configurableSchema?: Record<string, unknown> })
      .configurableSchema;
    expect(schema, req('openwop.it.configurable-schema.manifest-surfaces-configurableschema-mismatched-configurable-is-rejected', 
      'run-options.md §"Per-workflow configurableSchema"',
      'GET /v1/workflows/{workflowId} MUST surface configurableSchema when the workflow declares one',
    )).toBeDefined();

    // Provide a deliberately invalid override — a key the schema either
    // forbids (additionalProperties: false) or whose type is wrong. The
    // generic shape `{__invalid_key__: 'not-a-number'}` exercises both.
    const create = await driver.post('/v1/runs', {
      workflowId: fixture,
      configurable: { __conformance_invalid_key__: { unexpected: true } },
    });
    expect(
      [400, 422].includes(create.status),
      req('openwop.it.configurable-schema.manifest-surfaces-configurableschema-mismatched-configurable-is-rejected', 
        'run-options.md §"Per-workflow configurableSchema"',
        'configurable that violates the workflow schema MUST be rejected with 400/422',
      ),
    ).toBe(true);

    const body = create.json as { error?: string };
    expect(body.error).toBe('validation_error');
  });

  it('configurable overlay matching configurableSchema is accepted', async () => {
    const fixture = await pickFixture();
    if (!fixture) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `!fixture` returned early (covered by skip warning above)'); // covered by skip warning above

    const manifest = await driver.get(`/v1/workflows/${encodeURIComponent(fixture)}`);
    const schema = (manifest.json as { configurableSchema?: Record<string, unknown> })
      .configurableSchema;
    if (!schema) return softSkip('blocked', 'precondition not met — `!schema` returned early (seam, prior step, or fixture unavailable)');

    // Build a minimal valid overlay derived from the schema's first
    // `properties.*` entry. This stays generic across fixtures: we pick
    // the first integer property with a `minimum` (if present) and emit
    // a value at that minimum. Falls back to {} when no usable property
    // is declared.
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const overlay: Record<string, unknown> = {};
    for (const [key, p] of Object.entries(props)) {
      if (p.type === 'integer') {
        const min = typeof p.minimum === 'number' ? p.minimum : 1;
        overlay[key] = min;
        break;
      }
      if (p.type === 'string') {
        overlay[key] = 'conformance-test';
        break;
      }
    }

    const create = await driver.post('/v1/runs', {
      workflowId: fixture,
      configurable: overlay,
    });
    expect(create.status, req('openwop.it.configurable-schema.configurable-overlay-matching-configurableschema-is-accepted', 
      'run-options.md §"Per-workflow configurableSchema"',
      'configurable matching the declared schema MUST be accepted (201)',
    )).toBe(201);

    const body = create.json as { runId?: string };
    expect(typeof body.runId).toBe('string');

    // Clean up so subsequent scenario runs don't accumulate state.
    if (body.runId) {
      await driver.post(`/v1/runs/${encodeURIComponent(body.runId)}/cancel`, {
        reason: 'conformance-cleanup',
      });
    }
  });
});
