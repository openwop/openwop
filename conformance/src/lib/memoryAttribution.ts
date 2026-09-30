/**
 * Shared helpers for the RFC 0057 memory write-attribution scenarios.
 * Lives in lib/ (not a *.test.ts) so scenarios import it via `../lib/memoryAttribution.js`.
 */
import { driver } from './driver.js';
import { discoveryFamilies } from './discovery-capabilities.js';
import { isFixtureAdvertised } from './fixtures.js';
import { targetMajor } from './seams.js';
import { gateFamily } from './v2.js';

/**
 * The runs collection under the major in play. `/v1/runs` is a v1 address, not
 * a seam, so `driver`'s seam rewrite does not touch it and a v1-shaped helper
 * simply 404s on a v2 host. Every path in this file goes through here so a
 * scenario can be made dual-major without editing three call sites and missing
 * a fourth.
 */
export const runsPath = (): string => (targetMajor() === 2 ? '/runs' : '/v1/runs');

/**
 * `memory.attribution`, read the way the major in play advertises it, with the
 * gate RECORDED at major 2.
 *
 * At major 1 this is the v1 capability read it always was. At major 2 it goes
 * through `gateFamily('memory')`, which registers `openwop.family.memory` in
 * the behaviour ledger — so a bundle distinguishes "the host does not
 * advertise `memory`" from "the suite's reader did not understand the shape".
 * An unrecorded early return looks identical to both, and to a scenario that
 * was never selected; that is the whole reason a v1 behavioural file cannot
 * just be pointed at a v2 host and trusted.
 */
export async function readMemoryAttributionCap(): Promise<Record<string, unknown> | null> {
  if (targetMajor() === 2) {
    const family = await gateFamily('memory');
    const attr = family?.['attribution'];
    return attr && typeof attr === 'object' && !Array.isArray(attr) ? (attr as Record<string, unknown>) : null;
  }
  const res = await driver.get('/.well-known/openwop');
  const caps = discoveryFamilies(res.json);
  const mem = caps && typeof caps === 'object' ? (caps as Record<string, unknown>)['memory'] : undefined;
  const attr = mem && typeof mem === 'object' ? (mem as Record<string, unknown>)['attribution'] : undefined;
  return attr && typeof attr === 'object' ? (attr as Record<string, unknown>) : null;
}

/**
 * True when the host commits to emitting `memory.written`.
 *
 * Major 1: the v1 block's `supported: true` (its schema `const`) AND
 * `emitsWriteEvents: true`. Major 2: there is no `supported` field — presence
 * of the `memory` family record IS the claim (RFC 0169 §A.2), and
 * `readMemoryAttributionCap` returns the `attribution` object only when that
 * record is present — so the commitment is `emitsWriteEvents: true` alone.
 * Requiring `supported` at major 2 soft-skipped every v2 host (suite 2.45.3).
 */
export function emitsWriteEvents(cap: Record<string, unknown> | null): boolean {
  if (cap?.['emitsWriteEvents'] !== true) return false;
  return targetMajor() === 2 ? true : cap['supported'] === true;
}

const SEED_FIXTURE = 'conformance-noop';

/** Seeds a basic run (the host writes a run-summary on completion); null
 *  (soft-skip) when the fixture isn't advertised or creation fails. */
export async function seedRun(_label: string): Promise<string | null> {
  if (!isFixtureAdvertised(SEED_FIXTURE)) return null;
  // S41 (2026-08-17): the argument used to be sent as `tenantId` on POST /v1/runs. It was
  // a fabricated label (`mem-attr-emit`, `feedback-cti`, …), and a host that enforces
  // "tenantId MUST match the principal's accessible workspaces" answers 403 — MyndHyve did,
  // which left every scenario on this helper `blocked` and kept `openwop-memory` from
  // certifying. No caller ever needed a SECOND tenant: every leg reads back its own run.
  // The tenant is the credential's own tenant (the host defaults it from the API key —
  // rest-endpoints.md), which is what "a run the bearer provably owns" means.
  const r = await driver.post(runsPath(), { workflowId: SEED_FIXTURE, inputs: {} });
  if (r.status !== 200 && r.status !== 201) return null;
  return (r.json as { runId?: string } | undefined)?.runId ?? null;
}

interface RunEventLike {
  type: string;
  runId?: string;
  payload?: Record<string, unknown>;
}

/**
 * Fetches a run's events and returns only the `memory.written` ones.
 *
 * Major 2: `GET /runs/{runId}/events` is the SSE stream (`streamRunEvents`,
 * `text/event-stream` only), so a JSON read of it yields nothing and every leg
 * would soft-skip "run wrote no memory" — a `blocked` row that denies
 * certification for a suite defect. The JSON projection at v2 is the poll
 * (`events.md` §Poll), read from sequence 0 and paged on `afterSequence` until
 * `lastSequence` is reached.
 */
export async function memoryWrittenEvents(runId: string): Promise<RunEventLike[]> {
  if (targetMajor() !== 2) {
    const res = await driver.get(`${runsPath()}/${encodeURIComponent(runId)}/events`);
    const events = (res.json as { events?: RunEventLike[] } | undefined)?.events ?? [];
    return events.filter((e) => e.type === 'memory.written');
  }
  const out: RunEventLike[] = [];
  let after = -1;
  for (let page = 0; page < 50; page++) {
    const q = after < 0 ? '' : `&afterSequence=${after}`;
    const res = await driver.get(`/runs/${encodeURIComponent(runId)}/events/poll?timeout=1${q}`);
    const body = res.json as { events?: Array<RunEventLike & { sequence?: number }>; lastSequence?: number } | undefined;
    const events = res.status === 200 && Array.isArray(body?.events) ? body.events : [];
    out.push(...events);
    const seqs = events.map((e) => e.sequence).filter((s): s is number => typeof s === 'number');
    const next = seqs.length ? Math.max(...seqs) : after;
    if (next <= after || typeof body?.lastSequence !== 'number' || next >= body.lastSequence) break;
    after = next;
  }
  return out.filter((e) => e.type === 'memory.written');
}
