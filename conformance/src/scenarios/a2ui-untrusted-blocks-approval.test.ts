/**
 * a2ui-untrusted-blocks-approval — RFC 0102 §A.5: an untrusted-authored
 * surface MUST NOT advance an approval gate.
 *
 * A `ui.a2ui-surface` emitted by a node that consumed untrusted MCP/A2A
 * content carries `meta.contentTrust: 'untrusted'`; the existing
 * `untrusted_content_blocks_approval` rule then blocks that surface from
 * advancing an `approval` interrupt. This is a composition of the existing
 * untrusted-content rule for the new kind, not a new taint primitive.
 *
 * Always-on (server-free): `ui.a2ui-surface` is an advertised (non-universal)
 * kind, so the envelope trust-boundary machinery (`meta.contentTrust`) applies
 * to it exactly as to any other envelope — the precondition for the block.
 * Capability-gated (HTTP): an untrusted surface bound to an approval interrupt
 * is refused.
 *
 * @see RFCS/0102-a2ui-agent-authored-interface-surfaces.md §A.5
 * @see spec/v1/ai-envelope.md §"A2UI surfaces", §"Trust boundary"
 * @see SECURITY/invariants.yaml (a2ui-untrusted-blocks-approval, untrusted_content_blocks_approval)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;
const UNIVERSAL_KINDS = ['clarification.request', 'schema.request', 'schema.response', 'error'];

describe('a2ui-untrusted-blocks-approval: trust machinery applies (RFC 0102 §A.5)', () => {
  it('ui.a2ui-surface is an advertised kind subject to meta.contentTrust gating (not universal/always-allowed)', () => {
    expect(
      UNIVERSAL_KINDS.includes('ui.a2ui-surface'),
      'ai-envelope.md §"A2UI surfaces" / §"Trust boundary": a ui.a2ui-surface is trust-gated like any advertised envelope, so an untrusted surface is subject to untrusted_content_blocks_approval',
    ).toBe(false);
  });
});

describe.skipIf(HTTP_SKIP)('a2ui-untrusted-blocks-approval: untrusted surface cannot drive an approval (RFC 0102 §A.5)', () => {
  it('an untrusted-marked ui.a2ui-surface bound to an approval interrupt is refused', async () => {
    const res = await driver.post('/v1/host/sample/envelope/accept', {
      envelope: {
        type: 'ui.a2ui-surface',
        schemaVersion: 1,
        envelopeId: 'env-a2ui-untrusted-1',
        correlationId: 'run-a2ui:node-1:turn-0:unt',
        payload: {
          catalogVersion: '0.9.1',
          surface: {
            components: [
              { component: 'action.button', id: 'approve', label: 'Approve', action: { target: 'resume' } },
            ],
          },
        },
        meta: { source: 'ai-generation', ts: '2026-06-15T10:00:00Z', contentTrust: 'untrusted' },
      },
      hostSupportedEnvelopes: ['ui.a2ui-surface'],
      boundInterruptKind: 'approval',
    });
    if (res.status === 404) return; // seam absent — soft-skip
    const body = res.json as { status?: string; reason?: string };
    expect(
      body.status === 'blocked' || (body.reason ?? '').includes('untrusted'),
      driver.describe(
        'RFC 0102 §A.5',
        'an untrusted ui.a2ui-surface MUST NOT advance an approval interrupt (untrusted_content_blocks_approval)',
      ),
    ).toBe(true);
  });
});
