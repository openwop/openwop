/**
 * run-transport-economy — RFC 0115 behavioral.
 *
 * Status: ACTIVE (capability-gated behavioral). Gated on
 * `capabilities.restTransport.conditionalRunGet === true` (conditional-GET
 * leg) and on a non-empty `capabilities.restTransport.contentEncodings`
 * (compression leg). Both legs soft-skip on hosts that do not advertise the
 * surface (incl. the reference workflow-engine, which has not yet wired the
 * sequence-derived `ETag` path), so they light up the moment a host advertises
 * `restTransport`.
 *
 * Asserts (per `spec/v1/rest-endpoints.md` §"`GET /v1/runs/{runId}`
 * conditional read + Content-Encoding (RFC 0115)"):
 *
 *   1. `GET /v1/runs/{runId}` carries a strong `ETag` on the `200`.
 *   2. A re-`GET` with `If-None-Match: <current ETag>` returns `304 Not
 *      Modified` with an empty body while the run has NOT advanced (the
 *      validator is stable while no observable transition occurs).
 *   3. After the run advances (the `conformance-approval` fixture is resumed
 *      from `waiting-approval` to `completed`), the `ETag` CHANGES — proving
 *      it is derived from the run's latest persisted event-log sequence
 *      number, not a coarser signal that could leave a `304` stale.
 *   4. For each advertised `contentEncodings` value, requesting it via
 *      `Accept-Encoding` yields a `Content-Encoding`-tagged response whose
 *      decoded bytes are byte-identical to the identity body.
 *
 * Non-vacuity: the `conformance-approval` fixture gives two deterministic,
 * stable observable states (suspended → completed), so the ETag-stability and
 * ETag-change assertions are exact rather than racing a fast run.
 *
 * @see RFCS/0115-run-transport-economy.md
 * @see spec/v1/rest-endpoints.md §"`GET /v1/runs/{runId}` conditional read + Content-Encoding (RFC 0115)"
 * @see spec/v1/replay.md §"durable event log" (the monotonic sequence the ETag derives from)
 */

import { describe, it, expect } from 'vitest';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import * as zlib from 'node:zlib';
import { driver } from '../lib/driver.js';
import { loadEnv } from '../lib/env.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { pollUntilStatus, pollUntilTerminal } from '../lib/polling.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;
const APPROVAL_FIXTURE = 'conformance-approval';
const APPROVAL_NODE_ID = 'gate';
const NOOP_FIXTURE = 'conformance-noop';

type Encoding = 'gzip' | 'br' | 'zstd';

interface RestTransportCaps {
  conditionalRunGet?: unknown;
  contentEncodings?: unknown;
}

async function readRestTransport(): Promise<RestTransportCaps | undefined> {
  try {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return undefined;
    return capabilityFamily<RestTransportCaps>(res.json, 'restTransport');
  } catch {
    return undefined;
  }
}

/** Advertised content-encodings, narrowed to the spec enum. */
function advertisedEncodings(caps: RestTransportCaps | undefined): Encoding[] {
  const raw = caps?.contentEncodings;
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is Encoding => e === 'gzip' || e === 'br' || e === 'zstd');
}

/** Read the run snapshot's ETag header (case-insensitive via Headers). */
function etagOf(res: { headers: Headers }): string | null {
  return res.headers.get('etag');
}

describe.skipIf(HTTP_SKIP)('run-transport-economy: conditional GET on run reads (RFC 0115)', () => {
  it('emits a sequence-derived strong ETag, honors If-None-Match with 304, and rotates the ETag when the run advances', async (ctx) => {
    const caps = await readRestTransport();
    if (caps?.conditionalRunGet !== true) {
      ctx.skip(); // host does not advertise restTransport.conditionalRunGet
      return;
    }

    // Use the approval fixture: it parks at a stable `waiting-approval` state,
    // then advances to `completed` on resolve — two deterministic snapshots.
    const create = await driver.post('/v1/runs', { workflowId: APPROVAL_FIXTURE });
    if (create.status === 404 || create.status === 422) {
      ctx.skip(); // fixture not advertised by this host
      return;
    }
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilStatus(runId, 'waiting-approval', { timeoutMs: 10_000 });

    // (1) Strong ETag present on the 200.
    const suspendedRead = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    expect(suspendedRead.status).toBe(200);
    const etagSuspended = etagOf(suspendedRead);
    expect(
      etagSuspended,
      driver.describe(
        'rest-endpoints.md §GET /v1/runs/{runId} conditional read (RFC 0115)',
        'a host advertising restTransport.conditionalRunGet MUST return a strong ETag on the 200',
      ),
    ).toBeTruthy();

    // (2) If-None-Match with the current ETag → 304, empty body, while unchanged.
    const revalidate = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`, {
      headers: { 'If-None-Match': etagSuspended as string },
    });
    expect(
      revalidate.status,
      driver.describe(
        'rest-endpoints.md §GET /v1/runs/{runId} conditional read (RFC 0115)',
        'If-None-Match matching the current ETag MUST return 304 Not Modified',
      ),
    ).toBe(304);
    expect(
      revalidate.text,
      driver.describe(
        'rest-endpoints.md §GET /v1/runs/{runId} conditional read (RFC 0115)',
        '304 Not Modified MUST carry no body',
      ),
    ).toBe('');

    // Advance the run: resolve the approval interrupt → terminal `completed`.
    const resolve = await driver.post(
      `/v1/runs/${encodeURIComponent(runId)}/interrupts/${encodeURIComponent(APPROVAL_NODE_ID)}`,
      { resumeValue: { action: 'accept' } },
    );
    expect(resolve.status).toBe(200);
    const terminal = await pollUntilTerminal(runId, { timeoutMs: 10_000 });
    expect(terminal.status).toBe('completed');

    // (3) ETag rotates after the observable state advanced.
    const completedRead = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`);
    expect(completedRead.status).toBe(200);
    const etagCompleted = etagOf(completedRead);
    expect(etagCompleted).toBeTruthy();
    expect(
      etagCompleted,
      driver.describe(
        'rest-endpoints.md §GET /v1/runs/{runId} conditional read (RFC 0115)',
        'the ETag MUST change once the run advances (it is derived from the latest event-log sequence); a stable ETag across an observable transition would leave a 304 stale',
      ),
    ).not.toBe(etagSuspended);

    // The new ETag is itself stable while the (now terminal) run does not change.
    const revalidateTerminal = await driver.get(`/v1/runs/${encodeURIComponent(runId)}`, {
      headers: { 'If-None-Match': etagCompleted as string },
    });
    expect(
      revalidateTerminal.status,
      driver.describe(
        'rest-endpoints.md §GET /v1/runs/{runId} conditional read (RFC 0115)',
        'the terminal ETag MUST be stable — If-None-Match against it returns 304',
      ),
    ).toBe(304);
  });
});

describe.skipIf(HTTP_SKIP)('run-transport-economy: Content-Encoding round-trips byte-identically (RFC 0115)', () => {
  it('each advertised contentEncodings value decodes to the identity body byte-for-byte', async (ctx) => {
    const caps = await readRestTransport();
    const encodings = advertisedEncodings(caps);
    if (encodings.length === 0) {
      ctx.skip(); // host advertises no run-read content encodings
      return;
    }

    // A terminal run gives a stable body to compare encodings against.
    const create = await driver.post('/v1/runs', { workflowId: NOOP_FIXTURE });
    if (create.status === 404 || create.status === 422) {
      ctx.skip();
      return;
    }
    expect(create.status).toBe(201);
    const runId = (create.json as { runId: string }).runId;
    await pollUntilTerminal(runId, { timeoutMs: 10_000 });

    const env = loadEnv();
    const url = `${env.baseUrl}/v1/runs/${encodeURIComponent(runId)}`;
    const auth = { Authorization: `Bearer ${env.apiKey}`, Accept: 'application/json' };

    // Identity baseline — explicit Accept-Encoding: identity so the host does
    // not compress; raw bytes are the comparison oracle.
    const identityRes = await fetch(url, { headers: { ...auth, 'Accept-Encoding': 'identity' } });
    expect(identityRes.status).toBe(200);
    const identityBytes = Buffer.from(await identityRes.arrayBuffer());
    expect(identityBytes.length).toBeGreaterThan(0);

    // Feature-detect zstd decode (Node >= 22.15 / 23.8); when absent we still
    // assert the host negotiated Content-Encoding but defer the byte-compare.
    // Cast-free: the optional-property view is assignable from the zlib module
    // namespace under structural typing whether or not @types/node declares it.
    const zlibMaybeZstd: { zstdDecompressSync?: (b: Buffer) => Buffer } = zlib;
    const zstdDecode: ((b: Buffer) => Buffer) | undefined =
      typeof zlibMaybeZstd.zstdDecompressSync === 'function'
        ? zlibMaybeZstd.zstdDecompressSync
        : undefined;

    for (const enc of encodings) {
      // Manually set Accept-Encoding so undici returns the raw compressed
      // bytes (it only auto-decompresses encodings it negotiated itself).
      const res = await fetch(url, { headers: { ...auth, 'Accept-Encoding': enc } });
      expect(res.status).toBe(200);
      const contentEncoding = res.headers.get('content-encoding');
      expect(
        contentEncoding,
        driver.describe(
          'rest-endpoints.md §GET /v1/runs/{runId} conditional read + Content-Encoding (RFC 0115)',
          `a host advertising restTransport.contentEncodings:["...","${enc}"] MUST set Content-Encoding: ${enc} when that encoding is requested`,
        ),
      ).toBe(enc);

      const compressedBytes = Buffer.from(await res.arrayBuffer());
      const decode = enc === 'gzip' ? gunzipSync : enc === 'br' ? brotliDecompressSync : zstdDecode;
      if (!decode) {
        // zstd decode unavailable in this runtime: negotiation already
        // asserted above; skip only the byte-compare for this encoding.
        expect(compressedBytes.length).toBeGreaterThan(0);
        continue;
      }
      const decoded = Buffer.from(decode(compressedBytes));
      expect(
        decoded.equals(identityBytes),
        driver.describe(
          'rest-endpoints.md §GET /v1/runs/{runId} conditional read + Content-Encoding (RFC 0115)',
          `the ${enc}-decoded body MUST be byte-identical to the identity body (Content-Encoding MUST NOT alter decoded bytes or semantics)`,
        ),
      ).toBe(true);
    }
  });
});
