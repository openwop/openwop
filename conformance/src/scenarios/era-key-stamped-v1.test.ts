/**
 * `spec/v1/version-negotiation.md` §Stamping / §Legacy detection — the two
 * run-document stamping MUSTs, and the legacy rule that makes their absence
 * actively harmful (suite 2.0.0, target major 1; unaided).
 *
 * The rule is a v1 `MUST` and has been since the contract was written:
 *
 *   §Stamping        "Every persisted run document MUST carry an
 *                     `eventLogSchemaVersion: number` field. The current v1
 *                     value is `2`."
 *   §Legacy detection "Hosts identify an older run document as legacy when
 *                     `eventLogSchemaVersion` is undefined or `< 2`" … legacy
 *                     runs have "no event subcollection … Readers MUST fall
 *                     back to the snapshot for state."
 *
 * **Nothing in the suite has ever asserted it.** `version-negotiation.test.ts`
 * opens by claiming it checks "the four version axes (`engineVersion`,
 * `eventLogSchemaVersion`, per-event `schemaVersion`, `pinnedVersions`) appear
 * where the spec says they should" — and `protocolVersion` is the only axis it
 * asserts. Across all 444 v1 scenario files the sole occurrence of the
 * identifier `eventLogSchemaVersion` was that sentence: a docstring describing
 * a check that does not exist. **A comment claiming coverage is worse than no
 * comment**, because it answers "is this tested?" for anyone who greps, and
 * answers it wrongly.
 *
 * Both production hosts were measured on 2026-09-04 and neither stamps the
 * field on any run it has ever served. Each found it independently, after the
 * other published its own greps.
 *
 * The consequence fails in the direction that punishes correctness. A client
 * following §Legacy detection exactly classifies every such run as legacy and
 * reads the snapshot — **ignoring the event log the host is in fact serving**.
 * The host under-serves the conforming reader and over-serves the careless one.
 *
 * Why the schema could not catch it: `run-snapshot.schema.json` requires only
 * `runId`, `workflowId` and `status`, so a snapshot missing the field validates
 * cleanly. The obligation is prose-only, which is exactly the shape that needs
 * a scenario rather than a keyword.
 *
 * @see spec/v1/version-negotiation.md §Stamping
 * @see spec/v1/version-negotiation.md §Legacy detection
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID_STAMPED = 'openwop.requirement.version-negotiation.era-key-stamped';
const ID_NOT_LEGACY = 'openwop.requirement.version-negotiation.era-key-not-legacy';
const ID_ENGINE = 'openwop.requirement.version-negotiation.engine-version-stamped';
const DOC = 'spec/v1/version-negotiation.md §Stamping';

interface Snapshot { readonly eventLogSchemaVersion?: unknown; readonly engineVersion?: unknown }

/** A run this host created moments ago — the one case where "legacy" cannot apply. */
async function freshRun(): Promise<{ runId: string } | { skip: string }> {
  try {
    // v1 path keys are explicit: the driver's unversioned rewrite is a major-2
    // behaviour, and `/runs` answers 404 on a v1 host. The first version of this
    // file used `/runs` and therefore SOFT-SKIPPED against a host that violates
    // the rule — passing vacuously, which is the failure this scenario exists to
    // catch, committed by the scenario itself.
    const created = await driver.post('/v1/runs', { workflowId: 'conformance-noop', inputs: {} });
    if (created.status !== 201) return { skip: `POST /v1/runs answered ${created.status} — no run to inspect` };
    const runId = (created.json as { runId?: unknown } | null)?.runId;
    if (typeof runId !== 'string') return { skip: 'POST /v1/runs returned no runId' };
    return { runId };
  } catch {
    return { skip: 'POST /v1/runs unreachable' };
  }
}

describe('era-key-stamped-v1 (version-negotiation.md §Stamping)', () => {
  it('a run the host just created carries eventLogSchemaVersion', async () => {
    const r = await freshRun();
    if ('skip' in r) return softSkip('blocked', r.skip);

    let snap;
    try {
      snap = await driver.get(`/v1/runs/${encodeURIComponent(r.runId)}`);
    } catch {
      return softSkip('blocked', 'GET /v1/runs/{runId} unreachable');
    }
    if (snap.status !== 200) return softSkip('blocked', `GET /v1/runs/{runId} answered ${snap.status}`);

    const value = (snap.json as Snapshot | null)?.eventLogSchemaVersion;
    expect(
      value,
      req(ID_STAMPED, DOC, 'every persisted run document MUST carry an eventLogSchemaVersion — the field is prose-only (run-snapshot.schema.json requires just runId, workflowId and status), so a snapshot without it validates cleanly and only this check can see its absence'),
    ).not.toBeUndefined();
    expect(
      typeof value === 'number',
      req(ID_STAMPED, DOC, `eventLogSchemaVersion MUST be a number (got ${JSON.stringify(value)})`),
    ).toBe(true);
  });

  it('a freshly created run is not classified legacy by the host\'s own rule', async () => {
    const r = await freshRun();
    if ('skip' in r) return softSkip('blocked', r.skip);

    let snap;
    try {
      snap = await driver.get(`/v1/runs/${encodeURIComponent(r.runId)}`);
    } catch {
      return softSkip('blocked', 'GET /v1/runs/{runId} unreachable');
    }
    if (snap.status !== 200) return softSkip('blocked', `GET /v1/runs/{runId} answered ${snap.status}`);
    const value = (snap.json as Snapshot | null)?.eventLogSchemaVersion;
    if (value === undefined) {
      return softSkip('blocked', 'the field is absent — the stamping leg above records that; legacy classification cannot be judged separately from it');
    }

    // §Legacy detection: "undefined or < 2" is legacy, and a legacy run means
    // "no event subcollection … Readers MUST fall back to the snapshot". A host
    // that serves an event log while stamping a legacy value is telling a
    // conforming client to ignore the log it is serving.
    expect(
      typeof value === 'number' && value >= 2,
      req(ID_NOT_LEGACY, 'spec/v1/version-negotiation.md §Legacy detection', `a run created moments ago MUST NOT be legacy: legacy is "undefined or < 2", and a legacy run is specified to have no event subcollection so readers MUST fall back to the snapshot. Stamping ${JSON.stringify(value)} on a new run instructs a CONFORMING client to ignore the event log this host is serving it — the failure lands on the correct reader and spares the careless one`),
    ).toBe(true);
  });

  it('a run the host just created carries engineVersion — the legacy escape cannot reach it', async () => {
    const r = await freshRun();
    if ('skip' in r) return softSkip('blocked', r.skip);

    let snap;
    try {
      snap = await driver.get(`/v1/runs/${encodeURIComponent(r.runId)}`);
    } catch {
      return softSkip('blocked', 'GET /v1/runs/{runId} unreachable');
    }
    if (snap.status !== 200) return softSkip('blocked', `GET /v1/runs/{runId} answered ${snap.status}`);

    // §Stamping: "Every persisted run document MUST carry an `engineVersion:
    // number` field … Servers MAY omit this field on legacy runs that predate
    // the contract." The escape is scoped to runs that PREDATE the contract, so
    // it cannot cover a run created seconds ago — which is why this leg creates
    // one rather than inspecting whatever happens to be in the store.
    //
    // Asserted here because nothing else asserts it ON A RUN: version-fold.test.ts
    // reads engineVersion from the DISCOVERY document, and wasm-pack-load.test.ts
    // carries it only as a type field. Both mention the identifier, so a grep
    // suggests coverage that does not exist for this requirement.
    const value = (snap.json as Snapshot | null)?.engineVersion;
    expect(
      value,
      req(ID_ENGINE, DOC, 'every persisted run document MUST carry engineVersion; the "MAY omit" escape applies only to legacy runs that predate the contract, and this run was created moments ago'),
    ).not.toBeUndefined();
    expect(
      typeof value === 'number',
      req(ID_ENGINE, DOC, `engineVersion MUST be a number set to the writer engine's CURRENT_ENGINE_VERSION at write time (got ${JSON.stringify(value)})`),
    ).toBe(true);
  });
});
