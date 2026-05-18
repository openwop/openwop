/**
 * aiEnvelope.schemaDrift — FINAL v1.1 advertisement-shape verification + behavioral placeholders.
 *
 * Status: DRAFT (advertisement-shape). `spec/v1/ai-envelope.md` landed
 * 2026-05-17 as DRAFT v1.x. This scenario asserts the advertisement shape
 * for hosts that opt into envelopeContracts and the optional
 * `envelopeStrictness` knob; behavioral assertions stay `it.todo()` until
 * a reference host wires the accept path.
 *
 * Summary: an LLM emits an envelope whose `schemaVersion` is lower than the
 * host's advertised floor for that kind (`Capabilities.schemaVersions[kind]`).
 * Under `envelopeStrictness: "warn"` (default) the engine MUST attempt
 * validation against the advertised version and log `envelope_schema_version_drift`.
 * Under `envelopeStrictness: "strict"` the engine MUST refuse with
 * `unknown_schema_version`. When the emitted `schemaVersion` is HIGHER than
 * advertised, the engine MUST refuse regardless of strictness.
 *
 * @see spec/v1/ai-envelope.md §"Schema discipline"
 * @see spec/v1/ai-envelope.md §"Capability handshake integration"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

interface DiscoveryDoc {
  capabilities?: Record<string, unknown>;
}

async function isEnvelopeContractsAdvertised(): Promise<boolean> {
  const res = await driver.get('/.well-known/openwop');
  const body = res.json as DiscoveryDoc | undefined;
  const top = body?.capabilities as Record<string, unknown> | undefined;
  const block = top && typeof top === 'object' ? (top['envelopeContracts'] as Record<string, unknown> | undefined) : undefined;
  return Boolean(block && block['advertised'] === true);
}

describe('aiEnvelope.schemaDrift: advertisement shape (FINAL v1.1)', () => {
  it('capabilities.envelopeStrictness is either absent (treated as "warn") or "warn" | "strict"', async () => {
    const res = await driver.get('/.well-known/openwop');
    const body = res.json as DiscoveryDoc | undefined;
    const top = body?.capabilities as Record<string, unknown> | undefined;
    const val = top && typeof top === 'object' ? top['envelopeStrictness'] : undefined;
    if (val === undefined) return; // absent → treated as 'warn'; skip
    expect(
      val === 'warn' || val === 'strict',
      driver.describe(
        'ai-envelope.md §"Capability handshake integration"',
        'envelopeStrictness MUST be the literal string "warn" or "strict" when present',
      ),
    ).toBe(true);
  });

  it('schemaVersions is non-empty when envelopeContracts.advertised: true', async () => {
    if (!(await isEnvelopeContractsAdvertised())) return; // not opted in — skip
    const res = await driver.get('/.well-known/openwop');
    const body = res.json as { schemaVersions?: Record<string, number>; capabilities?: { schemaVersions?: Record<string, number> } } | undefined;
    const versions = body?.schemaVersions ?? body?.capabilities?.schemaVersions ?? {};
    expect(
      Object.keys(versions).length > 0,
      driver.describe(
        'ai-envelope.md §"Schema version advertisement"',
        'schemaVersions MUST be non-empty when envelopeContracts.advertised is true',
      ),
    ).toBe(true);
  });
});

describe('aiEnvelope.schemaDrift: engine-strictness placeholders', () => {
  // The 4 assertions below require the engine to read both:
  //   (a) `Capabilities.schemaVersions[<kind>]` — the advertised floor
  //       version the host implements for the kind, AND
  //   (b) `Capabilities.envelopeStrictness` — the run-level knob that
  //       decides whether below-floor versions warn or refuse.
  //
  // The reference workflow-engine sample's `acceptEnvelope` validates
  // `schemaVersion` as a top-level structural field but does NOT yet
  // cross-reference it against the host's advertised floor or apply
  // the strictness knob. Promoting these to behavioral requires
  // threading both pieces of state through `AcceptOptions` (or making
  // the acceptor close over a discovery snapshot). Tracked as host-
  // impl follow-up; the OTel span attribute (`envelope_schema_version_drift`)
  // is engine-projection scope.
  it.todo('emit envelope with schemaVersion below advertised floor under strictness:"warn" → warn-and-continue');
  it.todo('emit envelope with schemaVersion below advertised floor under strictness:"strict" → refuse unknown_schema_version');
  it.todo('emit envelope with schemaVersion ABOVE advertised floor → refuse regardless of strictness');
  it.todo('drift logs include envelope_schema_version_drift attribute on the OTel span');
});
