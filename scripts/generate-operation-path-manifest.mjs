#!/usr/bin/env node
/**
 * generate-operation-path-manifest.mjs — RFC 0149 §A / §Conformance.
 *
 * Emits `spec/v1/operation-path-manifest.json`: the canonical, RESOLVED
 * operation-path manifest that SDK repositories consume ("SDK repositories
 * consume a generated canonical operation-path manifest" — RFC 0149
 * §Conformance). One row per OpenAPI operation:
 *
 *   { operationId, method, pathKey, resolvedPath, tag, class }
 *
 * `resolvedPath` is `servers[0].url`'s path portion + the path key — the string
 * an SDK MUST issue against a bare base URL — with the RFC 0149 §A guarantee
 * that it carries exactly one `/v1` segment (or none, for `/.well-known/*`).
 * `class` says what kind of surface the row is, so an SDK parity check can be
 * strict about the right set:
 *
 *   - `canonical`      — protocol surface; every SDK is expected to issue it;
 *   - `host-extension` — `tags: [host]` — reference-host extension surfaces
 *                        published in the contract for tooling, optional in SDKs;
 *   - `test-catalog`   — `tags: [packs-test]` — the test registry seam.
 *
 * Text-scanned like the other corpus gates (no YAML dependency): a 2-space
 * `/path:` key opens a path block, a 4-space HTTP verb opens an operation,
 * and `operationId:` / `tags:` are read inside it. `--write` regenerates;
 * `--check` (default) fails when the committed file is stale.
 * `openapi-asyncapi-sdk-parity.test.ts` re-derives the same rows in-process
 * and compares, so this script and the suite cannot silently disagree.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OPENAPI = join(ROOT, 'api', 'openapi.yaml');
const OUT = join(ROOT, 'spec', 'v1', 'operation-path-manifest.json');

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

export function serverUrls(raw) {
  const urls = [];
  let inServers = false;
  for (const line of raw.split('\n')) {
    if (/^servers:/.test(line)) { inServers = true; continue; }
    if (inServers && /^[^\s#]/.test(line)) break;
    if (!inServers) continue;
    const m = /^\s*-\s*url:\s*(\S+)\s*$/.exec(line);
    if (m) urls.push(m[1]);
  }
  return urls;
}

export function resolvedPath(serverUrl, pathKey) {
  const afterScheme = serverUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const slash = afterScheme.indexOf('/');
  const basePath = slash === -1 ? '' : afterScheme.slice(slash);
  return `${basePath.replace(/\/$/, '')}${pathKey}`;
}

/** Walk `paths:`; return [{ operationId, method, pathKey, tag }] in document order. */
export function operations(raw) {
  const rows = [];
  let inPaths = false;
  let pathKey = null;
  let op = null;
  for (const line of raw.split('\n')) {
    if (/^paths:/.test(line)) { inPaths = true; continue; }
    if (inPaths && /^[^\s#]/.test(line)) break;
    if (!inPaths) continue;
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) { pathKey = p[1]; op = null; continue; }
    const v = /^ {4}([a-z]+):\s*$/.exec(line);
    if (v && VERBS.has(v[1]) && pathKey !== null) {
      op = { operationId: null, method: v[1].toUpperCase(), pathKey, tag: null };
      rows.push(op);
      continue;
    }
    if (op === null) continue;
    const id = /^ {6}operationId:\s*([A-Za-z0-9_]+)\s*$/.exec(line);
    if (id) { op.operationId = id[1]; continue; }
    const t = /^ {6}tags:\s*\[([^\]]*)\]\s*$/.exec(line);
    if (t) { op.tag = t[1].split(',')[0].trim(); continue; }
  }
  return rows;
}

export function classify(row) {
  if (row.tag === 'host') return 'host-extension';
  if (row.tag === 'packs-test') return 'test-catalog';
  return 'canonical';
}

export function build(raw = readFileSync(OPENAPI, 'utf8')) {
  const servers = serverUrls(raw);
  if (servers.length === 0) throw new Error('openapi.yaml has no servers[] — refusing to emit');
  const base = servers[0];
  const ops = operations(raw);
  const missing = ops.filter((o) => o.operationId === null);
  if (missing.length > 0) {
    throw new Error(`operations without operationId: ${missing.map((o) => `${o.method} ${o.pathKey}`).join(', ')}`);
  }
  const rows = ops
    .map((o) => ({
      operationId: o.operationId,
      method: o.method,
      pathKey: o.pathKey,
      resolvedPath: resolvedPath(base, o.pathKey),
      tag: o.tag ?? '',
      class: classify(o),
    }))
    .sort((a, b) => a.resolvedPath.localeCompare(b.resolvedPath) || a.method.localeCompare(b.method));
  const ids = new Set();
  for (const r of rows) {
    if (ids.has(r.operationId)) throw new Error(`duplicate operationId ${r.operationId}`);
    ids.add(r.operationId);
    const v1 = (r.resolvedPath.match(/\/v1(?=\/|$)/g) ?? []).length;
    if (r.pathKey.startsWith('/.well-known/') ? v1 !== 0 : v1 !== 1) {
      throw new Error(`${r.operationId} resolves to ${r.resolvedPath} — RFC 0149 §A requires exactly one /v1 segment (none for /.well-known/*)`);
    }
  }
  const body = {
    $comment:
      'GENERATED by scripts/generate-operation-path-manifest.mjs — do not edit. RFC 0149 §A/§Conformance: the canonical resolved operation-path manifest SDK repositories consume. `resolvedPath` is what an SDK MUST issue against a bare base URL. `class`: canonical | host-extension (tags: [host]) | test-catalog (tags: [packs-test]).',
    generatedFrom: 'api/openapi.yaml',
    serverUrl: base,
    operations: rows,
    counts: {
      total: rows.length,
      canonical: rows.filter((r) => r.class === 'canonical').length,
      hostExtension: rows.filter((r) => r.class === 'host-extension').length,
      testCatalog: rows.filter((r) => r.class === 'test-catalog').length,
    },
  };
  const digest = createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
  return { ...body, digest };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const manifest = build();
  const serialized = JSON.stringify(manifest, null, 2) + '\n';
  if (process.argv.includes('--write')) {
    writeFileSync(OUT, serialized);
    console.log(`wrote ${OUT}`);
    console.log(`  ${manifest.counts.total} operations (${manifest.counts.canonical} canonical, ${manifest.counts.hostExtension} host-extension, ${manifest.counts.testCatalog} test-catalog)`);
  } else {
    if (!existsSync(OUT)) {
      console.error('operation-path-manifest.json is missing. Run: node scripts/generate-operation-path-manifest.mjs --write');
      process.exit(1);
    }
    if (readFileSync(OUT, 'utf8') !== serialized) {
      console.error(
        'operation-path-manifest.json is stale — api/openapi.yaml moved and the manifest did not.\n' +
          'Run: node scripts/generate-operation-path-manifest.mjs --write',
      );
      process.exit(1);
    }
    console.log('operation-path-manifest.json is in sync with api/openapi.yaml.');
  }
}
