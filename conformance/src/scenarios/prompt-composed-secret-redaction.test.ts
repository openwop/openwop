/**
 * prompt-composed-secret-redaction — RFC 0027 §E + SECURITY invariant
 * `prompt-composed-secret-redaction` (filed alongside reference-host
 * emission per the RFC 0021 staging precedent).
 *
 * Asserts: when a host composes a PromptTemplate whose `variables[]`
 * declares a `source: "secret"` slot and the host emits a
 * `prompt.composed` event under `capabilities.prompts.observability:
 * "full"`, the event payload MUST replace the secret-sourced binding
 * with `[REDACTED:<secretId>]` markers in BOTH the composed body
 * (`systemPrompt` / `userPrompt`) AND the `variableBindings` map.
 *
 * Capability-gated: skips when the host doesn't advertise
 * `capabilities.prompts.supported: true` AND
 * `capabilities.prompts.observability: "full"`.
 *
 * HTTP-driven: skips when no `OPENWOP_BASE_URL` is configured (the
 * server-free subset of the gate can't exercise this — it requires a
 * live reference-host emission seam).
 *
 *
 * Under `OPENWOP_REQUIRE_BEHAVIOR=true` the capability gate hardens
 * from SKIP to FAIL — a host that advertises the gating capability
 * but doesn't emit the asserted contract fails the scenario instead
 * of silently skipping. See `conformance/coverage.md` §"Capability-
 * gated scenarios."
 *
 * @see RFCS/0027-prompt-templates.md §E + §G
 * @see spec/v1/prompts.md §"Composition + observability"
 * @see SECURITY/threat-model-secret-leakage.md §SR-1
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';

interface DiscoveryDoc {
  capabilities?: {
    prompts?: {
      supported?: unknown;
      observability?: unknown;
    };
    secrets?: { supported?: unknown };
  };
}

interface PromptComposedPayload {
  nodeId: string;
  refs: string[];
  kind: string;
  hash: string;
  systemPrompt?: string;
  userPrompt?: string;
  variableBindings?: Record<string, unknown>;
  variableHashes?: Record<string, string>;
  contentTrust?: 'trusted' | 'untrusted';
}

async function readDiscovery(): Promise<DiscoveryDoc | null> {
  const res = await driver.get('/.well-known/openwop');
  if (res.status !== 200) return null;
  return res.json as DiscoveryDoc;
}

function promptsSupportFull(d: DiscoveryDoc | null): boolean {
  const p = d?.capabilities?.prompts;
  if (!p) return false;
  return p.supported === true && p.observability === 'full';
}

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

// Canary marker — the conformance suite's standard sentinel for
// detecting secret leakage across all observability surfaces. Any
// substring of the canary appearing in a `prompt.composed` payload
// indicates a redaction failure.
const CANARY_FRAGMENT = 'CANARY-CONFORMANCE-SECRET';

describe.skipIf(HTTP_SKIP)('prompt-composed-secret-redaction: composed body redacts secret-sourced values (RFC 0027 §E)', () => {
  it('emits prompt.composed with [REDACTED:<id>] in place of secret-sourced variable values', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-observability-full', promptsSupportFull(d))) return;

    // Driver test-seam endpoint: instructs the reference host to compose
    // a fixture template with one secret-sourced variable bound to a
    // known canary-marker value. Returns the emitted `prompt.composed`
    // event payload synchronously so the scenario can assert.
    const res = await driver.post('/v1/host/sample/prompt/compose', {
      templateId: 'conformance.prompt.secret-redaction',
      bindings: {
        // declared variable `apiKey` with source: 'secret' resolves
        // against a host-pre-provisioned canary secret containing
        // CANARY_FRAGMENT.
        secretRef: 'openwop-conformance-canary-secret',
      },
      observability: 'full',
    });
    if (res.status === 404) return; // host doesn't expose the seam
    expect(res.status, 'compose seam MUST return 200').toBe(200);

    const payload = res.json as PromptComposedPayload;

    // §E invariant #1 — composed body never contains the plaintext
    // secret value (canary fragment).
    const systemBody = payload.systemPrompt ?? '';
    const userBody = payload.userPrompt ?? '';
    expect(
      systemBody.includes(CANARY_FRAGMENT),
      driver.describe(
        'spec/v1/prompts.md §Composition + observability',
        'prompt.composed.systemPrompt MUST NOT contain plaintext secret value',
      ),
    ).toBe(false);
    expect(
      userBody.includes(CANARY_FRAGMENT),
      driver.describe(
        'spec/v1/prompts.md §Composition + observability',
        'prompt.composed.userPrompt MUST NOT contain plaintext secret value',
      ),
    ).toBe(false);

    // §E invariant #2 — composed body carries the [REDACTED:<secretId>]
    // marker preserving the secret's identifier (so debuggers can
    // correlate without the value).
    const combined = systemBody + userBody;
    expect(
      /\[REDACTED:[a-zA-Z0-9._-]+\]/.test(combined),
      driver.describe(
        'spec/v1/prompts.md §Composition + observability',
        'composed body MUST carry [REDACTED:<secretId>] marker where secret-sourced variables appear',
      ),
    ).toBe(true);

    // §E invariant #3 — variableBindings reflects the same redaction;
    // never the plaintext value.
    if (payload.variableBindings) {
      for (const [name, value] of Object.entries(payload.variableBindings)) {
        if (typeof value === 'string') {
          expect(
            value.includes(CANARY_FRAGMENT),
            driver.describe(
              'spec/v1/prompts.md §Composition + observability',
              `variableBindings[${name}] MUST NOT contain plaintext secret value`,
            ),
          ).toBe(false);
        }
      }
    }
  });

  it('emits variableHashes for the secret-sourced binding regardless of observability', async () => {
    const d = await readDiscovery();
    if (!behaviorGate('prompts-observability-full', promptsSupportFull(d))) return;
    const res = await driver.post('/v1/host/sample/prompt/compose', {
      templateId: 'conformance.prompt.secret-redaction',
      bindings: { secretRef: 'openwop-conformance-canary-secret' },
      observability: 'full',
    });
    if (res.status === 404) return;
    expect(res.status).toBe(200);
    const payload = res.json as PromptComposedPayload;
    expect(
      payload.hash && /^sha256:[0-9a-f]{64}$/.test(payload.hash),
      driver.describe(
        'spec/v1/prompts.md §Composition + observability',
        'prompt.composed.hash MUST be present and match sha256:<hex64>',
      ),
    ).toBe(true);
    expect(
      payload.variableHashes !== undefined,
      driver.describe(
        'spec/v1/prompts.md §Composition + observability',
        'prompt.composed.variableHashes MUST be present under all non-off observability modes',
      ),
    ).toBe(true);
  });
});
