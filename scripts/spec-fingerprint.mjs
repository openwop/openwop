#!/usr/bin/env node
/**
 * spec-fingerprint — prove an editorial rewrite of spec/v2 prose dropped no rule.
 *
 * For every `spec/v2/**\/*.md` it compares the working tree against a git ref:
 * RFC 2119 keyword counts, the set of backticked identifiers, HTTP status codes,
 * and heading lines, plus word count, longest paragraph, OpenWOP RFC citations
 * and `v1` mentions. An editorial pass should show keyword counts unchanged,
 * nothing lost that was not an aside, and headings unchanged. Every delta it
 * prints is something the author must justify in the PR.
 *
 * Usage:
 *   node scripts/spec-fingerprint.mjs [--base <ref>] [path-substring]
 *     --base   git ref to compare against (default origin/main)
 *
 * Used by /spec-readability; not part of openwop:check (a normative PR changes
 * keyword counts legitimately).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KW = ['MUST NOT', 'SHALL NOT', 'SHOULD NOT', 'MUST', 'SHALL', 'SHOULD', 'REQUIRED', 'RECOMMENDED', 'MAY', 'OPTIONAL'];
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = join(d, e.name);
  return e.isDirectory() ? walk(p) : e.name.endsWith('.md') ? [p] : [];
});

function fp(text) {
  const kw = {};
  let t = text.replace(/\s+/g, ' '); // a keyword split across a line break still counts once
  for (const k of KW) {
    const re = new RegExp(`\\b${k}\\b`, 'g');
    kw[k] = (t.match(re) ?? []).length;
    t = t.replace(re, ' ');
  }
  const ticks = [...new Set([...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]))].sort();
  const status = [...new Set([...text.matchAll(/\b([1-5]\d\d)\b(?= [a-z_]+|`)/g)].map((m) => m[1]))].sort();
  const headings = text.split('\n').filter((l) => /^#{1,6} /.test(l));
  const words = text.replace(/```[\s\S]*?```/g, '').split(/\s+/).filter(Boolean).length;
  const rfcRefs = (text.match(/RFC 0\d{3}/g) ?? []).length;
  const v1 = (text.match(/\bv1\b|legacy/gi) ?? []).length;
  const longestPara = Math.max(0, ...text.split(/\n\s*\n/).filter((p) => !/^\s*[|#>`-]/.test(p)).map((p) => p.split(/\s+/).length));
  return { kw, ticks, status, headings, words, rfcRefs, v1, longestPara };
}

const args = process.argv.slice(2);
const bi = args.indexOf('--base');
const base = bi >= 0 ? args.splice(bi, 2)[1] : 'origin/main';
const filter = args[0];

const show = (rel) => {
  try { return execFileSync('git', ['show', `${base}:${rel}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
};
const listed = execFileSync('git', ['ls-tree', '-r', '--name-only', base, 'spec/v2'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((f) => f.endsWith('.md'));
const files = [...new Set([...listed, ...walk(join(ROOT, 'spec', 'v2')).map((p) => relative(ROOT, p))])].sort();

let wb = 0, wa = 0, flagged = 0;
for (const f of files) {
  if (filter && !f.includes(filter)) continue;
  const before = show(f);
  const after = existsSync(join(ROOT, f)) ? readFileSync(join(ROOT, f), 'utf8') : null;
  if (before === after) continue;
  if (before === null) { console.log(`\n## ${f}: NEW`); continue; }
  if (after === null) { console.log(`\n## ${f}: DELETED`); flagged++; continue; }
  const x = fp(before), y = fp(after);
  wb += x.words; wa += y.words;
  const kwd = KW.filter((k) => x.kw[k] !== y.kw[k]).map((k) => `${k} ${x.kw[k]}→${y.kw[k]}`);
  const lost = x.ticks.filter((t) => !y.ticks.includes(t));
  const lostH = x.headings.filter((h) => !y.headings.includes(h));
  const lostS = x.status.filter((s) => !y.status.includes(s));
  console.log(`\n## ${f}  words ${x.words}→${y.words}  longestPara ${x.longestPara}→${y.longestPara}  RFCrefs ${x.rfcRefs}→${y.rfcRefs}  v1/legacy ${x.v1}→${y.v1}`);
  if (kwd.length) console.log(`  keywords changed: ${kwd.join(', ')}`);
  if (lost.length) console.log(`  backticked tokens LOST (${lost.length}): ${lost.map((t) => '`' + t + '`').join(' ')}`);
  if (lostS.length) console.log(`  status codes LOST: ${lostS.join(' ')}`);
  if (lostH.length) console.log(`  headings CHANGED/REMOVED: ${lostH.join(' | ')}`);
  if (kwd.length || lost.length || lostS.length || lostH.length) flagged++;
}
console.log(`\nbase ${base}: words ${wb}→${wa}; ${flagged} doc(s) with deltas to justify`);
