#!/usr/bin/env node
/**
 * RFC 0266 §B.1 — no current v2 artifact cites frozen v1 as the home of a rule.
 *
 * Scans every file under `spec/v2/`, `schemas/v2/` and `api/v2/` for a
 * reference to the v1 corpus:
 *
 *   spec-v1      a `spec/v1/…` path (also `../v1/…` and `openwop.dev/spec/v1/…`)
 *   flat-schema  a flat `schemas/<name>.schema.json` path (not `schemas/v2/…`)
 *   v1-api       `api/openapi.yaml`, `api/asyncapi.yaml` or `api/grpc/…`
 *   v1-doc       a bare v1-only document name: a `spec/v1/*.md` basename with
 *                no file of the same basename anywhere under `spec/v2/`
 *
 * Each finding is keyed (file, kind, target, fingerprint). The fingerprint is a
 * hash of the whitespace-normalised text around the reference (WINDOW characters
 * each side, within its line), so an edit elsewhere in the file does not churn
 * it; a second identical occurrence in one file gets `~2`, `~3`, ….
 *
 * `scripts/v2-self-contained-allowlist.json` lists every current finding with a
 * `disposition` — `history` (the sentence names v1 as history or migration
 * provenance; it may stay) or `to-rehome` (a rule RFC 0266 §B.2 moves into v2;
 * must reach zero for `Accepted`) — and a one-line `why`. The gate fails on:
 *
 *   1. a finding the allow-list does not name (a new v1 citation);
 *   2. an allow-list row no finding matches (stale — remove it);
 *   3. a malformed or duplicated allow-list row;
 *   4. with --require-zero-rehome, any `to-rehome` row (RFC 0266 acceptance);
 *   5. RFC 0266 §C.1 — a scanned file carrying the v1 seed stamp (the
 *      `x-openwop-seeded-from` annotation with the value `v1`). v2 is its own
 *      source: no v2 schema is seeded from v1, so the stamp has no allow-list.
 *
 *   node scripts/check-v2-self-contained.mjs [--require-zero-rehome] [--json]
 *   node scripts/check-v2-self-contained.mjs --write-allowlist   (re-seed: keeps
 *        existing dispositions, adds new findings as `unclassified` — the gate
 *        fails until each is classified by hand)
 *   node scripts/check-v2-self-contained.mjs --self-test
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST = join(ROOT, 'scripts', 'v2-self-contained-allowlist.json');
// api/seams-v2.yaml is the v2 conformance seams profile; it sits beside api/v2/, not in it.
export const SCANNED = ['spec/v2', 'schemas/v2', 'api/v2', 'api/seams-v2.yaml'];
export const DISPOSITIONS = ['history', 'to-rehome'];
// Not scanned: the gap registers, whose rows are history by construction (RFC 0266 §C
// moved both out of the frozen v1 tree). spec/v2/gaps.json is generate-gaps.mjs's index
// of every RFCS/registers/ gap row, copied verbatim; spec/v2/spec-gaps.json holds the rows
// of the v1 documents' "Open spec gaps" sections, each naming the v1 document it came
// from. Listing them here would re-list both registers row by row.
export const NOT_SCANNED = new Set(['spec/v2/gaps.json', 'spec/v2/spec-gaps.json']);
const WINDOW = 40;

const posix = (p) => p.split(sep).join('/');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  if (!statSync(dir).isDirectory()) { out.push(dir); return out; }
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/** Read the tree the gate scans: v2 files as { path, text }, and the v1-only doc names. */
export function readTree(root = ROOT) {
  const files = SCANNED.flatMap((d) => walk(join(root, d)))
    .map((p) => ({ path: posix(relative(root, p)), text: readFileSync(p, 'utf8') }))
    .filter((f) => !NOT_SCANNED.has(f.path));
  const v1Docs = readdirSync(join(root, 'spec', 'v1')).filter((n) => n.endsWith('.md'));
  return { files, v1Docs };
}

/** v1-only document names: a spec/v1/*.md basename with no same-basename file under spec/v2/. */
export function v1OnlyNames(v1Docs, files) {
  const v2Names = new Set(files.filter((f) => f.path.startsWith('spec/v2/')).map((f) => basename(f.path)));
  return v1Docs.filter((n) => !v2Names.has(n)).sort();
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function patterns(onlyNames) {
  const pats = [
    // spec/v1/<path>, ../v1/<path>, openwop.dev/spec/v1/<path>. Target: the spec/v1 path, anchor dropped.
    { kind: 'spec-v1', re: /(?:spec\/|(?<![A-Za-z0-9_])(?:\.\.\/)+)v1\/([A-Za-z0-9_.\/-]*[A-Za-z0-9_])?/g, target: (m) => `spec/v1/${m[1] ?? ''}` },
    // schemas/<name>.schema.json — the flat v1 tree, never schemas/v2/<name>.
    { kind: 'flat-schema', re: /(?<![A-Za-z0-9_-])schemas\/([A-Za-z0-9_-]+\.schema\.json)/g, target: (m) => `schemas/${m[1]}` },
    { kind: 'v1-api', re: /(?<![A-Za-z0-9_-])api\/(openapi\.yaml|asyncapi\.yaml|grpc\/[A-Za-z0-9_.\/-]*[A-Za-z0-9_])/g, target: (m) => `api/${m[1]}` },
  ];
  // A bare v1-only document name: not preceded by a path segment (spec/v1/x.md is
  // already a spec-v1 finding; docs/x.md is not the v1 document).
  if (onlyNames.length) pats.push({ kind: 'v1-doc', re: new RegExp(`(?<![A-Za-z0-9_./-])(${onlyNames.map(esc).join('|')})(?![A-Za-z0-9_-])`, 'g'), target: (m) => m[1] });
  return pats;
}

const fingerprintOf = (excerpt) => createHash('sha256').update(excerpt).digest('hex').slice(0, 12);

/** Every v1 reference in the scanned files, each with a stable key. */
export function scan({ files, v1Docs }) {
  const pats = patterns(v1OnlyNames(v1Docs, files));
  const findings = [];
  for (const f of files) {
    const seen = new Map();
    const lines = f.text.split('\n');
    lines.forEach((line, i) => {
      const hits = [];
      for (const p of pats) for (const m of line.matchAll(p.re)) hits.push({ p, m });
      hits.sort((a, b) => a.m.index - b.m.index);
      for (const { p, m } of hits) {
        const start = Math.max(0, m.index - WINDOW);
        const end = Math.min(line.length, m.index + m[0].length + WINDOW);
        const excerpt = line.slice(start, end).replace(/\s+/g, ' ').trim();
        const target = p.target(m);
        let fingerprint = fingerprintOf(excerpt);
        const base = `${f.path}\u0000${p.kind}\u0000${target}\u0000${fingerprint}`;
        const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
        if (n > 1) fingerprint += `~${n}`;
        findings.push({ file: f.path, kind: p.kind, target, fingerprint, line: i + 1, excerpt });
      }
    });
  }
  return findings;
}

// The stamp's name is built from parts: a checker never writes the literal it polices.
const SEED_STAMP = ['x', 'openwop', 'seeded', 'from'].join('-');
const SEED_STAMP_RE = new RegExp(`["']?${SEED_STAMP}["']?\\s*:\\s*["']?v1(?![A-Za-z0-9_.-])`);

/** RFC 0266 §C.1 — every scanned line that stamps a v2 artifact as seeded from v1. */
export function seedStamps({ files }) {
  const out = [];
  for (const f of files) f.text.split('\n').forEach((line, i) => { if (SEED_STAMP_RE.test(line)) out.push(`v1 seed stamp (RFC 0266 §C.1): ${f.file ?? f.path}:${i + 1} — v2 is its own source; remove the stamp (the file is edited by hand)`); });
  return out;
}

export const keyOf = (r) => `${r.file} | ${r.kind} | ${r.target} | ${r.fingerprint}`;

/** Compare findings with the allow-list. Returns { failures, matched }. */
export function evaluate(findings, allow, { requireZeroRehome = false } = {}) {
  const failures = [];
  const rows = Array.isArray(allow?.rows) ? allow.rows : null;
  if (!rows) return { failures: ['allow-list: `rows` must be an array'], matched: [] };
  const byKey = new Map();
  rows.forEach((r, i) => {
    const at = `allow-list rows[${i}] (${keyOf(r)})`;
    for (const k of ['file', 'kind', 'target', 'fingerprint']) if (typeof r[k] !== 'string' || !r[k]) failures.push(`${at}: \`${k}\` must be a non-empty string`);
    if (!DISPOSITIONS.includes(r.disposition)) failures.push(`${at}: disposition must be one of ${DISPOSITIONS.join(', ')} (got ${JSON.stringify(r.disposition)}) — classify it`);
    if (typeof r.why !== 'string' || r.why.trim().length < 10 || r.why.includes('\n')) failures.push(`${at}: \`why\` must be one line saying why the reference is ${r.disposition ?? 'listed'}`);
    if (byKey.has(keyOf(r))) failures.push(`${at}: duplicate of rows[${byKey.get(keyOf(r))}]`);
    else byKey.set(keyOf(r), i);
  });
  const found = new Set(findings.map(keyOf));
  const matched = [];
  for (const f of findings) {
    const i = byKey.get(keyOf(f));
    if (i === undefined) failures.push(`unlisted v1 reference (RFC 0266 §B.1): ${f.file}:${f.line} ${f.kind} → ${f.target} — "${f.excerpt}" — re-home the rule in v2, or, if the sentence names v1 as history, add an allow-list row (fingerprint ${f.fingerprint})`);
    else matched.push({ ...f, disposition: rows[i].disposition, why: rows[i].why });
  }
  rows.forEach((r, i) => { if (!found.has(keyOf(r))) failures.push(`stale allow-list row rows[${i}]: ${keyOf(r)} — no such reference in the tree any more; remove the row`); });
  if (requireZeroRehome) {
    const left = rows.filter((r) => r.disposition === 'to-rehome');
    if (left.length) failures.push(`--require-zero-rehome: ${left.length} \`to-rehome\` row(s) remain (RFC 0266 acceptance needs zero): ${[...new Set(left.map((r) => r.file))].join(', ')}`);
  }
  return { failures, matched };
}

function summary(matched) {
  const count = (xs, f) => [...xs.reduce((m, x) => m.set(f(x), (m.get(f(x)) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const by = (d) => matched.filter((m) => m.disposition === d);
  const out = [`  ${matched.length} v1 reference(s): ${DISPOSITIONS.map((d) => `${by(d).length} ${d}`).join(', ')}`];
  out.push('  by file (history / to-rehome):');
  for (const [file, n] of count(matched, (m) => m.file)) {
    const h = matched.filter((m) => m.file === file && m.disposition === 'history').length;
    out.push(`    ${String(n).padStart(4)}  ${file} (${h} / ${n - h})`);
  }
  out.push('  top targets:');
  for (const [t, n] of count(matched, (m) => m.target).slice(0, 15)) out.push(`    ${String(n).padStart(4)}  ${t}`);
  const rehome = count(by('to-rehome'), (m) => m.target);
  if (rehome.length) out.push(`  to-rehome targets: ${rehome.map(([t, n]) => `${t} ×${n}`).join(', ')}`);
  return out.join('\n');
}

function selfTest() {
  const v1Docs = ['node-packs.md', 'overview.md', 'stream-modes.md'];
  const base = [
    { path: 'spec/v2/core/overview.md', text: '# Overview\n\nThe v1 tree is frozen as history; see `spec/v1/overview.md` for the record.\n' },
    { path: 'spec/v2/core/runs.md', text: '# Runs\n\nA run MUST stream as stream-modes.md says.\n' },
    { path: 'schemas/v2/x.schema.json', text: '{ "description": "Moved from schemas/run-options.schema.json in the v1 → v2 cut." }\n' },
    { path: 'api/v2/openapi.yaml', text: 'info: { description: "Derived once from api/openapi.yaml; see docs/node-packs.md and schemas/v2/x.schema.json." }\n' },
  ];
  const tree = (files = base) => ({ files, v1Docs });
  const seed = (findings, disposition = 'history') => ({ rows: findings.map((f) => ({ file: f.file, kind: f.kind, target: f.target, fingerprint: f.fingerprint, disposition, why: 'self-test row, history by construction' })) });
  const edit = (path, fn) => base.map((f) => (f.path === path ? { ...f, text: fn(f.text) } : f));
  const ok = scan(tree());
  const allow = seed(ok);
  const real = readTree();
  const realAllow = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
  const plant = (files) => files.map((f) => (f.path === 'spec/v2/core/runs.md' ? { ...f, text: `${f.text}\nA run option MUST follow [spec/v1/run-options.md](../../v1/run-options.md).\n` } : f));
  const cases = [
    ['the fixture finds one reference of each kind', () => (JSON.stringify(ok.map((f) => f.kind).sort()) === JSON.stringify(['flat-schema', 'spec-v1', 'v1-api', 'v1-doc']) ? 0 : 1), 0],
    ['overview.md has a v2 twin, so it is not a v1-only name', () => scan(tree()).filter((f) => f.kind === 'v1-doc' && f.target === 'overview.md').length, 0],
    ['docs/node-packs.md and schemas/v2/x.schema.json are not v1 references', () => ok.filter((f) => f.file === 'api/v2/openapi.yaml').length - 1, 0],
    ['a seeded allow-list passes', () => evaluate(ok, allow).failures.length, 0],
    ['an edit elsewhere in the file does not churn a fingerprint', () => evaluate(scan(tree(edit('spec/v2/core/overview.md', (t) => `Preface paragraph.\n\n${t}\nTrailer.\n`))), allow).failures.length, 0],
    ['a planted spec/v1/ citation fails (fixture)', () => evaluate(scan(tree(plant(base))), allow).failures.filter((f) => f.startsWith('unlisted')).length, 2],
    ['a planted bare v1 doc name fails', () => evaluate(scan(tree(edit('spec/v2/core/runs.md', (t) => `${t}Packs are named per node-packs.md.\n`))), allow).failures.length, 1],
    ['a stale allow-list row fails (fixture)', () => evaluate(scan(tree(edit('spec/v2/core/runs.md', () => '# Runs\n'))), allow).failures.filter((f) => f.startsWith('stale')).length, 1],
    ['an unclassified row fails', () => evaluate(ok, { rows: allow.rows.map((r, i) => (i ? r : { ...r, disposition: 'unclassified' })) }).failures.length, 1],
    ['a row with no why fails', () => evaluate(ok, { rows: allow.rows.map((r, i) => (i ? r : { ...r, why: '' })) }).failures.length, 1],
    ['a duplicated row fails', () => evaluate(ok, { rows: [...allow.rows, allow.rows[0]] }).failures.length, 1],
    ['--require-zero-rehome passes with only history rows', () => evaluate(ok, allow, { requireZeroRehome: true }).failures.length, 0],
    ['a v1 seed stamp fails (fixture)', () => seedStamps(tree(edit('schemas/v2/x.schema.json', (t) => t.replace(/}\s*$/, `, "${SEED_STAMP}": "v1" }`)))).length, 1],
    ['a stamp naming a non-v1 source is not a v1 seed stamp', () => seedStamps(tree(edit('schemas/v2/x.schema.json', (t) => t.replace(/}\s*$/, `, "${SEED_STAMP}": "declaration" }`)))).length, 0],
    ['the generated gap aggregate is not scanned', () => real.files.filter((f) => NOT_SCANNED.has(f.path)).length, 0],
    ['the tree carries no v1 seed stamp', () => seedStamps(real).length, 0],
    ['a v1 seed stamp planted in a real v2 schema fails (real tree)', () => seedStamps({ files: real.files.map((f) => (f.path === 'schemas/v2/goal.schema.json' ? { ...f, text: f.text.replace(/\n}\n?$/, `,\n  "${SEED_STAMP}": "v1"\n}\n`) } : f)) }).length, 1],
    ['--require-zero-rehome fails on a to-rehome row', () => evaluate(ok, seed(ok, 'to-rehome'), { requireZeroRehome: true }).failures.length, 1],
    // The same legs on the real tree and the committed allow-list, in memory: nothing on disk changes.
    ['the committed allow-list matches the tree', () => evaluate(scan(real), realAllow).failures.length, 0],
    ['a planted spec/v1/ citation in spec/v2/core/runs.md fails (real tree)', () => evaluate(scan({ ...real, files: plant(real.files) }), realAllow).failures.filter((f) => f.startsWith('unlisted')).length, 2],
    ['a stale allow-list row fails (real tree)', () => evaluate(scan(real), { rows: [...realAllow.rows, { ...realAllow.rows[0], fingerprint: '000000000000' }] }).failures.filter((f) => f.startsWith('stale')).length, 1],
  ];
  let bad = 0;
  for (const [name, fn, want] of cases) {
    const got = fn();
    if (got !== want) { bad++; console.error(`  self-test FAILED: ${name} — expected ${want}, got ${got}`); }
  }
  if (bad) { console.error(`=== check-v2-self-contained --self-test FAILED — ${bad} case(s) ===`); process.exit(1); }
  console.log(`=== check-v2-self-contained --self-test OK — ${cases.length} cases ===`);
}

// realpath both sides: a script under a symlinked tmpdir (/var → /private/var) must still run.
const isMain = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();
  else {
    const findings = scan(readTree());
    if (argv.includes('--write-allowlist')) {
      const prev = existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, 'utf8')) : { rows: [] };
      const old = new Map((prev.rows ?? []).map((r) => [keyOf(r), r]));
      const rows = findings.map((f) => {
        const o = old.get(keyOf(f));
        return { file: f.file, kind: f.kind, target: f.target, fingerprint: f.fingerprint, excerpt: f.excerpt, disposition: o?.disposition ?? 'unclassified', why: o?.why ?? '' };
      });
      writeFileSync(ALLOWLIST, JSON.stringify({ $comment: prev.$comment, rows }, null, 2) + '\n');
      console.log(`wrote ${posix(relative(ROOT, ALLOWLIST))}: ${rows.length} row(s), ${rows.filter((r) => r.disposition === 'unclassified').length} unclassified`);
      process.exit(0);
    }
    const allow = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
    const { failures, matched } = evaluate(findings, allow, { requireZeroRehome: argv.includes('--require-zero-rehome') });
    failures.push(...seedStamps(readTree()));
    if (argv.includes('--json')) console.log(JSON.stringify(matched, null, 2));
    if (failures.length) {
      console.error(`=== check-v2-self-contained FAILED — ${failures.length} problem(s) (RFC 0266 §B.1) ===`);
      for (const f of failures.slice(0, 60)) console.error(`  ${f}`);
      if (failures.length > 60) console.error(`  … ${failures.length - 60} more`);
      process.exit(1);
    }
    console.log(`=== check-v2-self-contained OK — every v1 reference in ${SCANNED.join(', ')} is allow-listed (RFC 0266 §B.1); no v1 seed stamp (§C.1) ===\n${summary(matched)}`);
  }
}
