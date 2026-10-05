/**
 * `spec/v2/core/runs.md` §Snapshot — the conditional GET (suite 2.0.0, target
 * major 2; unaided; one run created).
 *
 * The 200 SHOULD carry a strong `ETag`; WHEN PRESENT, a matching
 * `If-None-Match` MUST receive `304` with no body. The SHOULD gates the MUST:
 * a host that sends no ETag records `inapplicable`. Every response carries
 * `OpenWOP-Version` (versioning.md §1.4), the 304 included.
 *
 * The revalidation runs once per client spelling (`OpenWOP-Version: 2.0`,
 * `2`, and `2` with a wildcard Accept): a host MUST treat them alike
 * (versioning.md §1), so a host that honours only the suite's own spelling
 * cannot pass by it.
 *
 * Control: a non-matching `If-None-Match` MUST receive 200 with the body — a
 * host that answers 304 to any conditional request fails here. `headers.md`
 * scopes `If-None-Match` to the discovery document; runs.md applies it to the
 * snapshot with a MUST (finding 5, filed).
 *
 * RFC 0235 (`runs.md` §Caching and encoding) adds four legs, shared with
 * `v2-discovery-etag` through `lib/if-none-match-witness.ts`: the RFC 9110
 * match (weak, list, `*`, and two negatives), a 304 carrying the ETag, a
 * request `Cache-Control: no-cache` not suppressing evaluation, and — only on
 * this surface — evaluation only where the answer would be 2xx: `*` or a
 * minted tag on a run id that does not exist gets the unconditional status,
 * never a 304 that would disclose the run. Each of them is `inapplicable` when
 * the snapshot carries no ETag, like the base leg.
 *
 * @see spec/v2/core/runs.md §Snapshot
 * @see spec/v2/core/runs.md §Caching and encoding
 * @see spec/v2/core/versioning.md §1.4
 */

import { pollUntilTerminal, scaledTimeoutMs } from '../lib/polling.js';
import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { v2Discovery } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { headersLeg, judgeNot2xx, matchLeg, noCacheLeg, type Get, type LegOutcome } from '../lib/if-none-match-witness.js';

const ID = 'openwop.requirement.0170.run-snapshot-etag';
const DOC = 'spec/v2/core/runs.md §Snapshot';
const NOOP = 'conformance-noop';
const MATCH_DOC = 'spec/v2/core/runs.md §Caching and encoding';
const ID_MATCH = 'openwop.requirement.0235.if-none-match.rfc9110-match';
const ID_304_ETAG = 'openwop.requirement.0235.if-none-match.304-carries-etag';
const ID_NO_CACHE = 'openwop.requirement.0235.if-none-match.no-cache-ignored';
const ID_ONLY_2XX = 'openwop.requirement.0235.if-none-match.only-on-2xx';
/** The client spellings a host MUST treat alike (versioning.md §1). */
const SPELLINGS: ReadonlyArray<Readonly<Record<string, string>>> = [
  { 'OpenWOP-Version': '2.0' },
  { 'OpenWOP-Version': '2' },
  { 'OpenWOP-Version': '2', Accept: '*/*' },
];
const label = (h: Readonly<Record<string, string>>): string => Object.entries(h).map(([k, v]) => `${k}: ${v}`).join(', ');

async function discovery(): Promise<Record<string, unknown> | null> { try { return await v2Discovery(); } catch { return null; } }
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> { try { return await fn(); } catch { return null; } }

describe('v2 run-snapshot-etag (runs.md §Snapshot)', () => {
  it('a matching If-None-Match receives 304 with no body and the version header; a non-matching one receives 200', async () => {
    if (!(await discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const created = await http(() => driver.post('/runs', { workflowId: NOOP }));
    if (created === null) return softSkip('blocked', 'POST /runs unreachable (fetch failed)');
    const runId = (created.json as { runId?: unknown } | null)?.runId;
    if (created.status !== 201 || typeof runId !== 'string') return softSkip('blocked', `POST /runs answered ${created.status} ${readErrorCode(created.json) ?? ''} — create refused`.trim());
    const path = `/runs/${encodeURIComponent(runId)}`;
    // The tag MUST be taken from a representation that has stopped moving. Until
    // 2.33.2 this slept a fixed 1 s and hoped. A host whose ETag tracks the run's
    // event-log sequence (RFC 0115 — the strong tag the SHOULD asks for) is still
    // appending while a noop executes, so between the two GETs the representation
    // CHANGES and `200` with a new tag is the only correct answer; a `304` there
    // would be a stale-cache bug. Measured on a tier-2 production host, 4 of 4:
    // immediately after create etag1 != etag2 and the conditional GET answers 200;
    // after the run settles the same request answers 304 every time. The row had
    // passed three earlier cuts of that host — a timing lottery, won when the run
    // happened to finish inside the sleep. It also let a host with a CONSTANT tag
    // pass for the wrong reason, which the control below still catches.
    await pollUntilTerminal(runId, { timeoutMs: scaledTimeoutMs(30_000) });
    for (const spelling of SPELLINGS) {
      let etag: string | null = null;
      let hit: OpenWOPResponse | null = null;
      // A terminal run should be still, but "should" is not the claim under test:
      // if the tag moves again, take the NEW tag and retry. The violation is a 200
      // whose ETag EQUALS the If-None-Match that was sent — never a 200 per se.
      for (let attempt = 0; attempt < 4; attempt++) {
        const first = await http(() => driver.get(path, { headers: { ...spelling } }));
        if (first === null || first.status !== 200) return softSkip('blocked', `GET /runs/{runId} answered ${first?.status ?? 'no response'}`);
        etag = first.headers.get('etag');
        if (!etag) return softSkip('inapplicable', 'the snapshot carries no ETag — runs.md §Snapshot makes the ETag a SHOULD; the 304 rule applies only when it is present');
        const sent = etag;
        hit = await http(() => driver.get(path, { headers: { ...spelling, 'If-None-Match': sent } }));
        if (hit === null) return softSkip('blocked', 'conditional GET unreachable (fetch failed)');
        if (hit.status !== 200 || hit.headers.get('etag') === sent) break; // 304, or the real violation: decided below
        await new Promise((r) => setTimeout(r, 500)); // 200 with a DIFFERENT tag: the representation moved; the tag sent was honestly stale
      }
      if (hit === null || etag === null) return softSkip('blocked', 'no conditional GET was made');
      if (hit.status === 200 && hit.headers.get('etag') !== etag) {
        return softSkip('blocked', `the snapshot of a TERMINAL run kept changing across four reads (last tag sent ${etag}, answered 200 with ${String(hit.headers.get('etag'))}) — the 304 rule cannot be witnessed against a representation that never holds still`);
      }
      expect(hit.status, req(ID, DOC, `under ${label(spelling)}, a request whose If-None-Match matches the CURRENT ETag MUST receive 304 — got ${hit.status} while the response still carried the same tag ${etag}`)).toBe(304);
      expect(hit.text.length, req(ID, DOC, `under ${label(spelling)}, the 304 MUST carry no body (got ${hit.text.length} byte(s))`)).toBe(0);
      expect(hit.headers.get('openwop-version'), req(ID, 'spec/v2/core/versioning.md §1.4', `under ${label(spelling)}, every response carries OpenWOP-Version, the 304 included`)).not.toBeNull();
    }
    const miss = await http(() => driver.get(path, { headers: { 'If-None-Match': '"openwop-conformance-no-such-tag"' } }));
    if (miss === null) return softSkip('blocked', 'conditional GET unreachable (fetch failed)');
    expect(miss.status, req(ID, DOC, `a non-matching If-None-Match MUST receive 200 with the body — got ${miss.status} (a host answering 304 to any conditional request is not honouring the tag)`)).toBe(200);
    expect((miss.json as { runId?: unknown } | null)?.runId, req(ID, DOC, 'the 200 body is the snapshot')).toBe(runId);
  });

  /** A settled run whose snapshot carries an ETag, or the reason there is none. */
  let settled: Promise<{ runId: string; tag: string } | { skip: 'blocked' | 'inapplicable'; reason: string }> | null = null;
  function settledRun(): Promise<{ runId: string; tag: string } | { skip: 'blocked' | 'inapplicable'; reason: string }> {
    settled ??= (async () => {
      if (!(await discovery())) return { skip: 'blocked' as const, reason: 'v2 discovery unreachable' };
      const created = await http(() => driver.post('/runs', { workflowId: NOOP }));
      const runId = (created?.json as { runId?: unknown } | null)?.runId;
      if (created === null || created.status !== 201 || typeof runId !== 'string') return { skip: 'blocked' as const, reason: `POST /runs answered ${created?.status ?? 'no response'} — create refused` };
      await pollUntilTerminal(runId, { timeoutMs: scaledTimeoutMs(30_000) });
      const ok = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}`));
      if (ok === null || ok.status !== 200) return { skip: 'blocked' as const, reason: `GET /runs/{runId} answered ${ok?.status ?? 'no response'}` };
      const tag = ok.headers.get('etag');
      if (!tag) return { skip: 'inapplicable' as const, reason: 'the snapshot carries no ETag — runs.md makes it a SHOULD; the If-None-Match rules apply only when it is present' };
      return { runId, tag };
    })();
    return settled;
  }
  const runGet = (runId: string): Get => (headers) => http(() => driver.get(`/runs/${encodeURIComponent(runId)}`, { headers: { ...headers } }));
  async function leg(fn: (get: Get) => Promise<LegOutcome>): Promise<LegOutcome | { kind: 'skip'; skip: 'blocked' | 'inapplicable'; reason: string }> {
    const run = await settledRun();
    if ('skip' in run) return { kind: 'skip', ...run };
    return fn(runGet(run.runId));
  }

  it('If-None-Match is evaluated as RFC 9110 defines it: a weak tag, a list holding the tag and `*` match; other tags do not', async () => {
    const out = await leg(matchLeg);
    if (out.kind === 'skip') return softSkip(out.skip, out.reason);
    if (out.kind === 'unreadable') return softSkip('blocked', `run snapshot: ${out.reason}`);
    expect(out.findings.join('; '), req(ID_MATCH, MATCH_DOC, 'If-None-Match is `*` or a list of entity tags compared weakly (RFC 9110 §13.1.2)')).toBe('');
  });

  it('a 304 carries the ETag and the Vary of the 200', async () => {
    const out = await leg(headersLeg);
    if (out.kind === 'skip') return softSkip(out.skip, out.reason);
    if (out.kind === 'unreadable') return softSkip('blocked', `run snapshot: ${out.reason}`);
    expect(out.findings.join('; '), req(ID_304_ETAG, MATCH_DOC, 'on a match the host MUST answer 304 carrying the ETag and the Vary the 200 would carry')).toBe('');
  });

  it('a request Cache-Control: no-cache does not suppress the evaluation', async () => {
    const out = await leg(noCacheLeg);
    if (out.kind === 'skip') return softSkip(out.skip, out.reason);
    if (out.kind === 'unreadable') return softSkip('blocked', `run snapshot: ${out.reason}`);
    expect(out.findings.join('; '), req(ID_NO_CACHE, MATCH_DOC, 'a request Cache-Control: no-cache MUST NOT suppress the evaluation')).toBe('');
  });

  it('a conditional request on a run that does not exist gets the unconditional status, never 304', async () => {
    const run = await settledRun();
    if ('skip' in run) return softSkip(run.skip, run.reason);
    // Same grammar and tenant as a real id, last character changed: an id this host never minted.
    const last = run.runId.slice(-1);
    const absent = run.runId.slice(0, -1) + (last === 'a' ? 'b' : 'a');
    const get = runGet(absent);
    const plain = await get({});
    if (plain === null) return softSkip('blocked', 'GET /runs/{runId} on an absent id could not be made');
    if (plain.status >= 200 && plain.status < 300) return softSkip('blocked', `an id differing from a real run in its last character answered ${plain.status}; no absent run to probe`);
    const findings: string[] = [];
    for (const sent of ['*', run.tag]) {
      const c = await get({ 'If-None-Match': sent });
      if (c === null) return softSkip('blocked', 'the conditional GET on an absent id could not be made');
      findings.push(...judgeNot2xx(plain.status, c.status, sent));
    }
    expect(findings.join('; '), req(ID_ONLY_2XX, MATCH_DOC, 'If-None-Match is evaluated only when the unconditional response would be 2xx; a run the caller cannot read stays 404')).toBe('');
  });
});
