/**
 * v2-ext-rest-transport — RFC 0220 §C, the behavioral witness for the
 * `restTransport` extension family (suite 2.42.7, target major 2).
 *
 * Gate: the host advertises `extensions["<org>.rest-transport"]` under a
 * registered org (spec/v2/ext/restTransport/README.md §The claim). Absent ⇒
 * `inapplicable`. A malformed claim fails the claim leg; it does not skip.
 *
 * Legs, both recorded under `openwop.family.restTransport` so the family row is
 * the least certifiable of them (requirement-ledger fold):
 *
 *   1. `conditionalRunGet: true` — the `conformance-approval` fixture parks at
 *      `waiting-approval`, a stable state. The 200 carries a strong ETag, a
 *      matching If-None-Match gets 304 with no body, and once the approval is
 *      resolved and the run completes the ETag differs — a 304 across that
 *      transition would be stale (runs.md §"Caching and encoding").
 *   2. `contentEncodings` — for each advertised coding, the response carries
 *      that `Content-Encoding` and decodes to the identity body byte for byte.
 *
 * A leg whose facet the record does not set records `inapplicable` for itself
 * only: a host that claims one facet has promised nothing about the other.
 *
 * Ported from the v1 `run-transport-economy` scenario, which reads the v1 root
 * key; this one reads the v2 extensions record.
 *
 * @see RFCS/0220-ext-families-graduate-on-evidence.md
 * @see spec/v2/ext/restTransport/README.md
 * @see spec/v2/core/runs.md §"Caching and encoding"
 */
import { describe, it, expect } from 'vitest';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import * as zlib from 'node:zlib';
import { driver } from '../lib/driver.js';
import { loadEnv } from '../lib/env.js';
import { v2Discovery } from '../lib/v2.js';
import { extDeclaration, classifyExtClaim } from '../lib/ext-claims.js';
import { pollUntilStatus, pollUntilTerminal } from '../lib/polling.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

type Json = Record<string, unknown>;
type Encoding = 'gzip' | 'br' | 'zstd';
const APPROVAL_FIXTURE = 'conformance-approval';
const APPROVAL_NODE_ID = 'gate';
const NOOP_FIXTURE = 'conformance-noop';
const SECTION = 'spec/v2/ext/restTransport/README.md §What the claim adds';
const R = (why: string): string => req('openwop.family.restTransport', SECTION, why);

type Claim = { ok: true; record: Json; key: string } | { ok: false; kind: 'inapplicable' | 'blocked'; reason: string };

/** The one well-formed rest-transport record, or why there is none. A malformed claim is asserted here, not skipped. */
async function claim(): Promise<Claim> {
  const decl = extDeclaration();
  if (!decl) return { ok: false, kind: 'blocked', reason: 'spec/v2/declaration.json is not resolvable in this layout — the extension name and the org registry come from it' };
  const family = decl.families.find((f) => f.key === 'restTransport');
  if (!family) return { ok: false, kind: 'blocked', reason: 'the declaration has no ext row for restTransport — this scenario is stale against the corpus' };
  const doc = await v2Discovery();
  if (!doc) return { ok: false, kind: 'blocked', reason: 'v2 discovery unreachable' };
  const claims = classifyExtClaim(doc, family, decl);
  if (claims.length === 1 && claims[0].state === 'absent') return { ok: false, kind: 'inapplicable', reason: 'no extensions["<org>.rest-transport"] record under a registered org — the host does not advertise restTransport' };
  for (const c of claims) {
    if (c.state === 'malformed') expect(c.state, R(`extensions["${c.key}"]: ${c.why}`)).toBe('well-formed');
  }
  const first = claims.find((c) => c.state === 'well-formed');
  if (!first || first.state !== 'well-formed') return { ok: false, kind: 'blocked', reason: 'no well-formed rest-transport claim' };
  return { ok: true, record: ((doc['extensions'] as Json)[first.key] ?? {}) as Json, key: first.key };
}

function advertisedEncodings(record: Json): Encoding[] {
  const raw = record['contentEncodings'];
  return Array.isArray(raw) ? raw.filter((e): e is Encoding => e === 'gzip' || e === 'br' || e === 'zstd') : [];
}

describe('RFC 0220 §C — restTransport: conditional GET on the run snapshot', () => {
  it('a strong ETag on the 200, 304 on a match while the run is parked, and a new ETag once it completes', async () => {
    const c = await claim();
    if (!c.ok) return softSkip(c.kind, c.reason);
    if (c.record['conditionalRunGet'] !== true) return softSkip('inapplicable', `extensions["${c.key}"].conditionalRunGet is not true — the host claims no validator`);

    const create = await driver.post('/runs', { workflowId: APPROVAL_FIXTURE });
    // Any non-201 is the suite's precondition failing (fixture, credential), not the claim — the v2-a2ui gate's convention.
    if (create.status !== 201) return softSkip('blocked', `POST /runs {workflowId: ${APPROVAL_FIXTURE}} answered ${create.status} — the run the leg needs could not be created`);
    const runId = (create.json as { runId: string }).runId;
    const path = `/runs/${encodeURIComponent(runId)}`;
    await pollUntilStatus(runId, 'waiting-approval', { timeoutMs: 10_000 });

    const parked = await driver.get(path);
    expect(parked.status, R('the parked run reads 200')).toBe(200);
    const etagParked = parked.headers.get('etag');
    expect(etagParked, R('a host whose record sets conditionalRunGet: true MUST carry an ETag on every 200 of GET /runs/{runId}')).toBeTruthy();
    expect(etagParked?.startsWith('W/'), R('the ETag MUST be strong')).toBe(false);

    const revalidate = await driver.get(path, { headers: { 'If-None-Match': etagParked as string } });
    expect(revalidate.status, R('a matching If-None-Match MUST receive 304 while the run has not advanced (runs.md §"Caching and encoding")')).toBe(304);
    expect(revalidate.text, R('the 304 MUST carry no body')).toBe('');

    const resolve = await driver.post(`${path}/interrupts/${encodeURIComponent(APPROVAL_NODE_ID)}`, { resumeValue: { action: 'accept' } });
    expect(resolve.status, R('the approval resolves (control: the run must advance for the rotation check to mean anything)')).toBe(200);
    const terminal = await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    expect(terminal.status, R('the run completes')).toBe('completed');

    const done = await driver.get(path);
    const etagDone = done.headers.get('etag');
    expect(etagDone, R('the completed run still carries an ETag')).toBeTruthy();
    expect(etagDone, R('the ETag MUST change once the run advances; the parked ETag would otherwise answer 304 for a changed run')).not.toBe(etagParked);
    const stale = await driver.get(path, { headers: { 'If-None-Match': etagParked as string } });
    expect(stale.status, R('the parked ETag MUST NOT match the completed run')).toBe(200);
  });
});

describe('RFC 0220 §C — restTransport: each advertised coding round-trips', () => {
  it('each coding in contentEncodings is produced when asked for alone and decodes to the identity body', async () => {
    const c = await claim();
    if (!c.ok) return softSkip(c.kind, c.reason);
    const encodings = advertisedEncodings(c.record);
    if (encodings.length === 0) return softSkip('inapplicable', `extensions["${c.key}"].contentEncodings lists no coding — the host claims none`);

    const create = await driver.post('/runs', { workflowId: NOOP_FIXTURE });
    // Any non-201 is the suite's precondition failing (fixture, credential), not the claim — the v2-a2ui gate's convention.
    if (create.status !== 201) return softSkip('blocked', `POST /runs {workflowId: ${NOOP_FIXTURE}} answered ${create.status} — the run the leg needs could not be created`);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId, { timeoutMs: 10_000 });

    // A raw fetch, not the driver: the driver decodes JSON, and the oracle here is bytes.
    const env = loadEnv();
    const url = `${env.baseUrl}/runs/${encodeURIComponent(runId)}`;
    const base = { Authorization: `Bearer ${env.apiKey}`, Accept: 'application/json', 'OpenWOP-Version': '2.0' };
    const identity = await fetch(url, { headers: { ...base, 'Accept-Encoding': 'identity' } });
    expect(identity.status, R('the identity read is 200')).toBe(200);
    const identityBytes = Buffer.from(await identity.arrayBuffer());
    expect(identityBytes.length, R('the identity body is non-empty')).toBeGreaterThan(0);

    const zstdMaybe: { zstdDecompressSync?: (b: Buffer) => Buffer } = zlib;
    for (const enc of encodings) {
      const res = await fetch(url, { headers: { ...base, 'Accept-Encoding': enc } });
      expect(res.status, R(`the ${enc} read is 200`)).toBe(200);
      expect(res.headers.get('content-encoding'), R(`a coding listed in contentEncodings MUST be produced when it is the only one asked for (${enc})`)).toBe(enc);
      expect((res.headers.get('vary') ?? '').toLowerCase(), R('a compressed response MUST carry Vary: Accept-Encoding (runs.md §"Caching and encoding")')).toContain('accept-encoding');
      const bytes = Buffer.from(await res.arrayBuffer());
      // Node's fetch decodes gzip and br in transit, so equal bytes already prove the round trip.
      const decode = enc === 'gzip' ? gunzipSync : enc === 'br' ? brotliDecompressSync : zstdMaybe.zstdDecompressSync;
      // No zstd decoder in this Node: the coding was produced (asserted above); the byte compare needs a decoder the suite lacks.
      if (!bytes.equals(identityBytes) && !decode) continue;
      let decoded = bytes;
      if (!bytes.equals(identityBytes) && decode) {
        try { decoded = Buffer.from(decode(bytes)); } catch { /* not compressed bytes either: a real mismatch, compared below */ }
      }
      expect(decoded.equals(identityBytes), R(`the ${enc}-decoded body MUST be byte-identical to the identity body`)).toBe(true);
    }
  });
});
