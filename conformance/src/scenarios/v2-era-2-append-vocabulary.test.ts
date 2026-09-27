/**
 * RFC 0176 §A / `spec/v2/core/persistence.md` §The writer rule — an append to a
 * run in era `2` uses v1 vocabulary (suite 2.0.0, target major 2; seam-gated).
 *
 * The reader rule translates an era-`2` log through the codemap at the storage
 * boundary. That is only coherent if the log stays in ONE vocabulary: the era
 * key is fixed at run creation and fixes the log's vocabulary for the run's
 * lifetime. A host that upgrades while runs are open and then begins writing v2
 * names into an era-`2` log breaks the reader two ways — a renamed type gets
 * mapped a second time, and a v2-only name is not on the codemap's v1 side at
 * all, so the read fails with `event_type_unmapped`.
 *
 * This is not a hypothetical for a host with human-approval interrupts, where a
 * run can stay open for days across a deploy. Draining era-`2` runs before
 * serving v2 is explicitly not the path (`persistence.md` §"Runs pinned to v1"),
 * so the writer rule is what makes an in-flight run safe across the cut.
 *
 * The witness: seed an era-`2` run that is still `running`, drive one canonical
 * mutation so the HOST's own writer appends a terminal event, then read the
 * whole log back under major 2. A host that appended in v1 vocabulary reads
 * back cleanly; a host that appended in v2 vocabulary fails the read or returns
 * a type the closed v2 registry does not carry.
 *
 * @see spec/v2/core/persistence.md §The writer rule
 * @see RFCS/0176-v2-persisted-data-and-coexistence.md §A
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { appendEra2Event, codemapV1toV2, era2Gate, eventsOf, pollEvents, seedEra2Log, v1FixtureLog, type ReadEvent } from '../lib/era2-seed.js';

const ID = 'openwop.requirement.0176.era-2-append-vocabulary';
const DOC = 'spec/v2/core/persistence.md §The writer rule';
/** A type the codemap renames (v1 `agent.reasoning.delta`); artifact event, no projection effect. */
const WITNESS_TYPE = 'agent.reasoning-delta';

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

describe('v2-era-2-append-vocabulary (RFC 0176 §A — the writer rule)', () => {
  it('a host append to an open era-2 run keeps the log in v1 vocabulary, so the whole log still reads', async () => {
    const doc = await v2Discovery().catch(() => null);
    const gate = era2Gate(doc);
    if (gate !== null && !gate.ok) return softSkip(gate.kind, gate.reason);

    // An era-2 log that is still OPEN: `running`, not `completed`. A completed
    // run is never appended to, so it cannot witness the writer rule.
    const seeded = await seedEra2Log(v1FixtureLog().slice(0, 2), 'running');
    if (!seeded.ok) return softSkip(seeded.kind, seeded.reason);
    const runId = seeded.runId;

    const before = await pollEvents(runId);
    if (before === null || before.status !== 200) {
      return softSkip('blocked', `GET /runs/${runId}/events/poll answered ${before?.status ?? 'no response'} on the seeded era-2 run — the log cannot be read back`);
    }
    // rc.58: `eventsOf` reads `.events` off a JSON body; `before` is the
    // RESPONSE. Passing the response read `events` off an object that never
    // has one, so this leg recorded "reads back empty (0 events)" on every host
    // — including one whose poll returned both seeded rows — and the writer
    // rule was unwitnessable. Every other caller passes `.json`.
    const seedCount = eventsOf(before.json).length;
    // The seam returning ok is a WRAPPER claim; the readable log is the artifact.
    // A seam that reports success and seeds nothing leaves no era-2 log to append
    // to, so there is nothing here to witness the writer rule with — that is
    // `blocked`, not a writer-rule failure. Asserting against an empty log would
    // charge this requirement for a seam defect, which is the misattribution the
    // suite exists to avoid.
    if (seedCount === 0) {
      return softSkip('blocked', `seedEra2Log reported success but the log reads back empty (0 events) — the seam's return value is not evidence that a log exists, and without a seeded era-2 log the writer rule is unwitnessed here`);
    }

    // unfailable-leg audit, 2026-09-26: cancel was the ONLY write driven, and
    // it appends run.cancelled (and node.cancelled) — names the codemap spells
    // identically in v1 and v2. A host writing v2 names into an era-2 log
    // therefore produced the same rows as one writing v1 names, and the leg
    // recorded executed-pass either way. The discriminator needs a type the
    // codemap RENAMES. Best effort first: pause then resume the seeded run
    // through the core :pause / :resume operations (runs.md §Pause and
    // resume), which gives a host that records the resume transition a chance
    // to append `run.resuming` (v1) — read back as `run.resume-started` (v2).
    // Neither answer is asserted: the resume transition's event set is not
    // pinned to a renamed type, and a seeded run's pause is host latitude. If
    // no renamed type is appended, the leg records `blocked` below, not a pass.
    // 2.42.6: the writer-rule witness proper. `appendEra2Event` (host-sample-test-
    // seams.md §27) hands the host ONE event of a type the codemap RENAMES
    // (`agent.reasoning-delta`, stored v1 `agent.reasoning.delta`) and the host's
    // production writer chooses the stored spelling; the read below is the witness.
    // It is an artifact event, so it moves no projection. A host that claims the
    // seams profile but does not serve the seam records `blocked` — the gate above
    // already made a host without the profile `inapplicable`.
    const appended = await appendEra2Event(runId, WITNESS_TYPE, { agentId: 'conformance', delta: 'era-2 writer-rule witness', sequence: 0 });
    // A served seam that breaks its contract is `blocked`. An UNSERVED seam is not:
    // §27 is optional and newer than this leg, so its absence falls through to the
    // pre-seam path and ends in the partial witness below — it never denies a
    // host certification it held before the seam existed.
    if (!appended.ok && !appended.unserved) return softSkip(appended.kind, appended.reason);
    const seamServed = appended.ok;

    const enc = encodeURIComponent(runId);
    const paused = await http(() => driver.post(`/runs/${enc}:pause`, { reason: 'conformance', drainPolicy: 'immediate' }));
    if (paused?.status === 202) await http(() => driver.post(`/runs/${enc}:resume`, { reason: 'conformance' }));

    // A canonical mutation as well, so the host's own lifecycle writer appends
    // beside the seam's append. The seam append above already drove the
    // production writer, so a host that refuses cancel on a SEEDED run no longer
    // leaves the rule unwitnessed — the answer is not asserted here.
    await http(() => driver.post(`/runs/${enc}/cancel`, {}));

    const after = await pollEvents(runId);
    if (after === null) return softSkip('blocked', 'the event read failed after the append');

    // Failure mode 1: the read itself refuses. A host that wrote a v2-only name
    // into an era-2 log produces a type the codemap cannot map FROM.
    if (after.status !== 200) {
      const code = readErrorCode(after.json);
      expect(
        code,
        req(ID, DOC, `reading the era-2 log after the host's own append failed with ${after.status} ${String(code)} — an append in v2 vocabulary is exactly what makes a translated read fail, and the era key fixes the log's vocabulary for the run's lifetime`),
      ).toBe(null);
      return softSkip('blocked', `the era-2 read failed with ${after.status} after the host's own append — the assertion above already recorded the refusal`);
    }

    const rows = eventsOf(after.json) as ReadEvent[];
    expect(
      rows.length,
      req(ID, DOC, `the append MUST be visible in the log (seeded ${seedCount}, read ${rows.length} after cancel)`),
    ).toBeGreaterThan(seedCount);

    // Failure mode 2: the read succeeds but returns a name the v2 registry does
    // not carry — a v1 name that survived untranslated because it was written
    // after the upgrade and the host treated the log as era 3.
    const v2Names = new Set(codemapV1toV2().values());
    const v1Names = new Set(codemapV1toV2().keys());
    for (const row of rows.slice(seedCount)) {
      const type = String(row.type ?? '');
      // A renamed type is the discriminator: its v1 spelling must NOT appear on
      // the wire, because every reader translates an era-2 log.
      const renamedV1 = v1Names.has(type) && !v2Names.has(type);
      expect(
        renamedV1,
        req(ID, DOC, `the appended event reads as its v2 name, not its v1 spelling (${type}) — every reader translates an era-2 log, so a v1 name reaching the wire means the append bypassed the storage boundary`),
      ).toBe(false);
    }

    // Sequence stays contiguous across the era boundary the append crosses.
    const seqs = rows.map((r) => Number(r.sequence)).sort((a, b) => a - b);
    for (let i = 0; i < seqs.length; i++) {
      expect(
        seqs[i],
        req(ID, DOC, `the appended rows continue the seeded sequence space without a gap or restart (expected ${i}, got ${String(seqs[i])})`),
      ).toBe(i);
    }

    // unfailable-leg audit, 2026-09-26: the vocabulary is only observable
    // through a type the codemap renames. An appended row that reads back under
    // a RENAMED v2 name (v2 ≠ v1) through a successful translated read is the
    // positive witness: the stored spelling was the v1 one the reader maps
    // from. When every appended type is spelled the same in both vocabularies,
    // the rows above hold for a v1-writing and a v2-writing host alike, so the
    // writer rule is unobserved.
    const renamedV2 = new Set([...codemapV1toV2()].filter(([v1, v2]) => v1 !== v2).map(([, v2]) => v2));
    const appendedTypes = rows.slice(seedCount).map((r) => String(r.type ?? ''));
    if (!seamServed) {
      // partial-witness-ok: the host does not serve the optional appendEra2Event
      // seam (host-sample-test-seams.md §27), and no canonical mutation is pinned
      // to append a codemap-RENAMED type, so the writer rule is unobserved here.
      // The append, the read-back and the sequence rules above ARE observed. This
      // is the 2.42.5 disposition, kept for hosts without the seam; the
      // acceptance predicate refuses a partial-witness row.
      if (!appendedTypes.some((t) => renamedV2.has(t))) {
        return softSkip('inapplicable', `partial witness — the codemap-renaming writer rule is UNWITNESSED: ${appended.ok ? '' : appended.reason}; every type the host appended to the era-2 log (${appendedTypes.join(', ') || 'none'}) is spelled identically in v1 and v2 (spec/v2/event-codemap.json)`);
      }
      return;
    }
    expect(
      appendedTypes.includes(WITNESS_TYPE),
      req(ID, DOC, `the event appended through appendEra2Event (${WITNESS_TYPE}, a codemap-RENAMED type) MUST read back under its v2 name through the translated read — it read as ${appendedTypes.join(', ') || 'nothing'}: a host that stored the v2 spelling in an era-2 log makes the reader map it a second time (event_type_unmapped), and one that bypassed the storage boundary leaks the v1 spelling`),
    ).toBe(true);
  });

  it('the run keeps the era it was created with; an append does not promote it to era 3', async () => {
    const doc = await v2Discovery().catch(() => null);
    const gate = era2Gate(doc);
    if (gate !== null && !gate.ok) return softSkip(gate.kind, gate.reason);

    const seeded = await seedEra2Log(v1FixtureLog().slice(0, 2), 'running');
    if (!seeded.ok) return softSkip(seeded.kind, seeded.reason);
    const runId = seeded.runId;

    // unfailable-leg audit, 2026-09-26: the cancel's answer was ignored, so a
    // host that refused it (no append at all) still had its unappended run's
    // era read as the witness of "an append does not promote".
    const cancelled = await http(() => driver.post(`/runs/${encodeURIComponent(runId)}/cancel`, {}));
    if (cancelled === null || (cancelled.status !== 200 && cancelled.status !== 202 && cancelled.status !== 204)) {
      return softSkip('blocked', `POST /runs/{runId}/cancel answered ${cancelled?.status ?? 'no response'} on a seeded era-2 run — nothing was appended, so whether an append promotes the era is unwitnessed`);
    }

    const snap = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}`));
    if (snap === null || snap.status !== 200) {
      return softSkip('blocked', `GET /runs/{runId} answered ${snap?.status ?? 'no response'} — the era key cannot be read back`);
    }
    const era = (snap.json as { eventLogSchemaVersion?: unknown } | null)?.eventLogSchemaVersion;
    // unfailable-leg audit, 2026-09-26: `era === undefined` was accepted, so a
    // host that dropped the era key from the snapshot passed. runs.md §getRun
    // and persistence.md make eventLogSchemaVersion REQUIRED on every v2 run
    // snapshot (schemas/v2/run-snapshot.schema.json `required`); absent ⇒ 2 is
    // the STORAGE rule, not a wire latitude.
    expect(
      era,
      req(ID, DOC, `the era key is fixed at run creation: a run seeded in era 2 and then appended to MUST still read as era 2 (got ${String(era)}) — promoting it to 3 would strand the seeded rows in a vocabulary the reader no longer translates, and the snapshot MUST carry eventLogSchemaVersion (runs.md §getRun)`),
    ).toBe(2);
  });
});
