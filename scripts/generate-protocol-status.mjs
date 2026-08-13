#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const statusPath = path.join(root, 'docs', 'PROTOCOL-STATUS.md');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function listFiles(rel, predicate = () => true) {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(rel, entry.name))
    .filter(predicate)
    .sort();
}

function listDirs(rel) {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rel, entry.name))
    .sort();
}

function walkFiles(rel, predicate = () => true) {
  const start = path.join(root, rel);
  const out = [];
  if (!fs.existsSync(start)) return out;

  function walk(abs) {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.join(abs, entry.name);
      if (entry.isDirectory()) {
        walk(child);
      } else if (entry.isFile()) {
        const relative = path.relative(root, child).split(path.sep).join('/');
        if (predicate(relative)) out.push(relative);
      }
    }
  }

  walk(start);
  return out.sort();
}

function stripMd(value) {
  return value
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ascii(value) {
  return String(value)
    .replace(/\u2192/g, '->')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=')
    .replace(/\u00a7/g, 'section');
}

function firstNumber(value) {
  const match = stripMd(value).match(/-|\d+(?:\.\d+)?%?/);
  return match ? match[0] : stripMd(value);
}

function tableRow(cells) {
  return `| ${cells.map(ascii).join(' | ')} |`;
}

function openApiOperationIds() {
  const text = read('api/openapi.yaml');
  return [...text.matchAll(/^\s*operationId:\s*([A-Za-z0-9_]+)/gm)]
    .map((match) => match[1])
    .sort();
}

function asyncApiVersion() {
  const text = read('api/asyncapi.yaml');
  const match = text.match(/^asyncapi:\s*['"]?([^'"\s]+)['"]?/m);
  return match ? match[1] : 'unknown';
}

function readJsonVersion(rel) {
  if (!exists(rel)) return 'absent';
  try {
    return JSON.parse(read(rel)).version ?? 'unknown';
  } catch {
    return 'unparseable';
  }
}

function pyprojectVersion(rel) {
  if (!exists(rel)) return 'absent';
  const match = read(rel).match(/^version\s*=\s*["']([^"']+)["']/m);
  return match ? match[1] : 'unknown';
}

// The reconciled artifact-version readout. Per PUBLISHING.md these stream on
// independent cadences; the spec-corpus (root) version trails the per-artifact
// patch streams by design, so a bare `package.json` version read in isolation
// looks like "drift" when it is intentional. This table is the single source.
function artifactVersions() {
  return [
    { artifact: 'Spec corpus (root)', version: readJsonVersion('package.json'), source: '`package.json`', cadence: 'bumps only on a coordinated spec release' },
    { artifact: 'Conformance suite `@openwop/openwop-conformance`', version: readJsonVersion('conformance/package.json'), source: '`conformance/package.json`', cadence: 'minor on scenario add/remove' },
    // The three SDKs (`@openwop/openwop`, `openwop-client`, Go) were extracted to
    // openwop/openwop-sdks and are versioned there (tracking the spec major per
    // PUBLISHING.md). The CLI (`@openwop/cli`) publishes from openwop/openwop-cli.
    // Neither is versioned from this repo — see those repos for their release lines.
  ];
}

function parseRfcs() {
  // Exclude `0000-template.md` and the per-RFC companion registers
  // (`NNNN-<slug>.gaps.md` / `.risks.md`, authored by the /prd skill) — those
  // are working artifacts, not RFCs, and would otherwise inflate the count +
  // add garbage rows to the RFC status table.
  return listFiles('RFCS', (rel) => /^RFCS\/\d{4}-.+\.md$/.test(rel) && !rel.includes('0000-template') && !/\.(gaps|risks)\.md$/.test(rel))
    .map((rel) => {
      const text = read(rel);
      const id = path.basename(rel).slice(0, 4);
      const title = text.match(/\|\s*\*\*Title\*\*\s*\|\s*([^|]+)\|/)?.[1]?.trim() ?? path.basename(rel, '.md');
      // Capture the leading status keyword only, tolerating a trailing
      // annotation in the same cell (e.g. `Draft` (**Parked**), `Active` (waived)).
      // The prior `([^`|]+)…\|` form required the status token to be the whole
      // cell and silently returned 'Unknown' for any annotated Status field.
      const status = text.match(/\|\s*\*\*Status\*\*\s*\|\s*`?([A-Za-z][\w-]*)/)?.[1]?.trim() ?? 'Unknown';
      return { id, title, status, rel };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

// SDK helper-coverage parity (sdk/PARITY.md) moved to the openwop-sdks repo with
// the SDKs; this generator no longer reads it. The "SDK Helper Coverage" section
// of the status doc now points there instead of pinning cross-repo counts.
function parseSdkParity() {
  return [];
}

function parseInteropPassRates() {
  const text = read('INTEROP-MATRIX.md');
  const rows = [];
  let inPassRateTable = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('| Host | Passed | Failed | Skipped | Todo | Total | Pass rate')) {
      inPassRateTable = true;
      continue;
    }
    if (inPassRateTable && line.trim() === '') break;
    if (!inPassRateTable) continue;
    if (!line.startsWith('| ')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 7) continue;
    const [host, passed, failed, skipped, todo, total, passRate] = cells;
    if (host.startsWith('---')) continue;
    if (!/reference/i.test(host)) continue;
    rows.push({
      host: stripMd(host),
      passed: firstNumber(passed),
      failed: firstNumber(failed),
      skipped: firstNumber(skipped),
      todo: firstNumber(todo),
      total: firstNumber(total),
      passRate: stripMd(passRate),
    });
  }
  return rows;
}

// The pack registry inventory moved to the openwop-registry repo (served at
// packs.openwop.dev). Its per-pack counts/signatures are validated by that repo's
// own gate (scripts/registry-check.sh); the spec corpus keeps prose honest about
// packs via the live-fetching scripts/check-doc-pack-claims.mjs instead of pinning
// volatile cross-repo counts in this committed, diff-checked status doc.

function staleStatusFindings(rfcs) {
  // Recompute the same corpus state generateStatus() uses, so we can structurally
  // compare README claims to actual counts rather than relying on grep patterns
  // that themselves go stale.
  const specDocs = listFiles('spec/v1', (rel) => rel.endsWith('.md'));
  const schemas = listFiles('schemas', (rel) => rel.endsWith('.schema.json'));
  const operations = openApiOperationIds();
  const scenarios = listFiles('conformance/src/scenarios', (rel) => rel.endsWith('.test.ts'));
  const findings = [];

  // Structural drift checks: compare README's stated counts against the actual corpus.
  // These catch drift introduced when the corpus grows but the README isn't updated.
  const readmeText = read('README.md');

  // (1) Spec FINAL/DRAFT honesty: walk every spec/v1/*.md and classify by the Status line.
  const draftSpecs = [];
  for (const rel of specDocs) {
    const text = read(rel);
    const header = text.slice(0, 4000);
    if (/^>?\s*\*?\*?Status:?\*?\*?\s*[:`]?\s*`?DRAFT/im.test(header)) {
      draftSpecs.push(path.basename(rel));
    }
  }
  if (draftSpecs.length > 0 && /every\s+`spec\/v1\/\*\.md`\s+at\s+`FINAL/.test(readmeText)) {
    findings.push(`README.md: claims "every spec/v1/*.md at FINAL" but ${draftSpecs.length} spec(s) are DRAFT (${draftSpecs.join(', ')}).`);
  }

  // (2) Numeric drift in the corpus counts that get embedded in README prose.
  const numericChecks = [
    { label: 'prose specs', re: /(\d+)\s+prose\s+specs\b/, actual: specDocs.length },
    { label: 'JSON Schemas', re: /(\d+)\s+JSON\s+Schemas\b/, actual: schemas.length },
    { label: 'OpenAPI operations', re: /(\d+)\s+OpenAPI\s+operations\b/, actual: operations.length },
    { label: 'conformance scenario files', re: /(\d+)\s+conformance\s+scenario\s+files\b/, actual: scenarios.length },
  ];
  // Validate EVERY occurrence — a count can appear in the banner AND in a prose line
  // (e.g. the "ready for adoption" sentence restates scenario/invariant totals). `.match`
  // returns only the first, so a duplicated-and-drifted count would slip past the gate.
  for (const check of numericChecks) {
    const g = new RegExp(check.re.source, 'g');
    for (const m of readmeText.matchAll(g)) {
      if (Number(m[1]) !== check.actual) {
        findings.push(`README.md: claims "${m[1]} ${check.label}" but actual is ${check.actual}.`);
      }
    }
  }

  // (3) SECURITY invariant counts: parse the YAML and compare to README claims.
  const invariantsText = read('SECURITY/invariants.yaml');
  const protocolCount = (invariantsText.match(/^\s+tier:\s*protocol\b/gm) ?? []).length;
  const referenceImplCount = (invariantsText.match(/^\s+tier:\s*reference-impl\b/gm) ?? []).length;
  const advisoryCount = (invariantsText.match(/^\s+tier:\s*advisory\b/gm) ?? []).length;
  const totalInvariants = protocolCount + referenceImplCount + advisoryCount;
  const invariantChecks = [
    { label: 'protocol-tier', re: /(\d+)\s+protocol-tier\b/, actual: protocolCount },
    { label: 'reference-impl-tier', re: /(\d+)\s+reference-impl-tier\b/, actual: referenceImplCount },
    { label: 'invariants in', re: /(\d+)\s+invariants\s+in\b/, actual: totalInvariants },
    // The "N SECURITY invariants" prose phrasing (README "ready for adoption" line) is a
    // different wording from the banner's "N invariants in", so it was previously ungated
    // and silently rotted (157 vs 163). Gate it against the same actual total.
    { label: 'SECURITY invariants', re: /(\d+)\s+SECURITY\s+invariants\b/, actual: totalInvariants },
  ];
  for (const check of invariantChecks) {
    const g = new RegExp(check.re.source, 'g');
    for (const m of readmeText.matchAll(g)) {
      if (Number(m[1]) !== check.actual) {
        findings.push(`README.md: claims "${m[1]} ${check.label}" but actual is ${check.actual} invariants.`);
      }
    }
  }

  // (4a) RFC status counts: cross-check README's per-status claims against parsed rfcs metadata.
  // The count regexes tolerate a trailing annotation after the number — the banner writes
  // "(124 — including …)", not a bare "(124)". An anchored `\)` here previously made the
  // Accepted/Active/Draft checks silently skip (m === null) while the hand-typed counts drifted
  // out of sync with the generated table. `token` is the literal that must be present in the
  // banner; if it IS present but the tolerant regex still fails to capture a number, that is
  // itself a finding — so a future banner reword can never re-open the silent-skip hole.
  const acceptedCount = rfcs.filter((r) => r.status === 'Accepted').length;
  const activeCount = rfcs.filter((r) => r.status === 'Active').length;
  const draftCount = rfcs.filter((r) => r.status === 'Draft').length;
  const activeIds = rfcs.filter((r) => r.status === 'Active').map((r) => r.id).sort();
  const draftIds = rfcs.filter((r) => r.status === 'Draft').map((r) => r.id).sort();
  const rfcChecks = [
    { label: 'RFCs excluding template', token: 'RFCs excluding template', re: /\((\d+)\s+RFCs\s+excluding\s+template\)/, actual: rfcs.length },
    { label: 'Accepted RFCs', token: 'are `Accepted` (', re: /are\s+`Accepted`\s+\((\d+)(?=[\s)])/, actual: acceptedCount },
    { label: 'Active RFCs', token: 'are `Active` (', re: /are\s+`Active`\s+\((\d+)(?=[\s)])/, actual: activeCount },
    { label: 'Draft RFCs', token: 'are `Draft` (', re: /are\s+`Draft`\s+\((\d+)(?=[\s)])/, actual: draftCount },
  ];
  for (const check of rfcChecks) {
    const m = readmeText.match(check.re);
    if (m) {
      if (Number(m[1]) !== check.actual) {
        findings.push(`README.md: claims "${m[1]}" ${check.label} but actual is ${check.actual}.`);
      }
    } else if (readmeText.includes(check.token)) {
      findings.push(`README.md: ${check.label} count phrase is present ("${check.token}") but its number could not be parsed — the banner format changed; update this check in scripts/generate-protocol-status.mjs.`);
    }
  }

  // (4b) Enumerated Active/Draft RFC id lists in the banner must equal the actual sets.
  // The banner prints e.g. "`Active` (4 — RFC 0035, RFC 0043, …)"; a stale list (an RFC that
  // graduated to Accepted but was left in the Active enumeration) is exactly the drift a bare
  // count check cannot see — the count and the id list can disagree independently.
  const idListChecks = [
    { label: 'Active', ids: activeIds, re: /are\s+`Active`\s+\(([^)]*)\)/ },
    { label: 'Draft', ids: draftIds, re: /are\s+`Draft`\s+\(([^)]*)\)/ },
  ];
  for (const check of idListChecks) {
    const m = readmeText.match(check.re);
    if (!m) continue;
    const listed = [...m[1].matchAll(/RFC\s+(\d{4})/g)].map((x) => x[1]).sort();
    if (listed.join(',') !== check.ids.join(',')) {
      findings.push(`README.md: enumerated \`${check.label}\` RFC list is [${listed.join(', ')}] but actual ${check.label} RFCs are [${check.ids.join(', ')}].`);
    }
  }

  // (4c) `RFCS/README.md` §"Status index" must match the corpus, row for row.
  // This table went ungated from 2026-06-11 until 2026-08-08 and drifted to
  // claiming 132 RFCs against a true 142, with 0134-0139 missing outright and
  // 0140 shown as `Draft` after it had reached `Accepted`. A doc that says
  // "TODO: generate me" and is never checked will always end up here; the fix
  // is the check, not another pass of hand-editing.
  const rfcsReadme = read('RFCS/README.md');
  const indexedRows = [...rfcsReadme.matchAll(/^\|\s*\[(\d{4})\]\([^)]*\)\s*\|.*\|\s*`?(\w[\w-]*)`?\s*\|\s*$/gm)]
    .map((m) => ({ id: m[1], status: m[2] }));
  if (indexedRows.length === 0) {
    findings.push('RFCS/README.md: §"Status index" table has no parseable rows — run `node scripts/generate-protocol-status.mjs --write`.');
  } else {
    const indexedIds = indexedRows.map((r) => r.id).sort();
    const actualIds = rfcs.map((r) => r.id).sort();
    if (indexedIds.join(',') !== actualIds.join(',')) {
      const missing = actualIds.filter((id) => !indexedIds.includes(id));
      const extra = indexedIds.filter((id) => !actualIds.includes(id));
      findings.push(
        `RFCS/README.md: §"Status index" table does not cover the corpus` +
          (missing.length ? ` — missing [${missing.join(', ')}]` : '') +
          (extra.length ? ` — lists nonexistent [${extra.join(', ')}]` : '') + '.',
      );
    }
    const byId = new Map(rfcs.map((r) => [r.id, r.status]));
    for (const row of indexedRows) {
      const actual = byId.get(row.id);
      if (actual && actual !== row.status) {
        findings.push(`RFCS/README.md: RFC ${row.id} is listed as \`${row.status}\` but its header says \`${actual}\`.`);
      }
    }
    // The tally sentence drifts independently of the rows it summarises — and it
    // is the number a human actually reads. Checking rows alone let a sabotaged
    // tally pass, which is the same partial-coverage mistake this whole change
    // exists to fix, so it is checked separately rather than assumed to follow.
    const tallyMatch = rfcsReadme.match(/Current tally:\s*\*\*([^*]+)\*\*\s*\((\d+) RFCs/);
    if (!tallyMatch) {
      findings.push('RFCS/README.md: §"Status index" tally sentence is missing or unparseable.');
    } else {
      if (Number(tallyMatch[2]) !== rfcs.length) {
        findings.push(`RFCS/README.md: tally claims ${tallyMatch[2]} RFCs but the corpus has ${rfcs.length}.`);
      }
      const counts = {};
      for (const r of rfcs) counts[r.status] = (counts[r.status] ?? 0) + 1;
      for (const [, label, num] of tallyMatch[1].matchAll(/(\w[\w-]*)\s+(\d+)/g)) {
        if ((counts[label] ?? 0) !== Number(num)) {
          findings.push(`RFCS/README.md: tally claims ${label} ${num} but the corpus has ${counts[label] ?? 0}.`);
        }
      }
    }
  }

  // (4) Legacy known-bad-string rules for the files that haven't been refactored yet.
  const legacyRules = [
    {
      rel: 'ROADMAP.md',
      pattern: /26 prose specs at FINAL v1|19 first-class JSON Schemas|728\/797|\*\*RFC 0012[^|\n]*\|[^|\n]*\| `Draft`|Memory compaction \| `Draft`|mTLS\*\* remains spec-FINAL|reasoning-event emission wiring/,
      message: 'ROADMAP contains stale corpus counts or status language.',
    },
    {
      rel: 'spec/v1/node-packs.md',
      pattern: /Not yet referenced from a publicly-deployed registry|Active 2026-05-10, eligible for Accepted promotion/,
      message: 'node-packs.md contains stale registry or RFC 0008 status language.',
    },
    {
      rel: 'conformance/coverage.md',
      pattern: /hosted registry interoperability once `packs\.openwop\.dev` exists/,
      message: 'coverage.md treats the public registry as future work.',
    },
    {
      rel: 'SECURITY/external-audit-engagement.md',
      pattern: /RFC 0008 \(WASM ABI for node packs.*likely still `Draft`/,
      message: 'external audit scope treats RFC 0008 as draft.',
    },
  ];
  for (const rule of legacyRules) {
    const text = read(rule.rel);
    if (rule.pattern.test(text)) {
      findings.push(`${rule.rel}: ${rule.message}`);
    }
  }

  // (5) MAINTAINERS waiver table cross-reference.
  const rfc0012Accepted = rfcs.some((rfc) => rfc.id === '0012' && rfc.status === 'Accepted');
  if (rfc0012Accepted && !/\|\s*0012\s*\|/.test(read('MAINTAINERS.md'))) {
    findings.push('MAINTAINERS.md: RFC 0012 used the bootstrap waiver but is missing from the waiver table.');
  }

  return findings;
}

function generateStatus() {
  const specDocs = listFiles('spec/v1', (rel) => rel.endsWith('.md'));
  const schemas = listFiles('schemas', (rel) => rel.endsWith('.schema.json'));
  const operations = openApiOperationIds();
  const scenarios = listFiles('conformance/src/scenarios', (rel) => rel.endsWith('.test.ts'));
  const rfcs = parseRfcs();
  const sdkRows = parseSdkParity();
  const interopRows = parseInteropPassRates();
  const rfcStatusCounts = rfcs.reduce((acc, rfc) => {
    acc[rfc.status] = (acc[rfc.status] ?? 0) + 1;
    return acc;
  }, {});

  const lines = [];
  lines.push('# OpenWOP Protocol Status');
  lines.push('');
  lines.push('> Generated by `node scripts/generate-protocol-status.mjs --write`.');
  lines.push('> Do not edit generated tables by hand; update source artifacts instead.');
  lines.push('');
  lines.push('## Corpus Counts');
  lines.push('');
  lines.push('| Surface | Current value | Source |');
  lines.push('|---|---:|---|');
  lines.push(tableRow(['Spec prose documents', String(specDocs.length), '`spec/v1/*.md`']));
  lines.push(tableRow(['JSON Schemas', String(schemas.length), '`schemas/*.schema.json`']));
  lines.push(tableRow(['OpenAPI operations', String(operations.length), '`api/openapi.yaml`']));
  lines.push(tableRow(['AsyncAPI version', asyncApiVersion(), '`api/asyncapi.yaml`']));
  lines.push(tableRow(['Conformance scenario files', String(scenarios.length), '`conformance/src/scenarios/*.test.ts`']));
  lines.push(tableRow(['RFCs tracked', String(rfcs.length), '`RFCS/[0-9][0-9][0-9][0-9]-*.md`, excluding template']));
  lines.push('');
  lines.push('## Artifact Versions');
  lines.push('');
  lines.push('> Per `PUBLISHING.md`, these artifacts version on independent cadences. The spec-corpus (root) version bumps only on a coordinated release, so it intentionally trails the per-artifact patch streams. This generated table is the single reconciled readout — read it instead of any one `package.json` in isolation.');
  lines.push('');
  lines.push('| Artifact | Version | Source | Cadence |');
  lines.push('|---|---|---|---|');
  for (const v of artifactVersions()) {
    lines.push(tableRow([v.artifact, v.version, v.source, v.cadence]));
  }
  lines.push('');
  lines.push('## OpenAPI Operations');
  lines.push('');
  lines.push(operations.map((operation) => `\`${operation}\``).join(', '));
  lines.push('');
  lines.push('## RFC Status');
  lines.push('');
  lines.push('| Status | Count |');
  lines.push('|---|---:|');
  for (const status of Object.keys(rfcStatusCounts).sort()) {
    lines.push(tableRow([status, String(rfcStatusCounts[status])]));
  }
  lines.push('');
  // Full per-RFC status table — the canonical per-RFC list. README links here
  // instead of carrying a hand-maintained `+ NNNN` enumeration (RFC graduation
  // history lives in each RFC's `Updated` field + CHANGELOG.md).
  lines.push('| RFC | Title | Status |');
  lines.push('|---|---|---|');
  for (const rfc of rfcs) {
    lines.push(tableRow([`RFC ${rfc.id}`, rfc.title, rfc.status]));
  }
  lines.push('');
  lines.push('## SDK Helper Coverage');
  lines.push('');
  lines.push('The TypeScript / Python / Go SDKs live in the [`openwop-sdks`](https://github.com/openwop/openwop-sdks) repo. Per-SDK helper coverage (typed / raw-only / unreachable surfaces) is tracked in that repo\'s `sdk/PARITY.md` and machine-enforced by its `scripts/check-sdk-parity.mjs` against the OpenAPI operation set.');
  lines.push('');
  lines.push('## Reference Host Conformance Evidence');
  lines.push('');
  lines.push('| Host | Passed | Failed | Skipped | Todo | Total | Pass rate |');
  lines.push('|---|---:|---:|---:|---:|---:|---|');
  for (const row of interopRows) {
    lines.push(tableRow([row.host, row.passed, row.failed, row.skipped, row.todo, row.total, row.passRate]));
  }
  lines.push('');
  lines.push('## Registry Snapshot');
  lines.push('');
  lines.push('The pack registry now lives in the [`openwop-registry`](https://github.com/openwop/openwop-registry) repo and is served at [`packs.openwop.dev`](https://packs.openwop.dev/v1/index.json). Its inventory (pack count, version manifests, tarballs, signatures, per-scope breakdown) is validated by that repo\'s own gate; spec-corpus prose claims about packs are checked live by `scripts/check-doc-pack-claims.mjs`.');
  lines.push('');
  lines.push('## Active Follow-Ups');
  lines.push('');
  const draftRfcs = rfcs.filter((rfc) => rfc.status === 'Draft');
  const activeRfcs = rfcs.filter((rfc) => rfc.status === 'Active');
  if (draftRfcs.length > 0) {
    const list = draftRfcs.map((rfc) => `RFC ${rfc.id}`).join(', ');
    lines.push(`- ${draftRfcs.length} RFC${draftRfcs.length === 1 ? '' : 's'} still \`Draft\` (${list}) — advance with schema/conformance proof or defer.`);
  }
  if (activeRfcs.length > 0) {
    const list = activeRfcs.map((rfc) => `RFC ${rfc.id}`).join(', ');
    lines.push(`- ${activeRfcs.length} RFC${activeRfcs.length === 1 ? '' : 's'} \`Active\` (${list}) — wire-shape MAY shift compatibly within v1.x until promotion to \`Accepted\`.`);
  }
  lines.push('- External audit, non-steward host recruitment, and non-steward maintainer recruitment remain external-action gates.');
  lines.push('- Multi-region idempotency and some optional-profile behavior checks remain lower-confidence than the core wire contract.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

// Self-heal the corpus counts embedded in README.md prose.
//
// `staleStatusFindings()` is a one-way guard: it FAILS when README's hand-typed
// counts drift from the corpus, but a human still had to retype them. That made
// the single giant "RFC status" blockquote a serialized merge-conflict locus —
// every status flip hand-edited the same line, and parallel flips collided on
// the integers. This makes `--write` the source of truth for those integers:
// it rewrites ONLY the `\d+` run inside each checked, ASCII-delimited pattern
// (the same patterns `staleStatusFindings()` validates), leaving every other
// byte — including the unchecked `+ NNNN` enumeration, the graduation prose,
// and any non-ASCII characters — untouched. A status flip is now: edit the
// RFC's own `| **Status** |` row, then run `--write`; count conflicts on README
// re-resolve mechanically (`git checkout --theirs README.md && …--write`) with
// no arithmetic. Idempotent: re-running on a current README is a no-op.
function syncReadmeCounts() {
  const specDocs = listFiles('spec/v1', (rel) => rel.endsWith('.md'));
  const schemas = listFiles('schemas', (rel) => rel.endsWith('.schema.json'));
  const operations = openApiOperationIds();
  const scenarios = listFiles('conformance/src/scenarios', (rel) => rel.endsWith('.test.ts'));
  const rfcs = parseRfcs();
  const invariantsText = read('SECURITY/invariants.yaml');
  const protocolCount = (invariantsText.match(/^\s+tier:\s*protocol\b/gm) ?? []).length;
  const referenceImplCount = (invariantsText.match(/^\s+tier:\s*reference-impl\b/gm) ?? []).length;
  const advisoryCount = (invariantsText.match(/^\s+tier:\s*advisory\b/gm) ?? []).length;
  const totalInvariants = protocolCount + referenceImplCount + advisoryCount;

  // [regex with (prefix)(\d+)(suffix), replacement value]. Each pattern mirrors
  // a check in staleStatusFindings(); only the middle \d+ run is rewritten.
  //
  // The three RFC-status suffixes are `(\s|\))`, NOT `(\))`. They used to require
  // the count to be followed immediately by a closing paren — but the banner has
  // always written `are `Accepted` (133 — including RFC 0099 …)`, i.e. the count
  // is followed by a SPACE and a long prose annotation. So those three rules
  // never matched anything, `--write` silently left the counts stale, and every
  // RFC status flip became a hand-edit and a guaranteed merge conflict for any
  // branch open at the time. `--check` caught the drift and told you to run
  // `--write`, which then didn't fix it — the worst combination.
  const rules = [
    [/(are\s+`Accepted`\s+\()\d+(\s|\))/g, rfcs.filter((r) => r.status === 'Accepted').length],
    [/(are\s+`Active`\s+\()\d+(\s|\))/g, rfcs.filter((r) => r.status === 'Active').length],
    [/(are\s+`Draft`\s+\()\d+(\s|\))/g, rfcs.filter((r) => r.status === 'Draft').length],
    [/(\()\d+(\s+RFCs\s+excluding\s+template\))/g, rfcs.length],
    [/(\b)\d+(\s+conformance\s+scenario\s+files\b)/g, scenarios.length],
    [/(\b)\d+(\s+prose\s+specs\b)/g, specDocs.length],
    [/(\b)\d+(\s+JSON\s+Schemas\b)/g, schemas.length],
    [/(\b)\d+(\s+OpenAPI\s+operations\b)/g, operations.length],
    [/(\b)\d+(\s+protocol-tier\b)/g, protocolCount],
    [/(\b)\d+(\s+reference-impl-tier\b)/g, referenceImplCount],
    [/(\b)\d+(\s+invariants\s+in\b)/g, totalInvariants],
  ];

  let text = read('README.md');
  for (const [re, value] of rules) {
    text = text.replace(re, (_match, prefix, suffix) => `${prefix}${value}${suffix}`);
  }
  text = syncReadmeRfcEnumerations(text, rfcs);
  fs.writeFileSync(path.join(root, 'README.md'), text);

  fs.writeFileSync(path.join(root, 'RFCS/README.md'), renderRfcsReadmeIndex(read('RFCS/README.md'), rfcs));
}

/**
 * Rewrites `RFCS/README.md` §"Status index" — the tally sentence and the
 * per-RFC table — from the parsed corpus.
 *
 * This table carried a TODO asking to be generated since 2026-06-11 and was
 * never gated, so it rotted exactly as you would predict: at the time this
 * landed it claimed `Accepted 129 · Active 3 · Draft 1` across 132 RFCs against
 * a true 135/5/2 across 142, was missing rows for 0134-0139 entirely, and still
 * showed RFC 0140 as `Draft` describing a Motivation that RFC had since
 * withdrawn as false.
 *
 * NOT a regenerate-from-scratch. The Title cells here are hand-written prose
 * summaries — often a full paragraph of design rationale — not the RFC's short
 * `**Title**` header field. Rebuilding them from `**Title**` would silently
 * destroy the most useful thing in the file. So each row's Title cell is
 * preserved VERBATIM, keyed by RFC id; only the mechanically-derivable Status
 * cell is rewritten, rows for vanished ids are dropped, and a newly-added RFC
 * gets a row seeded from its `**Title**` field for a human to enrich later.
 *
 * Preserved cells are emitted raw rather than through `tableRow()`/`ascii()`:
 * the existing summaries contain em-dashes and `⇒`, and normalising them would
 * churn hundreds of lines on the first write for no gain.
 */
function renderRfcsReadmeIndex(text, rfcs) {
  const heading = '## Status index';
  const start = text.indexOf(heading);
  if (start < 0) return text; // section renamed — leave it and let the check report
  const after = text.indexOf('\n## ', start + heading.length);
  const end = after < 0 ? text.length : after + 1;

  const block = text.slice(start, end);

  // Preserve each existing row's Title cell, keyed by id.
  const existingTitle = new Map();
  for (const line of block.split('\n')) {
    const m = line.match(/^\|\s*\[(\d{4})\]\([^)]*\)\s*\|\s*(.*?)\s*\|\s*`?\w[\w-]*`?\s*\|\s*$/);
    if (m) existingTitle.set(m[1], m[2]);
  }

  const counts = {};
  for (const r of rfcs) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const order = ['Accepted', 'Active', 'Draft', 'Withdrawn', 'Superseded'];
  const tally = order.filter((s) => counts[s]).map((s) => `${s} ${counts[s]}`).join(' · ');

  // Preserve per-id annotations in the enumerations (`0038 Parked`), same rule
  // as syncReadmeRfcEnumerations() — an annotation is hand-written signal.
  const enumerate = (label) => {
    const prev = new Map();
    const m = block.match(new RegExp(label + ' = ([^;)]*)'));
    if (m) for (const e of m[1].split(/,\s*/)) {
      const idm = e.match(/(\d{4})/);
      if (idm) prev.set(idm[1], e.trim());
    }
    const ids = rfcs.filter((r) => r.status === label).map((r) => r.id).sort();
    return ids.map((id) => prev.get(id) ?? id).join(', ');
  };

  const lines = [
    heading,
    '',
    '<!-- GENERATED by scripts/generate-protocol-status.mjs. Do not hand-edit the tally or the Status column; run `node scripts/generate-protocol-status.mjs --write`. Title cells ARE hand-written and are preserved verbatim across regeneration — edit those freely. -->',
    '',
    `Current tally: **${tally}** (${rfcs.length} RFCs, excluding the \`0000\` template; Active = ${enumerate('Active')}; Draft = ${enumerate('Draft')}).`,
    '',
    '| RFC | Title | Status |',
    '| --- | --- | --- |',
  ];
  for (const rfc of rfcs) {
    const title = existingTitle.get(rfc.id) ?? rfc.title;
    lines.push(`| [${rfc.id}](./${path.basename(rfc.rel)}) | ${title} | \`${rfc.status}\` |`);
  }
  lines.push('');

  return text.slice(0, start) + lines.join('\n') + text.slice(end);
}

/**
 * Rewrites the banner's enumerated `Active` / `Draft` RFC id lists in place,
 * mirroring check (4b) in staleStatusFindings().
 *
 * Counts and id lists drift independently, so a count-only sync left the second
 * half of the same sentence to be hand-edited — the single most conflict-prone
 * string in the corpus, because every RFC status flip touches it and every open
 * branch collides on it.
 *
 * Each entry carries a hand-written annotation (`RFC 0038 Parked`, `RFC 0136
 * workflow-variable \`format\``), so this is NOT a regenerate-from-scratch: an
 * RFC still in the set keeps its existing entry verbatim, one that left is
 * dropped, and one that arrived is appended bare as `RFC NNNN` for a human to
 * annotate later. Losing an annotation would be a silent downgrade of the
 * banner, which is why the map is keyed on id rather than rebuilt positionally.
 *
 * The separator between count and list is sliced from the existing text rather
 * than assumed: the README's dashes are not clean em-dashes, and hard-coding one
 * would corrupt the byte sequence on every write.
 */
function syncReadmeRfcEnumerations(text, rfcs) {
  for (const label of ['Active', 'Draft']) {
    const ids = rfcs.filter((r) => r.status === label).map((r) => r.id).sort();
    // Same shape as staleStatusFindings() check (4b), so the writer and the
    // checker cannot disagree about what they are looking at.
    const re = new RegExp('(are\\s+`' + label + '`\\s+\\()([^)]*)(\\))');
    const m = text.match(re);
    if (!m) continue;

    const inner = m[2];
    const head = inner.match(/^(\s*)(\d+)/);
    const firstRfc = inner.search(/RFC\s+\d{4}/);
    if (!head || firstRfc < 0) continue; // shape we don't recognise — leave it for the check to report

    const lead = head[1];
    const separator = inner.slice(lead.length + head[2].length, firstRfc);

    const byId = new Map();
    for (const entry of inner.slice(firstRfc).split(/,\s*/)) {
      const idMatch = entry.match(/RFC\s+(\d{4})/);
      if (idMatch) byId.set(idMatch[1], entry.trim());
    }

    const rebuilt = ids.map((id) => byId.get(id) ?? `RFC ${id}`).join(', ');
    text = text.replace(re, () => `${m[1]}${lead}${ids.length}${separator}${rebuilt}${m[3]}`);
  }
  return text;
}

function main() {
  const mode = process.argv[2] ?? '--print';
  const generated = generateStatus();
  const rfcs = parseRfcs();

  if (mode === '--write') {
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, generated);
    syncReadmeCounts();
    return;
  }

  if (mode === '--check') {
    const findings = staleStatusFindings(rfcs);
    if (!fs.existsSync(statusPath)) {
      findings.push('docs/PROTOCOL-STATUS.md is missing. Run `node scripts/generate-protocol-status.mjs --write`.');
    } else {
      const current = fs.readFileSync(statusPath, 'utf8');
      if (current !== generated) {
        findings.push('docs/PROTOCOL-STATUS.md is stale. Run `node scripts/generate-protocol-status.mjs --write`.');
      }
    }

    if (findings.length > 0) {
      console.error('Protocol status check failed:');
      for (const finding of findings) console.error(`- ${finding}`);
      console.error(
        '\nMost of these auto-fix: run `node scripts/generate-protocol-status.mjs --write` ' +
          '(syncs README corpus counts + regenerates docs/PROTOCOL-STATUS.md). ' +
          'Findings about RFC/spec Status lines, ROADMAP, or node-packs prose are content fixes, not counts.',
      );
      process.exit(1);
    }
    console.log('Protocol status is current.');
    return;
  }

  if (mode !== '--print') {
    console.error(`Unknown mode: ${mode}`);
    console.error('Usage: node scripts/generate-protocol-status.mjs [--print|--write|--check]');
    process.exit(2);
  }

  process.stdout.write(generated);
}

main();
