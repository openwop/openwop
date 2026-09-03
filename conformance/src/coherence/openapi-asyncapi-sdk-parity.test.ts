/**
 * RFC 0149 §A / §Conformance — `openapi-asyncapi-sdk-parity`.
 *
 * "SDK operation URLs and AsyncAPI bindings MUST match the resolved OpenAPI
 * path" (§A), and "SDK repositories consume a generated canonical
 * operation-path manifest" (§Conformance). `openapi-resolved-paths.test.ts`
 * landed the OpenAPI half (exactly one `/v1` per resolved operation); this
 * scenario lands the AsyncAPI half and the manifest, and witnesses the SDK
 * half when the SDK repository is reachable.
 *
 * Legs:
 *   1. `spec/v1/operation-path-manifest.json` — the canonical resolved
 *      operation-path manifest — is in sync with `api/openapi.yaml`: this file
 *      re-derives the rows from the contract with its own scanner and compares,
 *      so the generator (`scripts/generate-operation-path-manifest.mjs`) and
 *      the suite cannot silently disagree; every row carries exactly one `/v1`
 *      (none for `/.well-known/*`); the digest matches the body.
 *   2. AsyncAPI bindings: every channel `address` (resolved under
 *      `servers.*.pathname`) is an OpenAPI path key with a GET operation, with
 *      exactly one `/v1`; the AsyncAPI server pathname carries the version
 *      segment exactly once. The AsyncAPI document names the same wire
 *      the OpenAPI document does — no second contract for the event stream.
 *   3. SDK parity (`openwop-sdks`): the SDK repository's
 *      `sdk/parity-expectations.json` covers every CANONICAL manifest
 *      operation with the same method + resolved path, declares no operation
 *      the manifest lacks, and the TypeScript client issues every path an
 *      operation declared `ts: typed` names. Reached through
 *      `OPENWOP_SDKS_DIR` or the sibling checkout `../openwop-sdks`. When the
 *      SDK tree is NOT reachable the requirement is recorded `blocked` with the
 *      reason — RFC 0148 §A: an unwitnessed requirement is blocked, never a
 *      pass — and the leg returns without asserting.
 *
 * Server-free (reads files only). Legs 1–2 always-on.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { API_DIR, V1_DIR } from '../lib/paths.js';
import { recordRequirement } from '../lib/requirement-ledger.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'server-free: compares contract documents and (when reachable) SDK sources on disk; no host is contacted';

/** RFC 0148 §A requirement id for the SDK half, recorded blocked when unwitnessable. */
export const SDK_PATH_PARITY_REQUIREMENT = 'openwop.requirement.rfc0149.sdk-path-parity';

const OPENAPI = readFileSync(join(API_DIR, 'openapi.yaml'), 'utf8');
const ASYNCAPI = readFileSync(join(API_DIR, 'asyncapi.yaml'), 'utf8');
const MANIFEST_PATH = V1_DIR === null ? null : join(V1_DIR, 'operation-path-manifest.json');

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

interface Op { operationId: string | null; method: string; pathKey: string; tag: string | null }
interface Row { operationId: string; method: string; pathKey: string; resolvedPath: string; tag: string; class: string }

function serverUrls(raw: string): string[] {
  const urls: string[] = [];
  let inServers = false;
  for (const line of raw.split('\n')) {
    if (/^servers:/.test(line)) { inServers = true; continue; }
    if (inServers && /^[^\s#]/.test(line)) break;
    if (!inServers) continue;
    const m = /^\s*-\s*url:\s*(\S+)\s*$/.exec(line);
    if (m?.[1] !== undefined) urls.push(m[1]);
  }
  return urls;
}
function resolvedPath(serverUrl: string, pathKey: string): string {
  const afterScheme = serverUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const slash = afterScheme.indexOf('/');
  const basePath = slash === -1 ? '' : afterScheme.slice(slash);
  return `${basePath.replace(/\/$/, '')}${pathKey}`;
}
function operations(raw: string): Op[] {
  const rows: Op[] = [];
  let inPaths = false;
  let pathKey: string | null = null;
  let op: Op | null = null;
  for (const line of raw.split('\n')) {
    if (/^paths:/.test(line)) { inPaths = true; continue; }
    if (inPaths && /^[^\s#]/.test(line)) break;
    if (!inPaths) continue;
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p?.[1] !== undefined) { pathKey = p[1]; op = null; continue; }
    const v = /^ {4}([a-z]+):\s*$/.exec(line);
    if (v?.[1] !== undefined && VERBS.has(v[1]) && pathKey !== null) {
      op = { operationId: null, method: v[1].toUpperCase(), pathKey, tag: null };
      rows.push(op);
      continue;
    }
    if (op === null) continue;
    const id = /^ {6}operationId:\s*([A-Za-z0-9_]+)\s*$/.exec(line);
    if (id?.[1] !== undefined) { op.operationId = id[1]; continue; }
    const t = /^ {6}tags:\s*\[([^\]]*)\]\s*$/.exec(line);
    if (t?.[1] !== undefined) { op.tag = (t[1].split(',')[0] ?? '').trim(); continue; }
  }
  return rows;
}
function classify(tag: string | null): string {
  if (tag === 'host') return 'host-extension';
  if (tag === 'packs-test') return 'test-catalog';
  return 'canonical';
}
function deriveRows(): { serverUrl: string; rows: Row[] } {
  const servers = serverUrls(OPENAPI);
  const base = servers[0] ?? '';
  const rows: Row[] = operations(OPENAPI).map((o) => ({
    operationId: o.operationId ?? '',
    method: o.method,
    pathKey: o.pathKey,
    resolvedPath: resolvedPath(base, o.pathKey),
    tag: o.tag ?? '',
    class: classify(o.tag),
  }));
  rows.sort((a, b) => a.resolvedPath.localeCompare(b.resolvedPath) || a.method.localeCompare(b.method));
  return { serverUrl: base, rows };
}
function v1Segments(p: string): number {
  return (p.match(/\/v1(?=\/|$)/g) ?? []).length;
}

/* ─── AsyncAPI scanning ─────────────────────────────────────────────────── */

function asyncapiServerPathnames(raw: string): string[] {
  const out: string[] = [];
  let inServers = false;
  for (const line of raw.split('\n')) {
    if (/^servers:/.test(line)) { inServers = true; continue; }
    if (inServers && /^[^\s#]/.test(line)) break;
    if (!inServers) continue;
    const m = /^\s+pathname:\s*(\S+)\s*$/.exec(line);
    if (m?.[1] !== undefined) out.push(m[1]);
  }
  return out;
}
/** Channel `address:` values (a `null` address is a logical channel and is skipped). */
function asyncapiChannelAddresses(raw: string): { channel: string; address: string | null }[] {
  const out: { channel: string; address: string | null }[] = [];
  let inChannels = false;
  let channel: string | null = null;
  for (const line of raw.split('\n')) {
    if (/^channels:/.test(line)) { inChannels = true; continue; }
    if (inChannels && /^[^\s#]/.test(line)) break;
    if (!inChannels) continue;
    const c = /^ {2}([A-Za-z][\w.-]*):\s*$/.exec(line);
    if (c?.[1] !== undefined) { channel = c[1]; continue; }
    const a = /^ {4}address:\s*(\S+)\s*$/.exec(line);
    if (a?.[1] !== undefined && channel !== null) out.push({ channel, address: a[1] === 'null' ? null : a[1] });
  }
  return out;
}

/* ─── SDK repository probing ────────────────────────────────────────────── */

function sdksDir(): string | null {
  const env = process.env['OPENWOP_SDKS_DIR'];
  if (env !== undefined && env !== '' && existsSync(join(env, 'sdk', 'parity-expectations.json'))) return resolve(env);
  if (V1_DIR === null) return null;
  const sibling = resolve(V1_DIR, '..', '..', '..', 'openwop-sdks');
  return existsSync(join(sibling, 'sdk', 'parity-expectations.json')) ? sibling : null;
}
function collectTs(dir: string): string {
  let out = '';
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!/node_modules|__tests__/.test(name)) out += collectTs(p); continue; }
    if (name.endsWith('.ts') && !/\.test\./.test(name)) out += readFileSync(p, 'utf8') + '\n';
  }
  return out;
}
/**
 * The most distinctive STATIC fragment of a templated path: everything up to
 * the first `{param}` (an SDK builds the rest with `encodeURIComponent`).
 * `/v1/runs/{runId}:fork` → `/v1/runs/` … plus the tail `:fork` checked
 * separately when the template ends in a static suffix.
 */
function staticFragments(pathTpl: string): string[] {
  const head = pathTpl.split('{')[0] ?? pathTpl;
  const tail = /\}([^{}]*)$/.exec(pathTpl)?.[1] ?? '';
  const frags = [head];
  if (tail !== '' && tail !== '/') frags.push(tail);
  return frags;
}

describe('RFC 0149 §A/§Conformance — the canonical operation-path manifest is in sync with the contract', () => {
  it('spec/v1/operation-path-manifest.json exists in the corpus layout and re-derives byte-for-byte from api/openapi.yaml', () => {
    if (MANIFEST_PATH === null) return softSkip('blocked', 'precondition not met — `MANIFEST_PATH === null` returned early (published tarball: prose dir absent (see leg below)) (seam, prior step, or fixture unavailable)'); // published tarball: prose dir absent (see leg below)
    expect(existsSync(MANIFEST_PATH), req('openwop.it.openapi-asyncapi-sdk-parity.spec-v1-operation-path-manifest-json-exists-in-the-corpus-layout-and-re-derives', 'RFC 0149 §A', 'RFC 0149 §Conformance: the manifest MUST be published (run scripts/generate-operation-path-manifest.mjs --write)')).toBe(true);
    const doc = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as { serverUrl: string; operations: Row[]; digest: string; counts: Record<string, number> } & Record<string, unknown>;
    const { serverUrl, rows } = deriveRows();
    expect(doc.serverUrl).toBe(serverUrl);
    expect(doc.operations).toEqual(rows);
    expect(doc.counts['total']).toBe(rows.length);
    const { digest: _d, ...body } = doc;
    expect(doc.digest).toBe(createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex'));
  });

  it('every operation resolves to exactly one /v1 segment (none for /.well-known/*), has an operationId, and ids are unique', () => {
    const { rows } = deriveRows();
    expect(rows.length).toBeGreaterThan(40);
    const ids = new Set<string>();
    for (const r of rows) {
      expect(r.operationId, req('openwop.it.openapi-asyncapi-sdk-parity.every-operation-resolves-to-exactly-one-v1-segment-none-for-well-known-has-an-op', 'RFC 0149 §A', `${r.method} ${r.pathKey} has no operationId`)).not.toBe('');
      expect(ids.has(r.operationId), req('openwop.it.openapi-asyncapi-sdk-parity.every-operation-resolves-to-exactly-one-v1-segment-none-for-well-known-has-an-op', 'RFC 0149 §A', `duplicate operationId ${r.operationId}`)).toBe(false);
      ids.add(r.operationId);
      const n = v1Segments(r.resolvedPath);
      if (r.pathKey.startsWith('/.well-known/')) expect(n, req('openwop.it.openapi-asyncapi-sdk-parity.every-operation-resolves-to-exactly-one-v1-segment-none-for-well-known-has-an-op', 'RFC 0149 §A', `${r.resolvedPath} MUST be unversioned`)).toBe(0);
      else expect(n, req('openwop.it.openapi-asyncapi-sdk-parity.every-operation-resolves-to-exactly-one-v1-segment-none-for-well-known-has-an-op', 'RFC 0149 §A', `${r.operationId} resolves to ${r.resolvedPath}`)).toBe(1);
    }
    // the classes are exhaustive and the canonical set is the large majority
    expect(rows.every((r) => ['canonical', 'host-extension', 'test-catalog'].includes(r.class))).toBe(true);
    expect(rows.filter((r) => r.class === 'canonical').length).toBeGreaterThan(rows.length / 2);
  });
});

describe('RFC 0149 §A — AsyncAPI bindings name the same wire the OpenAPI document does', () => {
  it('the AsyncAPI server pathname carries the version segment exactly once', () => {
    const pathnames = asyncapiServerPathnames(ASYNCAPI);
    expect(pathnames.length).toBeGreaterThan(0);
    for (const p of pathnames) expect(v1Segments(p), req('openwop.it.openapi-asyncapi-sdk-parity.the-asyncapi-server-pathname-carries-the-version-segment-exactly-once', 'RFC 0149 §A', `asyncapi servers pathname ${p}`)).toBe(1);
  });

  it('every addressed channel resolves (server pathname + address) to an OpenAPI path key that has a GET operation, with exactly one /v1', () => {
    const pathnames = asyncapiServerPathnames(ASYNCAPI);
    const channels = asyncapiChannelAddresses(ASYNCAPI);
    const addressed = channels.filter((c) => c.address !== null);
    expect(addressed.length, req('openwop.it.openapi-asyncapi-sdk-parity.every-addressed-channel-resolves-server-pathname-address-to-an-openapi-path-key', 'RFC 0149 §A', 'at least one channel is bound to a wire address')).toBeGreaterThan(0);
    const { rows } = deriveRows();
    const getPaths = new Set(rows.filter((r) => r.method === 'GET').map((r) => r.pathKey));
    for (const base of pathnames) {
      for (const c of addressed) {
        const resolved = `${base.replace(/\/$/, '')}${c.address as string}`;
        expect(v1Segments(resolved), req('openwop.it.openapi-asyncapi-sdk-parity.every-addressed-channel-resolves-server-pathname-address-to-an-openapi-path-key', 'RFC 0149 §A', `channel ${c.channel} resolves to ${resolved}`)).toBe(1);
        expect(getPaths.has(resolved), req('openwop.it.openapi-asyncapi-sdk-parity.every-addressed-channel-resolves-server-pathname-address-to-an-openapi-path-key', 'RFC 0149 §A', `channel ${c.channel} → ${resolved} is not a GET path in api/openapi.yaml`)).toBe(true);
      }
    }
  });

  it('logical (address: null) channels are the only ones without a wire address, and they are documented as logical', () => {
    const channels = asyncapiChannelAddresses(ASYNCAPI);
    const logical = channels.filter((c) => c.address === null).map((c) => c.channel);
    // heartbeat is the known logical channel (host-capabilities.md §host.heartbeat)
    for (const name of logical) expect(name, req('openwop.it.openapi-asyncapi-sdk-parity.logical-address-null-channels-are-the-only-ones-without-a-wire-address-and-they', 'RFC 0149 §A', `logical channel ${name} must be documented as such`)).toMatch(/heartbeat/i);
  });
});

describe('RFC 0149 §A — SDK operation URLs match the resolved OpenAPI paths (openwop-sdks parity manifest)', () => {
  it('sdk/parity-expectations.json covers every canonical operation with the same method + path, declares nothing the contract lacks, and the TypeScript client issues every ts-typed path', () => {
    const dir = sdksDir();
    if (dir === null) {
      recordRequirement(
        SDK_PATH_PARITY_REQUIREMENT,
        'blocked',
        'openwop-sdks is not reachable from this runner (set OPENWOP_SDKS_DIR or check the sibling repository out next to this one); the SDK half of RFC 0149 §A parity is unwitnessed here',
      );
      return softSkip('blocked', 'precondition not met — `dir === null` returned early (seam, prior step, or fixture unavailable)');
    }
    const exp = JSON.parse(readFileSync(join(dir, 'sdk', 'parity-expectations.json'), 'utf8')) as {
      operations: { operationId: string; method: string; path: string; ts: string; py: string; go: string; note?: string }[];
    };
    const { rows } = deriveRows();
    const byId = new Map(rows.map((r) => [r.operationId, r] as const));
    const expById = new Map(exp.operations.map((e) => [e.operationId, e] as const));

    // (a) every canonical operation is declared, with the same method and RESOLVED path
    const missing = rows.filter((r) => r.class === 'canonical' && !expById.has(r.operationId)).map((r) => r.operationId);
    expect(missing, req('openwop.it.openapi-asyncapi-sdk-parity.sdk-parity-expectations-json-covers-every-canonical-operation-with-the-same-meth', 'RFC 0149 §A', 'canonical operations with no SDK parity declaration')).toEqual([]);
    const drift: string[] = [];
    for (const r of rows) {
      const e = expById.get(r.operationId);
      if (e === undefined) continue;
      if (e.method.toUpperCase() !== r.method || e.path !== r.resolvedPath) drift.push(`${r.operationId}: sdk says ${e.method} ${e.path}, contract resolves ${r.method} ${r.resolvedPath}`);
    }
    expect(drift, req('openwop.it.openapi-asyncapi-sdk-parity.sdk-parity-expectations-json-covers-every-canonical-operation-with-the-same-meth', 'RFC 0149 §A', 'SDK-declared operation URLs MUST match the resolved OpenAPI path (RFC 0149 §A)')).toEqual([]);

    // (b) nothing declared that the contract lacks (orphan drift)
    const orphans = exp.operations.filter((e) => !byId.has(e.operationId)).map((e) => e.operationId);
    expect(orphans, req('openwop.it.openapi-asyncapi-sdk-parity.sdk-parity-expectations-json-covers-every-canonical-operation-with-the-same-meth', 'RFC 0149 §A', 'SDK parity entries for operationIds the contract no longer has')).toEqual([]);

    // (c) the TypeScript client actually issues every ts-typed path
    const tsSrc = collectTs(join(dir, 'sdk', 'typescript', 'src'));
    const notIssued: string[] = [];
    for (const e of exp.operations) {
      if (e.ts !== 'typed') continue;
      const frags = staticFragments(e.path);
      if (!frags.every((f) => tsSrc.includes(f))) notIssued.push(`${e.operationId} (${e.path})`);
    }
    expect(notIssued, req('openwop.it.openapi-asyncapi-sdk-parity.sdk-parity-expectations-json-covers-every-canonical-operation-with-the-same-meth', 'RFC 0149 §A', 'operations declared ts-typed whose path the TypeScript client never issues')).toEqual([]);

    // (d) and no HOST-client-issued /v1 literal resolves outside the contract's
    //     canonical+host set. Scoped to the OpenwopClient modules (`client.ts`,
    //     `sse.ts`): the SDK also carries a pack-REGISTRY client
    //     (`registry-helpers.ts` — `/v1/packs/*`, `/v1/index.json`, issued to a
    //     registry base) and provider-shaped types (`/v1/chat/completions`, RFC
    //     0108, issued to a provider) that are not host operations.
    const hostClientSrc = ['client.ts', 'sse.ts']
      .map((f) => join(dir, 'sdk', 'typescript', 'src', f))
      .filter((f) => existsSync(f))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    const issued = [...hostClientSrc.matchAll(/[`'"](\/v1\/[^`'"$?]*)/g)].map((m) => (m[1] ?? '').replace(/\/$/, ''));
    const known = new Set(rows.map((r) => r.pathKey.split('{')[0] ?? r.pathKey));
    const unknown = [...new Set(issued)].filter((p) => ![...known].some((k) => p.startsWith(k.replace(/\/$/, ''))) && !p.startsWith('/v1/host/'));
    expect(unknown, req('openwop.it.openapi-asyncapi-sdk-parity.sdk-parity-expectations-json-covers-every-canonical-operation-with-the-same-meth', 'RFC 0149 §A', 'the host client issues /v1 paths the contract does not define (outside /v1/host/* extensions)')).toEqual([]);

    recordRequirement(SDK_PATH_PARITY_REQUIREMENT, 'executed-pass', undefined, { assertionCount: 6 });
  });
});
