#!/usr/bin/env node
/**
 * Rebuild the registry index files from the on-disk pack tree.
 *
 * Scans `registry/v1/packs/{name}/-/*.json` and regenerates:
 *   - `registry/v1/packs/{name}/index.json` (per-pack metadata aggregate)
 *   - `registry/v1/index.json` (registry-wide index)
 *
 * Also recomputes the `integrity` field on each version manifest by
 * hashing the corresponding `.tgz` file when present. Manifests whose
 * tarball is missing (e.g., not yet built locally) keep their existing
 * `integrity` value AND the script emits a warning to stderr so CI
 * doesn't accept partial submissions.
 *
 * Pure Node 20 stdlib — no `npm install` required.
 *
 * Usage:
 *   node registry/scripts/build-index.mjs
 *   node registry/scripts/build-index.mjs --check   # fail if files would change
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // registry/
const PACKS_DIR = join(ROOT, 'v1', 'packs');
const REGISTRY_INDEX = join(ROOT, 'v1', 'index.json');

const args = new Set(process.argv.slice(2));
const checkMode = args.has('--check');

const warnings = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, data) {
  const text = JSON.stringify(data, null, 2) + '\n';
  if (checkMode) {
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (existing !== text) {
      console.error(`[build-index --check] ${path} would change`);
      process.exitCode = 1;
    }
    return;
  }
  writeFileSync(path, text, 'utf8');
}

function sha256Base64(filePath) {
  const buf = readFileSync(filePath);
  const hash = createHash('sha256').update(buf).digest('base64');
  return `sha256-${hash}`;
}

function semverCmp(a, b) {
  const parse = (v) => v.split('.').map((n) => Number(n.split('-')[0]) || 0);
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
}

function listPackNames() {
  if (!existsSync(PACKS_DIR)) return [];
  return readdirSync(PACKS_DIR).filter((entry) => {
    const stat = statSync(join(PACKS_DIR, entry));
    return stat.isDirectory();
  });
}

function listVersionManifests(packName) {
  const dir = join(PACKS_DIR, packName, '-');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.sbom.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

/**
 * Extract schemas/*.json from a signed pack tarball into the schema-mirror
 * tree at registry/{packName}/{version}/<schema>.json.
 *
 * The mirror is a derived view of the signed tarball — consumers wanting
 * cryptographic integrity should verify against the tarball, not the
 * mirrored URL. The mirror exists so JSON Schema validators that resolve
 * `$id` URLs (per the schemas' declared identifiers) get a real document
 * back instead of a 404.
 *
 * In --check mode, we write to a temp location and compare; the
 * writeJson helper handles the same flow for the index/manifest files.
 */
function extractSchemaMirror(packName, version, tarballPath) {
  const mirrorDir = join(ROOT, packName, version);
  // Extract just the `schemas/` subtree from the tarball into a temp dir,
  // then move the .json files into place. Using tar with a wildcard would
  // be cleaner, but BSD tar (macOS) and GNU tar differ in syntax; the
  // temp-extract approach is portable.
  const tmp = join(tmpdir(), `openwop-mirror-${packName}-${version}-${process.pid}`);
  try {
    mkdirSync(tmp, { recursive: true });
    try {
      execFileSync('tar', ['-xzf', tarballPath, '-C', tmp], { stdio: 'pipe' });
    } catch (err) {
      warnings.push(
        `pack ${packName}@${version}: tar extraction failed (${err.message ?? 'unknown'}); ` +
          `schema mirror not updated.`,
      );
      return;
    }
    const schemasDir = join(tmp, 'schemas');
    if (!existsSync(schemasDir) || !statSync(schemasDir).isDirectory()) {
      // Pack has no schemas/ subdirectory (e.g., WASM packs that pass JSON
      // via the ABI rather than declaring per-port schemas). That's valid;
      // just emit no mirror entries for this version.
      return;
    }
    const schemaFiles = readdirSync(schemasDir).filter((f) => f.endsWith('.json'));
    if (schemaFiles.length === 0) return;
    if (!checkMode) {
      mkdirSync(mirrorDir, { recursive: true });
    }
    for (const file of schemaFiles) {
      const src = join(schemasDir, file);
      const dst = join(mirrorDir, file);
      const content = readFileSync(src, 'utf8');
      if (checkMode) {
        const existing = existsSync(dst) ? readFileSync(dst, 'utf8') : '';
        if (existing !== content) {
          console.error(`[build-index --check] schema mirror ${dst} would change`);
          process.exitCode = 1;
        }
      } else {
        writeFileSync(dst, content, 'utf8');
      }
    }
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

function rebuildPack(packName) {
  const versions = listVersionManifests(packName);
  if (versions.length === 0) {
    warnings.push(`pack ${packName} has no version manifests`);
    return null;
  }
  versions.sort(semverCmp);

  const versionEntries = [];
  let pack;
  for (const version of versions) {
    const manifestPath = join(PACKS_DIR, packName, '-', `${version}.json`);
    const manifest = readJson(manifestPath);

    const tarballPath = join(PACKS_DIR, packName, '-', `${version}.tgz`);
    if (existsSync(tarballPath)) {
      const integrity = sha256Base64(tarballPath);
      if (manifest.integrity !== integrity) {
        manifest.integrity = integrity;
        writeJson(manifestPath, manifest);
      }
      // Derive the schema mirror at /{name}/{version}/<schema>.json from the
      // tarball. The tarball is the signed source-of-truth; the mirror is a
      // view. See spec/v1/node-packs.md §"Schema $id resolution" for the
      // consumer contract.
      extractSchemaMirror(packName, version, tarballPath);
    } else {
      warnings.push(
        `pack ${packName}@${version}: tarball ${tarballPath} not found; ` +
          `integrity field + schema mirror NOT updated. Bundle the pack ` +
          `(\`tar -czf .../${version}.tgz ...\`) and sign before re-running.`,
      );
    }

    versionEntries.push({
      version,
      publishedAt: manifest.publishedAt ?? '2026-05-10T00:00:00Z',
      manifestUrl: `/v1/packs/${packName}/-/${version}.json`,
      tarballUrl: `/v1/packs/${packName}/-/${version}.tgz`,
      signatureUrl: `/v1/packs/${packName}/-/${version}.sig`,
      signingMethod: manifest.signing?.method ?? 'ed25519',
      // The signed manifest records the publisher key as `signing.publicKeyRef`
      // (node-pack-manifest.schema.json §Signing); `signing.keyId` is a legacy
      // alias. Read publicKeyRef FIRST — reading only `keyId` made this always
      // fall through to the hardcoded default, mislabeling every pack's signer
      // as `openwop-registry-root` (the drift check-registry-signer-consistency
      // guards). Verified by verify-signatures.mjs against registry/keys/<id>.pub.
      signingKeyId: manifest.signing?.publicKeyRef ?? manifest.signing?.keyId ?? 'openwop-registry-root',
      integrity: manifest.integrity ?? 'sha256-PENDING-FIRST-BUILD',
      deprecated: Boolean(manifest.deprecated),
      yanked: Boolean(manifest.yanked),
    });

    pack = manifest;
  }

  const latest = versions[versions.length - 1];
  // Pack kind per RFC 0013. Node packs (the default and original kind)
  // either omit `kind` or set it to "node"; workflow-chain packs set
  // `kind: "workflow-chain"`. Consumers MUST inspect `kind` before
  // assuming dispatch semantics (workflow-chain packs aren't directly
  // dispatchable — they expand at workflow-author time).
  const kind = pack?.kind ?? 'node';
  // Per-pack typeIds[] surfaced for catalog/discovery. The semantics:
  //   - node packs (kind=node, the default): merge nodes[].typeId AND
  //     agents[].agentId so pure-agent packs (per RFC 0003) and mixed
  //     node+agent packs both surface their full id set. Without the
  //     agentId merge, agent-only packs would carry an empty typeIds[]
  //     even though they ship real consumer-facing ids.
  //   - workflow-chain packs (kind=workflow-chain, RFC 0013): chains[].chainId.
  // All three id types share the same reverse-DNS shape; consumers MUST
  // inspect `kind` if they need to discriminate dispatch semantics
  // (node typeIds dispatch directly; chainIds expand at edit time;
  // agentIds are resolved as AgentRef references).
  const typeIds =
    kind === 'workflow-chain'
      ? (pack?.chains ?? []).map((c) => c.chainId).filter(Boolean)
      : [
          ...(pack?.nodes ?? []).map((n) => n.typeId),
          ...(pack?.agents ?? []).map((a) => a.agentId),
        ].filter(Boolean);

  // Per-pack node + agent counts surface the composition of the latest
  // manifest so the catalog landing page can bucket "node packs" vs
  // "agent packs" without re-reading each manifest. Mixed packs (both
  // arrays non-empty) appear in BOTH tabs — they ship both kinds of
  // consumer-facing artifacts. Additive field per RFC 0003 / RFC 0013;
  // unknown-key tolerance covers older clients.
  const nodeCount  = Array.isArray(pack?.nodes)  ? pack.nodes.length  : 0;
  const agentCount = Array.isArray(pack?.agents) ? pack.agents.length : 0;

  const indexDoc = {
    name: packName,
    kind,
    description: pack?.description ?? '',
    author: pack?.author ?? '',
    license: pack?.license ?? '',
    homepage: pack?.homepage,
    repository: pack?.repository,
    tags: pack?.tags ?? [],
    typeIds,
    nodeCount,
    agentCount,
    versions: versionEntries,
    latest,
    deprecated: versionEntries.every((v) => v.deprecated),
  };
  if (!indexDoc.homepage) delete indexDoc.homepage;
  if (!indexDoc.repository) delete indexDoc.repository;

  writeJson(join(PACKS_DIR, packName, 'index.json'), indexDoc);
  return indexDoc;
}

function rebuildRegistryIndex(packDocs) {
  const registryDoc = {
    registryVersion: '1.0.0',
    generatedAt: '2026-05-10T00:00:00Z',
    packCount: packDocs.length,
    packs: packDocs.map((p) => ({
      name: p.name,
      kind: p.kind,
      latestVersion: p.latest,
      description: p.description,
      license: p.license,
      tags: p.tags,
      typeIds: p.typeIds,
      nodeCount: p.nodeCount,
      agentCount: p.agentCount,
      deprecated: p.deprecated,
      yanked: false,
    })),
  };
  writeJson(REGISTRY_INDEX, registryDoc);
}

/**
 * HTML-escape a value for safe interpolation into the landing page.
 * Pack descriptions / authors / etc. are author-controlled — never trust
 * them to be HTML-safe.
 */
function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Emit registry/index.html — a derived view of the registry catalog.
 *
 * Single source of truth: the same `docs` array `rebuildRegistryIndex`
 * uses to write `v1/index.json`. The HTML is generated at build time
 * and re-deployed alongside the JSON; it can't drift from the catalog
 * because the generator reads the same data.
 *
 * Properties:
 *   - Zero JavaScript
 *   - Inline CSS, plus one Google Fonts <link> for the editorial type
 *     triple (Instrument Serif + Geist + Geist Mono) shared with
 *     openwop.dev and app.openwop.dev. font-display: swap means the
 *     system font shows immediately; web fonts swap in when available,
 *     so the page is still functional offline.
 *   - OG + Twitter card meta for shareable unfurls
 *   - Light-mode only across all three openwop surfaces today. Dark
 *     mode is deferred until a coherent dark variant ships across the
 *     marketing site + app + registry (DESIGN.md §9).
 *   - All author-controlled strings HTML-escaped
 *   - Tokens mirror public/styles.css :root per DESIGN.md §4 — keep in
 *     lockstep across surfaces (marketing site, app, registry)
 */
function emitLandingPage(packDocs) {
  const generatedAt = new Date().toISOString();
  const total = packDocs.length;
  const totalVersions = packDocs.reduce((acc, p) => acc + (p.versions?.length ?? 0), 0);

  // Bucket packs into "node" + "agent" categories. Mixed packs (both
  // arrays non-empty in the manifest) appear in BOTH tabs since they
  // ship both kinds of consumer-facing artifacts.
  const nodePacks  = packDocs.filter((p) => (p.nodeCount  ?? 0) > 0);
  const agentPacks = packDocs.filter((p) => (p.agentCount ?? 0) > 0);

  const rowFor = (p, kindHint) => {
    const v = p.versions[p.versions.length - 1];
    const flags = [];
    if (p.deprecated || v?.deprecated) flags.push('<span class="flag flag-deprecated">deprecated</span>');
    if (v?.yanked) flags.push('<span class="flag flag-yanked">yanked</span>');
    // Mark mixed packs so a user scanning one tab knows the same pack
    // also lives in the other tab.
    if (kindHint === 'node' && (p.agentCount ?? 0) > 0) flags.push('<span class="flag flag-mixed">+ agent</span>');
    if (kindHint === 'agent' && (p.nodeCount ?? 0) > 0) flags.push('<span class="flag flag-mixed">+ nodes</span>');
    const countCell = kindHint === 'node'
      ? `<td class="count" title="nodes in latest manifest">${p.nodeCount ?? 0}</td>`
      : `<td class="count" title="agents in latest manifest">${p.agentCount ?? 0}</td>`;
    return `        <tr>
          <td class="name"><code>${htmlEscape(p.name)}</code> ${flags.join(' ')}</td>
          <td class="version">${htmlEscape(p.latest)}</td>
          ${countCell}
          <td class="desc">${htmlEscape(p.description || '—')}</td>
          <td class="license">${htmlEscape(p.license || '—')}</td>
          <td class="artifacts">
            <a href="${htmlEscape(v?.manifestUrl ?? '#')}" title="version manifest (JSON)">manifest</a>
            · <a href="${htmlEscape(v?.tarballUrl ?? '#')}" title="signed tarball (tgz)">tgz</a>
            · <a href="${htmlEscape(v?.signatureUrl ?? '#')}" title="Ed25519 signature">sig</a>
          </td>
        </tr>`;
  };

  const buildRows = (packs, kindHint) =>
    packs
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => rowFor(p, kindHint))
      .join('\n');

  const nodeRows  = buildRows(nodePacks,  'node');
  const agentRows = buildRows(agentPacks, 'agent');

  const tableFor = (rows, countHeader) =>
    `    <table>
      <thead>
        <tr><th>Name</th><th>Version</th><th class="count-h">${countHeader}</th><th>Description</th><th>License</th><th>Artifacts</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>openwop registry — packs.openwop.dev</title>
<meta name="description" content="The canonical signed node-pack registry for the openwop workflow orchestration protocol. ${total} pack(s), ${totalVersions} version(s) published.">
<meta name="robots" content="index, follow">

<meta property="og:type" content="website">
<meta property="og:url" content="https://packs.openwop.dev/">
<meta property="og:title" content="openwop registry">
<meta property="og:description" content="Canonical signed node-pack registry for the openwop workflow orchestration protocol.">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="openwop registry">
<meta name="twitter:description" content="Canonical signed node-pack registry for the openwop workflow orchestration protocol.">

<link rel="alternate" type="application/json" title="Discovery" href="/.well-known/openwop-registry">
<link rel="alternate" type="application/json" title="Registry index" href="/v1/index.json">

<!-- Fonts — shared with openwop.dev + app.openwop.dev per DESIGN.md §3.
     font-display: swap means system fonts paint first; Geist + Instrument
     Serif swap in when available so the page is still readable offline. -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap">

<style>
  /* Tokens mirror public/styles.css :root — see DESIGN.md §4. Keep in
     lockstep with the marketing site and apps/.../react/src/styles/global.css. */
  :root {
    --paper:        #f4f1ea;
    --paper-2:      #ece8de;
    --rule:         #d9d4c5;
    --rule-2:       #c4bfae;
    --ink:          #1a1a17;
    --ink-2:        #4a4842;
    --ink-3:        #837f72;
    --clay:         oklch(58% 0.13 40);
    --clay-soft:    oklch(58% 0.13 40 / 0.10);
    --clay-rule:    oklch(58% 0.13 40 / 0.35);
    --clay-wash:    oklch(58% 0.13 40 / 0.04);
    --clay-glow:    oklch(58% 0.13 40 / 0.50);

    --serif: "Instrument Serif", "Times New Roman", serif;
    --sans:  "Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --mono:  "Geist Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;

    /* Registry-only functional tokens — flags for deprecated / yanked packs.
       Functional, not brand; do NOT mirror to the marketing site or app. */
    --flag-deprecated:    oklch(60% 0.13 75);
    --flag-deprecated-bg: oklch(60% 0.13 75 / 0.12);
    --flag-yanked:        oklch(55% 0.16 28);
    --flag-yanked-bg:     oklch(55% 0.16 28 / 0.12);
  }
  /* Light-mode only today. Dark mode lands when all three surfaces
     (marketing site, app, registry) ship a coherent dark variant
     together — see DESIGN.md §9. */
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--paper); color: var(--ink); }
  body {
    font-family: var(--sans);
    font-size: 16px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  main { max-width: 960px; margin: 0 auto; padding: clamp(40px, 6vw, 72px) clamp(20px, 4vw, 32px) 64px; }

  /* ─── Headlines — brand mark mirrors public/styles.css .foot-mark ───── */
  header { margin-bottom: 40px; }
  .brand-mark {
    display: inline-flex;
    align-items: center;
    gap: 14px;
    margin: 0 0 14px;
    font-family: var(--serif);
    font-weight: 400;
    font-size: clamp(32px, 4.5vw, 42px);
    line-height: 1.05;
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  .brand-mark img {
    width: 44px;
    height: 44px;
    display: inline-block;
    flex-shrink: 0;
  }
  .brand-mark em {
    font-style: italic;
    color: var(--clay);
  }
  .brand-mark-sub {
    color: var(--ink-3);
    font-style: normal;
  }
  h2 {
    font-family: var(--serif);
    font-style: italic;
    font-weight: 400;
    font-size: clamp(26px, 3vw, 34px);
    line-height: 1.1;
    letter-spacing: -0.01em;
    margin: 48px 0 14px;
    color: var(--ink);
  }
  h3 {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin: 28px 0 10px;
    font-weight: 500;
  }
  .lead { color: var(--ink-2); font-size: 17px; line-height: 1.55; margin: 0; max-width: 64ch; }

  /* ─── Code / pre — paper-2 fill, rule border, mono ──────────────────── */
  code, pre { font-family: var(--mono); font-size: 0.92em; }
  code { background: var(--paper-2); padding: 1px 6px; border-radius: 2px; color: var(--ink); }
  pre {
    background: var(--paper-2);
    border: 1px solid var(--rule);
    padding: 14px 18px;
    border-radius: 2px;
    overflow-x: auto;
    line-height: 1.5;
  }
  pre code { background: transparent; padding: 0; border: 0; }
  a { color: var(--ink); text-decoration: none; border-bottom: 1px dotted var(--rule-2); transition: color .15s ease, border-color .15s ease; }
  a:hover { color: var(--clay); border-bottom-color: var(--clay); }
  h1 a, h2 a, h3 a, .summary a, .endpoint-list a, footer a { border-bottom: none; }
  a code { border-bottom: 0; }

  /* ─── Summary cards — border-only, hover wash ───────────────────────── */
  .summary { display: flex; gap: 14px; flex-wrap: wrap; margin: 20px 0 28px; }
  .summary > div {
    padding: 14px 18px;
    border: 1px solid var(--rule);
    border-radius: 2px;
    min-width: 140px;
    background: var(--paper);
    transition: background .15s ease;
  }
  .summary > div:hover { background: var(--clay-wash); }
  .summary strong {
    display: block;
    font-family: var(--serif);
    font-style: italic;
    font-weight: 400;
    font-size: 26px;
    line-height: 1.1;
    color: var(--ink);
  }
  .summary span {
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-3);
  }

  /* ─── Catalog table — hairline rules, mono uppercase header ─────────── */
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 14px; }
  th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  thead th { border-bottom: 1px solid var(--ink-3); }
  th {
    font-family: var(--mono);
    font-weight: 500;
    font-size: 10.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  tbody tr { transition: background .15s ease; }
  tbody tr:hover { background: var(--clay-wash); }
  td.name code { font-size: 13px; }
  td.version { color: var(--ink-3); font-family: var(--mono); font-variant-numeric: tabular-nums; }
  td.artifacts { font-size: 13px; }
  td.artifacts a { white-space: nowrap; }

  /* ─── Flags — functional color pairs with text label (DESIGN.app.md §11) */
  .flag {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 2px;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    vertical-align: middle;
  }
  .flag-deprecated { color: var(--flag-deprecated); background: var(--flag-deprecated-bg); }
  .flag-yanked     { color: var(--flag-yanked);     background: var(--flag-yanked-bg); }
  .flag-mixed      { color: var(--ink-3);           background: var(--paper-2); }

  /* ─── Tabs — CSS-only radio-pattern. Zero JavaScript. ────────────────
   * The .tabs container holds two hidden radio inputs followed by the
   * label row and the two panels. :checked on each radio drives sibling
   * selectors that show the matching panel and highlight the matching
   * label. Default tab = nodes (the larger bucket today). */
  .tabs { margin: 8px 0; }
  .tab-radio {
    /* Visually hide the radio but keep it keyboard-focusable.
     * Browsers focus the label's associated input — clicking the
     * label toggles the radio, which drives the :checked sibling rules. */
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .tab-list {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--rule);
    margin-bottom: 24px;
    flex-wrap: wrap;
  }
  .tab {
    cursor: pointer;
    padding: 10px 16px 12px;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-3);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    transition: color .15s ease, border-color .15s ease;
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
  }
  .tab:hover { color: var(--clay); }
  .tab-count {
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border-radius: 2px;
    background: var(--paper-2);
    color: var(--ink-3);
  }
  /* :focus-visible reaches the LABEL when keyboard focus is on the radio
   * input — most browsers forward :focus-visible to the styled label via
   * the +/~ selector. Keep an explicit outline so screen-reader users
   * see which tab is keyboard-focused. */
  .tab-radio:focus-visible + .tab-list .tab[for="tab-nodes"],
  .tab-radio:focus-visible ~ .tab-list .tab {
    outline: none;
  }
  #tab-nodes:focus-visible  ~ .tab-list .tab[for="tab-nodes"],
  #tab-agents:focus-visible ~ .tab-list .tab[for="tab-agents"] {
    outline: 2px solid var(--clay);
    outline-offset: 2px;
    border-radius: 2px;
  }
  /* Active-tab styling — :checked drives sibling rules. */
  #tab-nodes:checked  ~ .tab-list .tab[for="tab-nodes"],
  #tab-agents:checked ~ .tab-list .tab[for="tab-agents"] {
    color: var(--ink);
    border-bottom-color: var(--clay);
  }
  #tab-nodes:checked  ~ .tab-list .tab[for="tab-nodes"]  .tab-count,
  #tab-agents:checked ~ .tab-list .tab[for="tab-agents"] .tab-count {
    background: var(--clay-soft);
    color: var(--clay);
  }
  /* Show only the panel whose radio is checked. */
  .tab-panel { display: none; }
  #tab-nodes:checked  ~ .tab-panel-nodes  { display: block; }
  #tab-agents:checked ~ .tab-panel-agents { display: block; }
  .tab-desc {
    color: var(--ink-2);
    font-size: 14.5px;
    line-height: 1.6;
    margin: 0 0 24px;
    max-width: 76ch;
  }
  .tab-desc strong { color: var(--ink); font-weight: 500; }
  .tab-desc a { color: var(--ink); border-bottom: 1px dotted var(--rule-2); }
  .tab-desc a:hover { color: var(--clay); border-bottom-color: var(--clay); }
  .tab-desc code {
    background: var(--paper-2);
    padding: 1px 5px;
    border-radius: 2px;
    font-size: 12.5px;
  }

  /* Per-tab pack-count column. */
  th.count-h, td.count {
    text-align: right;
    font-family: var(--mono);
    font-variant-numeric: tabular-nums;
  }
  td.count { color: var(--ink); }

  /* ─── Endpoint list — mono code + grey note ─────────────────────────── */
  .endpoint-list { list-style: none; padding: 0; margin: 12px 0; }
  .endpoint-list li {
    display: flex;
    gap: 14px;
    padding: 8px 0;
    align-items: baseline;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--rule);
  }
  .endpoint-list li:last-child { border-bottom: 0; }
  .endpoint-list li code { font-size: 13px; }
  .endpoint-list li .note { color: var(--ink-3); font-size: 13px; }

  footer {
    margin-top: 72px;
    padding-top: 24px;
    border-top: 1px solid var(--rule);
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  footer a { color: var(--ink-3); border-bottom: 1px dotted var(--rule-2); }
  footer a:hover { color: var(--clay); border-bottom-color: var(--clay); }

  .empty {
    padding: 32px;
    border: 1px dashed var(--rule-2);
    border-radius: 2px;
    color: var(--ink-3);
    text-align: center;
    font-family: var(--mono);
    font-size: 12px;
  }

  /* ─── Mobile breakpoints — matches DESIGN.md §8 (640 / 760) ─────────── */
  @media (max-width: 760px) {
    .summary > div { flex: 1 1 calc(50% - 14px); min-width: 0; }
  }
  @media (max-width: 640px) {
    .summary > div { flex: 1 1 100%; }
    table { font-size: 13px; }
    th, td { padding: 10px 8px; }
  }
  /* ─── Reduced motion ─────────────────────────────────────────────────── */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
</style>
</head>
<body>
<main>
  <header>
    <h1 class="brand-mark">
      <img src="/assets/OpenWOP.svg" alt="" aria-hidden="true">
      <span>Open<em>WOP</em> <span class="brand-mark-sub">registry</span></span>
    </h1>
    <p class="lead">Canonical signed node-pack registry for the <a href="https://openwop.dev/">openwop</a> workflow orchestration protocol.</p>
    <div class="summary">
      <div><strong>${total}</strong><span>${total === 1 ? 'pack' : 'packs'} published</span></div>
      <div><strong>${totalVersions}</strong><span>${totalVersions === 1 ? 'version' : 'versions'} total</span></div>
      <div><strong>Ed25519</strong><span>signing algorithm</span></div>
    </div>
  </header>

  <section id="catalog">
    <h2>Catalog</h2>
${
  total === 0
    ? '    <div class="empty">No packs published yet. The first one lands soon.</div>'
    : `    <div class="tabs">
      <input type="radio" name="catalog-tab" id="tab-nodes" class="tab-radio" checked>
      <input type="radio" name="catalog-tab" id="tab-agents" class="tab-radio">

      <div class="tab-list" role="tablist" aria-label="Pack categories">
        <label class="tab" for="tab-nodes" role="tab">
          <span class="tab-label">Node packs</span>
          <span class="tab-count">${nodePacks.length}</span>
        </label>
        <label class="tab" for="tab-agents" role="tab">
          <span class="tab-label">Agent packs</span>
          <span class="tab-count">${agentPacks.length}</span>
        </label>
      </div>

      <div class="tab-panel tab-panel-nodes" role="tabpanel" aria-labelledby="tab-nodes">
        <p class="tab-desc">
          <strong>Node packs</strong> ship reusable workflow building blocks — typed
          input/output handlers, control nodes (flow / branching / approval gates),
          and integrations (HTTP, storage, MCP). Authors drop them into the canvas
          at edit time; hosts load and verify them at runtime. See the
          <a href="https://openwop.dev/spec/v1/node-packs.md">node-packs.md</a>
          spec for the manifest contract and the SRI + Ed25519 trust model.
          Mixed packs that also ship agents are flagged
          <span class="flag flag-mixed">+ agent</span>.
        </p>
        ${nodePacks.length === 0
          ? '<div class="empty">No node packs published yet.</div>'
          : tableFor(nodeRows, 'Nodes')}
      </div>

      <div class="tab-panel tab-panel-agents" role="tabpanel" aria-labelledby="tab-agents">
        <p class="tab-desc">
          <strong>Agent packs</strong> ship reusable agent personas — each one bundles
          a system prompt, a tool allowlist, a memory shape, and handoff schemas. They
          are addressed by <code>AgentRef</code> and resolved at run time through the
          host's agent runtime, so the same pack can plug into supervisor, ReAct, or
          deep-research orchestration patterns. See
          <a href="https://github.com/openwop/openwop/blob/main/RFCS/0003-agent-packs.md">RFC 0003 (Active)</a>
          for the manifest contract. Mixed packs that also ship nodes are flagged
          <span class="flag flag-mixed">+ nodes</span>.
        </p>
        ${agentPacks.length === 0
          ? '<div class="empty">No agent packs published yet — the first pure-agent packs are in the <code>core.openwop.agents.*</code> family.</div>'
          : tableFor(agentRows, 'Agents')}
      </div>
    </div>`
}
  </section>

  <section id="trust">
    <h2>Trust &amp; verification</h2>
    <p>Every tarball is signed with the registry's Ed25519 root key. Hosts running in <code>verified</code> trust mode (per <a href="https://openwop.dev/spec/v1/node-packs.md">node-packs.md §Trust model</a>) MUST verify each <code>.tgz</code> against this key before unpacking.</p>
    <ul class="endpoint-list">
      <li><code><a href="/keys/openwop-registry-root.pub">/keys/openwop-registry-root.pub</a></code> <span class="note">root public key (PEM, Ed25519)</span></li>
    </ul>
    <h3>Verification recipe (Node 20+)</h3>
    <pre><code>const { createPublicKey, verify } = require('node:crypto');
const { readFileSync } = require('node:fs');
const pub = createPublicKey({ key: readFileSync('root.pub'), format: 'pem' });
const ok = verify(null, readFileSync('pack.tgz'), pub, readFileSync('pack.sig'));
// ok === true if the tarball is signed by this registry's root key</code></pre>
  </section>

  <section id="api">
    <h2>API</h2>
    <p>The registry is read-only; programmatic access via the documented endpoints:</p>
    <ul class="endpoint-list">
      <li><code><a href="/.well-known/openwop-registry">/.well-known/openwop-registry</a></code> <span class="note">discovery — declares all endpoint templates</span></li>
      <li><code><a href="/v1/index.json">/v1/index.json</a></code> <span class="note">full pack catalog</span></li>
      <li><code>/v1/packs/{name}/index.json</code> <span class="note">per-pack metadata + versions list</span></li>
      <li><code>/v1/packs/{name}/-/{version}.json</code> <span class="note">version manifest</span></li>
      <li><code>/v1/packs/{name}/-/{version}.tgz</code> <span class="note">signed tarball</span></li>
      <li><code>/v1/packs/{name}/-/{version}.sig</code> <span class="note">Ed25519 signature</span></li>
    </ul>
    <p>Pack schemas declared with a <code>$id</code> URL of the form <code>https://packs.openwop.dev/{name}/{version}/&lt;schema&gt;.json</code> resolve to the schema content extracted from the signed tarball. The tarball is canonical; the mirrored URL is a derived view — consumers wanting cryptographic integrity should verify against the tarball (see <a href="https://openwop.dev/spec/v1/node-packs.md">node-packs.md §"Schema $id resolution"</a>).</p>
  </section>

  <section id="publish">
    <h2>Publishing a pack</h2>
    <p>Submissions land via maintainer pull request — write API is intentionally not exposed. Build the pack, sign the tarball with your private key, commit alongside the manifest, open a PR. CI validates JSON parsing, sha256 integrity, signature presence, and (in <code>verified</code> mode) signature correctness before merge. The deploy ships on merge to <code>main</code>.</p>
    <p>Detailed flow: <a href="https://github.com/openwop/openwop/tree/main/registry">registry/README.md</a>.</p>
  </section>

  <section id="namespaces">
    <h2>Namespaces</h2>
    <ul>
      <li><code>core.*</code> — reserved for the openwop working group; spec-canonical packs only.</li>
      <li><code>vendor.&lt;org&gt;.*</code> — under control of a specific vendor organization.</li>
      <li><code>community.&lt;author&gt;.*</code> — open-publish; first-claim wins per name.</li>
    </ul>
    <p><code>private.*</code> and <code>local.*</code> namespaces MUST NOT appear in this registry; they're for host-internal and in-repo packs respectively.</p>
  </section>

  <footer>
    Generated ${htmlEscape(generatedAt)} · <a href="https://openwop.dev/">openwop.dev</a> · <a href="https://github.com/openwop/openwop">openwop on GitHub</a>
  </footer>
</main>
</body>
</html>
`;

  const dst = join(ROOT, 'index.html');
  if (checkMode) {
    const existing = existsSync(dst) ? readFileSync(dst, 'utf8') : '';
    // The landing page bakes in a generation timestamp; compare ignoring that
    // line so --check is stable across runs.
    const stripTs = (s) => s.replace(/Generated [^<]+/, 'Generated …');
    if (stripTs(existing) !== stripTs(html)) {
      console.error(`[build-index --check] ${dst} would change`);
      process.exitCode = 1;
    }
  } else {
    writeFileSync(dst, html, 'utf8');
  }
}

function emitRobotsTxt() {
  // Allow the landing page; disallow API surface so search engines don't
  // clutter results with JSON files. Sitemap is the landing page itself.
  const txt = `User-agent: *
Allow: /$
Allow: /index.html
Disallow: /v1/
Disallow: /keys/
Disallow: /.well-known/

Sitemap: https://packs.openwop.dev/
`;
  const dst = join(ROOT, 'robots.txt');
  if (checkMode) {
    const existing = existsSync(dst) ? readFileSync(dst, 'utf8') : '';
    if (existing !== txt) {
      console.error(`[build-index --check] ${dst} would change`);
      process.exitCode = 1;
    }
  } else {
    writeFileSync(dst, txt, 'utf8');
  }
}

const packs = listPackNames();
const docs = packs.map(rebuildPack).filter((p) => p !== null);
rebuildRegistryIndex(docs);
emitLandingPage(docs);
emitRobotsTxt();

if (warnings.length > 0) {
  console.error('build-index warnings:');
  for (const w of warnings) console.error(`  - ${w}`);
}

if (process.exitCode === 1) {
  console.error('[build-index] check mode: files would change; run without --check to fix');
  process.exit(1);
}
console.log(`[build-index] rebuilt ${docs.length} pack(s); ${warnings.length} warning(s)`);
