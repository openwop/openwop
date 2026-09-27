#!/usr/bin/env node
/**
 * check-spec-readability — the v2 spec prose stays readable.
 *
 * `spec/v2/**\/*.md` renders verbatim on openwop.dev/spec/v2/. It had drifted
 * into walls of stacked MUSTs, tables whose cells were paragraphs, and RFC
 * section citations in every banner, heading and sentence (rewritten in
 * #1665). These checks are mechanical, so they cannot misfire on meaning:
 *
 *   1. banner    — a `> **Status: …**` line names no OpenWOP RFC.
 *   2. heading   — no heading names an OpenWOP RFC.
 *   3. inline    — an OpenWOP RFC is cited only on the doc's one `*Sources: …*`
 *                  line, or as a markdown link where the RFC is the sole
 *                  definition of something the sentence uses.
 *   4. paragraph — a prose paragraph or list item is at most PARA_MAX words.
 *   5. cell      — a table cell is at most CELL_MAX words.
 *   6. v1        — mentions of `v1` across the tree never grow (V1_BASELINE).
 *                  Lower the baseline when a PR removes some.
 *
 * "OpenWOP RFC" is `RFC 0NNN`; IETF RFCs (RFC 9110, RFC 8785) are not flagged.
 * Words are whitespace tokens with inline code counted as one word.
 *
 * `/spec-readability` (.claude/skills/spec-readability) is the procedure that
 * fixes what this gate reports.
 *
 * Usage: node scripts/check-spec-readability.mjs [--self-test]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PARA_MAX = 90;
const CELL_MAX = 40;
const V1_BASELINE = 128;
const OWN_RFC = /RFC 0\d{3}/;

const words = (s) => s.replace(/`[^`]*`/g, 'x').split(/\s+/).filter(Boolean).length;
const isTableSep = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);

export function check(file, text) {
  const out = [];
  const lines = text.split('\n');
  const push = (n, rule, msg) => out.push(`${file}:${n}: ${rule} — ${msg}`);
  let inCode = false;
  let para = [];
  let paraStart = 0;
  let item = null; // { n, words }
  const flushPara = () => {
    if (para.length) {
      const w = words(para.join(' '));
      if (w > PARA_MAX) push(paraStart, 'paragraph', `${w} words (max ${PARA_MAX}); split it into a lead-in plus one rule per bullet`);
    }
    para = [];
  };
  const flushItem = () => {
    if (item && item.words > PARA_MAX) push(item.n, 'paragraph', `list item of ${item.words} words (max ${PARA_MAX}); split it`);
    item = null;
  };
  // A table is a header line followed by a separator line; rows may omit the outer pipes.
  const tableRows = new Set();
  for (let i = 1; i < lines.length; i++) {
    if (isTableSep(lines[i]) && lines[i - 1].includes('|')) {
      tableRows.add(i - 1);
      for (let j = i + 1; j < lines.length && lines[j].includes('|') && lines[j].trim() !== ''; j++) tableRows.add(j);
    }
  }
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/^\s*```/.test(line)) { flushPara(); flushItem(); inCode = !inCode; return; }
    if (inCode) return;
    if (/^>\s*\*\*Status:/.test(line) && OWN_RFC.test(line)) push(n, 'banner', 'the Status banner names an RFC; move it to the *Sources:* line');
    if (/^#{1,6} /.test(line) && OWN_RFC.test(line)) push(n, 'heading', 'the heading names an RFC; drop the citation (section numbers carry §N references)');
    if (!/^\*Sources:/.test(line)) {
      const bare = line.replace(/\[[^\]]*\]\([^)]*\)/g, (m) => (OWN_RFC.test(m) ? '' : m));
      if (OWN_RFC.test(bare)) push(n, 'inline', `\`${bare.match(OWN_RFC)[0]}\` cited in running text; move it to the *Sources:* line, or link it if the RFC is the only definition`);
    }
    if (tableRows.has(i)) {
      flushPara(); flushItem();
      if (isTableSep(line)) return;
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/);
      for (const c of cells) {
        const w = words(c);
        if (w > CELL_MAX) push(n, 'cell', `table cell of ${w} words (max ${CELL_MAX}): "${c.trim().slice(0, 50)}…"; keep the table as lookup data and move the rule below it`);
      }
      return;
    }
    if (/^\s*([-*+]|\d+\.)\s/.test(line)) { flushPara(); flushItem(); item = { n, words: words(line) }; return; }
    if (item && /^\s{2,}\S/.test(line)) { item.words += words(line); return; }
    if (line.trim() === '' || /^#{1,6} |^>/.test(line)) { flushPara(); flushItem(); return; }
    flushItem();
    if (!para.length) paraStart = n;
    para.push(line);
  });
  flushPara(); flushItem();
  return out;
}

const v1Count = (text) => (text.match(/\bv1\b/g) ?? []).length;

function selfTest() {
  const long = Array.from({ length: PARA_MAX + 5 }, () => 'word').join(' ');
  const cases = [
    ['banner', '> **Status: Stable · RFC 0170.**\n'],
    ['heading', '## 1. Runs (RFC 0170 §A)\n'],
    ['inline', 'A host MUST do this (RFC 0170 §A.1).\n'],
    ['paragraph', `${long}\n`],
    ['paragraph', `- ${long}\n`],
    ['cell', `| a | b |\n| --- | --- |\n| x | ${Array.from({ length: CELL_MAX + 3 }, () => 'w').join(' ')} |\n`],
  ];
  const clean = [
    '> **Status: Stable.**\n',
    '## 1. Runs\n',
    '*Sources: RFC 0170, RFC 0171.*\n',
    'Defined in [RFC 0041](https://github.com/openwop/openwop/blob/main/RFCS/0041-x.md).\n',
    'Canonical JSON is RFC 8785.\n',
    '```\n' + long + '\n```\n',
  ];
  let bad = 0;
  for (const [rule, text] of cases) {
    if (!check('t.md', text).some((m) => m.includes(`: ${rule} —`))) { console.error(`self-test: "${rule}" not detected in ${JSON.stringify(text.slice(0, 40))}`); bad++; }
  }
  for (const text of clean) {
    const r = check('t.md', text);
    if (r.length) { console.error(`self-test: false positive ${r[0]}`); bad++; }
  }
  if (bad) { console.error(`=== check-spec-readability self-test FAILED (${bad}) ===`); process.exit(1); }
  console.log(`=== check-spec-readability self-test OK — ${cases.length} violations caught, ${clean.length} clean inputs pass ===`);
}

if (process.argv.includes('--self-test')) selfTest();
else {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.md') ? [p] : [];
  });
  const files = walk(join(ROOT, 'spec', 'v2'));
  const problems = [];
  let v1 = 0;
  for (const p of files) {
    const text = readFileSync(p, 'utf8');
    problems.push(...check(relative(ROOT, p), text));
    v1 += v1Count(text);
  }
  if (v1 > V1_BASELINE) problems.push(`spec/v2: v1 — ${v1} mentions of "v1" (baseline ${V1_BASELINE}); v2 prose states v2 rules, and only live overlap rules name v1`);
  if (problems.length) {
    for (const m of problems) console.error(m);
    console.error(`=== check-spec-readability FAILED — ${problems.length} problem(s); run /spec-readability to fix ===`);
    process.exit(1);
  }
  const note = v1 < V1_BASELINE ? ` — lower V1_BASELINE to ${v1}` : '';
  console.log(`=== check-spec-readability OK — ${files.length} docs; v1 mentions ${v1}/${V1_BASELINE}${note} ===`);
}
