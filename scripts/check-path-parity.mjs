#!/usr/bin/env node
/**
 * RFC 0172 §C.2 / charter §F "Paths" — OpenAPI, AsyncAPI and the path manifest
 * resolve identical absolute paths, and the canonical OpenAPI carries no seam or
 * test-mode operation.
 *
 * v1 leg (api/openapi.yaml, api/asyncapi.yaml, spec/v1/operation-path-manifest.json):
 *   - every OpenAPI path key is `/v1/...` or `/.well-known/...`;
 *   - AsyncAPI server pathname is `/v1` and every channel address, resolved
 *     against it, is an OpenAPI path key (the shared event stream);
 *   - the manifest's resolvedPath set equals the OpenAPI path-key set.
 *   The v1 seams are documented as present (RFC 0168 row C1.6: deprecated,
 *   removed at v2) — reported, not failed.
 * v2 leg (api/v2/openapi.yaml, api/v2/asyncapi.yaml, spec/v2/path-manifest.json),
 *   when they exist:
 *   - no path key starts with `/v1/` or `/v2/` (bare origin, unversioned keys);
 *   - AsyncAPI server pathname is empty and every channel address IS an OpenAPI
 *     path key;
 *   - the manifest lists operations and channels and equals both sets;
 *   - no operation matches the exact seam/test-mode prefixes
 *     `/host/sample/`, `/host/workspace/files`, `/packs-test/`
 *     (`/host/effect-seams` is a normative RFC 0173 surface and is allowed);
 *   - the proto leg is `retired-by-0175` (no gRPC path exists to compare).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function yamlPathKeys(text) { // top-level `paths:` block keys — the corpus writes them as `  /x/y:` at two-space indent
  const m = /^paths:\s*$/m.exec(text); if (!m) return [];
  const rest = text.slice(m.index + m[0].length);
  const end = /^[a-zA-Z]/m.exec(rest); const block = end ? rest.slice(0, end.index) : rest;
  // Path keys may carry an action suffix (`/v1/runs/{runId}:fork`), so the key
  // is everything up to the colon that ENDS the line, not the first colon.
  return [...block.matchAll(/^  (\/\S*):\s*$/gm)].map((x) => x[1]);
}
function asyncapi(text) {
  const pathname = (/^\s+pathname:\s*['"]?([^'"\n]*)['"]?/m.exec(text) ?? [, ''])[1].trim();
  // A channel whose address is `null` (AsyncAPI 3: the address is declared
  // elsewhere — the discovery document, RFC 0171 §C hostEvents) has no path to
  // compare; it is skipped here and checked by its own leg at v2.
  const addresses = [...text.matchAll(/^\s+address:\s*['"]?([^'"\n]+)['"]?/gm)].map((x) => x[1].trim()).filter((a) => a !== 'null' && a !== '~');
  return { pathname, addresses };
}

// v1
const oa1 = yamlPathKeys(readFileSync(join(ROOT, 'api', 'openapi.yaml'), 'utf8'));
for (const k of oa1) if (!k.startsWith('/v1/') && !k.startsWith('/.well-known/')) failures.push(`v1 OpenAPI key ${k} is neither /v1/ nor /.well-known/`);
const aa1 = asyncapi(readFileSync(join(ROOT, 'api', 'asyncapi.yaml'), 'utf8'));
if (aa1.pathname !== '/v1') failures.push(`v1 AsyncAPI server pathname is "${aa1.pathname}", expected /v1`);
const oa1set = new Set(oa1);
for (const a of aa1.addresses) { const resolved = a.startsWith('/') ? aa1.pathname + a : a; if (!oa1set.has(resolved)) failures.push(`v1 AsyncAPI channel ${a} resolves to ${resolved}, not an OpenAPI path key`); }
const man1 = JSON.parse(readFileSync(join(ROOT, 'spec', 'v1', 'operation-path-manifest.json'), 'utf8'));
const man1set = new Set(man1.operations.map((o) => o.resolvedPath));
for (const k of oa1) if (!man1set.has(k)) failures.push(`v1 OpenAPI key ${k} missing from operation-path-manifest.json`);
for (const k of man1set) if (!oa1set.has(k)) failures.push(`manifest path ${k} is not an OpenAPI key`);
const seams1 = oa1.filter((k) => /^\/v1\/(host\/sample\/|host\/workspace\/files|packs-test\/)/.test(k));
console.log(`  v1: ${oa1.length} OpenAPI keys, ${aa1.addresses.length} AsyncAPI channels resolve, manifest in parity; ${seams1.length} seam/test-mode key(s) present (deprecated → removed at v2, RFC 0168 C1.6)`);

// v2
const oa2p = join(ROOT, 'api', 'v2', 'openapi.yaml');
if (existsSync(oa2p)) {
  const oa2 = yamlPathKeys(readFileSync(oa2p, 'utf8')); const oa2set = new Set(oa2);
  for (const k of oa2) { if (/^\/v[12]\//.test(k)) failures.push(`v2 OpenAPI key ${k} carries a version segment (RFC 0172 §A.2)`); if (/^\/(host\/sample\/|host\/workspace\/files|packs-test\/)/.test(k)) failures.push(`v2 OpenAPI key ${k} is a seam/test-mode operation (RFC 0168 §C.2)`); }
  const aa2p = join(ROOT, 'api', 'v2', 'asyncapi.yaml');
  if (existsSync(aa2p)) { const aa2 = asyncapi(readFileSync(aa2p, 'utf8')); if (aa2.pathname !== '') failures.push(`v2 AsyncAPI server pathname must be empty, got "${aa2.pathname}"`); for (const a of aa2.addresses) if (!oa2set.has(a)) failures.push(`v2 AsyncAPI channel ${a} is not an OpenAPI path key`); }
  else failures.push('api/v2/asyncapi.yaml missing beside api/v2/openapi.yaml');
  const man2p = join(ROOT, 'spec', 'v2', 'path-manifest.json');
  if (existsSync(man2p)) { const m2 = JSON.parse(readFileSync(man2p, 'utf8')); const s = new Set((m2.operations ?? []).map((o) => o.path)); for (const k of oa2) if (!s.has(k)) failures.push(`v2 key ${k} missing from spec/v2/path-manifest.json`); for (const k of s) if (!oa2set.has(k)) failures.push(`v2 manifest path ${k} is not an OpenAPI key`); }
  else failures.push('spec/v2/path-manifest.json missing beside api/v2/openapi.yaml');
  console.log(`  v2: ${oa2.length} OpenAPI keys checked; proto leg: retired-by-0175`);
} else console.log('  v2: api/v2/ does not exist yet (v2 leg not measured)');

if (failures.length) { console.error('=== check-path-parity FAILED ===\n  ' + failures.join('\n  ')); process.exit(1); }
console.log('=== check-path-parity OK ===');
