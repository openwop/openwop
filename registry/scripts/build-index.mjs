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
    .filter((f) => f.endsWith('.json'))
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
      signingKeyId: manifest.signing?.keyId ?? 'openwop-registry-root',
      integrity: manifest.integrity ?? 'sha256-PENDING-FIRST-BUILD',
      deprecated: Boolean(manifest.deprecated),
      yanked: Boolean(manifest.yanked),
    });

    pack = manifest;
  }

  const latest = versions[versions.length - 1];
  const indexDoc = {
    name: packName,
    description: pack?.description ?? '',
    author: pack?.author ?? '',
    license: pack?.license ?? '',
    homepage: pack?.homepage,
    repository: pack?.repository,
    tags: pack?.tags ?? [],
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
      latestVersion: p.latest,
      description: p.description,
      license: p.license,
      tags: p.tags,
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
 *   - Inline CSS (no external loads, no third-party domains)
 *   - System font stack (no web-font fetches)
 *   - OG + Twitter card meta for shareable unfurls
 *   - prefers-color-scheme: dark for users with dark UIs
 *   - All author-controlled strings HTML-escaped
 */
function emitLandingPage(packDocs) {
  const generatedAt = new Date().toISOString();
  const total = packDocs.length;
  const totalVersions = packDocs.reduce((acc, p) => acc + (p.versions?.length ?? 0), 0);

  const rows = packDocs
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => {
      const v = p.versions[p.versions.length - 1];
      const flags = [];
      if (p.deprecated || v?.deprecated) flags.push('<span class="flag flag-deprecated">deprecated</span>');
      if (v?.yanked) flags.push('<span class="flag flag-yanked">yanked</span>');
      return `        <tr>
          <td class="name"><code>${htmlEscape(p.name)}</code> ${flags.join(' ')}</td>
          <td class="version">${htmlEscape(p.latest)}</td>
          <td class="desc">${htmlEscape(p.description || '—')}</td>
          <td class="license">${htmlEscape(p.license || '—')}</td>
          <td class="artifacts">
            <a href="${htmlEscape(v?.manifestUrl ?? '#')}" title="version manifest (JSON)">manifest</a>
            · <a href="${htmlEscape(v?.tarballUrl ?? '#')}" title="signed tarball (tgz)">tgz</a>
            · <a href="${htmlEscape(v?.signatureUrl ?? '#')}" title="Ed25519 signature">sig</a>
          </td>
        </tr>`;
    })
    .join('\n');

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

<style>
  :root {
    --bg: #ffffff;
    --fg: #15171b;
    --muted: #6b7280;
    --border: #e4e6eb;
    --accent: #1e4dd4;
    --accent-bg: #eef2ff;
    --code-bg: #f5f6f8;
    --flag-deprecated: #a16207;
    --flag-deprecated-bg: #fef3c7;
    --flag-yanked: #b91c1c;
    --flag-yanked-bg: #fee2e2;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0e1014;
      --fg: #e8eaed;
      --muted: #9aa0a6;
      --border: #2a2d34;
      --accent: #88aaff;
      --accent-bg: #1c2540;
      --code-bg: #1a1c22;
      --flag-deprecated: #facc15;
      --flag-deprecated-bg: #3a2f06;
      --flag-yanked: #f87171;
      --flag-yanked-bg: #3a1414;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, "Helvetica Neue", Arial, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 960px; margin: 0 auto; padding: 48px 24px 64px; }
  header { margin-bottom: 40px; }
  h1 { font-size: 32px; margin: 0 0 8px; letter-spacing: -0.02em; }
  h2 { font-size: 22px; margin: 40px 0 12px; letter-spacing: -0.01em; }
  h3 { font-size: 16px; margin: 24px 0 8px; }
  .lead { color: var(--muted); font-size: 18px; margin: 0; }
  code, pre { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 0.92em; }
  code { background: var(--code-bg); padding: 1px 6px; border-radius: 4px; }
  pre { background: var(--code-bg); padding: 12px 16px; border-radius: 6px; overflow-x: auto; line-height: 1.5; }
  pre code { background: transparent; padding: 0; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .summary { display: flex; gap: 16px; flex-wrap: wrap; margin: 16px 0 24px; }
  .summary > div { padding: 12px 16px; border: 1px solid var(--border); border-radius: 6px; min-width: 120px; }
  .summary strong { display: block; font-size: 22px; line-height: 1.2; }
  .summary span { color: var(--muted); font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 14px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-weight: 600; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  td.name code { font-size: 13px; }
  td.version { color: var(--muted); font-variant-numeric: tabular-nums; }
  td.artifacts { font-size: 13px; }
  td.artifacts a { white-space: nowrap; }
  .flag { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; vertical-align: middle; }
  .flag-deprecated { color: var(--flag-deprecated); background: var(--flag-deprecated-bg); }
  .flag-yanked { color: var(--flag-yanked); background: var(--flag-yanked-bg); }
  .endpoint-list { list-style: none; padding: 0; margin: 8px 0; }
  .endpoint-list li { display: flex; gap: 12px; padding: 6px 0; align-items: baseline; flex-wrap: wrap; }
  .endpoint-list li code { font-size: 13px; }
  .endpoint-list li .note { color: var(--muted); font-size: 13px; }
  footer { margin-top: 64px; padding-top: 24px; border-top: 1px solid var(--border); color: var(--muted); font-size: 13px; }
  .empty { padding: 24px; border: 1px dashed var(--border); border-radius: 6px; color: var(--muted); text-align: center; }
</style>
</head>
<body>
<main>
  <header>
    <h1>openwop registry</h1>
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
    : `    <table>
      <thead>
        <tr><th>Name</th><th>Version</th><th>Description</th><th>License</th><th>Artifacts</th></tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>`
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
