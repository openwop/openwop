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
 *   `agent.toolReturned` pair (`transport: "http"`) for every `safeFetch`
 *   invocation.
 *
 * This scenario verifies that MUST against the DURABLE run event log, not the
 * seam's inline echo:
 *   1. Drive one `ctx.http.safeFetch` call inside a REAL run via the open seam
 *      `POST /v1/host/sample/http/safe-fetch-run` → `{ runId, outcome }`.
 *   2. Read the run's persisted events via the test event-log seam
 *      (`GET /v1/host/sample/test/runs/:runId/events`).
 *   3. Assert a `callId`-paired `agent.toolCalled` (`transport:"http"`) /
 *      `agent.toolReturned` exists in the durable log.
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

describe('safefetch-live-audit (RFC 0076 §B / RFC 0064 §B — production path, durable log)', () => {
  it('a real-run safeFetch call emits the agent.toolCalled/agent.toolReturned pair (transport:"http") to the durable event log', async () => {
    const advertised = await isSafeFetchLiveAuditAdvertised();
    if (!behaviorGate(PROFILE, advertised)) return; // default-skip; strict-fail when both flags advertised

    // Run seam is host-pending infrastructure — soft-skip (even in strict mode)
    // until a safeFetch host wires it. behaviorGate above already enforced the
    // capability co-advertisement; this only gates on the test vehicle.
    const run = await safeFetchViaRun({ url: 'https://example.com/' });
    if (run === null) {
      // eslint-disable-next-line no-console
      console.warn(`[${PROFILE}] safe-fetch-run seam unwired (404); host-pending — skipping`);
      return;
    }
    if (run.outcome !== 'fetched') return; // only a completed fetch carries the pair
    expect(
      typeof run.runId === 'string' && run.runId.length > 0,
      driver.describe(CITE, 'the safe-fetch-run seam MUST return the runId of the real run it executed the fetch in'),
    ).toBe(true);
    const runId = run.runId as string;

    const calledQ = await queryTestEvents(runId, { type: 'agent.toolCalled' });
    const returnedQ = await queryTestEvents(runId, { type: 'agent.toolReturned' });
    if (!calledQ.ok || !returnedQ.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[${PROFILE}] event-log query seam unavailable; host-pending — skipping`);
      return;
    }

    // The HTTP-transport tool call: a durable agent.toolCalled with transport:"http".
    const httpCall = calledQ.events.find((e) => (e.payload as { transport?: string }).transport === 'http');
    expect(
      httpCall !== undefined,
      driver.describe(
        CITE,
        'when toolHooks.prePostEvents + safeFetch are both advertised, a production ctx.http.safeFetch call MUST persist an agent.toolCalled with transport:"http" to the run event log (not just the seam echo)',
      ),
    ).toBe(true);
    if (!httpCall) return;

    const callId = (httpCall.payload as { callId?: string }).callId;
    expect(
      typeof callId === 'string' && callId.length > 0,
      driver.describe(CITE, 'the persisted agent.toolCalled MUST carry the required callId (run-event-payloads.schema.json §agentToolCalled)'),
    ).toBe(true);

    // The paired agent.toolReturned — matched by the required callId (RFC 0002 §B pairing).
    const paired = returnedQ.events.find((e) => (e.payload as { callId?: string }).callId === callId);
    expect(
      paired !== undefined,
      driver.describe(CITE, 'the agent.toolCalled MUST be followed by a callId-paired agent.toolReturned in the durable log (no quiet bypass)'),
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
  });
});
