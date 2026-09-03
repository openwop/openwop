#!/usr/bin/env node
/**
 * check-rfc-status-coherence — RFC 0174 §A/§C/§D (+ RFC 0178 §E.1).
 *   1. supersession pairs: an RFC naming N in `Supersedes` ⇒ N is `Superseded`
 *      with a forward pointer (§A.1);
 *   2. register location: every *.gaps.md / *.risks.md lives under
 *      RFCS/registers/ (§C.1);
 *   3. self-carry: `carried:<own id>` on a terminal-status RFC is a ratchet
 *      (docs/witness-baseline.json `selfCarried`, may only fall) and is REFUSED
 *      when the row's own prose says CLOSED — machine and prose must agree (§C.2);
 *   4. document banners: a spec/v1 `Status: Draft` banner whose stated
 *      predicate names an RFC that is Accepted fails (§D.1); a `Status:` banner
 *      that states an RFC status contradicting the RFC's real status fails;
 *   5. stale deferrals: a spec/v1 gap row deferring to `Active → Accepted` of
 *      an RFC that is already Accepted fails (§D.2);
 *   6. schemas/README.md maturity column: a row stating an RFC status that
 *      contradicts the RFC's real status fails (RFC 0178 §E.1).
 * Exit 0 on success, 1 on any failure.  --update-baseline rewrites the ratchet.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = join(ROOT, 'docs', 'witness-baseline.json');
const update = process.argv.includes('--update-baseline');
const failures = [];
const TERMINAL = new Set(['Accepted', 'Superseded', 'Withdrawn', 'Rejected']);
const rfcFiles = readdirSync(join(ROOT, 'RFCS')).filter((f) => /^\d{4}-.*\.md$/.test(f) && !f.startsWith('0000'));
const status = new Map(); const supersedes = new Map();
for (const f of rfcFiles) {
  const t = readFileSync(join(ROOT, 'RFCS', f), 'utf8');
  const m = t.match(/\*\*Status\*\*\s*\|\s*`(\w+)`/); if (m) status.set(f.slice(0, 4), m[1]);
  const s = t.match(/\*\*Supersedes\*\*\s*\|\s*([^\n|]*)/); if (s && !/^\s*—|amends|corrects|where it|§/i.test(s[1])) for (const n of s[1].matchAll(/\b(\d{4})\b/g)) supersedes.set(f.slice(0, 4), [...(supersedes.get(f.slice(0, 4)) ?? []), n[1]]);
}
// 1
for (const [rfc, targets] of supersedes) for (const t of targets) if (status.has(t) && status.get(t) !== 'Superseded' && status.get(rfc) === 'Accepted') failures.push(`supersession: RFC ${rfc} (Accepted) supersedes ${t}, but ${t} is ${status.get(t)} — flip it in the same PR (RFC 0174 §A.1)`);
// 2
for (const f of readdirSync(join(ROOT, 'RFCS'))) if (/\.(gaps|risks)\.md$/.test(f)) failures.push(`register location: RFCS/${f} must live under RFCS/registers/ (RFC 0174 §C.1)`);
// 3
let selfCarried = 0;
for (const f of readdirSync(join(ROOT, 'RFCS', 'registers')).filter((f) => f.endsWith('.gaps.md'))) {
  const rfc = f.slice(0, 4); if (!TERMINAL.has(status.get(rfc))) continue;
  for (const line of readFileSync(join(ROOT, 'RFCS', 'registers', f), 'utf8').split('\n')) {
    const m = line.match(/^\| \**G(\d+)\**\s*\|/); if (!m) continue;
    if (line.includes(`carried:openwop.gap.${rfc}.${m[1]}`)) { selfCarried++; if (/\bCLOSED\b|\*\*Closed\b/.test(line)) failures.push(`self-carry: RFCS/registers/${f} G${m[1]} says CLOSED in prose but carries itself — re-token it \`closed\` (RFC 0174 §C.2)`); }
  }
}
// 4 + 5
const specDir = join(ROOT, 'spec', 'v1');
for (const f of readdirSync(specDir).filter((f) => f.endsWith('.md'))) {
  const lines = readFileSync(join(specDir, f), 'utf8').split('\n');
  const banner = lines.find((l) => /\*\*Status:/.test(l)) ?? '';
  for (const m of banner.matchAll(/RFC (\d{4}) `(Draft|Active|Accepted|Withdrawn|Superseded|Rejected)`/g)) if (status.has(m[1]) && status.get(m[1]) !== m[2]) failures.push(`banner: spec/v1/${f} says RFC ${m[1]} is \`${m[2]}\`; it is \`${status.get(m[1])}\` (RFC 0174 §D.1)`);
  if (/Status:\s*Draft/.test(banner)) for (const m of banner.matchAll(/graduates?[^.]*when RFC (\d{4}) reaches `?Accepted`?/g)) if (status.get(m[1]) === 'Accepted') failures.push(`banner: spec/v1/${f} is Draft "until RFC ${m[1]} reaches Accepted" — it has (RFC 0174 §D.1)`);
  lines.forEach((l, i) => { if (!l.startsWith('|') || /\*\*Closed/.test(l)) return; for (const m of l.matchAll(/(?:deferred to|lands? at|land in[^|]*at) `Active → Accepted`[^|]*RFC (\d{4})/gi)) if (status.get(m[1]) === 'Accepted') failures.push(`stale deferral: spec/v1/${f}:${i + 1} defers to RFC ${m[1]}'s Active → Accepted, which has happened (RFC 0174 §D.2)`); });
}
// 6
const readme = readFileSync(join(ROOT, 'schemas', 'README.md'), 'utf8').split('\n');
readme.forEach((l, i) => { if (!l.startsWith('|')) return; for (const m of l.matchAll(/RFC (\d{4}) \(`(Draft|Active|Accepted|Withdrawn|Superseded|Rejected)`\)/g)) if (status.has(m[1]) && status.get(m[1]) !== m[2]) failures.push(`schemas/README.md:${i + 1} says RFC ${m[1]} is \`${m[2]}\`; it is \`${status.get(m[1])}\` (RFC 0178 §E.1)`); });
// ratchet
const base = existsSync(BASE) ? JSON.parse(readFileSync(BASE, 'utf8')) : {};
if (update) { writeFileSync(BASE, JSON.stringify({ ...base, selfCarried }, null, 2) + '\n'); }
else if (typeof base.selfCarried === 'number' && selfCarried > base.selfCarried) failures.push(`self-carry ratchet: ${selfCarried} self-carried rows on terminal RFCs, baseline ${base.selfCarried} — a carry must name a different open row or a tracked surface (RFC 0174 §C.2)`);
if (failures.length > 0) { console.error(`=== check-rfc-status-coherence FAILED — ${failures.length} problem(s) ===`); for (const x of failures) console.error(`  ${x}`); process.exit(1); }
console.log(`=== check-rfc-status-coherence OK — ${rfcFiles.length} RFCs; supersession pairs coherent; every register under registers/; self-carried rows on terminal RFCs ${selfCarried} (baseline ${base.selfCarried ?? 'unset'}); banners, deferrals and schemas/README agree with RFC status ===`);
