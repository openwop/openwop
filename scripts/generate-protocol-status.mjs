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

function parseRfcs() {
  return listFiles('RFCS', (rel) => /^RFCS\/\d{4}-.+\.md$/.test(rel) && !rel.includes('0000-template'))
    .map((rel) => {
      const text = read(rel);
      const id = path.basename(rel).slice(0, 4);
      const title = text.match(/\|\s*\*\*Title\*\*\s*\|\s*([^|]+)\|/)?.[1]?.trim() ?? path.basename(rel, '.md');
      const status = text.match(/\|\s*\*\*Status\*\*\s*\|\s*`?([^`|]+)`?\s*\|/)?.[1]?.trim() ?? 'Unknown';
      return { id, title, status, rel };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function parseSdkParity() {
  const text = read('sdk/PARITY.md');
  const rows = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\|\s*(TypeScript|Python|Go)[^|]*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/);
    if (match) {
      rows.push({
        sdk: match[1],
        helpers: Number(match[2]),
        rawOnly: Number(match[3]),
        unreachable: Number(match[4]),
      });
    }
  }
  return rows;
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

function registryStats() {
  const indexRel = 'registry/v1/index.json';
  if (!exists(indexRel)) {
    return {
      indexPackCount: 0,
      indexedPacks: 0,
      packDirs: 0,
      versionManifests: 0,
      tarballs: 0,
      signatures: 0,
      scopes: {},
    };
  }

  const index = JSON.parse(read(indexRel));
  const packs = Array.isArray(index.packs) ? index.packs : [];
  const scopes = {};
  for (const pack of packs) {
    const scope = String(pack.name ?? '').split('.').slice(0, 2).join('.') || 'unknown';
    scopes[scope] = (scopes[scope] ?? 0) + 1;
  }

  const versionManifests = walkFiles('registry/v1/packs', (rel) => /\/-\/[^/]+\.json$/.test(rel) && !rel.endsWith('.sbom.json'));
  const tarballs = walkFiles('registry/v1/packs', (rel) => rel.endsWith('.tgz'));
  const signatures = walkFiles('registry/v1/packs', (rel) => rel.endsWith('.sig'));

  return {
    indexPackCount: Number(index.packCount ?? packs.length),
    indexedPacks: packs.length,
    packDirs: listDirs('registry/v1/packs').length,
    versionManifests: versionManifests.length,
    tarballs: tarballs.length,
    signatures: signatures.length,
    scopes,
  };
}

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
  for (const check of numericChecks) {
    const m = readmeText.match(check.re);
    if (m && Number(m[1]) !== check.actual) {
      findings.push(`README.md: claims "${m[1]} ${check.label}" but actual is ${check.actual}.`);
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
  ];
  for (const check of invariantChecks) {
    const m = readmeText.match(check.re);
    if (m && Number(m[1]) !== check.actual) {
      findings.push(`README.md: claims "${m[1]} ${check.label}" invariants but actual is ${check.actual}.`);
    }
  }

  // (4a) RFC status counts: cross-check README's per-status claims against parsed rfcs metadata.
  const acceptedCount = rfcs.filter((r) => r.status === 'Accepted').length;
  const activeCount = rfcs.filter((r) => r.status === 'Active').length;
  const draftCount = rfcs.filter((r) => r.status === 'Draft').length;
  const rfcChecks = [
    { label: 'RFCs excluding template', re: /\((\d+)\s+RFCs\s+excluding\s+template\)/, actual: rfcs.length },
    { label: 'Accepted RFCs', re: /are\s+`Accepted`\s+\((\d+)\)/, actual: acceptedCount },
    { label: 'Active RFCs', re: /are\s+`Active`\s+\((\d+)\)/, actual: activeCount },
    { label: 'Draft RFCs', re: /are\s+`Draft`\s+\((\d+)\)/, actual: draftCount },
  ];
  for (const check of rfcChecks) {
    const m = readmeText.match(check.re);
    if (m && Number(m[1]) !== check.actual) {
      findings.push(`README.md: claims "${m[1]}" ${check.label} but actual is ${check.actual}.`);
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
  const registry = registryStats();
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
  lines.push('| Latest RFC | Title | Status |');
  lines.push('|---|---|---|');
  for (const rfc of rfcs.slice(-5).reverse()) {
    lines.push(tableRow([`RFC ${rfc.id}`, rfc.title, rfc.status]));
  }
  lines.push('');
  lines.push('## SDK Helper Coverage');
  lines.push('');
  lines.push('| SDK | Typed helpers | Raw-only surfaces | Unreachable surfaces |');
  lines.push('|---|---:|---:|---:|');
  for (const row of sdkRows) {
    lines.push(tableRow([row.sdk, String(row.helpers), String(row.rawOnly), String(row.unreachable)]));
  }
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
  lines.push('| Metric | Count | Source |');
  lines.push('|---|---:|---|');
  lines.push(tableRow(['Index `packCount`', String(registry.indexPackCount), '`registry/v1/index.json`']));
  lines.push(tableRow(['Indexed pack rows', String(registry.indexedPacks), '`registry/v1/index.json`']));
  lines.push(tableRow(['Local pack directories', String(registry.packDirs), '`registry/v1/packs/*`']));
  lines.push(tableRow(['Version manifests', String(registry.versionManifests), '`registry/v1/packs/*/-/*.json`']));
  lines.push(tableRow(['Tarballs', String(registry.tarballs), '`registry/v1/packs/*/-/*.tgz`']));
  lines.push(tableRow(['Signatures', String(registry.signatures), '`registry/v1/packs/*/-/*.sig`']));
  lines.push('');
  lines.push('| Scope | Indexed packs |');
  lines.push('|---|---:|');
  for (const scope of Object.keys(registry.scopes).sort()) {
    lines.push(tableRow([scope, String(registry.scopes[scope])]));
  }
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
  lines.push('- SDK parity still shows raw-only rows for several stable v1.x helper surfaces.');
  lines.push('- External audit, non-steward host recruitment, and non-steward maintainer recruitment remain external-action gates.');
  lines.push('- Multi-region idempotency and some optional-profile behavior checks remain lower-confidence than the core wire contract.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const mode = process.argv[2] ?? '--print';
  const generated = generateStatus();
  const rfcs = parseRfcs();

  if (mode === '--write') {
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, generated);
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
