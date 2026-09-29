/**
 * `headers.md` §Cross-origin preflight — a host that grants an origin admits
 * what a conforming browser client sends (suite 2.45.0, target major 2;
 * openwop#1763; self-gated on the host's own grant).
 *
 * A browser client MUST send `OpenWOP-Version` and `OpenWOP-Client-Version` on
 * every request (versioning.md §1.3, §1.5), `Authorization` on an
 * authenticated operation and `Content-Type: application/json` with a body.
 * None of them is CORS-safelisted, so the browser preflights. When the host
 * grants the origin but leaves one out of `Access-Control-Allow-Headers`, the
 * browser never sends the request: the operation is unreachable from that
 * origin and the host's logs show nothing. Both production hosts shipped that
 * outage with explicit lists: openwop-app on `OpenWOP-Version` (2026-09-18) and
 * both on `OpenWOP-Client-Version` at the SDK 2.5.0 release (RFC 0219 G8).
 *
 * The admitted set per operation comes from `spec/v2/path-manifest.json`, which
 * `derive-v2-api.py` writes from `api/v2/openapi.yaml`: the declared header
 * parameters, plus `Authorization` when authenticated and `Content-Type` when
 * the operation takes a body. For each operation the leg sends
 * `OPTIONS <path>` (path parameters filled with a placeholder) with `Origin`,
 * `Access-Control-Request-Method` and `Access-Control-Request-Headers`, and
 * reads the answer the way the Fetch standard's CORS-preflight check does:
 *
 *   - granted: `Access-Control-Allow-Origin` is the origin or `*`. Anything
 *     else and the host does not serve that origin: that operation is not
 *     judged (a host MAY grant no origin at all; the rule is conditional).
 *   - method: a CORS-safelisted method (GET, HEAD, POST) is admitted without
 *     listing; any other must be listed, or `*` when credentials are not
 *     allowed. Compared case-sensitively, as Fetch does.
 *   - headers: every requested name listed (case-insensitive), or `*` when
 *     credentials are not allowed, and `*` never admits `authorization`.
 *
 * The row passes when at least one operation was granted and every granted one
 * admits its set, fails when any granted one does not (naming the operation and
 * the missing names), and is `inapplicable` when no operation was granted. The
 * origin is `OPENWOP_CORS_ORIGIN` (default `https://conformance.invalid`): a
 * host with an allowlist is inapplicable at the default, and its operator sets
 * an allowlisted origin to be witnessed. A pass carries an `observed:` detail.
 *
 * @see spec/v2/core/headers.md §Cross-origin preflight
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../lib/env.js';
import { v2Discovery } from '../lib/v2.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
import { noteObservation } from '../lib/row-observation.js';
import { SCHEMAS_DIR } from '../lib/paths.js';

const ID = 'openwop.requirement.headers.cors-preflight-admits';
const DOC = 'spec/v2/core/headers.md §Cross-origin preflight';
const ORIGIN_ENV = 'OPENWOP_CORS_ORIGIN';
const DEFAULT_ORIGIN = 'https://conformance.invalid';
/** Fetch standard: a CORS-safelisted method passes the preflight method check without being listed. */
const SAFELISTED_METHODS = new Set(['GET', 'HEAD', 'POST']);
const PLACEHOLDER = 'conformance-cors-probe';

interface ManifestOp { readonly method: string; readonly path: string; readonly operationId: string; readonly requestHeaders?: readonly string[]; readonly authenticated?: boolean; readonly requestBody?: boolean }
interface Preflight { readonly status: number | null; readonly allowOrigin: string | null; readonly allowMethods: string | null; readonly allowHeaders: string | null; readonly allowCredentials: string | null }

function operations(): ManifestOp[] | null {
  try {
    const manifest = JSON.parse(readFileSync(join(SCHEMAS_DIR, '..', 'spec', 'v2', 'path-manifest.json'), 'utf8')) as { operations?: ManifestOp[] };
    const ops = manifest.operations ?? [];
    return ops.length > 0 && ops.every((o) => Array.isArray(o.requestHeaders) && typeof o.authenticated === 'boolean' && typeof o.requestBody === 'boolean') ? ops : null;
  } catch {
    return null;
  }
}

/** The names a conforming browser client puts in Access-Control-Request-Headers for this operation, lowercased. */
export function requestedHeaders(op: ManifestOp): string[] {
  const names = new Set((op.requestHeaders ?? []).map((h) => h.toLowerCase()));
  if (op.authenticated === true) names.add('authorization');
  if (op.requestBody === true) names.add('content-type');
  return [...names].sort();
}

const tokens = (v: string | null): string[] => (v ?? '').split(',').map((t) => t.trim()).filter((t) => t.length > 0);

/** What the preflight answer fails to admit, per the Fetch standard's CORS-preflight check; empty when it admits everything. */
export function unadmitted(op: ManifestOp, p: Preflight): { method: string | null; headers: string[] } {
  const credentials = p.allowCredentials === 'true';
  const methods = tokens(p.allowMethods);
  const methodOk = SAFELISTED_METHODS.has(op.method) || methods.includes(op.method) || (!credentials && methods.includes('*'));
  const listed = new Set(tokens(p.allowHeaders).map((h) => h.toLowerCase()));
  const star = !credentials && listed.has('*');
  const headers = requestedHeaders(op).filter((h) => !listed.has(h) && !(star && h !== 'authorization'));
  return { method: methodOk ? null : op.method, headers };
}

async function preflight(baseUrl: string, op: ManifestOp, origin: string): Promise<Preflight> {
  const path = op.path.replace(/\{[^}]+\}/g, PLACEHOLDER);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': op.method, 'Access-Control-Request-Headers': requestedHeaders(op).join(',') },
    });
    await res.arrayBuffer().catch(() => undefined);
    const h = res.headers;
    return { status: res.status, allowOrigin: h.get('access-control-allow-origin'), allowMethods: h.get('access-control-allow-methods'), allowHeaders: h.get('access-control-allow-headers'), allowCredentials: h.get('access-control-allow-credentials') };
  } catch {
    return { status: null, allowOrigin: null, allowMethods: null, allowHeaders: null, allowCredentials: null };
  }
}

describe('headers.md §Cross-origin preflight (self-gated on the host granting the origin)', () => {
  it('every operation a granted origin preflights admits its method and every request header the contract declares for it', async () => {
    if (!(await v2Discovery())) return softSkip('blocked', 'v2 discovery unreachable');
    const ops = operations();
    if (ops === null) return softSkip('blocked', 'spec/v2/path-manifest.json carries no per-operation requestHeaders / authenticated / requestBody (a corpus older than openwop#1763), so the admitted sets cannot be derived');
    const origin = process.env[ORIGIN_ENV]?.trim() || DEFAULT_ORIGIN;
    const { baseUrl } = loadEnv();

    const granted: string[] = [];
    const failures: string[] = [];
    for (const op of ops) {
      const p = await preflight(baseUrl, op, origin);
      if (p.allowOrigin !== origin && p.allowOrigin !== '*') continue;
      granted.push(op.operationId);
      const miss = unadmitted(op, p);
      if (miss.method !== null || miss.headers.length > 0) {
        const parts = [
          ...(miss.method === null ? [] : [`method ${miss.method} not in Access-Control-Allow-Methods (${JSON.stringify(p.allowMethods)})`]),
          ...(miss.headers.length === 0 ? [] : [`${miss.headers.join(', ')} not in Access-Control-Allow-Headers (${JSON.stringify(p.allowHeaders)}${p.allowCredentials === 'true' ? ', credentials allowed so * admits nothing' : ''})`]),
        ];
        failures.push(`${op.operationId} (${op.method} ${op.path}): ${parts.join('; ')}`);
      }
    }
    noteObservation(`origin ${origin}: ${granted.length}/${ops.length} operation(s) granted, ${failures.length} not admitting their set`);
    if (granted.length === 0) {
      return softSkip('inapplicable', `no operation's preflight granted origin ${origin} (Access-Control-Allow-Origin neither it nor *): the host does not serve that origin cross-origin, which is host policy. An operator whose host allowlists origins sets ${ORIGIN_ENV} to one of them to be witnessed`);
    }
    expect(
      failures,
      req(ID, DOC, `a host that grants an origin MUST admit, per operation, its method and every request header api/v2/openapi.yaml declares for it, Authorization when authenticated and Content-Type with a body; a browser that is refused never sends the request. ${failures.length} of ${granted.length} granted operation(s) do not: ${failures.join(' | ')}`),
    ).toEqual([]);
  });
});
