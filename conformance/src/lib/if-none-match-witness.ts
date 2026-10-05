/**
 * `If-None-Match` evaluation (RFC 0235; `spec/v2/core/runs.md` §Caching and
 * encoding), shared by `v2-discovery-etag` and `v2-run-snapshot-etag` so both
 * surfaces are judged by one reading of RFC 9110 §13.1.2.
 *
 * Two halves, as in the other shared witnesses: `observeProbe` asserts nothing
 * and returns what the host answered (or why it could not be read); the
 * `judge*` functions are pure and return findings. The scenarios map findings
 * to requirement ids.
 */

import type { OpenWOPResponse } from './driver.js';

/** Sends one GET with the given extra headers; `null` when the request could not be made. */
export type Get = (headers: Readonly<Record<string, string>>) => Promise<OpenWOPResponse | null>;

export const NO_SUCH_TAG = '"openwop-conformance-no-such-tag"';

/** The opaque part of an entity tag: `W/"x"` and `"x"` both give `"x"` (RFC 9110 §8.8.3.2 weak comparison). */
export const opaque = (tag: string): string => tag.trim().replace(/^W\//, '');

export interface Probe {
  readonly name: string;
  /** The `If-None-Match` value, built from the tag of the preceding `200`. */
  readonly value: (tag: string) => string;
  readonly extra?: Readonly<Record<string, string>>;
  readonly want: 200 | 304;
}

/** RFC 0235 §D legs 1–3 and 5: weak, list, star, and the two negatives. */
export const MATCH_PROBES: readonly Probe[] = [
  { name: 'weak', value: (t) => `W/${opaque(t)}`, want: 304 },
  { name: 'list', value: (t) => `${NO_SUCH_TAG}, ${t}`, want: 304 },
  { name: 'star', value: () => '*', want: 304 },
  { name: 'non-matching list', value: () => `${NO_SUCH_TAG}, "openwop-conformance-no-such-tag-2"`, want: 200 },
  { name: 'non-matching weak tag', value: () => `W/${NO_SUCH_TAG}`, want: 200 },
];

/** RFC 0235 §D leg 7. */
export const NO_CACHE_PROBE: Probe = { name: 'no-cache', value: (t) => t, extra: { 'Cache-Control': 'no-cache' }, want: 304 };

/** What one conditional request returned, with the `200` it was built from. */
export interface Observed {
  readonly probe: Probe;
  readonly tag: string;
  readonly sent: string;
  /** `Vary` on the unconditional `200`, or null. */
  readonly okVary: string | null;
  readonly status: number;
  readonly bodyLength: number;
  readonly etag: string | null;
  readonly vary: string | null;
}

export type Observation = { readonly kind: 'observed'; readonly obs: Observed } | { readonly kind: 'unreadable'; readonly reason: string };

/**
 * GET the resource, take its `ETag`, then send the probe. A `200` carrying a
 * DIFFERENT tag on a probe that should match means the representation moved
 * between the two reads, so the probe is retried with the new tag (up to four
 * times). A `200` with the same tag is the violation and is returned as is.
 */
export async function observeProbe(get: Get, probe: Probe): Promise<Observation> {
  let last: Observed | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const ok = await get({});
    if (ok === null || ok.status !== 200) return { kind: 'unreadable', reason: `the unconditional GET answered ${ok?.status ?? 'no response'}` };
    const tag = ok.headers.get('etag');
    if (!tag) return { kind: 'unreadable', reason: 'the 200 carries no ETag' };
    const sent = probe.value(tag);
    const res = await get({ ...probe.extra, 'If-None-Match': sent });
    if (res === null) return { kind: 'unreadable', reason: `the ${probe.name} conditional GET could not be made` };
    last = { probe, tag, sent, okVary: ok.headers.get('vary'), status: res.status, bodyLength: res.text.length, etag: res.headers.get('etag'), vary: res.headers.get('vary') };
    const moved = probe.want === 304 && res.status === 200 && res.headers.get('etag') !== null && opaque(res.headers.get('etag') as string) !== opaque(tag);
    if (!moved) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return last ? { kind: 'observed', obs: last } : { kind: 'unreadable', reason: 'no conditional GET was made' };
}

/** §A match semantics: the status the probe wants, and no body on a `304`. */
export function judgeMatch(o: Observed): string[] {
  const out: string[] = [];
  if (o.status !== o.probe.want) out.push(`${o.probe.name}: If-None-Match ${o.sent} against ETag ${o.tag} MUST receive ${o.probe.want}, got ${o.status}`);
  if (o.status === 304 && o.bodyLength !== 0) out.push(`${o.probe.name}: a 304 MUST carry no body (got ${o.bodyLength} byte(s))`);
  return out;
}

const varySet = (v: string | null): string => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).sort().join(',');

/** §A a `304` carries the `ETag`, and the `Vary` the `200` would carry. Vacuous on a non-304. */
export function judge304Headers(o: Observed): string[] {
  if (o.status !== 304) return [];
  const out: string[] = [];
  if (o.etag === null) out.push(`${o.probe.name}: the 304 MUST carry the ETag (${o.tag}); it carried none`);
  else if (opaque(o.etag) !== opaque(o.tag)) out.push(`${o.probe.name}: the 304 MUST carry the ETag of the representation (${o.tag}); it carried ${o.etag}`);
  if (o.okVary !== null && varySet(o.vary) !== varySet(o.okVary)) out.push(`${o.probe.name}: the 304 MUST carry the Vary the 200 carries (${o.okVary}); it carried ${o.vary ?? 'none'}`);
  return out;
}

/**
 * §A evaluation only where the unconditional answer would be `2xx`: a
 * conditional request on a resource the caller cannot read gets that same
 * non-2xx status, never `304`.
 */
export function judgeNot2xx(unconditional: number, conditional: number, sent: string): string[] {
  if (unconditional >= 200 && unconditional < 300) return [];
  return conditional === unconditional ? [] : [`If-None-Match ${sent} on a resource answering ${unconditional} unconditionally MUST receive ${unconditional}, got ${conditional}${conditional === 304 ? ' (a 304 discloses that the resource exists)' : ''}`];
}

/** A plain `If-None-Match: <tag>`: the base case every 304 leg also inspects. */
export const EXACT_PROBE: Probe = { name: 'exact', value: (t) => t, want: 304 };

export type LegOutcome = { readonly kind: 'observed'; readonly findings: string[] } | { readonly kind: 'unreadable'; readonly reason: string };

async function each(get: Get, probes: readonly Probe[], judge: (o: Observed) => string[]): Promise<LegOutcome & { seen?: Observed[] }> {
  const findings: string[] = [];
  const seen: Observed[] = [];
  for (const p of probes) {
    const o = await observeProbe(get, p);
    if (o.kind === 'unreadable') return o;
    seen.push(o.obs);
    findings.push(...judge(o.obs));
  }
  return { kind: 'observed', findings, seen };
}

/** RFC 0235 §D legs 1–3 and 5. */
export const matchLeg = (get: Get): Promise<LegOutcome> => each(get, MATCH_PROBES, judgeMatch);

/** RFC 0235 §D leg 7. */
export const noCacheLeg = (get: Get): Promise<LegOutcome> => each(get, [NO_CACHE_PROBE], judgeMatch);

/** RFC 0235 §D leg 6, over every probe that should yield a 304. Unreadable when the host never answered 304. */
export async function headersLeg(get: Get): Promise<LegOutcome> {
  const out = await each(get, [EXACT_PROBE, ...MATCH_PROBES.filter((p) => p.want === 304)], judge304Headers);
  if (out.kind === 'observed' && !(out.seen ?? []).some((o) => o.status === 304)) return { kind: 'unreadable', reason: 'no probe was answered 304, so there is no 304 to inspect (the match leg records why)' };
  return out.kind === 'observed' ? { kind: 'observed', findings: out.findings } : out;
}
