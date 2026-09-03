/**
 * Portable tool-session bracket (RFC 0078 §D) — behavioral.
 *
 * Gated on `toolCatalog.sessionLifecycle` (root-first per RFC 0073). Soft-skips
 * when unadvertised (default) / hard-fails under `OPENWOP_REQUIRE_BEHAVIOR=true`.
 * The always-on wire-shape coverage lives in `tool-descriptor-shape.test.ts`
 * (the `tool.session.*` payload `$defs`); this asserts host BEHAVIOR: a tool session brackets its RFC 0064 call events
 * with `tool.session.opened` (BEFORE the first call event) and
 * `tool.session.closed` (AFTER the last), sharing one `sessionId`, carrying a
 * `toolId`, an `outcome` in the enum, and both events content-free.
 *
 * Drives the OPTIONAL `POST /v1/host/sample/tools/session-run` seam + reads the
 * bracket back via the test event-log seam (both deferred per RFC 0078
 * §Conformance — soft-skip on 404).
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/tool-catalog.md (§D)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0078-portable-tool-catalog-and-tool-session-contract.md
 */

import { describe, it, expect } from 'vitest';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readToolCatalogCap, driveToolSession, TOOL_CONTENT_FORBIDDEN } from '../lib/toolCatalog.js';
import { queryTestEvents, isEventLogSeamAvailable, resetTestSeam } from '../lib/event-log-query.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const SESSION_OUTCOMES = ['completed', 'failed', 'aborted', 'expired'];
/** RFC 0064 tool-call event family bracketed by a tool session. */
const CALL_EVENT = (t: string): boolean =>
  t === 'agent.toolCalled' || t === 'agent.toolReturned' || t.startsWith('tool.call');

describe('tool-session-lifecycle (RFC 0078 §D)', () => {
  it('brackets the call events with tool.session.opened-first / closed-last, one sessionId, content-free', async () => {
    const cap = await readToolCatalogCap();
    const lifecycle = cap?.sessionLifecycle === true || (typeof cap?.sessionLifecycle === 'object' && cap?.sessionLifecycle !== null);
    if (!behaviorGate('openwop-tool-session-lifecycle', lifecycle)) return;

    if (!(await isEventLogSeamAvailable())) return softSkip('blocked', 'precondition not met — `!(await isEventLogSeamAvailable())` returned early (event-log seam absent — soft-skip) (seam, prior step, or fixture unavailable)'); // event-log seam absent — soft-skip
    const res = await driveToolSession({});
    if (res === null || !res.runId) return softSkip('blocked', 'precondition not met — `res === null || !res.runId` returned early (session seam absent — soft-skip) (seam, prior step, or fixture unavailable)'); // session seam absent — soft-skip

    const q = await queryTestEvents(res.runId);
    if (!q.ok) return softSkip('blocked', 'precondition not met — `!q.ok` returned early (seam, prior step, or fixture unavailable)');
    const events = q.events.slice().sort((a, b) => a.sequence - b.sequence);

    const opened = events.filter((e) => e.type === 'tool.session.opened');
    const closed = events.filter((e) => e.type === 'tool.session.closed');
    expect(
      opened.length >= 1 && closed.length >= 1,
      req('openwop.it.tool-session-lifecycle.brackets-the-call-events-with-tool-session-opened-first-closed-last-one-sessioni', 'tool-catalog.md §D', 'a tool session MUST emit tool.session.opened + tool.session.closed'),
    ).toBe(true);
    if (opened.length === 0 || closed.length === 0) return softSkip('blocked', 'precondition not met — `opened.length === 0 || closed.length === 0` returned early (seam, prior step, or fixture unavailable)');

    const open = opened[0]!;
    const close = closed[closed.length - 1]!;

    // §D ordering: opened precedes every call event; closed follows them all.
    const calls = events.filter((e) => CALL_EVENT(e.type));
    if (calls.length > 0) {
      expect(
        open.sequence < calls[0]!.sequence,
        req('openwop.it.tool-session-lifecycle.brackets-the-call-events-with-tool-session-opened-first-closed-last-one-sessioni', 'RFC 0078 §D', 'tool.session.opened MUST precede the first call event'),
      ).toBe(true);
      expect(
        close.sequence > calls[calls.length - 1]!.sequence,
        req('openwop.it.tool-session-lifecycle.brackets-the-call-events-with-tool-session-opened-first-closed-last-one-sessioni', 'RFC 0078 §D', 'tool.session.closed MUST follow the last call event'),
      ).toBe(true);
    } else {
      expect(
        open.sequence < close.sequence,
        req('openwop.it.tool-session-lifecycle.brackets-the-call-events-with-tool-session-opened-first-closed-last-one-sessioni', 'RFC 0078 §D', 'tool.session.opened MUST precede tool.session.closed'),
      ).toBe(true);
    }

    // One sessionId across the bracket, both carrying a toolId.
    const openSid = open.payload.sessionId;
    const closeSid = close.payload.sessionId;
    expect(
      typeof openSid === 'string' && openSid === closeSid,
      req('openwop.it.tool-session-lifecycle.brackets-the-call-events-with-tool-session-opened-first-closed-last-one-sessioni', 'run-event-payloads.schema.json#toolSession*', 'the bracket MUST share one sessionId'),
    ).toBe(true);
    expect(
      typeof open.payload.toolId === 'string' && typeof close.payload.toolId === 'string',
      req('openwop.it.tool-session-lifecycle.brackets-the-call-events-with-tool-session-opened-first-closed-last-one-sessioni', 'run-event-payloads.schema.json#toolSession*', 'tool.session.* MUST carry a toolId'),
    ).toBe(true);

    // Closed outcome enum discipline.
    expect(
      typeof close.payload.outcome === 'string' && SESSION_OUTCOMES.includes(close.payload.outcome as string),
      req('openwop.it.tool-session-lifecycle.brackets-the-call-events-with-tool-session-opened-first-closed-last-one-sessioni', 'run-event-payloads.schema.json#toolSessionClosed', 'outcome MUST be in the closed enum'),
    ).toBe(true);

    // Content-free: identifiers + metadata only.
    for (const evt of [open, close]) {
      for (const forbidden of TOOL_CONTENT_FORBIDDEN) {
        expect(
          !(forbidden in evt.payload),
          req('openwop.it.tool-session-lifecycle.brackets-the-call-events-with-tool-session-opened-first-closed-last-one-sessioni', 'RFC 0078 §F (SR-1)', `tool.session.* MUST be content-free (no ${forbidden})`),
        ).toBe(true);
      }
    }

    await resetTestSeam();
  });
});
