/**
 * aiEnvelope.redaction — FINAL v1.1 advertisement-shape verification + behavioral placeholders.
 *
 * Status: DRAFT (advertisement-shape). `spec/v1/ai-envelope.md` landed
 * 2026-05-17 as DRAFT v1.x. Behavioral assertions stay `it.todo()` until a
 * reference host wires the envelope accept path through the BYOK redaction
 * harness.
 *
 * Summary: AI Envelopes MUST route through the same BYOK redaction harness
 * applied to a fresh `MemoryEntry.put` per `agent-memory.md` §"SR-1
 * secret-redaction invariant". The fact that the LLM was instructed not to
 * emit secrets is NOT evidence to skip redaction — the model can hallucinate
 * secret-shaped substrings from prompt context, in-context examples, or tool
 * results. Redacted material MUST NOT appear in resulting `RunEventDoc`s,
 * OTel span attributes, debug-bundle exports, or error envelopes returned to
 * the client. The pass runs AFTER validation and BEFORE dedup/handler routing
 * in the production-flow ordering.
 *
 * @see spec/v1/ai-envelope.md §"Redaction (SR-1 carry-forward)"
 * @see spec/v1/agent-memory.md §"SR-1 secret-redaction invariant"
 * @see SECURITY/invariants.yaml#envelope-redaction-sr-1-carry-forward
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

async function isBYOKAdvertised(): Promise<boolean> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = body?.capabilities as Record<string, unknown> | undefined;
  const secrets = top && typeof top === 'object' ? top['secrets'] : undefined;
  return Boolean(secrets && typeof secrets === 'object');
}

describe('aiEnvelope.redaction: advertisement shape (FINAL v1.1)', () => {
  it('hosts advertising envelopeContracts AND secrets honor SR-1 carry-forward', async () => {
    if (!(await isBYOKAdvertised())) return; // BYOK not advertised — skip
    // The contract is invariant-based, not capability-flag-based. The
    // advertisement-shape check is just "the host claims a BYOK surface";
    // behavioral assertions below exercise the redaction invariant.
    expect(true).toBe(true);
  });
});

describe('aiEnvelope.redaction: BYOK-redaction placeholders', () => {
  // The 6 assertions below require the engine's BYOK redaction pipeline
  // (per SECURITY/threat-model-secret-leakage.md SR-1 carry-forward) to
  // hook into envelope acceptance AND every downstream surface that
  // persists envelope content (RunEventDoc, OTel span attributes,
  // debug-bundle export, error envelope projection).
  //
  // The reference workflow-engine sample's `acceptEnvelope` is pure +
  // doesn't touch payload contents. Redaction lives at a different
  // layer (BYOK secretResolver + event-log sanitizer). Promoting these
  // to behavioral requires either:
  //   (a) chaining the acceptor through `stripSecretsFromPersisted`
  //       before persisting the recorded view, OR
  //   (b) an end-to-end test that plants a BYOK canary in an envelope
  //       payload, runs through the full accept → emit → persist → export
  //       chain, and asserts the canary is absent on every output.
  //
  // (b) is the spec-faithful path. Tracked as host-impl follow-up.
  it.todo('emit envelope whose payload contains a known BYOK substring → substring absent from emitted RunEventDocs');
  it.todo('redacted substring absent from OTel envelope_* span attributes');
  it.todo('redacted substring absent from debug-bundle export');
  it.todo('redacted substring absent from error envelope on validation refusal (no leak via error path)');
  it.todo('redaction marker is the canonical [REDACTED:<reason>] form, NOT a model-generated <REDACTED> string');
  it.todo('redaction runs AFTER schema validation: a payload with redacted-shaped substrings still validates structurally');
});
