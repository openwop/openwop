#!/usr/bin/env node
/**
 * check-changelog-shape — CHANGELOG.md stays short enough to read.
 *
 * The file grew to 906 KB: `[Unreleased]` was never emptied at a release, and
 * entries carried evidence digests, bundle counts and correction narratives
 * that already live in `evidence/` and the RFCs. It was condensed at 2.45.7.
 * This gate keeps the shape, so the next cleanup is not needed:
 *
 *   1. `## [Unreleased]` is the first `## ` heading; every other `## [` heading
 *      is `## [X.Y.Z] — YYYY-MM-DD — headline`, newest first, each version once.
 *      (generate-assurance-status and openwop-site read the newest one.)
 *   2. Every bullet is one line of `- **Lead.** sentence`, at most MAX_BULLET
 *      characters.
 *   3. A release has at most MAX_RELEASE_BULLETS bullets, `[Unreleased]` at most
 *      MAX_UNRELEASED: a release cut MOVES its items out of `[Unreleased]`.
 *   4. No digest-like hex string: evidence is cited by file, not by hash.
 *   5. The file is at most MAX_BYTES.
 *
 *   node scripts/check-changelog-shape.mjs [file]
 *   node scripts/check-changelog-shape.mjs --self-test
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BULLET = 320;
const MAX_RELEASE_BULLETS = 16; // a major release (2.0.0) needs the room; an ordinary one uses 1–5
const MAX_UNRELEASED = 20;
const MAX_BYTES = 200_000;
const RELEASE = /^## \[(\d+)\.(\d+)\.(\d+)\] — \d{4}-\d{2}-\d{2} — \S/;
const HEX = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{12,}\b/;

export function check(text) {
  const failures = [];
  const lines = text.split('\n');
  if (Buffer.byteLength(text) > MAX_BYTES) failures.push(`the file is ${Buffer.byteLength(text)} bytes, over the ${MAX_BYTES} cap — condense, do not append`);
  const headings = lines.map((l, i) => [l, i + 1]).filter(([l]) => l.startsWith('## '));
  if (headings[0]?.[0] !== '## [Unreleased]') failures.push(`the first \`## \` heading must be \`## [Unreleased]\` (found ${JSON.stringify(headings[0]?.[0] ?? 'none')})`);
  let prev = null;
  const seen = new Set();
  for (const [h, n] of headings.slice(1)) {
    if (!h.startsWith('## [')) continue; // a plain section such as the 1.x summary
    const m = RELEASE.exec(h);
    if (!m) { failures.push(`line ${n}: a release heading must be \`## [X.Y.Z] — YYYY-MM-DD — headline\`: ${h.slice(0, 60)}`); continue; }
    const v = [Number(m[1]), Number(m[2]), Number(m[3])];
    const key = v.join('.');
    if (seen.has(key)) failures.push(`line ${n}: version ${key} has two sections`);
    seen.add(key);
    if (prev !== null && !(v[0] < prev[0] || (v[0] === prev[0] && (v[1] < prev[1] || (v[1] === prev[1] && v[2] < prev[2]))))) failures.push(`line ${n}: ${key} is not older than the release above it — releases are newest first`);
    prev = v;
  }
  let section = null;
  let count = 0;
  const close = () => {
    if (section === null) return;
    const cap = section === '## [Unreleased]' ? MAX_UNRELEASED : MAX_RELEASE_BULLETS;
    if (section.startsWith('## [') && count > cap) failures.push(`${section.slice(0, 40)}: ${count} bullets, over the cap of ${cap}${section === '## [Unreleased]' ? ' — a release cut moves its items out of [Unreleased]' : ''}`);
  };
  lines.forEach((l, i) => {
    if (l.startsWith('## ')) { close(); section = l; count = 0; return; }
    if (HEX.test(l)) failures.push(`line ${i + 1}: a digest-like hex string — cite the evidence file, not the hash`);
    if (!l.startsWith('- ')) { if (/^\s+- /.test(l)) failures.push(`line ${i + 1}: nested bullets are not used — one line per change`); return; }
    count++;
    if (l.length > MAX_BULLET) failures.push(`line ${i + 1}: bullet is ${l.length} characters, over ${MAX_BULLET}`);
    if (section !== null && section.startsWith('## [') && !/^- \*\*[^*]+\*\* \S/.test(l)) failures.push(`line ${i + 1}: a bullet is \`- **Lead.** sentence\`: ${l.slice(0, 50)}`);
  });
  close();
  return failures;
}

function selfTest() {
  const ok = '# T\n\n## [Unreleased]\n\n## [2.1.0] — 2026-01-02 — b\n\n- **Lead.** Sentence.\n\n## [2.0.0] — 2026-01-01 — a\n\n- **Lead.** Sentence.\n\n## 1.x releases (x to y)\n\n- **1.0** (2026-01-01). Sentence.\n';
  const cases = [
    ['a well-formed file passes', ok, 0],
    ['Unreleased must come first', ok.replace('## [Unreleased]\n\n', ''), 1],
    ['a heading without a date fails', ok.replace('## [2.0.0] — 2026-01-01 — a', '## [2.0.0] — a'), 1],
    ['a duplicated version fails', ok.replace('## [2.0.0] — 2026-01-01', '## [2.1.0] — 2026-01-01'), 2],
    ['releases must be newest first', ok.replace('## [2.0.0] — 2026-01-01', '## [2.2.0] — 2026-01-01'), 1],
    ['a long bullet fails', ok.replace('- **Lead.** Sentence.\n\n## [2.0.0]', `- **Lead.** ${'x'.repeat(330)}\n\n## [2.0.0]`), 1],
    ['a bullet without a bold lead fails', ok.replace('- **Lead.** Sentence.\n\n## [2.0.0]', '- plain\n\n## [2.0.0]'), 1],
    ['a digest fails', ok.replace('Sentence.\n\n## [2.0.0]', 'Witness 61e63c510bfe1d3a.\n\n## [2.0.0]'), 1],
    ['a nested bullet fails', ok.replace('- **Lead.** Sentence.\n\n## [2.0.0]', '- **Lead.** Sentence.\n  - nested\n\n## [2.0.0]'), 1],
    ['an Unreleased that was never emptied fails', ok.replace('## [Unreleased]\n', `## [Unreleased]\n\n${'- **Lead.** Sentence.\n'.repeat(21)}`), 1],
  ];
  let bad = 0;
  for (const [name, text, want] of cases) {
    const got = check(text).length;
    if (got !== want) { bad++; console.error(`  self-test FAILED: ${name} — expected ${want} failure(s), got ${got}`); }
  }
  if (bad) { console.error(`=== check-changelog-shape --self-test FAILED — ${bad} case(s) ===`); process.exit(1); }
  console.log(`=== check-changelog-shape --self-test OK — ${cases.length} cases (${cases.length - 1} negative) ===`);
}

if (process.argv.includes('--self-test')) selfTest();
else {
  const file = process.argv[2] ?? join(ROOT, 'CHANGELOG.md');
  const failures = check(readFileSync(file, 'utf8'));
  if (failures.length) {
    console.error(`=== check-changelog-shape FAILED — ${failures.length} problem(s) ===`);
    for (const f of failures.slice(0, 40)) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('=== check-changelog-shape OK — one short entry per release, newest first ===');
}
