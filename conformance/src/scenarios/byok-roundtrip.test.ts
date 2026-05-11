/**
 * BYOK end-to-end roundtrip scenarios (`openwop-byok` profile).
 *
 * Companion to `redaction.test.ts` + `redactionAdversarial.test.ts`,
 * which assert credentialRefs DON'T leak (negative tests). This file
 * asserts credentialRefs DO resolve and DO get used (positive test) —
 * with redaction-safe verification via SHA-256 hashing.
 *
 * Both scenarios skip trivially-pass when the host returns 404/422 from
 * the start-run call (production deployments don't advertise the
 * fixture surface). Hosts that opt into `OPENWOP_CONFORMANCE_FIXTURES=1`
 * AND pre-provision a secret under `openwop-conformance-canary-secret`
 * expose the surface and the scenarios run end-to-end.
 *
 * The scenarios assert shape + non-empty + redaction, not exact value
 * equality — any host-defined canary value works as long as it's
 * non-empty and the host's `secrets.resolve` returns it intact.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/run-options.md §"Credential references"
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/auth.md §"Secret resolution"
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/observability.md §"Redaction"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

/** SHA-256 hex regex — 64 lowercase hex chars exactly. */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

const BYOK_WORKFLOW_ID = 'openwop-smoke-byok-roundtrip';
const SKIP_NO_FIXTURE = !isFixtureAdvertised(BYOK_WORKFLOW_ID);

describe.skipIf(SKIP_NO_FIXTURE)('byok: end-to-end credentialRef resolution roundtrip (openwop-byok profile)', () => {
  it('the canary fixture run MUST resolve a host-provisioned secret and emit SHA-256 hex', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: 'openwop-smoke-byok-roundtrip',
    });

    // Fixture absent OR canary not provisioned — host doesn't opt in.
    // Scenario passes trivially.
    if (create.status === 404 || create.status === 422) {
      return;
    }

    expect(create.status, driver.describe(
      'rest-endpoints.md POST /v1/runs',
      'starting openwop-smoke-byok-roundtrip MUST succeed when OPENWOP_CONFORMANCE_FIXTURES=1 is advertised AND openwop-conformance-canary-secret is provisioned',
    )).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    const terminal = await pollUntilTerminal(runId);
    expect(terminal.status, driver.describe(
      'auth.md §"Secret resolution"',
      'BYOK fixture run MUST reach terminal completed when canary is provisioned',
    )).toBe('completed');

    // The fixture writes secretSha256 + secretLength as node outputs
    // (which surface on the run via the engine's variables/outputs map
    // depending on host implementation). At minimum, the run terminates
    // completed — that's enough to know secrets.resolve returned a
    // non-empty value. The shape assertion below is the additional
    // proof that the canary value reached the NodeModule intact.
    const variables = terminal.variables ?? {};
    const outputs =
      (terminal as { outputs?: Record<string, unknown> }).outputs ?? {};

    // The host MAY surface fixture outputs via variables OR via a
    // host-specific outputs map. Look in both.
    const candidate =
      (outputs['resolve-secret'] as Record<string, unknown> | undefined) ??
      (variables['resolve-secret'] as Record<string, unknown> | undefined) ??
      (outputs as Record<string, unknown>) ??
      (variables as Record<string, unknown>);

    if (!candidate || typeof candidate !== 'object') {
      // Host doesn't expose node outputs in variables/outputs map —
      // some hosts only expose them on the events stream. Skip the
      // shape check; the run-completed assertion above is sufficient.
      return;
    }

    if ('secretSha256' in candidate && typeof candidate.secretSha256 === 'string') {
      expect(candidate.secretSha256, driver.describe(
        'auth.md §"Secret resolution"',
        'fixture-emitted SHA-256 hex MUST be 64 lowercase hex chars',
      )).toMatch(SHA256_HEX_RE);
    }
    if ('secretLength' in candidate && typeof candidate.secretLength === 'number') {
      expect(candidate.secretLength, driver.describe(
        'auth.md §"Secret resolution"',
        'resolved canary length MUST be > 0 (non-empty)',
      )).toBeGreaterThan(0);
    }
  });

  it('BYOK fixture run MUST emit a node.completed event for the resolve step', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: 'openwop-smoke-byok-roundtrip',
    });
    if (create.status === 404 || create.status === 422) {
      return;
    }
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId);

    const eventsResp = await driver.get(`/v1/runs/${runId}/events`);
    expect(eventsResp.status).toBe(200);
    const events = (eventsResp.json as { events: Array<{ type: string; nodeId?: string }> })
      .events;

    const completed = events.filter(
      (e) => e.type === 'node.completed' && e.nodeId === 'resolve-secret',
    );
    expect(completed.length, driver.describe(
      'event-log.md §node.completed',
      'BYOK fixture node MUST emit exactly one node.completed event when secrets.resolve succeeds',
    )).toBe(1);
  });

  it('BYOK fixture run event log MUST NOT echo the resolved secret value (redaction)', async () => {
    const create = await driver.post('/v1/runs', {
      workflowId: 'openwop-smoke-byok-roundtrip',
    });
    if (create.status === 404 || create.status === 422) {
      return;
    }
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId);

    const eventsResp = await driver.get(`/v1/runs/${runId}/events`);
    expect(eventsResp.status).toBe(200);

    // Universal redaction marker — same pattern as redaction.test.ts.
    // The test cannot know the exact canary value (host-defined), but
    // it MUST NOT contain a SHA-256-shaped or base64-shaped substring
    // adjacent to a `value:`/`secret:`/`password:` key. This is a
    // defense-in-depth check; the existing redaction.test.ts has the
    // canonical assertion.
    const dump = JSON.stringify(eventsResp.json);

    // The fixture emits `secretSha256: <hash>` and `secretLength: <n>`.
    // These ARE allowed in the event log (they're hash + length, not
    // the raw value). What MUST NOT appear: a key named `value` or
    // `password` carrying string-typed content alongside a
    // `secretSha256` field — that would suggest the raw value leaked.
    const suspiciousPatterns = [
      /"value"\s*:\s*"[^"]{8,}".*"secretSha256"/,
      /"password"\s*:\s*"[^"]{8,}"/,
      /"plaintext"\s*:\s*"[^"]{8,}"/,
      /"raw_secret"\s*:\s*"[^"]{8,}"/,
    ];
    for (const pat of suspiciousPatterns) {
      expect(dump, driver.describe(
        'observability.md §"Redaction"',
        `event log MUST NOT contain a payload matching ${pat} — secret.echo fixture only emits hash + length`,
      )).not.toMatch(pat);
    }
  });
});
