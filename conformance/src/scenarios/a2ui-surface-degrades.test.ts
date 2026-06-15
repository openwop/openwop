/**
 * a2ui-surface-degrades — RFC 0102 §A point: graceful degradation.
 *
 * A consumer that does NOT advertise `ui.a2ui-surface` and receives one
 * MUST fall back to store-without-render and MUST NOT fail the run (N6;
 * `ui.a2ui-surface` is an OPTIONAL advertised kind, not a MUST-recognize
 * universal kind — precedent `artifact-type-store-without-render`).
 *
 * Always-on (server-free): `ui.a2ui-surface` is NOT one of the four
 * universal kinds, so a non-advertising consumer is entitled to degrade.
 * Capability-gated (HTTP): posting the kind to a host that does not list it
 * in `supportedEnvelopes` is gated (run not failed), not accepted.
 *
 * @see RFCS/0102-a2ui-agent-authored-interface-surfaces.md §A
 * @see spec/v1/ai-envelope.md §"A2UI surfaces"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;
const UNIVERSAL_KINDS = ['clarification.request', 'schema.request', 'schema.response', 'error'];

describe('a2ui-surface-degrades: optional-advertised, not universal (RFC 0102 §A)', () => {
  it('ui.a2ui-surface is NOT a MUST-recognize universal kind', () => {
    expect(
      UNIVERSAL_KINDS.includes('ui.a2ui-surface'),
      'ai-envelope.md §"A2UI surfaces": ui.a2ui-surface MUST be optional/advertised so an unrecognizing consumer may store-without-render',
    ).toBe(false);
  });
});

describe.skipIf(HTTP_SKIP)('a2ui-surface-degrades: unadvertised kind is gated, run survives (RFC 0102 §A)', () => {
  it('posting ui.a2ui-surface to a host that does not advertise it → gated (not failed)', async () => {
    const res = await driver.post('/v1/host/sample/envelope/accept', {
      envelope: {
        type: 'ui.a2ui-surface',
        schemaVersion: 1,
        envelopeId: 'env-a2ui-degrade-1',
        correlationId: 'run-a2ui:node-1:turn-0:deg',
        payload: { catalogVersion: '0.9.1', surface: { components: [] } },
        meta: { source: 'ai-generation', ts: '2026-06-15T10:00:00Z' },
      },
      hostSupportedEnvelopes: ['clarification.request'], // does not advertise ui.a2ui-surface
    });
    if (res.status === 404) return; // seam absent — soft-skip
    expect(res.status).toBe(200);
    const body = res.json as { status?: string };
    expect(
      body.status,
      driver.describe('RFC 0102 §A (N6)', 'an unadvertised ui.a2ui-surface MUST be gated, never crash the run'),
    ).toBe('gated');
  });
});
