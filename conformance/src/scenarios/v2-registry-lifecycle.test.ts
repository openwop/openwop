/**
 * RFC 0222 — v2 registry lifecycle and signing keys, witnessed against a
 * registry (`spec/v2/core/packs.md` §"Version manifests" and §Signing; suite
 * 2.42.10, target major 2).
 *
 * This scenario reads a REGISTRY, not the host under test. It runs only when
 * one is named: `OPENWOP_REGISTRY_URL=<origin>` (a mirror, a vendor registry,
 * or `node registry/scripts/serve.mjs` in openwop-registry), or
 * `OPENWOP_TEST_PUBLIC_REGISTRY=true` for `https://packs.openwop.dev`. With
 * neither it records `inapplicable`, like `registry-public.test.ts`: a host
 * conformance run MUST NOT need outbound access to a registry. It is a major-2
 * file, so it runs in a major-2 lane (`OPENWOP_TARGET_MAJOR=2`).
 *
 * Every path is resolved through `.well-known/openwop-registry` `endpoints.v2`
 * (packs.md §"The registry tree"), never constructed.
 *
 * How it FAILS:
 *   - a per-pack index names a yanked version `latest` while the pack has one
 *     that is not yanked, or disagrees with the version manifest's `yanked` /
 *     `versionDeprecated`, or the registry-wide row disagrees with it;
 *   - a yanked version's manifest, tarball or signature is no longer served;
 *   - a served version names a key that `signingKeys[]` no longer lists, or one
 *     whose `permittedNamespaces` does not admit the pack, or whose signature
 *     does not verify. A key that is no longer `active` still verifies what it
 *     signed; the scenario refuses only a key that disappeared.
 *
 * @see spec/v2/core/packs.md §"Version manifests", §Signing
 * @see RFCS/0222-v2-registry-operations.md
 */

import { describe, it, expect } from 'vitest';
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

type Json = Record<string, unknown>;

const ID_YANK = 'openwop.requirement.0222.yanked-version-lifecycle';
const ID_KEYS = 'openwop.requirement.0222.signing-keys-cover-served-versions';
const SPEC_VM = 'RFC 0222 · packs.md §"Version manifests"';
const SPEC_SIG = 'RFC 0222 · packs.md §Signing';

const BASE = (process.env['OPENWOP_REGISTRY_URL'] ?? (process.env['OPENWOP_TEST_PUBLIC_REGISTRY'] === 'true' ? 'https://packs.openwop.dev' : '')).replace(/\/+$/, '');
const NO_REGISTRY = 'no registry named — set OPENWOP_REGISTRY_URL (or OPENWOP_TEST_PUBLIC_REGISTRY=true for packs.openwop.dev); a host run does not read a registry';

async function fetchWithRetry(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, { headers: { Accept: 'application/json, */*' } });
    } catch (err) {
      if (attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
}

async function getJson(path: string): Promise<{ status: number; json: Json | null }> {
  const res = await fetchWithRetry(`${BASE}${path}`);
  if (res.status !== 200) return { status: res.status, json: null };
  try {
    return { status: 200, json: (await res.json()) as Json };
  } catch {
    return { status: 200, json: null };
  }
}

async function getBytes(path: string): Promise<{ status: number; bytes: Buffer }> {
  const res = await fetchWithRetry(`${BASE}${path}`);
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
}

/** Run `fn` over `items`, `width` at a time. */
async function pool<T, R>(items: readonly T[], width: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!);
  }));
  return out;
}

/** The exact bytes of `pack.json` inside a gzipped USTAR tarball (what a v2 signature covers). */
function packJsonBytes(tgz: Buffer): Buffer | null {
  const tar = gunzipSync(tgz);
  for (let off = 0; off + 512 <= tar.length; ) {
    const nameBuf = tar.subarray(off, off + 100);
    const end = nameBuf.indexOf(0);
    const name = nameBuf.subarray(0, end < 0 ? 100 : end).toString('utf8');
    if (!name) return null;
    const size = parseInt(tar.subarray(off + 124, off + 136).toString('ascii').replace(/\0/g, '').trim() || '0', 8);
    if (name === 'pack.json' || name === './pack.json' || name === 'package/pack.json') return tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

function fill(template: string, name: string, version?: string): string {
  return template.replace('{name}', name).replace('{version}', version ?? '');
}

interface Registry {
  readonly discovery: Json;
  readonly v2: Record<string, string>;
  readonly packs: Json[];
}

let cached: Promise<Registry | string> | null = null;

/** Discovery + the v2 index, or the reason the registry is unreadable (an assertion failure, not a skip). */
function registry(): Promise<Registry | string> {
  cached ??= (async () => {
    const wk = await getJson('/.well-known/openwop-registry');
    if (!wk.json) return `GET /.well-known/openwop-registry answered ${wk.status} without a JSON document`;
    const endpoints = (wk.json['endpoints'] ?? {}) as Json;
    const v2 = endpoints['v2'] as Record<string, string> | undefined;
    if (!v2 || typeof v2['registryIndex'] !== 'string' || typeof v2['packMetadata'] !== 'string' || typeof v2['versionManifest'] !== 'string') {
      return 'the discovery document has no endpoints.v2 {registryIndex, packMetadata, versionManifest}';
    }
    const idx = await getJson(v2['registryIndex']);
    if (!idx.json || !Array.isArray(idx.json['packs'])) return `GET ${v2['registryIndex']} answered ${idx.status} without a packs[] index`;
    return { discovery: wk.json, v2, packs: idx.json['packs'] as Json[] };
  })();
  return cached;
}

interface Version { readonly pack: string; readonly version: string; readonly manifest: Json }

describe('RFC 0222 — v2 registry lifecycle and signing keys', () => {
  it('a yanked version is never latest while an unyanked one exists, the flags agree across index and manifest, and a yanked version stays served', async () => {
    if (!BASE) return softSkip('inapplicable', NO_REGISTRY);
    const reg = await registry();
    expect(typeof reg, req(ID_YANK, SPEC_VM, `the registry MUST serve a v2 index through endpoints.v2 — ${typeof reg === 'string' ? reg : ''}`)).toBe('object');
    if (typeof reg === 'string') throw new Error(reg);

    const problems: string[] = [];
    const yanked: Version[] = [];
    await pool(reg.packs, 8, async (row) => {
      const name = String(row['name']);
      const meta = await getJson(fill(reg.v2['packMetadata']!, name));
      if (!meta.json) { problems.push(`${name}: pack metadata answered ${meta.status}`); return; }
      const versions = (Array.isArray(meta.json['versions']) ? meta.json['versions'] : []) as Json[];
      const unyanked = versions.filter((v) => v['yanked'] !== true).map((v) => String(v['version']));
      const latest = String(meta.json['latest']);
      const latestRow = versions.find((v) => v['version'] === latest);
      if (latestRow?.['yanked'] === true && unyanked.length > 0) problems.push(`${name}: latest ${latest} is yanked while ${unyanked.join(', ')} is not`);
      if (row['latestVersion'] !== latest) problems.push(`${name}: registry index latestVersion ${String(row['latestVersion'])} ≠ pack metadata latest ${latest}`);
      if (row['yanked'] === true && unyanked.length > 0) problems.push(`${name}: registry index marks the pack yanked while ${unyanked.join(', ')} is not`);
      for (const v of versions) {
        const version = String(v['version']);
        const vm = await getJson(fill(reg.v2['versionManifest']!, name, version));
        if (!vm.json) { problems.push(`${name}@${version}: version manifest answered ${vm.status}`); continue; }
        if ((vm.json['yanked'] === true) !== (v['yanked'] === true)) problems.push(`${name}@${version}: index yanked=${String(v['yanked'])} but manifest yanked=${String(vm.json['yanked'])}`);
        if ((vm.json['versionDeprecated'] === true) !== (v['versionDeprecated'] === true)) problems.push(`${name}@${version}: index versionDeprecated=${String(v['versionDeprecated'])} but manifest versionDeprecated=${String(vm.json['versionDeprecated'])}`);
        if (vm.json['yanked'] === true) yanked.push({ pack: name, version, manifest: vm.json });
      }
    });
    expect(problems, req(ID_YANK, SPEC_VM, 'the per-pack index MUST NOT name a yanked version latest while an unyanked one exists, and the index MUST agree with each version manifest')).toEqual([]);

    if (yanked.length === 0) {
      // partial-witness-ok: the index/manifest agreement was asserted over every
      // version; the served-after-yank half has nothing to observe.
      return softSkip('inapplicable', 'no version in this v2 tree is yanked — the latest rule held vacuously and there is no yanked version whose files could be checked');
    }
    const unserved: string[] = [];
    await pool(yanked, 8, async ({ pack, version }) => {
      for (const key of ['versionTarball', 'versionSignature'] as const) {
        const tmpl = reg.v2[key];
        if (typeof tmpl !== 'string') { unserved.push(`endpoints.v2.${key} is absent`); continue; }
        const r = await getBytes(fill(tmpl, pack, version));
        if (r.status !== 200 || r.bytes.byteLength === 0) unserved.push(`${pack}@${version}: ${key} answered ${r.status}`);
      }
    });
    expect(unserved, req(ID_YANK, SPEC_VM, `the registry MUST keep serving a yanked version's manifest, tarball and signature at their exact paths (${yanked.length} yanked)`)).toEqual([]);
  });

  it('every served version names a listed key whose permittedNamespaces admit it, and its signature verifies — whatever the key status', async () => {
    if (!BASE) return softSkip('inapplicable', NO_REGISTRY);
    const reg = await registry();
    expect(typeof reg, req(ID_KEYS, SPEC_SIG, `the registry MUST serve a v2 index through endpoints.v2 — ${typeof reg === 'string' ? reg : ''}`)).toBe('object');
    if (typeof reg === 'string') throw new Error(reg);

    const keys = (Array.isArray(reg.discovery['signingKeys']) ? reg.discovery['signingKeys'] : []) as Json[];
    const malformed = keys.filter((k) => typeof k['keyId'] !== 'string' || typeof k['publicKeyUrl'] !== 'string' || typeof k['status'] !== 'string' || !Array.isArray(k['permittedNamespaces']));
    expect(malformed.map((k) => String(k['keyId'])), req(ID_KEYS, SPEC_SIG, 'every signingKeys[] entry MUST carry keyId, publicKeyUrl, status and permittedNamespaces')).toEqual([]);
    const byId = new Map(keys.map((k) => [String(k['keyId']), k]));
    const publicKeys = new Map<string, ReturnType<typeof createPublicKey> | null>();

    const permits = (key: Json, name: string): boolean => (key['permittedNamespaces'] as unknown[]).some((p) => {
      const pat = String(p);
      return pat.endsWith('.*') ? name.startsWith(pat.slice(0, -1)) : pat === name;
    });

    const versions: Version[] = [];
    await pool(reg.packs, 8, async (row) => {
      const name = String(row['name']);
      const meta = await getJson(fill(reg.v2['packMetadata']!, name));
      for (const v of (Array.isArray(meta.json?.['versions']) ? meta.json!['versions'] : []) as Json[]) {
        const vm = await getJson(fill(reg.v2['versionManifest']!, name, String(v['version'])));
        if (vm.json) versions.push({ pack: name, version: String(v['version']), manifest: vm.json });
      }
    });
    expect(versions.length, req(ID_KEYS, SPEC_SIG, 'the v2 tree MUST serve at least one version manifest to witness')).toBeGreaterThan(0);

    const problems: string[] = [];
    const statuses = new Map<string, number>();
    await pool(versions, 8, async ({ pack, version, manifest }) => {
      const at = `${pack}@${version}`;
      const keyId = String((manifest['signing'] as Json | undefined)?.['keyId'] ?? '');
      const key = byId.get(keyId);
      if (!key) { problems.push(`${at}: signed by ${keyId || '(no keyId)'}, which signingKeys[] does not list`); return; }
      if (!permits(key, pack)) { problems.push(`${at}: key ${keyId} does not permit this namespace (${(key['permittedNamespaces'] as unknown[]).join(', ')})`); return; }
      statuses.set(String(key['status']), (statuses.get(String(key['status'])) ?? 0) + 1);
      if (!publicKeys.has(keyId)) {
        const r = await getBytes(String(key['publicKeyUrl']));
        let pk: ReturnType<typeof createPublicKey> | null = null;
        try { pk = r.status === 200 ? createPublicKey(r.bytes.toString('utf8')) : null; } catch { pk = null; }
        publicKeys.set(keyId, pk);
      }
      const pk = publicKeys.get(keyId);
      if (!pk) { problems.push(`${at}: publicKeyUrl for ${keyId} does not serve a public key`); return; }
      const tgz = await getBytes(fill(reg.v2['versionTarball'] ?? '', pack, version));
      const sig = await getBytes(fill(reg.v2['versionSignature'] ?? '', pack, version));
      if (tgz.status !== 200 || sig.status !== 200) { problems.push(`${at}: tarball ${tgz.status}, signature ${sig.status}`); return; }
      if (typeof manifest['integrity'] === 'string' && manifest['integrity'] !== `sha256-${createHash('sha256').update(tgz.bytes).digest('base64')}`) problems.push(`${at}: integrity does not match the served tarball`);
      const signed = packJsonBytes(tgz.bytes);
      if (!signed) { problems.push(`${at}: the tarball has no pack.json`); return; }
      if (!cryptoVerify(null, signed, pk, sig.bytes)) problems.push(`${at}: the signature does not verify under ${keyId}`);
    });
    expect(problems, req(ID_KEYS, SPEC_SIG, `every served version MUST name a listed key permitted for its namespace and verify under it, whatever the key status (${versions.length} versions; key status ${JSON.stringify(Object.fromEntries(statuses))})`)).toEqual([]);
  });
});
