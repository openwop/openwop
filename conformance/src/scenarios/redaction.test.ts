/**
 * Redaction conformance scenarios — `capabilities.md` §"Secrets" + NFR-7.
 *
 * These are vendor-neutral assertions that any OpenWOP-compliant server
 * doesn't leak secret material in observable surfaces. The scenarios
 * gate cleanly on the host's advertised capabilities:
 *
 *   - **Discovery shape contract** runs against every host. It verifies
 *     `secrets` and `aiProviders` advertisements are well-formed
 *     regardless of whether the host supports BYOK.
 *
 *   - **Bearer-token redaction** runs against every host. The 401
 *     response when an invalid Bearer token is supplied MUST NOT
 *     echo the token back. This is universal — applies even to hosts
 *     that don't advertise `secrets.supported: true`.
 *
 *   - **credentialRef echo control** runs ONLY when the host advertises
 *     `secrets.supported: true`. Per `capabilities.md` §"aiProviders":
 *     `RunOptions.configurable.ai.credentialRef` is opaque + host-
 *     resolved; servers MUST NOT include the value in any RunEvent,
 *     log line, span attribute, error message, or export. The scenario
 *     plants a canary as `credentialRef` on a noop run and asserts
 *     the canary doesn't appear in any event payload.
 *
 * **Why these scenarios live here, not just in-tree:**
 *
 * Spec rule NFR-7 is normative: "any code path that emits a `RunEvent`
 * / OTel span / log line / error / export MUST NOT contain raw key
 * material." The reference implementation has its own in-process
 * canary harness (which can mock + intercept logger output). But other
 * OpenWOP-compliant servers — including non-OpenWOP ones — need to
 * verify the same invariant black-box, against their HTTP surface.
 * That's what these scenarios cover.
 *
 * **Limitations:**
 *
 * The conformance suite only sees what the HTTP surface emits — it
 * can't read a host's stdout / Cloud Logging / OTel collector.
 * Hosts MUST run their own internal redaction tests (mocking the
 * logger / tracer / etc.) to cover those surfaces. These scenarios
 * cover only the response-body + run-event-stream surfaces, which are
 * the cross-implementation interop contract.
 *
 * @see capabilities.md §"Secrets" + §"aiProviders"
 * @see lib/canaries.ts — canary fixtures + detector
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import {
  CANARIES,
  CANARY_MARKER,
  assertNoCanaryLeak,
  captureToText,
  getCanary,
} from '../lib/canaries.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';

const NOOP_WORKFLOW_ID = 'conformance-noop';
const SKIP_NO_NOOP = !isFixtureAdvertised(NOOP_WORKFLOW_ID);

// ─── Discovery shape contract (always runs) ───────────────────────────

describe('redaction: /.well-known/openwop secrets+aiProviders shape contract', () => {
  it('secrets is well-formed regardless of supported value', async () => {
    const res = await driver.get('/.well-known/openwop', { authenticated: false });
    expect(res.status).toBe(200);

    const body = res.json as { secrets?: unknown } | undefined;
    const secrets = body?.secrets;

    if (secrets === undefined) {
      // Optional v1 field — hosts MAY omit. Spec-allowed; nothing to assert.
      return;
    }

    // Per capabilities.schema.json: `secrets.supported` is REQUIRED
    // when secrets is present.
    const s = secrets as {
      supported?: unknown;
      scopes?: unknown;
      resolution?: unknown;
    };
    expect(typeof s.supported, driver.describe(
      'capabilities.md §"Secrets"',
      'secrets.supported MUST be a boolean',
    )).toBe('boolean');

    // When `supported === true`, scopes MUST be a non-empty array
    // (a host claiming secrets must declare at least one scope) AND
    // resolution MUST be 'host-managed' (only allowed value in v1.x).
    if (s.supported === true) {
      expect(Array.isArray(s.scopes), driver.describe(
        'capabilities.md §"Secrets"',
        'when secrets.supported is true, scopes MUST be a string[]',
      )).toBe(true);
      const scopes = s.scopes as string[];
      expect(scopes.length, driver.describe(
        'capabilities.md §"Secrets"',
        'when secrets.supported is true, scopes MUST be non-empty',
      )).toBeGreaterThanOrEqual(1);
      for (const scope of scopes) {
        // Allowlist MUST track the `secrets.scopes` enum in capabilities.schema.json
        // (`["tenant", "user", "run", "workspace"]`). `workspace` is the RFC 0046/0048
        // sub-tenant scope — additive; hosts that advertise it (e.g. MyndHyve) are conformant.
        expect(['tenant', 'user', 'run', 'workspace']).toContain(scope);
      }
      expect(s.resolution, driver.describe(
        'capabilities.md §"Secrets"',
        'resolution MUST be "host-managed" in v1.x',
      )).toBe('host-managed');
    }
  });

  it('aiProviders is well-formed when present (byok ⊆ supported)', async () => {
    const res = await driver.get('/.well-known/openwop', { authenticated: false });
    const body = res.json as { aiProviders?: unknown } | undefined;
    const ap = body?.aiProviders as
      | { supported?: unknown; byok?: unknown }
      | undefined;

    if (ap === undefined) return; // Optional v1 field — hosts MAY omit.

    if (ap.supported !== undefined) {
      expect(Array.isArray(ap.supported)).toBe(true);
      const supported = ap.supported as string[];
      const supportedSet = new Set(supported);

      if (ap.byok !== undefined) {
        expect(Array.isArray(ap.byok)).toBe(true);
        const byok = ap.byok as string[];
        for (const id of byok) {
          expect(supportedSet.has(id), driver.describe(
            'capabilities.md §"aiProviders"',
            `byok entry "${id}" MUST appear in aiProviders.supported`,
          )).toBe(true);
        }
      }
    }
  });
});

// ─── Bearer-token redaction (always runs) ─────────────────────────────

describe('redaction: 401 response MUST NOT echo invalid Bearer token (NFR-7)', () => {
  it.each(CANARIES.filter((c) => c.label === 'jwt-bearer' || c.label === 'byok-credential-ref').map((c) => [c.label, c.value]))(
    'canary "%s" planted in Authorization header is not echoed in 401 body',
    async (_label, canaryValue) => {
      // Drive the canonical authenticated route with a synthetic
      // bearer that the server cannot validate. The 401 body MUST
      // NOT echo the canary back. Per NFR-7, even error envelopes
      // are observable surfaces and MUST be canary-clean.
      const res = await driver.post(
        '/v1/runs',
        { workflowId: NOOP_WORKFLOW_ID },
        {
          authenticated: false,
          headers: { Authorization: `Bearer ${canaryValue}` },
        },
      );

      // We don't assert a specific status — different hosts have
      // different auth models (Firebase JWT, API-key, etc.). The
      // ONE assertion: no canary in response.
      const responseText = captureToText(res.json) + '\n' + res.text;
      assertNoCanaryLeak(responseText, 'invalid-bearer-401-body');
    },
  );

  it('the marker substring alone never appears in a 401 body (universal)', async () => {
    const res = await driver.post(
      '/v1/runs',
      { workflowId: NOOP_WORKFLOW_ID },
      {
        authenticated: false,
        headers: { Authorization: `Bearer ${CANARY_MARKER}-direct-marker` },
      },
    );
    const responseText = captureToText(res.json) + '\n' + res.text;
    expect(responseText).not.toContain(CANARY_MARKER);
  });
});

// ─── credentialRef echo control (gated on secrets.supported) ──────────

describe.skipIf(SKIP_NO_NOOP)('redaction: credentialRef value MUST NOT appear in event payloads (gated on secrets.supported)', () => {
  it('skips when host does NOT advertise secrets.supported', async () => {
    const cap = await driver.get('/.well-known/openwop', { authenticated: false });
    const supported =
      (cap.json as { secrets?: { supported?: boolean } } | undefined)?.secrets
        ?.supported ?? false;

    if (supported !== true) {
      // Spec-allowed — this scenario only applies to hosts that opt
      // into BYOK. Pass trivially.
      expect(supported).not.toBe(true);
      return;
    }

    // Real assertion path: plant a canary as credentialRef on a noop
    // run, complete the run, then poll all events and assert no event
    // payload contains the canary. The credentialRef is allowed to
    // round-trip via `RunSnapshot.configurable` (per run-options.md
    // §configurable echo) — but per capabilities.md §"aiProviders"
    // it MUST NOT appear in any RunEvent payload.
    const c = getCanary('byok-credential-ref');
    // S46 (2026-08-18): no fabricated `tenantId` — the run belongs to the
    // credential's own tenant (S41 rule). A tenant-enforcing host answered
    // 403 to the made-up id and this leg then `return`ed, vacuously.
    const create = await driver.post('/v1/runs', {
      workflowId: NOOP_WORKFLOW_ID,
      configurable: { ai: { credentialRef: c.value } },
    });
    if (create.status !== 201) {
      // Auth-required hosts may 401 here without an API key. The
      // conformance suite is expected to provide OPENWOP_API_KEY for the
      // full scenario; if the key is missing or invalid, the suite's
      // earlier auth scenarios already catch that. Bail with a non-
      // assertion — this scenario is opt-in.
      return;
    }
    const runId = (create.json as { runId: string }).runId;

    // Wait briefly for the noop to complete + emit terminal events.
    // We use poll-with-timeout rather than SSE to keep this scenario
    // transport-agnostic (some hosts might gate SSE behind a feature
    // flag).
    let lastSeq = 0;
    let isComplete = false;
    let iterations = 0;
    let allEvents: string[] = [];
    while (!isComplete && iterations < 5) {
      iterations++;
      const poll = await driver.get(
        `/v1/runs/${encodeURIComponent(runId)}/events/poll?lastSequence=${lastSeq}&timeout=5`,
      );
      const pollBody = poll.json as
        | { events?: unknown[]; isComplete?: boolean }
        | undefined;
      const events = pollBody?.events ?? [];
      isComplete = pollBody?.isComplete === true;
      for (const ev of events) {
        allEvents.push(captureToText(ev));
        const seq = (ev as { sequence?: number }).sequence;
        if (typeof seq === 'number' && seq > lastSeq) lastSeq = seq;
      }
      if (events.length === 0 && !isComplete) {
        // No new events — small backoff before re-poll.
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    // Canonical assertion: across ALL captured event payloads, no
    // canary value MAY appear. credentialRef may round-trip via
    // snapshot.configurable but MUST NOT touch any event.
    const allEventsText = allEvents.join('\n');
    assertNoCanaryLeak(allEventsText, 'credentialRef-event-stream');
  });
});
