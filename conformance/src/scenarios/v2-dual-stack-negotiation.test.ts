/**
 * v2 — `dual-stack-negotiation` (suite 2.0.0; RFC 0172 §A.3–§A.4;
 * `spec/v2/core/versioning.md` §1.3 "The request header", §1.4 "The response
 * header", §5 "The overlap").
 *
 * Witness class: witnessable — gated on two majors. Unless `protocolVersions[]`
 * carries both a `1.x` and a `2.x` member the file records `inapplicable`. On a
 * dual-advertising host: a run created through `/v1/runs` with NO
 * `OpenWOP-Version` header is readable through `GET /runs/{runId}` under
 * `OpenWOP-Version: 2.0`; an unlisted major (`9.0`) is `406
 * protocol_version_unsupported` with `details.protocolVersions[]`;
 * `OpenWOP-Version: 2.0` on a `/v1/…` path is `400 protocol_version_mismatch`;
 * every response's `OpenWOP-Version` equals the contract that produced it. The
 * header-less v1 call bypasses the driver (which stamps `OpenWOP-Version: 2.0`
 * under target major 2) with a raw `fetch` against the same base URL.
 */

import { describe, it, expect } from 'vitest';
import { driver, type OpenWOPResponse } from '../lib/driver.js';
import { loadEnv } from '../lib/env.js';
import { v2Discovery } from '../lib/v2.js';
import { readErrorCode } from '../lib/error-envelope.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const DOC = 'spec/v2/core/versioning.md §1.3';
const NOOP_WORKFLOW_ID = 'conformance-noop';

async function discovery(): Promise<Record<string, unknown> | null> {
  try { return await v2Discovery(); } catch { return null; }
}
async function http(fn: () => Promise<OpenWOPResponse>): Promise<OpenWOPResponse | null> {
  try { return await fn(); } catch { return null; }
}

/** Raw request with exactly the headers given — no OpenWOP-Version unless named. */
async function raw(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<OpenWOPResponse | null> {
  try {
    const env = loadEnv();
    const init: RequestInit = { method, headers: { Accept: 'application/json', Authorization: `Bearer ${env.apiKey}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers } };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(`${env.baseUrl}${path}`, init);
    const text = await res.text();
    let json: unknown;
    try { json = text.length > 0 ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: res.status, headers: res.headers, text, json };
  } catch {
    return null;
  }
}

function major(res: OpenWOPResponse | null): string | null {
  const v = res?.headers.get('openwop-version')?.trim();
  return v === undefined ? null : (v.split('.')[0] ?? null);
}

async function gate(): Promise<{ versions: string[] } | { kind: 'blocked' | 'inapplicable'; reason: string }> {
  const doc = await discovery();
  if (!doc) return { kind: 'blocked', reason: 'v2 discovery unreachable — /.well-known/openwop did not answer 200 with a JSON body under OpenWOP-Version: 2.0' };
  const versions = Array.isArray(doc['protocolVersions']) ? (doc['protocolVersions'] as unknown[]).filter((v): v is string => typeof v === 'string') : [];
  const has1 = versions.some((v) => v.startsWith('1.'));
  const has2 = versions.some((v) => v.startsWith('2.'));
  if (!(has1 && has2)) return { kind: 'inapplicable', reason: `protocolVersions [${versions.join(', ')}] does not carry both a 1.x and a 2.x member — dual-stack negotiation is gated on two majors` };
  return { versions };
}

describe('v2 dual-stack-negotiation (RFC 0172 §A.3–§A.4 — gated on two majors)', () => {
  it('a run created through /v1/runs with no header is readable through /runs under OpenWOP-Version: 2.0', async () => {
    const g = await gate();
    if ('kind' in g) return softSkip(g.kind, g.reason);
    const created = await raw('POST', '/v1/runs', {}, { workflowId: NOOP_WORKFLOW_ID });
    if (created === null) return softSkip('blocked', 'POST /v1/runs unreachable (fetch failed)');
    const runId = (created.json as { runId?: unknown } | undefined)?.runId;
    if (created.status !== 201 || typeof runId !== 'string') return softSkip('blocked', `POST /v1/runs {workflowId: ${NOOP_WORKFLOW_ID}} with no header answered ${created.status} ${readErrorCode(created.json) ?? ''} — the v1 create was refused (fixture not seeded?)`);
    expect(major(created), req('openwop.requirement.0172.dual-stack-negotiation.cross-major-read', 'spec/v2/core/versioning.md §1.4', 'a /v1/ response MUST report the 1.x contract that produced it')).toBe('1');
    const read = await http(() => driver.get(`/runs/${encodeURIComponent(runId)}`, { headers: { 'OpenWOP-Version': '2.0' } }));
    if (read === null) return softSkip('blocked', 'GET /runs/{runId} unreachable (fetch failed)');
    expect(read.status, req('openwop.requirement.0172.dual-stack-negotiation.cross-major-read', 'spec/v2/core/versioning.md §5', 'the overlap: a run created through /v1/runs MUST be readable through GET /runs/{runId} with OpenWOP-Version: 2.0')).toBe(200);
    expect((read.json as { runId?: unknown } | undefined)?.runId, req('openwop.requirement.0172.dual-stack-negotiation.cross-major-read', 'spec/v2/core/versioning.md §5', 'the v2 read MUST name the same run')).toBe(runId);
    expect(major(read), req('openwop.requirement.0172.dual-stack-negotiation.cross-major-read', 'spec/v2/core/versioning.md §1.4', 'the v2 read MUST report the 2.x contract that produced it')).toBe('2');
  });

  it('an unlisted major is 406 protocol_version_unsupported with details.protocolVersions[]', async () => {
    const g = await gate();
    if ('kind' in g) return softSkip(g.kind, g.reason);
    const res = await http(() => driver.get('/.well-known/openwop', { authenticated: false, headers: { 'OpenWOP-Version': '9.0' } }));
    if (res === null) return softSkip('blocked', 'GET /.well-known/openwop unreachable (fetch failed)');
    expect(res.status, req('openwop.requirement.0172.dual-stack-negotiation.unlisted-major', DOC, 'a header naming a major not in protocolVersions[] MUST be answered 406')).toBe(406);
    expect(readErrorCode(res.json), req('openwop.requirement.0172.dual-stack-negotiation.unlisted-major', DOC, 'the refusal code MUST be protocol_version_unsupported')).toBe('protocol_version_unsupported');
    const echoed = (res.json as { details?: { protocolVersions?: unknown } } | undefined)?.details?.protocolVersions;
    expect(Array.isArray(echoed) ? [...echoed].sort() : echoed, req('openwop.requirement.0172.dual-stack-negotiation.unlisted-major', DOC, 'details.protocolVersions[] MUST echo the advertised list')).toEqual([...g.versions].sort());
  });

  it('OpenWOP-Version: 2.0 on a /v1/ path is 400 protocol_version_mismatch', async () => {
    const g = await gate();
    if ('kind' in g) return softSkip(g.kind, g.reason);
    const res = await http(() => driver.get('/v1/openapi.json', { authenticated: false, headers: { 'OpenWOP-Version': '2.0' } }));
    if (res === null) return softSkip('blocked', 'GET /v1/openapi.json unreachable (fetch failed)');
    expect(res.status, req('openwop.requirement.0172.dual-stack-negotiation.v1-path-mismatch', DOC, 'a /v1/… path with OpenWOP-Version other than 1 MUST be answered 400')).toBe(400);
    expect(readErrorCode(res.json), req('openwop.requirement.0172.dual-stack-negotiation.v1-path-mismatch', DOC, 'the refusal code MUST be protocol_version_mismatch')).toBe('protocol_version_mismatch');
  });

  it('every response reports the contract that produced it', async () => {
    const g = await gate();
    if ('kind' in g) return softSkip(g.kind, g.reason);
    const v1 = await raw('GET', '/v1/openapi.json', {});
    const v1Named = await raw('GET', '/v1/openapi.json', { 'OpenWOP-Version': '1.0' });
    const v2 = await http(() => driver.get('/.well-known/openwop', { authenticated: false, headers: { 'OpenWOP-Version': '2.0' } }));
    if (v1 === null || v1Named === null || v2 === null) return softSkip('blocked', 'a probe was unreachable (fetch failed)');
    expect(major(v1), req('openwop.requirement.0172.dual-stack-negotiation.response-header', 'spec/v2/core/versioning.md §1.4', 'a header-less /v1/ response MUST carry OpenWOP-Version: 1.<minor> — the contract used, never another (silent downgrade)')).toBe('1');
    expect(major(v1Named), req('openwop.requirement.0172.dual-stack-negotiation.response-header', 'spec/v2/core/versioning.md §1.4', 'a /v1/ response under OpenWOP-Version: 1.0 MUST carry OpenWOP-Version: 1.<minor>')).toBe('1');
    expect(major(v2), req('openwop.requirement.0172.dual-stack-negotiation.response-header', 'spec/v2/core/versioning.md §1.4', 'a response under OpenWOP-Version: 2.0 MUST carry OpenWOP-Version: 2.<minor>')).toBe('2');
    for (const res of [v1, v1Named, v2]) {
      const v = res.headers.get('openwop-version')?.trim() ?? '';
      expect(g.versions.includes(v), req('openwop.requirement.0172.dual-stack-negotiation.response-header', 'spec/v2/core/versioning.md §1.4', `the reported contract (${v}) MUST be a member of the advertised protocolVersions[]`)).toBe(true);
    }
  });
});
