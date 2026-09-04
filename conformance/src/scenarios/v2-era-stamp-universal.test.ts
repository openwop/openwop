/**
 * RFC 0176 §A.7 / `spec/v2/core/persistence.md` §The era key — every creation
 * path stamps the same era, and discovery advertises that one value (suite
 * 2.0.0, target major 2; unaided).
 *
 * The era trichotomy (absent ⇒ `2`, `2` = v1 era, `3` = v2 era) is sound only
 * because a v2 host stamps `3` on EVERY run it creates. A host with more than
 * one creation path that leaves one unstamped produces runs indistinguishable
 * from pre-cut runs, and every reader translates them as era `2` — a silent
 * wrong read, not an error. A tier-2 host found exactly this shape in review:
 * one creation path writing `2`, another writing nothing, and discovery
 * advertising `1`, a value no path wrote.
 *
 * This is witnessable unaided because the host's own discovery document states
 * the value it claims to write, and a run created through the canonical path
 * states what it actually wrote. A disagreement between them is the defect.
 *
 * @see spec/v2/core/persistence.md §The era key
 * @see RFCS/0176-v2-persisted-data-and-coexistence.md §A
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0176.era-stamp-universal';
const DOC = 'spec/v2/core/persistence.md §The era key';

async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

describe('v2-era-stamp-universal (RFC 0176 §A.7)', () => {
  it('discovery advertises an era the host actually writes, and a new run carries it', async () => {
    const doc = await v2Discovery().catch(() => null);
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');

    const advertised = doc['eventLogSchemaVersion'];
    if (advertised === undefined) {
      return softSkip('inapplicable', 'the host advertises no eventLogSchemaVersion — the era axis is undeclared, so there is no claim to falsify here');
    }
    expect(
      typeof advertised === 'number' && Number.isInteger(advertised),
      req(ID, DOC, `eventLogSchemaVersion is the era key and MUST be an integer (got ${JSON.stringify(advertised)})`),
    ).toBe(true);

    const created = await http(() => driver.post('/runs', { workflowId: 'conformance-noop', inputs: {} }));
    if (created === null || created.status !== 201) {
      return softSkip('blocked', `POST /runs answered ${created?.status ?? 'no response'} — a run the host created is what states the era it actually writes`);
    }
    const runId = (created.json as { runId?: unknown } | null)?.runId;
    if (typeof runId !== 'string') return softSkip('blocked', 'POST /runs returned no runId');

    const snap = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}`));
    if (snap === null || snap.status !== 200) {
      return softSkip('blocked', `GET /runs/{runId} answered ${snap?.status ?? 'no response'} — the snapshot is where the written era is reported`);
    }
    const written = (snap.json as { eventLogSchemaVersion?: unknown } | null)?.eventLogSchemaVersion;

    // The snapshot field is REQUIRED on the wire and may be synthesized for an
    // era-2 run, but a run this host just created is not era 2 — it is whatever
    // the host writes for new runs, which is the value discovery names.
    expect(
      written,
      req(ID, DOC, `the run snapshot MUST carry the era key — it is required on the wire, synthesized from absent-⇒-2 for historical runs and stated outright for a run the host just created (got ${JSON.stringify(written)})`),
    ).not.toBeUndefined();

    expect(
      written,
      req(ID, DOC, `discovery MUST advertise the value the host writes for new runs and nothing else: discovery says ${JSON.stringify(advertised)}, the run it just created says ${JSON.stringify(written)}. A host whose creation paths disagree has no single value to advertise, and whatever it publishes is false for some of its own runs`),
    ).toBe(advertised);
  });

  it('a v2-era host stamps 3, so its new runs are never read as the v1 era', async () => {
    const doc = await v2Discovery().catch(() => null);
    if (!doc) return softSkip('blocked', 'v2 discovery unreachable');
    const advertised = doc['eventLogSchemaVersion'];
    if (advertised === undefined) return softSkip('inapplicable', 'the host advertises no eventLogSchemaVersion');
    if (advertised !== 3) {
      return softSkip('inapplicable', `the host advertises era ${JSON.stringify(advertised)}, not 3 — this scenario checks that the advertised value AGREES with what the creation paths write, whatever that value is. Whether it MUST be 3 is v2-era-key's assertion, not this one; a host reached under target major 2 is a v2 host and persistence.md requires 3 there`);
    }

    const created = await http(() => driver.post('/runs', { workflowId: 'conformance-noop', inputs: {} }));
    if (created === null || created.status !== 201) {
      return softSkip('blocked', `POST /runs answered ${created?.status ?? 'no response'}`);
    }
    const runId = (created.json as { runId?: unknown } | null)?.runId;
    if (typeof runId !== 'string') return softSkip('blocked', 'POST /runs returned no runId');
    const snap = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}`));
    if (snap === null || snap.status !== 200) return softSkip('blocked', `GET /runs/{runId} answered ${snap?.status ?? 'no response'}`);

    expect(
      (snap.json as { eventLogSchemaVersion?: unknown } | null)?.eventLogSchemaVersion,
      req(ID, DOC, 'a host advertising era 3 MUST stamp 3 on every run it creates — an unstamped run made after the cut is indistinguishable from a pre-cut run and every reader translates it as era 2, which is a silent wrong read rather than an error'),
    ).toBe(3);
  });
});
