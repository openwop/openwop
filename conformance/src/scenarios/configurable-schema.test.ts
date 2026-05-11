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
      return;
    }

    const manifest = await driver.get(`/v1/workflows/${encodeURIComponent(fixture)}`);
    const schema = (manifest.json as { configurableSchema?: Record<string, unknown> })
      .configurableSchema;
    expect(schema, driver.describe(
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
      driver.describe(
        'run-options.md §"Per-workflow configurableSchema"',
        'configurable that violates the workflow schema MUST be rejected with 400/422',
      ),
    ).toBe(true);

    const body = create.json as { error?: string };
    expect(body.error).toBe('validation_error');
  });
});
