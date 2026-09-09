/**
 * a2ui-surface-replay — RFC 0102 §A.6: replay determinism by correlationId.
 *
 * The surface envelope replays by `correlationId` (ai-envelope.md §"Replay
 * determinism"); on recovery/`:fork` the cached outcome is returned and the
 * surface is NEVER regenerated. Re-emission with the same correlationId but a
 * divergent `type` refuses with `envelope_correlation_conflict`. Durable
 * state is exactly `(surface envelope, submitted resume value)`.
 *
 * Always-on (server-free): the surface payload is self-contained (no external
 * `$ref`), the precondition that makes a stored surface replay deterministically
 * after the external A2UI catalog ships a breaking version.
 * Capability-gated (HTTP): same correlationId + different type → conflict.
 *
 * @see RFCS/0102-a2ui-agent-authored-interface-surfaces.md §A.6
 * @see spec/v1/ai-envelope.md §"Replay determinism"
 */

import { describe, it, expect } from 'vitest';
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

function refStrings(node: unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((n) => refStrings(n, out));
    return;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj['$ref'] === 'string') out.push(obj['$ref'] as string);
  Object.values(obj).forEach((v) => refStrings(v, out));
}

describe('a2ui-surface-replay: self-contained surface (RFC 0102 §A.6)', () => {
  it('all $refs are internal (#/...) — surface renders from the payload alone on replay', () => {
    const refs: string[] = [];
    refStrings(schema, refs);
    const external = refs.filter((r) => !r.startsWith('#'));
    expect(
      external,
      req('openwop.it.a2ui-surface-replay.all-refs-are-internal-surface-renders-from-the-payload-alone-on-replay', 'RFC 0102 §A.6', 'RFC 0102 §A.6: a stored surface MUST be self-contained for deterministic :fork/replay (no live external-catalog ref)'),
    ).toEqual([]);
  });
});

describe.skipIf(HTTP_SKIP)('a2ui-surface-replay: correlationId conflict on type divergence (RFC 0102 §A.6)', () => {
  const base = {
    schemaVersion: 1,
    correlationId: 'run-a2ui:node-1:turn-0:rep',
    payload: { catalogVersion: '0.9.1', surface: { components: [] } },
    meta: { source: 'ai-generation', ts: '2026-06-15T10:00:00Z' },
  };

  it('re-emission with same correlationId + different type → envelope_correlation_conflict', async () => {
    const first = await driver.post('/v1/host/sample/envelope/accept', {
      envelope: { ...base, type: 'ui.a2ui-surface', envelopeId: 'env-a2ui-rep-1' },
      hostSupportedEnvelopes: ['ui.a2ui-surface', 'clarification.request'],
    });
    if (first.status === 404) return softSkip('blocked', 'precondition not met — `first.status === 404` returned early (seam absent — soft-skip) (seam, prior step, or fixture unavailable)'); // seam absent — soft-skip

    const conflict = await driver.post('/v1/host/sample/envelope/accept', {
      envelope: {
        ...base,
        type: 'clarification.request',
        envelopeId: 'env-a2ui-rep-2',
        payload: { questions: [{ id: 'q', question: 'x' }] },
      },
      hostSupportedEnvelopes: ['ui.a2ui-surface', 'clarification.request'],
    });
    if (conflict.status === 404) return softSkip('blocked', 'precondition not met — `conflict.status === 404` returned early (seam, prior step, or fixture unavailable)');
    const body = conflict.json as { status?: string; reason?: string };
    expect(
      body.reason ?? '',
      req('openwop.it.a2ui-surface-replay.re-emission-with-same-correlationid-different-type-envelope-correlation-conflict', 'ai-envelope.md §"Replay determinism"', 'same correlationId + divergent type MUST conflict'),
    ).toContain('envelope_correlation_conflict');
  });
});
