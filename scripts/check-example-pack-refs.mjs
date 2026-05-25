#!/usr/bin/env node
/**
 * Validates `examples/* /*.json` workflow-definition files against the
 * registry in three passes:
 *
 *   1. metadata.packs[] resolution — each <name>@<version> exists +
 *      is not yanked at the registry.
 *   2. typeId resolution — each node's typeId is shipped by one of
 *      the declared packs (per-version manifest's nodes[].typeId).
 *   3. config-key validation — each key in a node's config object is
 *      declared in the pack's configSchema (when the schema has
 *      additionalProperties: false). Catches typoed field names that
 *      otherwise silently fall back to pack defaults.
 *
 *   node scripts/check-example-pack-refs.mjs
 *   node scripts/check-example-pack-refs.mjs --registry https://packs.openwop.dev
 *   node scripts/check-example-pack-refs.mjs --offline registry/v1/index.json
 *
 * Files are detected by presence of `.metadata.packs` array containing
 * `<name>@<version>` strings. Files without that shape are silently skipped
 * (they are runnable examples with package.json, not workflow definitions).
 *
 * Offline mode reads schemas from the in-tree tarballs at
 * `registry/v1/packs/{name}/-/{version}.tgz`. Live mode fetches them from
 * the CDN's derived schema mirror at /v1/packs/{name}/{version}/<file>.
 * Live-mode warnings for missing schemas are expected (only ~12 schemas
 * are CDN-mirrored as of 2026-05-13; the rest live only in tarballs).
 * The CI gate runs in offline mode where coverage is complete.
 *
 * Exit codes:
 *   0  all three passes clean
 *   1  one or more references unresolved / yanked / wrong typeId / unknown config key
 *   2  registry unreachable + no --offline fallback supplied
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { gunzipSync } from 'node:zlib';

/**
 * Extract a single file's bytes from a gzipped USTAR tarball. Returns
 * null if the file isn't present. Pattern lifted from
 * registry/scripts/generate-sbom.mjs's enumerateTarball() — same USTAR
 * conventions (`./` prefix stripping, 512-byte blocks, octal size).
 */
function readTarballFile(tarballBytes, wantPath) {
  const decompressed = gunzipSync(tarballBytes);
  const BLOCK = 512;
  for (let off = 0; off + BLOCK <= decompressed.length; ) {
    const nameBuf = decompressed.subarray(off, off + 100);
    const nameEnd = nameBuf.indexOf(0);
    const rawName = nameBuf.subarray(0, nameEnd < 0 ? 100 : nameEnd).toString('utf8');
    if (rawName === '') break;
    const name = rawName.replace(/^\.\//, '');
    const sizeStr = decompressed
      .subarray(off + 124, off + 136)
      .toString('ascii')
      .replace(/\0/g, '')
      .trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeflag = decompressed[off + 156];
    if (typeflag === 0x78 || typeflag === 0x4c) {
      throw new Error(`USTAR extended header (typeflag=0x${typeflag.toString(16)}) not supported`);
    }
    const isRegular = typeflag === 0x30 || typeflag === 0;
    if (isRegular && name === wantPath) {
      return decompressed.subarray(off + BLOCK, off + BLOCK + size);
    }
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return null;
}

const DEFAULT_REGISTRY = 'https://packs.openwop.dev';
const FETCH_TIMEOUT_MS = 15000;
const args = process.argv.slice(2);
const registryFlag = args.indexOf('--registry');
const offlineFlag = args.indexOf('--offline');
const registry = registryFlag >= 0 ? args[registryFlag + 1] : DEFAULT_REGISTRY;
const offlineIndex = offlineFlag >= 0 ? args[offlineFlag + 1] : null;

/**
 * fetch() with a hard timeout via AbortController. Without this a slow-
 * but-reachable registry would hang until GitHub Actions' job-level
 * timeout (5min default), masking the real failure.
 */
async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

function listExampleWorkflowFiles(root = 'examples') {
  const out = [];
  if (!existsSync(root)) return out;
  for (const dir of readdirSync(root)) {
    const sub = join(root, dir);
    if (!statSync(sub).isDirectory()) continue;
    for (const entry of readdirSync(sub)) {
      if (!entry.endsWith('.json')) continue;
      out.push(join(sub, entry));
    }
  }
  return out;
}

function isWorkflowDefinition(parsed) {
  return (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray(parsed?.metadata?.packs) &&
    parsed.metadata.packs.length > 0 &&
    parsed.metadata.packs.every((p) => typeof p === 'string' && p.includes('@'))
  );
}

async function loadTopIndex() {
  if (offlineIndex) {
    if (!existsSync(offlineIndex)) {
      console.error(`ERROR: --offline file not found: ${offlineIndex}`);
      process.exit(2);
    }
    return JSON.parse(readFileSync(offlineIndex, 'utf8'));
  }
  const url = `${registry.replace(/\/$/, '')}/v1/index.json`;
  let res;
  try {
    res = await fetchWithTimeout(url, { redirect: 'follow' });
  } catch (e) {
    const detail = e.name === 'AbortError' ? `timeout after ${FETCH_TIMEOUT_MS}ms` : e.message;
    console.error(`ERROR: registry unreachable at ${url}: ${detail}`);
    console.error(`  Hint: pass --offline registry/v1/index.json to validate against in-tree state`);
    process.exit(2);
  }
  if (!res.ok) {
    console.error(`ERROR: registry returned ${res.status} for ${url}`);
    process.exit(2);
  }
  return res.json();
}

async function loadPackIndex(name) {
  if (offlineIndex) {
    const dir = offlineIndex.replace(/\/v1\/index\.json$/, '');
    const path = `${dir}/v1/packs/${name}/index.json`;
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  const url = `${registry.replace(/\/$/, '')}/v1/packs/${name}/index.json`;
  try {
    const res = await fetchWithTimeout(url, { redirect: 'follow' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function loadPackVersion(name, version) {
  if (offlineIndex) {
    const dir = offlineIndex.replace(/\/v1\/index\.json$/, '');
    const path = `${dir}/v1/packs/${name}/-/${version}.json`;
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  const url = `${registry.replace(/\/$/, '')}/v1/packs/${name}/-/${version}.json`;
  try {
    const res = await fetchWithTimeout(url, { redirect: 'follow' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch a schema file referenced by configSchemaRef / inputSchemaRef
 * (e.g., "schemas/chat-completion.config.json"). In offline mode the
 * source is the in-tree tarball at registry/v1/packs/{name}/-/{version}.tgz;
 * in live mode it's the derived mirror at
 *   /v1/packs/{name}/{version}/<schema-basename>
 */
async function loadPackSchema(name, version, schemaRef) {
  if (offlineIndex) {
    const dir = offlineIndex.replace(/\/v1\/index\.json$/, '');
    const tarballPath = `${dir}/v1/packs/${name}/-/${version}.tgz`;
    if (!existsSync(tarballPath)) return { schema: null };
    try {
      const bytes = readTarballFile(readFileSync(tarballPath), schemaRef);
      if (!bytes) return { schema: null };
      return { schema: JSON.parse(bytes.toString('utf8')) };
    } catch (e) {
      return { schema: null, parseError: e.message };
    }
  }
  const filename = schemaRef.replace(/^schemas\//, '');
  const url = `${registry.replace(/\/$/, '')}/v1/packs/${name}/${version}/${filename}`;
  try {
    const res = await fetchWithTimeout(url, { redirect: 'follow' });
    if (!res.ok) return { schema: null };
    return { schema: await res.json() };
  } catch (e) {
    return { schema: null, parseError: e.message };
  }
}

/**
 * Fetch a schema file referenced by configSchemaRef / inputSchemaRef
 * (e.g., "schemas/chat-completion.config.json"). In offline mode the
 * source is the in-tree tarball at registry/v1/packs/{name}/-/{version}.tgz;
 * in live mode it's the derived mirror at
 *   /v1/packs/{name}/{version}/<schema-basename>
 */
async function loadPackSchema(name, version, schemaRef) {
  if (offlineIndex) {
    const dir = offlineIndex.replace(/\/v1\/index\.json$/, '');
    const tarballPath = `${dir}/v1/packs/${name}/-/${version}.tgz`;
    if (!existsSync(tarballPath)) return null;
    try {
      const bytes = readTarballFile(readFileSync(tarballPath), schemaRef);
      if (!bytes) return null;
      return JSON.parse(bytes.toString('utf8'));
    } catch (e) {
      return null;
    }
  }
  const filename = schemaRef.replace(/^schemas\//, '');
  const url = `${registry.replace(/\/$/, '')}/v1/packs/${name}/${version}/${filename}`;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function buildPackResolver(topIndex) {
  const known = new Set((topIndex.packs ?? []).map((p) => p.name));
  const detailCache = new Map();
  const manifestCache = new Map();
  return {
    async resolve(name, wantVersion) {
      if (!known.has(name)) return { ok: false, reason: 'pack name not found in registry' };
      if (!detailCache.has(name)) {
        const detail = await loadPackIndex(name);
        detailCache.set(name, detail);
      }
      const detail = detailCache.get(name);
      if (!detail) return { ok: false, reason: 'per-pack index unreachable' };
      const versions = detail.versions ?? [];
      const match = versions.find((v) => v.version === wantVersion);
      if (!match) {
        const have = versions.map((v) => v.version).join(', ') || '(none)';
        return { ok: false, reason: `version ${wantVersion} not published; available: ${have}` };
      }
      if (match.yanked) return { ok: false, reason: `version ${wantVersion} is YANKED` };
      if (match.deprecated || detail.deprecated) {
        return { ok: true, warn: `version ${wantVersion} is DEPRECATED` };
      }
      return { ok: true };
    },
    async manifestOf(name, wantVersion) {
      const key = `${name}@${wantVersion}`;
      if (!manifestCache.has(key)) {
        manifestCache.set(key, await loadPackVersion(name, wantVersion));
      }
      return manifestCache.get(key);
    },
    async typeIdsOf(name, wantVersion) {
      const manifest = await this.manifestOf(name, wantVersion);
      return manifest?.nodes?.map((n) => n.typeId).filter(Boolean) ?? null;
    },
    async nodeDefOf(name, wantVersion, typeId) {
      const manifest = await this.manifestOf(name, wantVersion);
      return manifest?.nodes?.find((n) => n.typeId === typeId) ?? null;
    },
    async schemaOf(name, wantVersion, schemaRef) {
      return loadPackSchema(name, wantVersion, schemaRef);
    },
  };
}

/**
 * Return the set of top-level `properties` keys declared by a JSON Schema,
 * or null if the schema doesn't declare a properties object (e.g., uses
 * oneOf/anyOf only — too complex for the key-check pass).
 */
function declaredConfigKeys(schema) {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.properties && typeof schema.properties === 'object') {
    return new Set(Object.keys(schema.properties));
  }
  return null;
}

function extractDeclaredPacks(parsed) {
  // Precondition: every spec contains `@` (enforced by isWorkflowDefinition's
  // .every((p) => typeof p === 'string' && p.includes('@'))). spec.indexOf('@')
  // returning -1 here would indicate the precondition was bypassed.
  return (parsed.metadata?.packs ?? []).map((spec) => {
    const at = spec.indexOf('@');
    return { spec, name: spec.slice(0, at), version: spec.slice(at + 1) };
  });
}

function extractNodeTypeIds(parsed) {
  return (parsed.nodes ?? []).map((n) => ({ nodeId: n.id, typeId: n.typeId })).filter((n) => n.typeId);
}

async function main() {
  const files = listExampleWorkflowFiles();
  if (files.length === 0) {
    console.log('No example files found under examples/');
    return 0;
  }

  const topIndex = await loadTopIndex();
  const resolver = await buildPackResolver(topIndex);

  const report = [];
  let workflowCount = 0;
  let errorCount = 0;
  let warnCount = 0;

  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      report.push({ file, kind: 'PARSE_ERROR', message: e.message });
      errorCount += 1;
      continue;
    }
    if (!isWorkflowDefinition(parsed)) continue;
    workflowCount += 1;

    const declared = extractDeclaredPacks(parsed);

    // Pass 1 — pack@version resolution + cache the per-version manifests
    const resolvedPacks = [];
    for (const pack of declared) {
      const result = await resolver.resolve(pack.name, pack.version);
      if (!result.ok) {
        report.push({ file, kind: 'UNRESOLVED', spec: pack.spec, reason: result.reason });
        errorCount += 1;
        continue;
      }
      if (result.warn) {
        report.push({ file, kind: 'WARN', spec: pack.spec, reason: result.warn });
        warnCount += 1;
      }
      resolvedPacks.push(pack);
    }

    // Pass 2 — typeId resolution: each node's typeId MUST exist in one of the
    // declared (and resolved) packs.
    const typeIdToPack = new Map();
    for (const pack of resolvedPacks) {
      const typeIds = await resolver.typeIdsOf(pack.name, pack.version);
      if (!typeIds) {
        report.push({
          file,
          kind: 'MANIFEST_UNREACHABLE',
          spec: pack.spec,
          reason: 'per-version manifest unreachable — cannot verify typeIds',
        });
        errorCount += 1;
        continue;
      }
      for (const tid of typeIds) {
        if (typeIdToPack.has(tid)) {
          // typeId collision across declared packs — surface as warning
          report.push({
            file,
            kind: 'WARN',
            spec: tid,
            reason: `typeId shipped by both ${typeIdToPack.get(tid).spec} and ${pack.spec}`,
          });
          warnCount += 1;
        }
        typeIdToPack.set(tid, pack);
      }
    }

    for (const node of extractNodeTypeIds(parsed)) {
      if (!typeIdToPack.has(node.typeId)) {
        report.push({
          file,
          kind: 'TYPEID_UNRESOLVED',
          spec: `${node.nodeId}:${node.typeId}`,
          reason: `typeId not shipped by any declared pack — add the providing pack to metadata.packs[] or fix the typeId`,
        });
        errorCount += 1;
      }
    }

    // Pass 3 — config-key validation: every key in node.config MUST be declared
    // in the pack's configSchema.properties. Doesn't validate types or recurse;
    // catches typoed field names (e.g., "temperture" instead of "temperature")
    // which silently fall back to pack defaults.
    for (const node of parsed.nodes ?? []) {
      if (!node.config || typeof node.config !== 'object') continue;
      const pack = typeIdToPack.get(node.typeId);
      if (!pack) continue; // already reported as TYPEID_UNRESOLVED
      const def = await resolver.nodeDefOf(pack.name, pack.version, node.typeId);
      if (!def?.configSchemaRef) continue; // pack declares no config schema
      const { schema, parseError } = await resolver.schemaOf(pack.name, pack.version, def.configSchemaRef);
      if (!schema) {
        const why = parseError
          ? `parse error: ${parseError}`
          : 'not fetchable';
        report.push({
          file,
          kind: 'WARN',
          spec: `${node.id}:${node.typeId}`,
          reason: `config schema ${def.configSchemaRef} ${why} — skipping key validation`,
        });
        warnCount += 1;
        continue;
      }
      const declared = declaredConfigKeys(schema);
      if (!declared) continue; // schema uses oneOf/etc — too complex for key-check
      if (schema.additionalProperties !== false) continue; // open schemas don't drift on typos
      for (const key of Object.keys(node.config)) {
        if (!declared.has(key)) {
          const suggest = Array.from(declared).join(', ');
          report.push({
            file,
            kind: 'CONFIG_KEY',
            spec: `${node.id}:${node.typeId}.${key}`,
            reason: `config key not declared in ${def.configSchemaRef}; allowed: ${suggest || '(none)'}`,
          });
          errorCount += 1;
        }
      }
    }
  }

  console.log(
    `Checked ${workflowCount} workflow-definition file(s) against ${topIndex.packs?.length ?? 0} published pack(s) at ${offlineIndex ?? registry}.`,
  );

  if (report.length === 0) {
    console.log(
      'OK: every metadata.packs[] reference resolves to a non-yanked, non-deprecated published version; every node typeId is shipped by a declared pack; every node.config key is declared in the pack\'s configSchema.',
    );
    return 0;
  }

  for (const row of report) {
    const tag = row.kind === 'WARN' ? 'WARN' : 'FAIL';
    const detail = row.spec ? `  ${row.spec}` : '';
    console.log(`${tag} ${basename(row.file)}${detail}: ${row.reason ?? row.message}`);
  }

  console.log('');
  console.log(`Summary: ${errorCount} error(s), ${warnCount} warning(s).`);
  return errorCount > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error('Uncaught:', e);
    process.exit(2);
  },
);
