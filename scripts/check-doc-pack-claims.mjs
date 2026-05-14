#!/usr/bin/env node
/**
 * Validates prose pack-related claims in markdown files against the live
 * (or in-tree) registry. Catches the drift class that the @code-review of
 * PRs #71-#79 found 3 instances of:
 *
 *   1. Registry-wide pack-count claims (e.g., "48 packs published")
 *      that drift when packs are added/yanked.
 *   2. "future `<pack-name>`" qualifiers for packs that already ship.
 *
 *   node scripts/check-doc-pack-claims.mjs
 *   node scripts/check-doc-pack-claims.mjs --registry https://packs.openwop.dev
 *   node scripts/check-doc-pack-claims.mjs --offline registry/v1/index.json
 *
 * Scope: walks .md files under docs/, spec/, RFCS/, packs/, examples/,
 * plus top-level README.md / ROADMAP.md. Skips archived files (matched by
 * the "archived" / "preserved for traceability" header pattern) since
 * those are intentionally frozen historical snapshots.
 *
 * Exit codes:
 *   0  all checked claims match registry state
 *   1  one or more count claims off, or "future" qualifier on shipped pack
 *   2  registry unreachable + no --offline fallback supplied
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_REGISTRY = 'https://packs.openwop.dev';
const FETCH_TIMEOUT_MS = 15000;
const args = process.argv.slice(2);
const registryFlag = args.indexOf('--registry');
const offlineFlag = args.indexOf('--offline');
const registry = registryFlag >= 0 ? args[registryFlag + 1] : DEFAULT_REGISTRY;
const offlineIndex = offlineFlag >= 0 ? args[offlineFlag + 1] : null;

const ROOTS = ['docs', 'spec', 'RFCS', 'packs', 'examples'];
const TOP_LEVEL = ['README.md', 'ROADMAP.md', 'CHANGELOG.md', 'CONTRIBUTING.md'];

/**
 * Recursive walk yielding .md files. Skips node_modules + .git + dist.
 */
function* walkMarkdown(root) {
  if (!existsSync(root)) return;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (entry.endsWith('.md')) {
        yield full;
      }
    }
  }
}

function isArchivedDoc(content) {
  const head = content.slice(0, 1500);
  return /Status:?\s*archived\b|preserved for traceability/i.test(head);
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(t);
  }
}

async function loadRegistryNames() {
  if (offlineIndex) {
    if (!existsSync(offlineIndex)) {
      console.error(`ERROR: --offline file not found: ${offlineIndex}`);
      process.exit(2);
    }
    return JSON.parse(readFileSync(offlineIndex, 'utf8')).packs.map((p) => p.name);
  }
  const url = `${registry.replace(/\/$/, '')}/v1/index.json`;
  let res;
  try {
    res = await fetchWithTimeout(url);
  } catch (e) {
    const detail = e.name === 'AbortError' ? `timeout after ${FETCH_TIMEOUT_MS}ms` : e.message;
    console.error(`ERROR: registry unreachable at ${url}: ${detail}`);
    process.exit(2);
  }
  if (!res.ok) {
    console.error(`ERROR: registry returned ${res.status} for ${url}`);
    process.exit(2);
  }
  const body = await res.json();
  return body.packs.map((p) => p.name);
}

/**
 * Find registry-wide pack-count claims like "48 packs published" or
 * "hosts 48 packs". Returns [{file, line, lineNumber, claimed}].
 * Excludes per-section counts (e.g., "9 packs composed") by requiring
 * one of a fixed set of registry-wide phrasings.
 */
function findCountClaims(file, content) {
  const out = [];
  const lines = content.split('\n');
  const REGISTRY_WIDE_PATTERNS = [
    /\b([0-9]+)\s+packs\s+published\b/gi,
    /\bhosts\s+\*?\*?([0-9]+)\s+packs\*?\*?/gi,
    /\b([0-9]+)\s+steward-published\s+packs\b/gi,
    /\bregistry of all\s+([0-9]+)\s+published\s+packs\b/gi,
    /\bcategorized\s+inventory\s+of\s+all\s+([0-9]+)\s+published\s+packs\b/gi,
    /\bcatalog\s+status:?\*?\*?\s*([0-9]+)\s+packs\s+published\b/gi,
  ];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Dedup by (line, claimed-number) so multiple overlapping patterns on the
    // same line don't produce duplicate findings.
    const seenOnLine = new Set();
    for (const pattern of REGISTRY_WIDE_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(line)) !== null) {
        const claimed = Number(m[1]);
        if (seenOnLine.has(claimed)) continue;
        seenOnLine.add(claimed);
        out.push({ file, lineNumber: i + 1, line, claimed });
      }
    }
  }
  return out;
}

/**
 * Find "future `vendor.X.Y`" / "future `core.X.Y`" mentions. Returns
 * [{file, line, lineNumber, packName}]. Skips false-positives where
 * the "future" is qualifying a future VERSION/MINOR/RELEASE of an
 * existing pack rather than a future pack itself — those are valid
 * since the pack already ships.
 */
function findFutureMentions(file, content) {
  const out = [];
  const lines = content.split('\n');
  const PATTERN = /\bfuture\s+`((?:vendor|core|community)\.[a-z0-9.-]+(?:-[a-z0-9]+)*)`(\s+(?:minor|major|patch|version|release|update))?/gi;
  for (let i = 0; i < lines.length; i += 1) {
    PATTERN.lastIndex = 0;
    const line = lines[i];
    let m;
    while ((m = PATTERN.exec(line)) !== null) {
      // Skip when the "future" is qualifying a future version/minor/etc of
      // a (possibly existing) pack rather than a future pack itself.
      if (m[2]) continue;
      out.push({ file, lineNumber: i + 1, line, packName: m[1] });
    }
  }
  return out;
}

async function main() {
  const packNames = new Set(await loadRegistryNames());
  const actualCount = packNames.size;

  const files = [];
  for (const root of ROOTS) {
    for (const f of walkMarkdown(root)) files.push(f);
  }
  for (const f of TOP_LEVEL) {
    if (existsSync(f)) files.push(f);
  }

  const errors = [];
  const warnings = [];
  let checkedFiles = 0;

  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (isArchivedDoc(content)) continue;
    checkedFiles += 1;

    for (const claim of findCountClaims(file, content)) {
      if (claim.claimed !== actualCount) {
        errors.push({
          file: claim.file,
          lineNumber: claim.lineNumber,
          kind: 'COUNT_DRIFT',
          message: `claims ${claim.claimed} packs; registry has ${actualCount}`,
        });
      }
    }

    for (const mention of findFutureMentions(file, content)) {
      // Strip trailing punctuation that may have leaked into the regex capture.
      const name = mention.packName.replace(/[.]+$/, '');
      if (packNames.has(name)) {
        errors.push({
          file: mention.file,
          lineNumber: mention.lineNumber,
          kind: 'FUTURE_STALE',
          message: `"future \`${name}\`" — pack already ships at registry`,
        });
      } else {
        warnings.push({
          file: mention.file,
          lineNumber: mention.lineNumber,
          kind: 'FUTURE_UNKNOWN',
          message: `"future \`${name}\`" — pack not in registry (verify still future)`,
        });
      }
    }
  }

  console.log(
    `Checked ${checkedFiles} markdown file(s) against ${actualCount} published pack(s) at ${offlineIndex ?? registry}.`,
  );

  if (errors.length === 0 && warnings.length === 0) {
    console.log('OK: registry-wide count claims match; no "future" qualifier on shipped packs.');
    return 0;
  }

  for (const row of errors) {
    console.log(`FAIL ${row.file}:${row.lineNumber}  [${row.kind}] ${row.message}`);
  }
  for (const row of warnings) {
    console.log(`WARN ${row.file}:${row.lineNumber}  [${row.kind}] ${row.message}`);
  }

  console.log('');
  console.log(`Summary: ${errors.length} error(s), ${warnings.length} warning(s).`);
  return errors.length > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error('Uncaught:', e);
    process.exit(2);
  },
);
