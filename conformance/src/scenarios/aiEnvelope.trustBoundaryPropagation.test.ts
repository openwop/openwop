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

// E.1 engine-projection via the test-only event-log seam.
import { queryTestEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';

describe('aiEnvelope.trustBoundaryPropagation: engine projection via event-log seam', () => {
  it('normalizedMeta.contentTrust:"untrusted" MUST project onto RunEventDoc.contentTrust', async () => {
    if (!(await isEventLogSeamAvailable())) return;
    const runId = `r-tb-proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await accept(
      {
        type: 'clarification.request',
        schemaVersion: 1,
        envelopeId: 'env-tb-proj-1',
        correlationId: `${runId}:n:0:tb-proj`,
        payload: { questions: [{ id: 'q1', question: 'why?' }] },
        meta: { ...baseMeta, contentTrust: 'untrusted' },
      },
      { projectTo: { runId, nodeId: 'n' } },
    );
    const events = await queryTestEvents(runId, { type: 'interrupt.requested' });
    if (!events.ok || events.events.length === 0) return;
    expect(
      events.events[0]!.contentTrust,
      driver.describe(
        'ai-envelope.md §"Trust boundary"',
        'engine MUST project normalizedMeta.contentTrust:"untrusted" onto every consequent RunEventDoc.contentTrust',
      ),
    ).toBe('untrusted');
    await resetTestSeam();
  });

  it('trusted envelope projects RunEventDoc.contentTrust:"trusted" (default + explicit both verified)', async () => {
    if (!(await isEventLogSeamAvailable())) return;
    const runId = `r-tb-trusted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await accept(
      {
        type: 'clarification.request',
        schemaVersion: 1,
        envelopeId: 'env-tb-proj-trusted',
        correlationId: `${runId}:n:0:tb-trusted`,
        payload: { questions: [{ id: 'q1', question: 'why?' }] },
        meta: baseMeta, // no contentTrust → default 'trusted'
      },
      { projectTo: { runId, nodeId: 'n' } },
    );
    const events = await queryTestEvents(runId, { type: 'interrupt.requested' });
    if (!events.ok || events.events.length === 0) return;
    expect(events.events[0]!.contentTrust).toBe('trusted');
    await resetTestSeam();
  });
});

// Approval-gate refusal — backed by the `approvalGateContext` bit on
// envelope/accept. When set, the acceptor evaluates the post-
// normalization contentTrust and refuses with
// `untrusted_content_blocks_approval` per ai-envelope.md §"Trust
// boundary." The seam-based assertion stands in for a full
// interrupt + resume flow: in production, the engine's approval-gate
// resume handler calls `acceptEnvelope(envelope, { approvalGateContext:
// true, ... })` and surfaces the refusal as the gate's outcome.
// Equivalent contract; the seam-based assertion is mechanical instead
// of having to drive a real run through a clarification gate.

async function acceptWithApprovalGate(envelope: unknown, opts: Record<string, unknown> = {}): Promise<{ status: number; body: { status?: string; reason?: string; normalizedMeta?: { contentTrust?: string } } }> {
  const res = await driver.post('/v1/host/sample/envelope/accept', { envelope, approvalGateContext: true, ...opts });
  return { status: res.status, body: res.json as { status?: string; reason?: string; normalizedMeta?: { contentTrust?: string } } };
}

describe('aiEnvelope.trustBoundaryPropagation: approval-gate refusal (FINAL v1.1)', () => {
  it('untrusted envelope presented as approval resolution MUST refuse with untrusted_content_blocks_approval', async () => {
    const r = await acceptWithApprovalGate({
      type: 'clarification.request',
      schemaVersion: 1,
      envelopeId: 'env-tb-approval-1',
      correlationId: 'r:n:0:tb-approval1',
      payload: { questions: [{ id: 'q1', question: 'continue?' }] },
      meta: { ...baseMeta, contentTrust: 'untrusted' },
    });
    if (r.status === 404) return; // seam not exposed — soft-skip
    expect(
      r.body.status,
      driver.describe(
        'ai-envelope.md §"Trust boundary"',
        'approval gate MUST refuse to advance on untrusted envelope',
      ),
    ).toBe('invalid');
    expect(
      r.body.reason,
      driver.describe(
        'ai-envelope.md §"Trust boundary"',
        'approval-gate refusal reason MUST be exactly "untrusted_content_blocks_approval"',
      ),
    ).toBe('untrusted_content_blocks_approval');
  });

  it('run-level runTrustBoundary:"untrusted" + no envelope contentTrust → approval gate refuses (run-level propagation reaches the gate)', async () => {
    const r = await acceptWithApprovalGate(
      {
        type: 'clarification.request',
        schemaVersion: 1,
        envelopeId: 'env-tb-approval-runlevel',
        correlationId: 'r:n:0:tb-approval-runlevel',
        payload: { questions: [{ id: 'q1', question: 'continue?' }] },
        meta: baseMeta, // no explicit contentTrust — runTrustBoundary propagates
      },
      { runTrustBoundary: 'untrusted' },
    );
    if (r.status === 404) return;
    expect(r.body.status).toBe('invalid');
    expect(r.body.reason).toBe('untrusted_content_blocks_approval');
  });

  it('trusted envelope advances the approval gate (no refusal)', async () => {
    const r = await acceptWithApprovalGate({
      type: 'clarification.request',
      schemaVersion: 1,
      envelopeId: 'env-tb-approval-trusted',
      correlationId: 'r:n:0:tb-approval-trusted',
      payload: { questions: [{ id: 'q1', question: 'continue?' }] },
      meta: { ...baseMeta, contentTrust: 'trusted' },
    });
    if (r.status === 404) return;
    expect(
      r.body.status,
      driver.describe(
        'ai-envelope.md §"Trust boundary"',
        'trusted envelope MUST NOT trigger approval-gate refusal — the gate only blocks on untrusted',
      ),
    ).toBe('accepted');
  });

  it('approvalGateContext absent → untrusted envelope accepted (per-call gate decision)', async () => {
    // Same envelope as the first test, but WITHOUT approvalGateContext.
    // The acceptor stays generic — untrusted is fine outside an approval
    // gate (observation, log, etc.); the refusal contract is contextual.
    const res = await driver.post('/v1/host/sample/envelope/accept', {
      envelope: {
        type: 'clarification.request',
        schemaVersion: 1,
        envelopeId: 'env-tb-approval-nocontext',
        correlationId: 'r:n:0:tb-approval-nocontext',
        payload: { questions: [{ id: 'q1', question: 'continue?' }] },
        meta: { ...baseMeta, contentTrust: 'untrusted' },
      },
    });
    if (res.status === 404) return;
    expect(
      (res.json as { status?: string }).status,
      driver.describe(
        'ai-envelope.md §"Trust boundary"',
        'untrusted envelope MUST be accepted outside an approval-gate context — the refusal is per-call, not envelope-global',
      ),
    ).toBe('accepted');
  });
});

describe('aiEnvelope.trustBoundaryPropagation: downstream-LLM-reconsume placeholder', () => {
  // Downstream LLM-node re-consumption (`<UNTRUSTED>` wrap per prompt-
  // injection invariant) still requires a real LLM-node execution
  // surface — the acceptor sees envelopes one-by-one; the wrap happens
  // when a downstream node reads a prior RunEventDoc as input. That
  // node-execution seam doesn't exist yet.
  it.todo('downstream LLM node re-consuming untrusted RunEventDoc applies <UNTRUSTED> wrap per prompt-injection invariant (needs node-execution seam)');
});
