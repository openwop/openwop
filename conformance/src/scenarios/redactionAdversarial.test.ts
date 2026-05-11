/**
 * Adversarial redaction scenarios — extends `redaction.test.ts` with
 * canary-injection through every untrusted input surface.
 *
 * `redaction.test.ts` covers the structural contract (`/.well-known/openwop`
 * shape, bearer-token redaction, basic credentialRef control). This
 * file pushes further: under hostile inputs, the host's redaction
 * pipeline MUST hold across every observable surface.
 *
 * Surfaces covered:
 *
 *   1. **Workflow inputs** — submit a run whose inputs contain canary
 *      values; assert no event payload echoes the canary verbatim.
 *      (Every host gates on this — even hosts that don't claim
 *      `openwop-secrets` mustn't echo arbitrary input values into events
 *      verbatim where the field shape suggests credential.)
 *
 *   2. **Run-creation request body in 4xx error responses** — submit
 *      a syntactically-valid POST whose `workflowId` references a
 *      non-existent workflow; the host returns 404. The error message
 *      MUST NOT echo the entire input object verbatim, since that path
 *      could leak embedded canaries.
 *
 *   3. **Long bearer-shaped strings in inputs** — long base64-shape
 *      runs (entropy proxy for token shape) MUST NOT round-trip into
 *      event payloads when they appear in non-credential field names.
 *      This is a defense-in-depth check; hosts MAY echo non-credential
 *      input verbatim, but a leak in this surface is a higher-severity
 *      defect.
 *
 * Profile gating:
 *
 *   - Surfaces 1 + 2 run against every conforming host.
 *   - Surface 3 is `@advisory-redaction` — recommended but not gating.
 *
 * Cross-references SECURITY/threat-model-secret-leakage.md invariants
 * `secret-leakage-eventlog-payload`, `secret-leakage-error-envelope`,
 * `secret-leakage-stream-chunk`.
 *
 * @see SECURITY/threat-model-secret-leakage.md
 * @see SECURITY/invariants.yaml — secret-leakage-* entries
 * @see spec/v1/capabilities.md §"Secrets" + NFR-7
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { CANARIES, CANARY_MARKER, getCanary } from '../lib/canaries.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const NOOP_WORKFLOW_ID = 'conformance-noop';
const SKIP_NO_NOOP = !isFixtureAdvertised(NOOP_WORKFLOW_ID);

describe.skipIf(SKIP_NO_NOOP)('redaction-adversarial: workflow input canaries', () => {
  it('OpenAI-shaped canary in arbitrary input field MUST NOT appear verbatim in any event-stream payload', async () => {
    const canary = getCanary('openai').value;

    const create = await driver.post('/v1/runs', {
      workflowId: NOOP_WORKFLOW_ID,
      inputs: {
        // Use a field name that does NOT signal "credential" — host has no
        // semantic reason to mask this, BUT it also has no reason to echo
        // arbitrary input values verbatim into RunEvent payloads.
        // For conformance-noop (which has NO declared variables), the
        // host SHOULD NOT propagate inputs verbatim into events.
        userSuppliedField: canary,
      },
    });
    expect(create.status, driver.describe('rest-endpoints.md', 'noop run create returns 201')).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId);

    const events = await driver.get(
      `/v1/runs/${encodeURIComponent(runId)}/events/poll`,
    );
    if (events.status !== 200) {
      // Host doesn't expose polling; SSE is the alternative. Skip-equivalent.
      return;
    }

    const eventsText = events.text;
    expect(eventsText.includes(canary), driver.describe(
      'capabilities.md §"Secrets" + NFR-7',
      'canary value submitted as workflow input MUST NOT appear verbatim in event poll response',
    )).toBe(false);
    expect(eventsText.includes(CANARY_MARKER), driver.describe(
      'NFR-7',
      'canary marker substring MUST NOT appear in event poll response',
    )).toBe(false);
  });
});

describe('redaction-adversarial: error-envelope canaries', () => {
  it('JWT-shaped canary in workflowId of a 404-failing request MUST NOT echo verbatim in error response', async () => {
    const canary = getCanary('jwt-bearer').value;
    const res = await driver.post('/v1/runs', {
      workflowId: `nonexistent-${canary}`,
      inputs: {},
    });
    expect(
      [400, 404].includes(res.status),
      driver.describe('rest-endpoints.md', 'unknown workflowId returns 400 or 404'),
    ).toBe(true);

    const responseText = res.text;
    // Hosts MAY echo the workflowId in the error message — that's a
    // legitimate UX choice. The redaction concern is the canary value
    // shape (JWT-style) appearing verbatim. Per
    // SECURITY/invariants.yaml `secret-leakage-error-envelope`, the
    // host SHOULD sanitize entropy-shaped substrings even when echoing
    // the workflowId.
    expect(responseText.includes(canary), driver.describe(
      'SECURITY/invariants.yaml secret-leakage-error-envelope',
      'JWT-shaped canary submitted in workflowId SHOULD NOT echo verbatim in 4xx error envelope',
    )).toBe(false);
  });
});

describe.skipIf(SKIP_NO_NOOP)('redaction-adversarial: bearer-shaped strings round-trip', () => {
  it('Anthropic-shaped canary embedded in non-credential input MUST NOT appear verbatim in events', async () => {
    // Plant a canary distinct from the first scenario to avoid
    // collisions if the host caches inputs across runs.
    const canary = getCanary('anthropic').value;

    const create = await driver.post('/v1/runs', {
      workflowId: NOOP_WORKFLOW_ID,
      inputs: {
        descriptiveText: `Some description containing ${canary} embedded`,
      },
    });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId);

    const events = await driver.get(
      `/v1/runs/${encodeURIComponent(runId)}/events/poll`,
    );
    if (events.status !== 200) return;

    expect(events.text.includes(canary), driver.describe(
      'capabilities.md §"Secrets" + NFR-7',
      'Anthropic-shaped canary embedded in arbitrary input MUST NOT appear verbatim in events',
    )).toBe(false);
  });
});

describe('redaction-adversarial: every canary fixture carries the marker substring', () => {
  it('every canary in CANARIES has the marker substring', () => {
    // Self-test on the lib/canaries.ts contract. Every canary value MUST
    // include CANARY_MARKER so the leak detector finds it unambiguously.
    // If this fails the canary harness has a bug — every other
    // adversarial scenario depends on this property.
    for (const c of CANARIES) {
      expect(c.value.includes(CANARY_MARKER), driver.describe(
        'lib/canaries.ts',
        `every canary fixture MUST contain CANARY_MARKER (offender label: ${c.label})`,
      )).toBe(true);
    }
  });
});
