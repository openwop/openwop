/**
 * RFC 0176 §A.5 — `fork-a-v1-run` (suite 2.0.0, target major 2; seam-gated on
 * `openwop-conformance-seams-v2` and gated on `replay`).
 *
 * A v2 host MUST fork a run created before the cut (era `2`). The fork's
 * prefix MUST be byte-equivalent to the TRANSLATED parent — the parent as read
 * through the codemap, not its stored bytes — under RFC 0041 §C (observable
 * output modulo clock fields and freshly minted ids), and `run.started` on the
 * fork MUST carry the legacy Subject (`issuer: urn:openwop:legacy`,
 * identity.md) where the parent had none (`spec/v2/core/replay.md` §Forking a
 * v1 run; persistence.md §Forking a v1 run; RFC 0170 §A.3).
 *
 * The era-2 parent is seeded in v1 vocabulary with a `run.started` that
 * carries no `owner` (a v1 payload) through the event-log seed seam
 * (lib/era2-seed.ts); the fork is `{ mode: replay, fromSeq: <last> }` so the
 * whole log below the terminal row is inherited history.
 *
 * @see spec/v2/core/replay.md §Forking a v1 run, §Byte-equivalence of the prefix
 * @see spec/v2/core/identity.md §1.2 (the legacy subject)
 */

import { describe, it, expect } from 'vitest';
import { v2Discovery, gateFamily } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { era2Gate, eventsOf, forkRun, observable, pollEvents, seedEra2Log, v1FixtureLog, type ReadEvent } from '../lib/era2-seed.js';

const DOC = 'spec/v2/core/replay.md §Forking a v1 run';
const LEGACY_ISSUER = 'urn:openwop:legacy';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}

type Forked =
  | { readonly ok: true; readonly parent: ReadEvent[]; readonly fork: ReadEvent[]; readonly fromSeq: number }
  | { readonly ok: false; readonly kind: 'blocked' | 'inapplicable' | 'skipped'; readonly reason: string };

async function forkedPair(): Promise<Forked> {
  const doc = await discovery();
  if (!doc) return { ok: false, kind: 'blocked', reason: 'discovery unreachable' };
  const gate = era2Gate(doc);
  if (gate !== null && !gate.ok) return { ok: false, kind: gate.kind, reason: gate.reason };
  if (!(await gateFamily('replay'))) return { ok: false, kind: 'inapplicable', reason: 'replay family not advertised (gate recorded under openwop.family.replay) — forkRun has no surface' };
  const log = v1FixtureLog();
  const seeded = await seedEra2Log(log, 'completed');
  if (!seeded.ok) return { ok: false, kind: seeded.kind, reason: seeded.reason };
  const parentRead = await pollEvents(seeded.runId);
  if (parentRead === null || parentRead.status !== 200) return { ok: false, kind: 'blocked', reason: `the translated parent could not be read — GET /runs/{runId}/events/poll answered ${parentRead?.status ?? 'no response'}` };
  const fromSeq = Math.max(...log.map((e) => e.sequence));
  const fork = await forkRun(seeded.runId, { mode: 'replay', fromSeq });
  if (fork === null) return { ok: false, kind: 'blocked', reason: 'POST /runs/{runId}:fork unreachable (fetch failed)' };
  if (fork.status !== 201) return { ok: false, kind: 'blocked', reason: `POST /runs/{runId}:fork on the era-2 parent answered ${fork.status} — the fork-a-v1-run obligation is asserted by openwop.requirement.0176.fork-a-v1-run.prefix, which records this refusal` };
  const forkId = (fork.json as { runId?: unknown } | undefined)?.runId;
  if (typeof forkId !== 'string') return { ok: false, kind: 'blocked', reason: 'the fork answered 201 without a runId' };
  const forkRead = await pollEvents(forkId);
  if (forkRead === null || forkRead.status !== 200) return { ok: false, kind: 'blocked', reason: `the fork's log could not be read — GET /runs/{forkId}/events/poll answered ${forkRead?.status ?? 'no response'}` };
  return { ok: true, parent: eventsOf(parentRead.json), fork: eventsOf(forkRead.json), fromSeq };
}

describe('RFC 0176 §A.5 — fork-a-v1-run (seam-gated, replay)', () => {
  it('the fork of an era-2 run is accepted and its prefix is byte-equivalent to the translated parent', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const pair = await forkedPair();
    if (!pair.ok) {
      // A refusal of the fork itself is the failure this leg exists to catch.
      if (pair.reason.includes(':fork on the era-2 parent answered')) {
        expect(pair.reason, req('openwop.requirement.0176.fork-a-v1-run.prefix', DOC, `a v2 host MUST fork a run created before the cut — ${pair.reason}`)).toBe('');
      }
      return softSkip(pair.kind, pair.reason);
    }
    const prefixOf = (events: ReadEvent[]) => events.filter((e) => typeof e.sequence === 'number' && e.sequence < pair.fromSeq).sort((a, b) => (a.sequence as number) - (b.sequence as number));
    const parent = prefixOf(pair.parent);
    const fork = prefixOf(pair.fork);
    expect(parent.length, req('openwop.requirement.0176.fork-a-v1-run.prefix', DOC, `the translated parent MUST expose its prefix [0, ${pair.fromSeq}) — got ${parent.length} rows`)).toBe(pair.fromSeq);
    expect(fork.length, req('openwop.requirement.0176.fork-a-v1-run.prefix', DOC, `the fork MUST inherit the whole prefix [0, ${pair.fromSeq}) as fixed history — got ${fork.length} rows`)).toBe(pair.fromSeq);
    for (let i = 0; i < parent.length; i++) {
      expect(
        fork[i] === undefined ? null : observable(fork[i]!),
        req('openwop.requirement.0176.fork-a-v1-run.prefix', 'spec/v2/core/replay.md §Byte-equivalence of the prefix', `sequence ${String(parent[i]!.sequence)}: the fork's row MUST be byte-equivalent (type, sequence, payload) to the TRANSLATED parent row — the parent as read through the codemap, never its stored v1 bytes (RFC 0041 §C)`),
      ).toBe(observable(parent[i]!));
    }
  });

  it('run.started on the fork carries the legacy Subject where the parent had none', async () => {
    const doc = await discovery();
    if (!doc) return softSkip('blocked', 'discovery unreachable');
    const pair = await forkedPair();
    if (!pair.ok) return softSkip(pair.kind, pair.reason);
    const started = pair.fork.find((e) => e.type === 'run.started');
    expect(started, req('openwop.requirement.0176.fork-a-v1-run.legacy-subject', DOC, 'the fork\'s log MUST carry run.started at its head')).toBeDefined();
    const owner = (started?.payload as { owner?: { subject?: { issuer?: unknown } } } | undefined)?.owner;
    expect(
      owner?.subject,
      req('openwop.requirement.0176.fork-a-v1-run.legacy-subject', 'spec/v2/core/identity.md §1.2', 'run.started on the fork MUST carry owner.subject — the seeded parent had none, so the host stamps the legacy Subject at first v2 read (RFC 0170 §A.3) and the fork copies it verbatim (replay.md §The surface)'),
    ).toBeDefined();
    expect(
      owner?.subject?.issuer,
      req('openwop.requirement.0176.fork-a-v1-run.legacy-subject', 'spec/v2/core/identity.md §1.2', `the stamped subject's issuer MUST be ${LEGACY_ISSUER} — nothing can attest the issuer of a historical principal, so a real issuer here is a forged provenance`),
    ).toBe(LEGACY_ISSUER);
    const parentStarted = pair.parent.find((e) => e.type === 'run.started');
    const parentIssuer = (parentStarted?.payload as { owner?: { subject?: { issuer?: unknown } } } | undefined)?.owner?.subject?.issuer;
    expect(
      parentIssuer,
      req('openwop.requirement.0176.fork-a-v1-run.legacy-subject', 'spec/v2/core/persistence.md §Everything else a v1 host persisted', `the parent read through v2 MUST carry the same legacy stamp (legacy-stamped at first v2 read, never rewritten) — got ${String(parentIssuer)}`),
    ).toBe(LEGACY_ISSUER);
  });
});
