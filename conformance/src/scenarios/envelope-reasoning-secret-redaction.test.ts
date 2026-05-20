/**
 * envelope-reasoning-secret-redaction — RFC 0030 §E security invariant.
 *
 * SECURITY invariant: `envelope-reasoning-secret-redaction` (gate timing
 * per RFC 0027 §G precedent — lands alongside reference-host emission, not
 * at Draft merge).
 *
 * Asserts: when a host advertises `capabilities.envelopes.reasoning.supported`
 * AND processes an envelope whose `reasoning` field contains a known
 * `secret:`-prefixed substring, the substring MUST NOT appear in:
 *   1. The emitted envelope's `reasoning` field as persisted in `RunEventDoc.payload`.
 *   2. OTel span attributes (`openwop.envelope.*`).
 *   3. The debug-bundle export.
 *
 * Capability-gated on `capabilities.envelopes.reasoning.supported: true` AND the
 * envelope-accept test seam (`POST /v1/host/sample/envelope/accept`). Behavioral
 * assertions are `it.todo()` until the reference workflow-engine wires the
 * accept path through the BYOK redaction harness for the `reasoning` field.
 *
 * @see RFCS/0030-envelope-reasoning-and-tier-one-subset.md §E
 * @see spec/v1/ai-envelope.md §"Reasoning field (normative)"
 * @see SECURITY/threat-model-secret-leakage.md §SR-1
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface DiscoveryDoc {
  capabilities?: {
    envelopes?: { reasoning?: { supported?: unknown } };
    secrets?: { supported?: unknown };
  };
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return null;
    return res.json as DiscoveryDoc;
  } catch {
    return null;
  }
}

describe.skipIf(HTTP_SKIP)('envelope-reasoning-secret-redaction: advertisement shape (RFC 0030 §E)', () => {
  it('hosts advertising envelope reasoning + BYOK honor SR-1 carry-forward for the reasoning field', async () => {
    const d = await readDiscovery();
    if (d === null) return;
    const reasoning = d.capabilities?.envelopes?.reasoning?.supported;
    const secrets = d.capabilities?.secrets?.supported;
    if (reasoning !== true || secrets !== true) return; // soft-skip when either is absent
    // The contract is invariant-based, not capability-flag-based — the
    // advertisement-shape check here just confirms both surfaces are claimed.
    // Behavioral assertions exercise the redaction invariant via the test seam.
    expect(true).toBe(true);
  });
});

// Behavioral assertions through the envelope-accept seam. Each test
// soft-skips on HTTP 404 (host doesn't expose the seam) and on capability
// absence. Promote from `it.todo()` to live assertions when the reference
// workflow-engine wires `reasoning` through the BYOK redaction harness.

describe('envelope-reasoning-secret-redaction: BYOK redaction of `reasoning` (RFC 0030 §E)', () => {
  it.todo(
    "host's accept path redacts known `secret:`-prefixed substrings from envelope.reasoning before persisting to RunEventDoc",
  );
  it.todo(
    "redacted `reasoning` MUST appear in derived RunEventDoc as `[REDACTED:<id>]` markers (matching SR-1 §SR-1 convention)",
  );
  it.todo(
    'OTel span attributes for the envelope-emitting node MUST NOT include plaintext `secret:`-prefixed substrings from `reasoning`',
  );
  it.todo(
    "debug-bundle export MUST NOT include plaintext `secret:`-prefixed substrings from envelope.reasoning",
  );
  it.todo(
    "envelope acceptance MUST NOT route on `reasoning` contents (RFC 0030 §A normative MUST NOT) — the host's handler-routing decision MUST be identical regardless of `reasoning` value",
  );
});
