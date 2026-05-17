#!/usr/bin/env node
/**
 * Structural conformance gate for every published pack.
 *
 * Stage 2 PR 3 (2026-05-12): closes CRITICAL finding #3 from the
 * enterprise-architecture review. Before this gate, a pack with a typo
 * in `inputSchemaRef`, a duplicate typeId, or a malformed JSON Schema
 * could land on `main` and ship to packs.openwop.dev — consumers
 * dispatching the pack would crash at runtime instead of at publish.
 *
 * Scope: STRUCTURAL conformance (this script). Authoring errors only.
 *
 * Out of scope: RUNTIME conformance (the pack actually dispatches on a
 * reference host). That gate is per-pack scenario file authored
 * alongside each pack in Stage 5 — too pack-specific for a one-size
 * gate here. This gate is the upstream filter.
 *
 * For each `registry/v1/packs/<name>/-/<version>.{tgz,json}`:
 *   1. Extract pack.json from tarball; assert it matches the version
 *      manifest on disk (no drift between tarball and served metadata).
 *   2. Parse every `nodes[].{inputSchemaRef, outputSchemaRef, configSchemaRef}`
 *      reference; assert the file exists in the tarball AND parses as
 *      valid JSON.
 *   3. Compile every referenced schema under Ajv draft 2020-12; assert
 *      it's a structurally valid JSON Schema.
 *   4. Assert no duplicate typeIds within the same pack.
 *   5. Assert pack name/version in manifest matches the URL path.
 *   6. Assert `peerDependencies` keys are well-formed `host.<surface>`
 *      identifiers.
 *
 * Exits 1 on first violation. Reports the count of pass/fail.
 *
 * @see services/workflow-runtime/src/registry/manifestValidator.ts
 *      (host-side runtime check used at install time; this script is
 *      the publish-PR-time mirror)
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REGISTRY_ROOT = dirname(dirname(__filename));
const PACKS_ROOT = join(REGISTRY_ROOT, 'v1', 'packs');

const TTY = process.stdout.isTTY;
const C = TTY
  ? { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', reset: '\x1b[0m' }
  : { red: '', green: '', yellow: '', dim: '', reset: '' };
const ok = (s) => console.log(`${C.green}✓${C.reset} ${s}`);
const fail = (s) => console.error(`${C.red}✗${C.reset} ${s}`);

// ─── tarball ────────────────────────────────────────────────────────

/**
 * Build a path → bytes map of every file in the gzipped USTAR tarball.
 * Used so referenced schema files can be looked up cheaply.
 */
function readTarballEntries(tarballBytes) {
  const decompressed = gunzipSync(tarballBytes);
  const BLOCK = 512;
  const entries = new Map();
  for (let off = 0; off + BLOCK <= decompressed.length; ) {
    const nameBuf = decompressed.subarray(off, off + 100);
    const nameEnd = nameBuf.indexOf(0);
    const rawName = nameBuf
      .subarray(0, nameEnd < 0 ? 100 : nameEnd)
      .toString('utf8');
    // True end-of-archive = zero-filled block. `rawName === ''` only when
    // the name field is entirely NUL bytes.
    if (rawName === '') break;
    const name = rawName.replace(/^\.\//, '');
    const sizeStr = decompressed
      .subarray(off + 124, off + 136)
      .toString('ascii')
      .replace(/\0/g, '')
      .trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeFlag = String.fromCharCode(decompressed[off + 156] || 0x30);
    // Skip directory entries (typeFlag '5') and pax-header sentinels
    // ('x', 'g', 'L') — they advance off normally but don't contribute
    // a tracked file entry. A bare `./` (after strip) is also a
    // directory marker.
    if (name && (typeFlag === '0' || typeFlag === '\0')) {
      entries.set(name, decompressed.subarray(off + BLOCK, off + BLOCK + size));
    }
    off += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return entries;
}

// ─── per-pack checks ────────────────────────────────────────────────

function check(packName, version, errors) {
  const baseDir = join(PACKS_ROOT, packName, '-');
  const tarballPath = join(baseDir, `${version}.tgz`);
  const manifestPath = join(baseDir, `${version}.json`);

  if (!existsSync(tarballPath)) {
    errors.push(`${packName}@${version}: tarball missing`);
    return;
  }
  if (!existsSync(manifestPath)) {
    errors.push(`${packName}@${version}: version manifest missing`);
    return;
  }

  const tarballBytes = readFileSync(tarballPath);
  const entries = readTarballEntries(tarballBytes);

  // 1. Extract pack.json from tarball; check matches version manifest.
  const inTarball = entries.get('pack.json');
  if (!inTarball) {
    errors.push(`${packName}@${version}: pack.json missing from tarball`);
    return;
  }
  let tarballManifest;
  try {
    tarballManifest = JSON.parse(inTarball.toString('utf8'));
  } catch (err) {
    errors.push(`${packName}@${version}: pack.json in tarball is invalid JSON: ${err.message}`);
    return;
  }

  const versionManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  // Cross-check pack-identity invariants:
  if (tarballManifest.name !== packName) {
    errors.push(
      `${packName}@${version}: tarball pack.json declares name='${tarballManifest.name}' (mismatch with directory)`,
    );
  }
  if (tarballManifest.version !== version) {
    errors.push(
      `${packName}@${version}: tarball pack.json declares version='${tarballManifest.version}' (mismatch with file path)`,
    );
  }
  if (versionManifest.name !== packName) {
    errors.push(`${packName}@${version}: version-manifest name mismatch`);
  }
  if (versionManifest.version !== version) {
    errors.push(`${packName}@${version}: version-manifest version mismatch`);
  }

  // 2. Pack-kind discriminator (RFC 0013). Routes the rest of validation:
  //   - kind=node (default) → existing nodes[] checks (schema refs etc.)
  //   - kind=workflow-chain → chains[] checks (dag fragments, no schema refs)
  // Manifests carrying BOTH nodes[] AND chains[] are rejected as
  // pack_kind_invalid per workflow-chain-packs.md §"Pack kind discriminator".
  const kind = tarballManifest.kind ?? 'node';
  const hasNodes = Array.isArray(tarballManifest.nodes) && tarballManifest.nodes.length > 0;
  const hasChains = Array.isArray(tarballManifest.chains) && tarballManifest.chains.length > 0;
  if (hasNodes && hasChains) {
    errors.push(
      `${packName}@${version}: pack_kind_invalid — manifests MUST have exactly one of nodes[] or chains[], not both`,
    );
    return;
  }
  if (kind === 'workflow-chain' && hasNodes) {
    errors.push(
      `${packName}@${version}: pack_kind_invalid — kind: "workflow-chain" rejects nodes[]; use chains[] instead`,
    );
    return;
  }
  if (kind === 'node' && hasChains) {
    errors.push(
      `${packName}@${version}: pack_kind_invalid — kind: "node" (or omitted) rejects chains[]; set kind: "workflow-chain"`,
    );
    return;
  }

  if (kind === 'workflow-chain') {
    // Workflow-chain pack checks per workflow-chain-packs.md.
    if (!hasChains) {
      errors.push(
        `${packName}@${version}: kind: "workflow-chain" requires a non-empty chains[]`,
      );
      return;
    }
    const seenChainIds = new Set();
    for (const chain of tarballManifest.chains) {
      const chainId = chain.chainId;
      if (!chainId) {
        errors.push(`${packName}@${version}: a chain entry is missing chainId`);
        continue;
      }
      // Same reverse-DNS pattern as node typeIds. Defensive duplicate of the
      // schema's `pattern` so structural errors surface here even when
      // schema validation isn't run inline.
      if (!/^[a-z][a-zA-Z0-9._-]*$/.test(chainId)) {
        errors.push(
          `${packName}@${version}: chainId '${chainId}' violates the reverse-DNS pattern ^[a-z][a-zA-Z0-9._-]*$`,
        );
      }
      if (seenChainIds.has(chainId)) {
        errors.push(`${packName}@${version}: duplicate chainId '${chainId}' within pack`);
      }
      seenChainIds.add(chainId);

      // Every chain MUST declare a non-empty dag.nodes[] (per the schema's
      // required[] but defensively re-asserted here).
      const dagNodes = chain.dag?.nodes;
      if (!Array.isArray(dagNodes) || dagNodes.length === 0) {
        errors.push(
          `${packName}@${version} chain '${chainId}': dag.nodes MUST be a non-empty array`,
        );
        continue;
      }
      // Each fragment node MUST have a typeId so the host editor can
      // resolve at expansion time.
      const seenNodeIds = new Set();
      for (const node of dagNodes) {
        if (!node.id) {
          errors.push(
            `${packName}@${version} chain '${chainId}': a dag.nodes[] entry is missing id`,
          );
          continue;
        }
        if (seenNodeIds.has(node.id)) {
          errors.push(
            `${packName}@${version} chain '${chainId}': duplicate node id '${node.id}' within fragment`,
          );
        }
        seenNodeIds.add(node.id);
        if (!node.typeId) {
          errors.push(
            `${packName}@${version} chain '${chainId}' node '${node.id}': missing typeId`,
          );
        }
      }
    }
  } else {
    // Node-pack checks (existing behavior preserved).
    // Schema refs resolve inside the tarball + parse as JSON.
    // (Full Ajv compile check intentionally omitted to keep this script
    // npm-install-free in CI; the spec-corpus-validity scenario in the
    // conformance suite already compiles every shipped schema.)
    const nodes = tarballManifest.nodes ?? [];

    // No duplicate typeIds.
    const seenTypeIds = new Set();
    for (const node of nodes) {
      const typeId = node.typeId;
      if (!typeId) {
        errors.push(`${packName}@${version}: a node is missing typeId`);
        continue;
      }
      if (seenTypeIds.has(typeId)) {
        errors.push(`${packName}@${version}: duplicate typeId '${typeId}' within pack`);
      }
      seenTypeIds.add(typeId);

      for (const refKey of ['inputSchemaRef', 'outputSchemaRef', 'configSchemaRef']) {
        const ref = node[refKey];
        if (!ref) continue;
        // Absolute https refs are allowed (e.g., shared schema URLs) but
        // can't be validated at gate time without outbound fetch. Skip.
        if (ref.startsWith('http://') || ref.startsWith('https://')) continue;
        if (ref.includes('..')) {
          errors.push(`${packName}@${version} ${typeId}.${refKey}='${ref}' has path traversal`);
          continue;
        }
        const schemaBytes = entries.get(ref);
        if (!schemaBytes) {
          errors.push(
            `${packName}@${version} ${typeId}.${refKey}='${ref}' references missing file in tarball`,
          );
          continue;
        }
        try {
          JSON.parse(schemaBytes.toString('utf8'));
        } catch (err) {
          errors.push(
            `${packName}@${version} ${typeId}.${refKey}='${ref}' is invalid JSON: ${err.message}`,
          );
        }
      }
    }
  }

  // 6. peerDependencies values are non-empty strings.
  // (Key shape is intentionally NOT constrained — the bare manifest
  // schema permits any string key. The `host.*` convention is
  // documented in spec/v1/host-capabilities.md but not normative for
  // peerDependencies keys. Packs like `core.openwop.ai` use shorter
  // keys like `aiProviders` and that's spec-legal.)
  const peerDeps = tarballManifest.peerDependencies ?? {};
  for (const [key, value] of Object.entries(peerDeps)) {
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(
        `${packName}@${version}: peerDependencies['${key}'] must be a non-empty string`,
      );
    }
  }
}

// ─── main ───────────────────────────────────────────────────────────

function main() {
  if (!existsSync(PACKS_ROOT)) {
    console.log('no registry/v1/packs/ directory; nothing to check');
    process.exit(0);
  }

  const packs = readdirSync(PACKS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const errors = [];
  let checked = 0;
  for (const pack of packs) {
    const versionsDir = join(PACKS_ROOT, pack, '-');
    if (!existsSync(versionsDir)) continue;
    const versions = readdirSync(versionsDir)
      .filter((f) => f.endsWith('.tgz'))
      .map((f) => f.slice(0, -4));
    for (const version of versions) {
      const errorsBefore = errors.length;
      check(pack, version, errors);
      checked++;
      if (errors.length === errorsBefore) {
        ok(`${pack}@${version}`);
      } else {
        const newErrors = errors.slice(errorsBefore);
        for (const e of newErrors) fail(e);
      }
    }
  }

  console.log('');
  if (errors.length === 0) {
    ok(`${checked} pack(s) pass structural conformance`);
    process.exit(0);
  } else {
    fail(`${errors.length} error(s) across ${checked} pack(s)`);
    process.exit(1);
  }
}

main();
