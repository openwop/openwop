/**
 * RFC 0176 §A.2 — `era-key` (suite 2.0.0, target major 2; unaided).
 *
 * `eventLogSchemaVersion` is the era key: a v2 host MUST stamp `3` on every run
 * it creates, the field is REQUIRED on every run snapshot
 * (`schemas/v2/run-snapshot.schema.json`), and discovery advertises the value
 * the host writes for new runs and nothing else (`spec/v2/core/persistence.md`
 * §The era key; versioning.md §2.2). The absent-⇒-`2` half of the rule is a
 * property of a store a v1 host has written and is witnessed by the seam-gated
 * `v2-v1-events-translated` scenario, not here.
 *
 * Legs:
 *   1. a run created now (`POST /runs`, the `conformance-noop` fixture) reads
 *      back with `eventLogSchemaVersion: 3`;
 *   2. discovery's `eventLogSchemaVersion` equals the value the host wrote.
 *
 * @see spec/v2/core/persistence.md §The era key
 * @see spec/v2/core/runs.md §getRun
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/persistence.md §The era key';
const NOOP_WORKFLOW_ID = 'conformance-noop';
const V2_ERA = 3;

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

async function freshSnapshot(): Promise<{ snapshot: Record<string, unknown> } | { reason: string }> {
  const created = await http(() => driver.post('/runs', { workflowId: NOOP_WORKFLOW_ID }));
  if (created === null) return { reason: 'POST /runs unreachable (fetch failed)' };
  const runId = (created.json as { runId?: unknown } | undefined)?.runId;
  if (created.status !== 201 || typeof runId !== 'string') {
    return { reason: `POST /runs {workflowId: ${NOOP_WORKFLOW_ID}} answered ${created.status} ${readErrorCode(created.json) ?? ''} — the smallest valid create was refused (fixture not seeded?)`.trim() };
  }
  const snap = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}`));
  if (snap === null || snap.status !== 200 || !snap.json || typeof snap.json !== 'object') return { reason: `GET /runs/{runId} answered ${snap?.status ?? 'no response'} for the run just created` };
  return { snapshot: snap.json as Record<string, unknown> };
}

describe('RFC 0176 §A.2 — era-key (unaided)', () => {
  it('a run created now carries eventLogSchemaVersion 3 on its snapshot', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const s = await freshSnapshot();
    if ('reason' in s) return softSkip('blocked', s.reason);
    expect(
      s.snapshot['eventLogSchemaVersion'],
      req('openwop.requirement.0176.era-key', DOC, 'eventLogSchemaVersion is REQUIRED on every run snapshot (run-snapshot.schema.json) — the era key is never absent on a run a v2 host created'),
    ).toBeDefined();
    expect(
      s.snapshot['eventLogSchemaVersion'],
      req('openwop.requirement.0176.era-key', DOC, `a v2 host MUST stamp ${V2_ERA} on every run it creates (RFC 0176 §A.2; versioning.md §2.2) — got ${String(s.snapshot['eventLogSchemaVersion'])}`),
    ).toBe(V2_ERA);
  });

  it('discovery advertises the value the host writes for new runs and nothing else', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const advertised = doc['eventLogSchemaVersion'];
    expect(
      Number.isInteger(advertised),
      req('openwop.requirement.0176.era-key.discovery', 'spec/v2/core/versioning.md §2.2', `discovery MUST advertise eventLogSchemaVersion as an integer (metadata key, capabilities.md §Metadata) — got ${String(advertised)}`),
    ).toBe(true);
    expect(
      advertised,
      req('openwop.requirement.0176.era-key.discovery', 'spec/v2/core/versioning.md §2.2', `the advertised value is the one the host writes for NEW runs: ${V2_ERA} on a v2 host (a host holds one constant for this axis, RFC 0167 §F)`),
    ).toBe(V2_ERA);
    const s = await freshSnapshot();
    if ('reason' in s) return softSkip('blocked', `${s.reason} — the advertised value was checked, its agreement with a written run was not`);
    expect(
      s.snapshot['eventLogSchemaVersion'],
      req('openwop.requirement.0176.era-key.discovery', DOC, 'the value stamped on a run created now MUST equal the value discovery advertises'),
    ).toBe(advertised);
  });
});
