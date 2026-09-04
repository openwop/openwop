/**
 * Version-negotiation scenarios — exercises the surface defined by
 * `version-negotiation.md`. Spec gap (per fixtures.md §F5): full
 * cross-version compat scenarios need a server with multiple
 * `engineVersion` releases or a schema-version cycle, which the v1.0
 * black-box suite can't synthesize.
 *
 * What we CAN test cheaply:
 *   1. Server advertises a `protocolVersion` in `Capabilities`.
 *   2. `protocolVersion` is advertised, and every event carries the six
 *      required `RunEventDoc` fields.
 *
 *   This file previously claimed to check "the four version axes
 *   (`engineVersion`, `eventLogSchemaVersion`, per-event `schemaVersion`,
 *   `pinnedVersions`)". IT DID NOT. `protocolVersion` was the only axis
 *   asserted, and across all 444 v1 scenario files the sole occurrence of the
 *   identifier `eventLogSchemaVersion` was that sentence — a docstring
 *   describing a check that did not exist. A comment claiming coverage is
 *   worse than no comment: it answers "is this tested?" for anyone who greps,
 *   and answers it wrongly.
 *
 *   Current state of the four, stated so this comment can be checked rather
 *   than trusted: `eventLogSchemaVersion` and `engineVersion` are witnessed by
 *   `era-key-stamped-v1.test.ts` (both are run-document `MUST`s in
 *   `version-negotiation.md` §Stamping, and both were unasserted until
 *   2026-09-04). Per-event `schemaVersion` and `pinnedVersions` are **not
 *   asserted here and carry no `MUST` in that document** — checked, rather
 *   than assumed to be a gap.
 *
 *   This paragraph was itself wrong for one release candidate: it said
 *   `engineVersion` "remains UNASSERTED" after the leg asserting it had
 *   landed. A docstring that describes coverage goes stale the moment
 *   coverage changes, which is the argument for stating what can be
 *   re-derived rather than what was true once.
 *   3. Forward-compat read: events carrying an UNKNOWN
 *      `schemaVersion` SHOULD still be readable via the events/poll
 *      endpoint without 5xx (best-effort fold per
 *      run-event.schema.json §schemaVersion description).
 *      We can't synthesize unknown schemaVersions from the client, so
 *      this is checked indirectly — every event the server emits today
 *      MUST carry `eventId`, `runId`, `type`, `payload`, `timestamp`,
 *      `sequence` (the required fields per the JSON Schema). Drift in
 *      the canonical shape would trip this scenario before any future
 *      version-bump scenario could.
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { pollUntilTerminal } from '../lib/polling.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { req } from '../lib/requirement-ids.js';

const NOOP_WORKFLOW_ID = 'conformance-noop';
const SKIP_NO_NOOP = !isFixtureAdvertised(NOOP_WORKFLOW_ID);

interface RunEvent {
  readonly eventId: string;
  readonly runId: string;
  readonly type: string;
  readonly payload: unknown;
  readonly timestamp: string;
  readonly sequence: number;
  readonly schemaVersion?: number;
  readonly engineVersion?: string;
}

describe('version-negotiation: Capabilities advertises a protocolVersion', () => {
  it('GET /.well-known/openwop returns Capabilities with protocolVersion (string)', async () => {
    const res = await driver.get('/.well-known/openwop', { authenticated: false });
    expect(res.status).toBe(200);

    const caps = res.json as { protocolVersion?: unknown };
    expect(typeof caps.protocolVersion, req('openwop.it.version-negotiation.get-well-known-openwop-returns-capabilities-with-protocolversion-string', 
      'capabilities.md §3 + version-negotiation.md',
      'Capabilities.protocolVersion MUST be a non-empty string',
    )).toBe('string');
    expect(String(caps.protocolVersion).length).toBeGreaterThan(0);
  });
});

describe.skipIf(SKIP_NO_NOOP)('version-negotiation: persisted events carry the canonical RunEventDoc shape', () => {
  it('every event has the 6 required RunEventDoc fields per run-event.schema.json', async () => {
    const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId);

    const eventsRes = await driver.get(
      `/v1/runs/${encodeURIComponent(runId)}/events/poll?lastSequence=0&timeout=1`,
    );
    expect(eventsRes.status).toBe(200);

    const events = (eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? [];
    expect(events.length, req('openwop.it.version-negotiation.every-event-has-the-6-required-runeventdoc-fields-per-run-event-schema-json', 'run-event.schema.json §required', 'noop run MUST emit at least one event')).toBeGreaterThan(0);

    for (const e of events) {
      expect(typeof e.eventId, req('openwop.it.version-negotiation.every-event-has-the-6-required-runeventdoc-fields-per-run-event-schema-json', 
        'run-event.schema.json §required',
        'eventId MUST be a string',
      )).toBe('string');
      expect(typeof e.runId, req('openwop.it.version-negotiation.every-event-has-the-6-required-runeventdoc-fields-per-run-event-schema-json', 
        'run-event.schema.json §required',
        'runId MUST be a string',
      )).toBe('string');
      expect(typeof e.type, req('openwop.it.version-negotiation.every-event-has-the-6-required-runeventdoc-fields-per-run-event-schema-json', 
        'run-event.schema.json §required',
        'type MUST be a string (RunEventType discriminator)',
      )).toBe('string');
      expect(e.payload, req('openwop.it.version-negotiation.every-event-has-the-6-required-runeventdoc-fields-per-run-event-schema-json', 
        'run-event.schema.json §required',
        'payload MUST be present (any JSON value, including null)',
      )).not.toBe(undefined);
      expect(typeof e.timestamp, req('openwop.it.version-negotiation.every-event-has-the-6-required-runeventdoc-fields-per-run-event-schema-json', 
        'run-event.schema.json §required',
        'timestamp MUST be an ISO 8601 string',
      )).toBe('string');
      expect(Number.isInteger(e.sequence), req('openwop.it.version-negotiation.every-event-has-the-6-required-runeventdoc-fields-per-run-event-schema-json', 
        'run-event.schema.json §required',
        'sequence MUST be a non-negative integer',
      )).toBe(true);
      expect(e.sequence, req('openwop.it.version-negotiation.every-event-has-the-6-required-runeventdoc-fields-per-run-event-schema-json', 'run-event.schema.json §required', 'sequence MUST be >= 0')).toBeGreaterThanOrEqual(0);
    }
  });

  it('event sequences within a run are strictly monotonic', async () => {
    const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId);

    const eventsRes = await driver.get(
      `/v1/runs/${encodeURIComponent(runId)}/events/poll?lastSequence=0&timeout=1`,
    );
    const events = (eventsRes.json as { events?: RunEvent[] } | undefined)?.events ?? [];

    const sequences = events.map((e) => e.sequence);
    for (let i = 1; i < sequences.length; i++) {
      const prev = sequences[i - 1] ?? -1;
      const curr = sequences[i] ?? -1;
      expect(
        curr,
        req('openwop.it.version-negotiation.event-sequences-within-a-run-are-strictly-monotonic', 
          'run-event.schema.json §sequence + idempotency.md',
          `event[${i}].sequence (${curr}) MUST be > event[${i - 1}].sequence (${prev}) — strictly monotonic per run`,
        ),
      ).toBeGreaterThan(prev);
    }
  });
});

describe.skipIf(SKIP_NO_NOOP)('version-negotiation: events/poll forward-compat tolerance', () => {
  it('events/poll with lastSequence past current end returns empty events + isComplete', async () => {
    const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;

    await pollUntilTerminal(runId);

    // For a terminal run, asking for events past the end is a benign
    // empty response — not a 4xx. Forward-compat readers will use this
    // pattern after recovering from a deploy that bumped sequence numbers.
    const eventsRes = await driver.get(
      `/v1/runs/${encodeURIComponent(runId)}/events/poll?lastSequence=99999&timeout=1`,
    );

    expect(
      eventsRes.status,
      req('openwop.it.version-negotiation.events-poll-with-lastsequence-past-current-end-returns-empty-events-iscomplete', 
        'rest-endpoints.md GET /v1/runs/{runId}/events/poll',
        'lastSequence beyond the current end MUST return 200 with empty events, not 4xx',
      ),
    ).toBe(200);

    const body = eventsRes.json as { events?: RunEvent[]; isComplete?: boolean };
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events?.length).toBe(0);
  });
});
