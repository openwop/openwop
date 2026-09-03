/**
 * owner-subject-echo — RFC 0165 §B.2, §B.4 verification (host-facing, gated).
 *
 * A host that emits `owner.subject` on a new run MUST: keep it consistent with
 * the owner triple (§B.2), echo it verbatim on `run.started` (§B.2; RFC 0048
 * §C), and copy it verbatim onto a fork (§B.4 — `replay.md` §"Fork
 * ownership"). This file drives the `conformance-noop` fixture, reads the
 * snapshot, and gates every leg on the snapshot actually carrying a subject:
 * a host that does not emit one is conformant in v1.x (`inapplicable`), and a
 * host that emits one is held to the rules.
 *
 * @see RFCS/0165-v2-preparation-wire-shapes.md §B
 * @see spec/v1/auth.md §"The Subject record"
 * @see spec/v1/replay.md §"Fork ownership"
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { isFixtureAdvertised } from '../lib/fixtures.js';
import { softSkip } from '../lib/soft-skip.js';
import { pollUntil } from '../lib/polling.js';
import { req } from '../lib/requirement-ids.js';

const NOOP_WORKFLOW_ID = 'conformance-noop';
const SKIP_NO_NOOP = !isFixtureAdvertised(NOOP_WORKFLOW_ID);

interface Subject {
  issuer: string;
  subjectId: string;
  tenant: string;
  lane: string;
  kind: string;
  keyClass?: string;
  actor?: Subject;
}
interface Owner {
  tenant?: string;
  workspace?: string;
  principal?: string;
  principalKind?: string;
  subject?: Subject;
}
interface Snapshot {
  runId?: string;
  status?: string;
  owner?: Owner;
}
interface RawEvent {
  type?: string;
  sequence?: number;
  payload?: { owner?: Owner };
}

async function createRun(): Promise<string> {
  const create = await driver.post('/v1/runs', { workflowId: NOOP_WORKFLOW_ID });
  if (create.status !== 201) throw new Error(`Failed to start ${NOOP_WORKFLOW_ID}: ${create.status}`);
  return (create.json as { runId: string }).runId;
}

async function snapshot(runId: string): Promise<Snapshot> {
  const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
  if (res.status !== 200) throw new Error(`GET /v1/runs/${runId}: ${res.status}`);
  return res.json as Snapshot;
}

async function events(runId: string): Promise<readonly RawEvent[]> {
  // Suite 1.159.0 — NO cursor. `lastSequence` names the highest sequence the
  // caller has ALREADY observed (version-negotiation.md §"events/poll"), and
  // run-event.schema.json numbers the first event 0, so `lastSequence=0` asks
  // a conforming host to SKIP `run.started` (MyndHyve does exactly that).
  // Omitting the cursor is the only spec-expressible "nothing observed yet"
  // read; the gap (no cursor value for the empty prefix) is RFC 0165 G7.
  const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events/poll?timeout=1`);
  if (res.status !== 200) throw new Error(`events for ${runId}: ${res.status}`);
  return (res.json as { events?: RawEvent[] })?.events ?? [];
}

function actorDepth(s: Subject | undefined): number {
  let d = 0;
  for (let cur = s?.actor; cur !== undefined; cur = cur.actor) d++;
  return d;
}

describe.skipIf(SKIP_NO_NOOP)('owner-subject-echo: consistency, echo, fork (RFC 0165 §B — gated on a host that emits owner.subject)', () => {
  it('subject is consistent with the owner triple (§B.2) and the actor chain is bounded (§B.5)', async () => {
    const runId = await createRun();
    const snap = await snapshot(runId);
    const subject = snap.owner?.subject;
    if (subject === undefined) {
      return softSkip('inapplicable', 'host does not emit owner.subject on new runs (RFC 0165 §B — optional in v1.x)');
    }
    expect(subject.tenant, req('openwop.it.owner-subject-echo.subject-is-consistent-with-the-owner-triple-b-2-and-the-actor-chain-is-bounded-b', 'RFC 0165 §B.2', 'subject.tenant MUST equal owner.tenant')).toBe(snap.owner?.tenant);
    if (snap.owner?.principal !== undefined) {
      expect(subject.subjectId, req('openwop.it.owner-subject-echo.subject-is-consistent-with-the-owner-triple-b-2-and-the-actor-chain-is-bounded-b', 'RFC 0165 §B.2', 'subject.subjectId MUST equal owner.principal when both are present')).toBe(snap.owner.principal);
    }
    if (snap.owner?.principalKind !== undefined) {
      expect(subject.kind, req('openwop.it.owner-subject-echo.subject-is-consistent-with-the-owner-triple-b-2-and-the-actor-chain-is-bounded-b', 'RFC 0165 §B.2', 'subject.kind MUST equal owner.principalKind when both are present')).toBe(snap.owner.principalKind);
    }
    if (subject.lane === 'saml' || subject.lane === 'scim') {
      expect(subject.keyClass, req('openwop.it.owner-subject-echo.subject-is-consistent-with-the-owner-triple-b-2-and-the-actor-chain-is-bounded-b', 'RFC 0165 §B.2', 'keyClass MUST be present on a linkable lane')).toBeDefined();
    } else {
      expect(subject.keyClass, req('openwop.it.owner-subject-echo.subject-is-consistent-with-the-owner-triple-b-2-and-the-actor-chain-is-bounded-b', 'RFC 0165 §B.2', 'keyClass MUST be absent off the linkable lanes')).toBeUndefined();
    }
    expect(actorDepth(subject), req('openwop.it.owner-subject-echo.subject-is-consistent-with-the-owner-triple-b-2-and-the-actor-chain-is-bounded-b', 'RFC 0165 §B.5', 'actor chain depth MUST NOT exceed 4')).toBeLessThanOrEqual(4);
  });

  it('run.started echoes the snapshot subject verbatim (§B.2, RFC 0048 §C)', async () => {
    const runId = await createRun();
    const snap = await snapshot(runId);
    if (snap.owner?.subject === undefined) {
      return softSkip('inapplicable', 'host does not emit owner.subject on new runs (RFC 0165 §B — optional in v1.x)');
    }
    // Suite 1.157.0 — `run.started` is appended when the host STARTS the run,
    // which a conforming host may do asynchronously after the 201 (openwop-app
    // dispatches on the next tick). Reading the log straight after the POST
    // raced that append and failed a conforming host; wait for the run to
    // leave `pending` first, then the event is a fact, not a timing.
    await pollUntil(runId, (s) => s.status !== 'pending', { label: 'run left pending (run.started appended)' });
    const started = (await events(runId)).find((e) => e.type === 'run.started');
    expect(started, req('openwop.it.owner-subject-echo.run-started-echoes-the-snapshot-subject-verbatim-b-2-rfc-0048-c', 'RFC 0048 §C', 'run.started MUST be present in the event log')).toBeDefined();
    expect(started?.payload?.owner?.subject, req('openwop.it.owner-subject-echo.run-started-echoes-the-snapshot-subject-verbatim-b-2-rfc-0048-c', 'RFC 0165 §B.2', 'run.started owner.subject MUST equal RunSnapshot.owner.subject')).toEqual(snap.owner.subject);
  });

  it('a fork copies owner.tenant and owner.subject verbatim onto the child (§B.4)', async () => {
    const sourceRunId = await createRun();
    const source = await snapshot(sourceRunId);
    if (source.owner?.subject === undefined) {
      return softSkip('inapplicable', 'host does not emit owner.subject on new runs (RFC 0165 §B — optional in v1.x)');
    }
    const fork = await driver.post(`/v1/runs/${encodeURIComponent(sourceRunId)}:fork`, { fromSeq: 0, mode: 'replay' });
    if (fork.status === 404 || fork.status === 501 || fork.status === 403) {
      return softSkip('inapplicable', `host does not offer :fork on this run (${fork.status}); the fork-copy rule has no fork to check`);
    }
    expect(fork.status, req('openwop.it.owner-subject-echo.a-fork-copies-owner-tenant-and-owner-subject-verbatim-onto-the-child-b-4', 'replay.md §"Fork ownership"', ':fork MUST return 201 for a completed noop run')).toBe(201);
    const childId = (fork.json as { runId?: string }).runId;
    expect(typeof childId, req('openwop.it.owner-subject-echo.a-fork-copies-owner-tenant-and-owner-subject-verbatim-onto-the-child-b-4', 'replay.md §"Fork ownership"', 'fork response MUST include the child runId')).toBe('string');
    const child = await snapshot(childId as string);
    expect(child.owner?.tenant, req('openwop.it.owner-subject-echo.a-fork-copies-owner-tenant-and-owner-subject-verbatim-onto-the-child-b-4', 'RFC 0165 §B.4', 'the child owner.tenant MUST equal the source')).toBe(source.owner.tenant);
    expect(child.owner?.subject, req('openwop.it.owner-subject-echo.a-fork-copies-owner-tenant-and-owner-subject-verbatim-onto-the-child-b-4', 'RFC 0165 §B.4', 'the child owner.subject MUST be copied verbatim from the source')).toEqual(source.owner.subject);
  });
});
