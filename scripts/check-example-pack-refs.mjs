#!/usr/bin/env node
/**
 * Validates that every `metadata.packs[]` entry in `examples/* /*.json`
 * workflow-definition files resolves to a published, non-yanked pack version
 * at the configured registry (default: https://packs.openwop.dev).
 *
 *   node scripts/check-example-pack-refs.mjs
 *   node scripts/check-example-pack-refs.mjs --registry https://packs.openwop.dev
 *   node scripts/check-example-pack-refs.mjs --offline registry/v1/index.json
 *
 * Files are detected by presence of `.metadata.packs` array containing
 * `<name>@<version>` strings. Files without that shape are silently skipped
 * (they are runnable examples with package.json, not workflow definitions).
 *
 * Exit codes:
 *   0  all references resolve to published, non-yanked versions
 *   1  one or more references unresolved / yanked / wrong version
 *   2  registry unreachable + no --offline fallback supplied
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const DEFAULT_REGISTRY = 'https://packs.openwop.dev';
const args = process.argv.slice(2);
const registryFlag = args.indexOf('--registry');
const offlineFlag = args.indexOf('--offline');
const registry = registryFlag >= 0 ? args[registryFlag + 1] : DEFAULT_REGISTRY;
const offlineIndex = offlineFlag >= 0 ? args[offlineFlag + 1] : null;

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
    res = await fetch(url, { redirect: 'follow' });
  } catch (e) {
    console.error(`ERROR: registry unreachable at ${url}: ${e.message}`);
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
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) return null;
  return res.json();
}

async function loadPackVersion(name, version) {
  if (offlineIndex) {
    const dir = offlineIndex.replace(/\/v1\/index\.json$/, '');
    const path = `${dir}/v1/packs/${name}/-/${version}.json`;
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  const url = `${registry.replace(/\/$/, '')}/v1/packs/${name}/-/${version}.json`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) return null;
  return res.json();
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
    async typeIdsOf(name, wantVersion) {
      const key = `${name}@${wantVersion}`;
      if (!manifestCache.has(key)) {
        const manifest = await loadPackVersion(name, wantVersion);
        const typeIds = manifest?.nodes?.map((n) => n.typeId).filter(Boolean) ?? null;
        manifestCache.set(key, typeIds);
      }
      return manifestCache.get(key);
    },
  };
}

function extractDeclaredPacks(parsed) {
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
  }

  console.log(
    `Checked ${workflowCount} workflow-definition file(s) against ${topIndex.packs?.length ?? 0} published pack(s) at ${offlineIndex ?? registry}.`,
  );

  if (report.length === 0) {
    console.log('OK: every metadata.packs[] reference resolves to a non-yanked, non-deprecated published version, and every node typeId is shipped by a declared pack.');
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
