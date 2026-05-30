/**
 * Live-run safe-fetch audit emission — `host-capabilities.md` §host.http
 * (`ctx.http.safeFetch`) + RFC 0076 §B + RFC 0064 §B.
 *
 * Closes the seam-vs-production gap left by `safefetch-behavior.test.ts`. That
 * scenario drives `POST /v1/host/sample/http/safe-fetch` and reads the audit
 * pair the SEAM returns INLINE — it never proves the *production* per-ctx
 * `ctx.http.safeFetch` (the client injected into a real run) emits anything. A
 * host can co-advertise `toolHooks.prePostEvents` + `httpClient.safeFetch`,
 * pass the seam, and still ship a production `createSafeFetch()` with no audit
 * hooks — the "quiet bypass" §host.http line "centralizing egress in the host
 * must increase auditability, not become a quiet bypass" forbids.
 *
 * The normative MUST (host-capabilities.md §host.http; RFC 0076 §B):
 *   When `toolHooks.prePostEvents: true` AND `httpClient.safeFetch.supported:
 *   true` are BOTH advertised, the host MUST emit the `agent.toolCalled` /
 *   `agent.toolReturned` pair (`transport: "http"`) **for every `safeFetch`
 *   invocation** — including a *refused* one (a blocked egress attempt is
 *   exactly the security-relevant event the audit log must capture).
 *
 * This scenario verifies that MUST against the DURABLE run event log, not the
 * seam's inline echo, and does so **without depending on outbound egress** so
 * the bar can never pass vacuously:
 *   1. EGRESS-FREE FLOOR (required): drive one `ctx.http.safeFetch` to a
 *      guaranteed-blocked link-local / cloud-metadata URL inside a REAL run via
 *      `POST /v1/host/sample/http/safe-fetch-run`. A conformant SSRF guard
 *      refuses it on every host with zero connectivity, yet the production
 *      injection + auditHooks path is still exercised, so the durable pair MUST
 *      be present. This removes the "no public egress ⇒ green-but-proves-nothing"
 *      hole that a `fetched`-only assertion left.
 *   2. SUCCESS-PATH COVERAGE (best-effort): drive a public URL; when it actually
 *      `fetched`, assert the same durable pair (catches a host that audits only
 *      the reject path). Skipped — not failed — where the environment has no
 *      public egress; the floor already proved emission.
 *   3. Read each run's persisted events via the test event-log seam
 *      (`GET /v1/host/sample/test/runs/:runId/events`) and assert a `callId`-
 *      paired `agent.toolCalled` (`transport:"http"`) / `agent.toolReturned`.
 *
 * Gating: `behaviorGate('openwop-safefetch-live-audit', <both flags>)` — NOT an
 * inline soft-skip. So it skips-with-reason in default mode but FAILS under
 * `OPENWOP_REQUIRE_BEHAVIOR=true` when a host advertises both flags yet does not
 * emit. This is the RFC 0076 §B → Accepted bar a non-steward host validates
 * against. The run seam itself (`safe-fetch-run`) is host-pending: a 404 from a
 * not-yet-wired seam soft-skips even in strict mode (the seam is test-only
 * infrastructure, distinct from the advertised production capability).
 * The SSRF guarantee reuses the existing `http-client-ssrf-guard` invariant —
 * no new SECURITY invariant; the audit MUST is RFC 0064's existing posture.
 *
 * @see spec/v1/host-capabilities.md §host.http
 * @see spec/v1/host-sample-test-seams.md §"Open seams" (safe-fetch-run)
 * @see RFCS/0076-pack-runtime-requirements-and-host-safe-fetch.md §B
 * @see RFCS/0064-tool-invocation-hooks-and-authorization.md §B
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { isSafeFetchLiveAuditAdvertised, safeFetchViaRun } from '../lib/safeFetch.js';
import { queryTestEvents } from '../lib/event-log-query.js';

const PROFILE = 'openwop-safefetch-live-audit';
const CITE = 'host-capabilities.md §host.http';

// A link-local / cloud-metadata URL the SSRF guard MUST refuse — reachable on
// EVERY host regardless of outbound egress, so the durable-pair assertion never
// passes vacuously. Per §host.http the audit MUST is per-invocation: a *blocked*
// safeFetch still emits the agent.toolCalled/agent.toolReturned pair (the
// toolReturned carries the forbidden status). cf. `http-client-ssrf-guard`.
const BLOCKED_URL = 'http://169.254.169.254/latest/meta-data/';
// A public URL the guard SHOULD allow — best-effort coverage of the *success*
// path; skipped (not failed) where the environment has no public egress.
const FETCH_URL = 'https://example.com/';

/**
 * Read the durable run event log for `runId` and assert a `callId`-paired
 * `agent.toolCalled` (`transport:"http"`) / `agent.toolReturned` exists, with
 * the RFC 0002 §B causation chain tolerated when the host surfaces it. Returns
 * `false` (caller treats as host-pending soft-skip) only when the event-log
 * query seam is unavailable; otherwise asserts and returns `true`.
 */
async function assertDurableHttpPair(runId: string, label: string): Promise<boolean> {
  const calledQ = await queryTestEvents(runId, { type: 'agent.toolCalled' });
  const returnedQ = await queryTestEvents(runId, { type: 'agent.toolReturned' });
  if (!calledQ.ok || !returnedQ.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[${PROFILE}] event-log query seam unavailable; host-pending — skipping`);
    return false;
  }

  // The HTTP-transport tool call: a durable agent.toolCalled with transport:"http".
  const httpCall = calledQ.events.find((e) => (e.payload as { transport?: string }).transport === 'http');
  expect(
    httpCall !== undefined,
    driver.describe(
      CITE,
      `(${label}) when toolHooks.prePostEvents + safeFetch are both advertised, a production ctx.http.safeFetch call MUST persist an agent.toolCalled with transport:"http" to the durable run event log (not just the seam echo), for EVERY invocation incl. blocked ones`,
    ),
  ).toBe(true);
  if (!httpCall) return true;

  const callId = (httpCall.payload as { callId?: string }).callId;
  expect(
    typeof callId === 'string' && callId.length > 0,
    driver.describe(CITE, `(${label}) the persisted agent.toolCalled MUST carry the required callId (run-event-payloads.schema.json §agentToolCalled)`),
  ).toBe(true);

  // The paired agent.toolReturned — matched by the required callId (RFC 0002 §B pairing).
  const paired = returnedQ.events.find((e) => (e.payload as { callId?: string }).callId === callId);
  expect(
    paired !== undefined,
    driver.describe(CITE, `(${label}) the agent.toolCalled MUST be followed by a callId-paired agent.toolReturned in the durable log (no quiet bypass)`),
  ).toBe(true);

  // Stricter, when the host surfaces causation: RFC 0002 §B says
  // toolReturned.causationId === the paired toolCalled.eventId. Tolerate
  // hosts that omit causationId (callId pairing already proven above).
  if (paired && typeof paired.causationId === 'string') {
    expect(
      paired.causationId,
      driver.describe('RFC 0002 §B', 'agent.toolReturned.causationId MUST equal the paired agent.toolCalled.eventId when surfaced'),
    ).toBe(httpCall.eventId);
  }
  return true;
}

describe('safefetch-live-audit (RFC 0076 §B / RFC 0064 §B — production path, durable log)', () => {
  it('a BLOCKED real-run safeFetch emits the durable agent.toolCalled/agent.toolReturned pair (transport:"http") — egress-free floor', async () => {
    const advertised = await isSafeFetchLiveAuditAdvertised();
    if (!behaviorGate(PROFILE, advertised)) return; // default-skip; strict-fail when both flags advertised

    // Run seam is host-pending infrastructure — soft-skip (even in strict mode)
    // until a safeFetch host wires it. behaviorGate above already enforced the
    // capability co-advertisement; this only gates on the test vehicle.
    const run = await safeFetchViaRun({ url: BLOCKED_URL });
    if (run === null) {
      // eslint-disable-next-line no-console
      console.warn(`[${PROFILE}] safe-fetch-run seam unwired (404); host-pending — skipping`);
      return;
    }

    // The metadata IP MUST be refused by a conformant SSRF guard
    // (http-client-ssrf.test.ts owns that contract). Regardless of the exact
    // outcome, the production injection path ran, so the durable audit pair MUST
    // exist — this is the egress-independent floor that makes the bar non-vacuous.
    expect(
      typeof run.runId === 'string' && (run.runId as string).length > 0,
      driver.describe(CITE, 'the safe-fetch-run seam MUST return the runId of the real run it executed the safeFetch in'),
    ).toBe(true);
    await assertDurableHttpPair(run.runId as string, 'blocked');
  });

  it('a FETCHED real-run safeFetch also emits the durable pair (success-path coverage — skipped without public egress)', async () => {
    const advertised = await isSafeFetchLiveAuditAdvertised();
    if (!behaviorGate(PROFILE, advertised)) return;

    const run = await safeFetchViaRun({ url: FETCH_URL });
    if (run === null) return; // seam unwired — already warned by the floor test

    if (run.outcome !== 'fetched') {
      // No public egress in this environment — the blocked-path floor already
      // proved the production audit path emits. Skip success-path coverage
      // rather than fail; this is coverage, not the floor.
      // eslint-disable-next-line no-console
      console.warn(
        `[${PROFILE}] ${FETCH_URL} did not fetch (outcome=${run.outcome ?? 'n/a'}); no public egress — success-path coverage skipped (the blocked floor covers emission)`,
      );
      return;
    }
    expect(
      typeof run.runId === 'string' && (run.runId as string).length > 0,
      driver.describe(CITE, 'the safe-fetch-run seam MUST return the runId of the real run it executed the fetch in'),
    ).toBe(true);
    await assertDurableHttpPair(run.runId as string, 'fetched');
  });
});
