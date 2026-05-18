/**
 * aiEnvelope.trustBoundaryPropagation — FINAL v1.1 advertisement-shape verification + behavioral placeholders.
 *
 * Status: DRAFT (advertisement-shape). `spec/v1/ai-envelope.md` landed
 * 2026-05-17 as DRAFT v1.x. Behavioral assertions stay `it.todo()` until a
 * reference host wires the MCP-tool-result → envelope → RunEventDoc trust path.
 *
 * Summary: when a node consumes content from an untrusted source (MCP tool
 * result per `mcp-integration.md`, A2A inbound message per `a2a-integration.md`),
 * any envelope it subsequently emits whose payload incorporates that content
 * MUST carry `meta.contentTrust: "untrusted"`. The engine MUST propagate this
 * onto every `RunEventDoc` emitted as a consequence (`RunEventDoc.contentTrust
 * = "untrusted"`). Downstream LLM nodes re-consuming these events MUST treat
 * the content as untrusted per `SECURITY/threat-model-prompt-injection.md`.
 * Approval gates MUST refuse to advance on `untrusted` envelopes with refusal
 * code `untrusted_content_blocks_approval`.
 *
 * @see spec/v1/ai-envelope.md §"Trust boundary"
 * @see spec/v1/mcp-integration.md §"Trust boundary"
 * @see spec/v1/a2a-integration.md §"Trust boundary"
 * @see SECURITY/threat-model-prompt-injection.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

async function readMcpTrustBoundary(): Promise<string | null> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = body?.capabilities as Record<string, unknown> | undefined;
  const mcp = top && typeof top === 'object' ? (top['mcpClient'] as Record<string, unknown> | undefined) : undefined;
  if (!mcp || typeof mcp !== 'object') return null;
  const tb = mcp['trustBoundary'];
  return typeof tb === 'string' ? tb : null;
}

describe('aiEnvelope.trustBoundaryPropagation: advertisement shape (FINAL v1.1)', () => {
  it('hosts advertising mcpClient declare trustBoundary as "untrusted"', async () => {
    const tb = await readMcpTrustBoundary();
    if (tb === null) return; // host doesn't advertise mcpClient — skip
    expect(
      tb,
      driver.describe(
        'mcp-integration.md §"Trust boundary"',
        'mcpClient.trustBoundary MUST be "untrusted" — MCP tool results are always untrusted input',
      ),
    ).toBe('untrusted');
  });
});

async function accept(envelope: unknown, opts: Record<string, unknown> = {}): Promise<{ status: number; body: { status?: string; normalizedMeta?: { contentTrust?: string } } }> {
  const res = await driver.post('/v1/host/sample/envelope/accept', { envelope, ...opts });
  return { status: res.status, body: res.json as { status?: string; normalizedMeta?: { contentTrust?: string } } };
}

const baseMeta = { source: 'ai-generation' as const, ts: '2026-05-18T10:00:00Z' };

describe('aiEnvelope.trustBoundaryPropagation: behavioral normalization (FINAL v1.1)', () => {
  it('envelope with meta.contentTrust:"untrusted" → normalizedMeta.contentTrust:"untrusted"', async () => {
    const r = await accept({
      type: 'clarification.request',
      schemaVersion: 1,
      envelopeId: 'env-tb-1',
      correlationId: 'r:n:0:tb1',
      payload: { questions: [{ id: 'q1', question: 'why?' }] },
      meta: { ...baseMeta, contentTrust: 'untrusted' },
    });
    if (r.status === 404) return;
    expect(r.body.status).toBe('accepted');
    expect(
      r.body.normalizedMeta?.contentTrust,
      driver.describe(
        'ai-envelope.md §"Trust boundary"',
        'envelope-supplied contentTrust:"untrusted" MUST propagate to normalizedMeta',
      ),
    ).toBe('untrusted');
  });

  it('envelope with no meta.contentTrust + runTrustBoundary:"untrusted" → normalizedMeta.contentTrust:"untrusted" (run-level propagation)', async () => {
    const r = await accept(
      {
        type: 'clarification.request',
        schemaVersion: 1,
        envelopeId: 'env-tb-2',
        correlationId: 'r:n:0:tb2',
        payload: { questions: [{ id: 'q1', question: 'why?' }] },
        meta: baseMeta,
      },
      { runTrustBoundary: 'untrusted' },
    );
    if (r.status === 404) return;
    expect(r.body.normalizedMeta?.contentTrust).toBe('untrusted');
  });

  it('envelope-supplied contentTrust takes precedence over runTrustBoundary (per-emission decision)', async () => {
    const r = await accept(
      {
        type: 'clarification.request',
        schemaVersion: 1,
        envelopeId: 'env-tb-3',
        correlationId: 'r:n:0:tb3',
        payload: { questions: [{ id: 'q1', question: 'why?' }] },
        meta: { ...baseMeta, contentTrust: 'trusted' },
      },
      { runTrustBoundary: 'untrusted' }, // explicit conflict — envelope wins
    );
    if (r.status === 404) return;
    expect(
      r.body.normalizedMeta?.contentTrust,
      driver.describe(
        'ai-envelope.md §"Trust boundary"',
        'per-emission contentTrust MUST take precedence — trusted envelope emitted after MCP tool result does NOT inherit untrusted',
      ),
    ).toBe('trusted');
  });

  it('no contentTrust + no runTrustBoundary → default "trusted"', async () => {
    const r = await accept({
      type: 'clarification.request',
      schemaVersion: 1,
      envelopeId: 'env-tb-default',
      correlationId: 'r:n:0:tbdef',
      payload: { questions: [{ id: 'q1', question: 'why?' }] },
      meta: baseMeta,
    });
    if (r.status === 404) return;
    expect(r.body.normalizedMeta?.contentTrust).toBe('trusted');
  });
});

describe('aiEnvelope.trustBoundaryPropagation: engine-integration placeholders', () => {
  // These require the engine to project normalizedMeta.contentTrust
  // onto RunEventDoc.contentTrust + enforce the approval-gate refusal
  // path. The pure-function acceptor surfaces normalizedMeta; engine
  // wiring is host-impl scope.
  it.todo('engine projects normalizedMeta.contentTrust onto RunEventDoc.contentTrust');
  it.todo('approval gate refuses to advance on untrusted envelope with untrusted_content_blocks_approval');
  it.todo('downstream LLM node re-consuming untrusted RunEventDoc applies <UNTRUSTED> wrap per prompt-injection invariant');
});
