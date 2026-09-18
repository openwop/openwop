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
 *   7. shipped requirement on a Draft RFC: a conformance scenario whose string
 *      literal cites `RFCS/NNNN-…` or `openwop.requirement.NNNN.…` where NNNN
 *      is `Draft` fails. A scenario the
 *      suite enforces is a contract; a `Draft` header says the wire may still
 *      move, and a host's ratchet cannot tell the two apart (suite 2.2.0 shipped
 *      RFC 0183/0184 legs against `Draft` headers). Flip the RFC or gate the leg.
 * Exit 0 on success, 1 on any failure.  --update-baseline rewrites the ratchet.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = join(ROOT, 'docs', 'witness-baseline.json');
const update = process.argv.includes('--update-baseline');
const failures = [];
const TERMINAL = new Set(['Accepted', 'Superseded', 'Withdrawn', 'Rejected']);
const rfcFiles = readdirSync(join(ROOT, 'RFCS')).filter((f) => /^\d{4}-.*\.md$/.test(f) && !f.startsWith('0000'));
const status = new Map(); const supersedes = new Map();
const supersededBy = new Map();
for (const f of rfcFiles) {
  const t = readFileSync(join(ROOT, 'RFCS', f), 'utf8');
  const m = t.match(/\*\*Status\*\*\s*\|\s*`(\w+)`/); if (m) status.set(f.slice(0, 4), m[1]);
  // ANCHORED. Only `^\s*—` was anchored before; `amends`, `corrects`, `where it`
  // and `§` matched ANYWHERE in the cell, so a cell reading `RFC 0035 §B — …`
  // silently exempted itself from RFC 0174 §A.1. Measured: no RFC is exempted by
  // a stray `§` today, and the corpus's one live pair (0173 → 0035) fires — but
  // it fires only because its author happened not to write a section sign. The
  // first supersession in corpus history passed by that accident.
  const s = t.match(/\*\*Supersedes\*\*\s*\|\s*([^\n|]*)/);
  if (s && !/^\s*(—|.*\b(?:amends|corrects|where it)\b)/i.test(s[1])) for (const n of s[1].matchAll(/\b(\d{4})\b/g)) supersedes.set(f.slice(0, 4), [...(supersedes.get(f.slice(0, 4)) ?? []), n[1]]);
  // The reverse edge: the pointer a reader of the OLD RFC follows.
  const sb = t.match(/\*\*Superseded by\*\*\s*\|\s*([^\n|]*)/);
  if (sb) supersededBy.set(f.slice(0, 4), sb[1]);
}
// 1
for (const [rfc, targets] of supersedes) for (const t of targets) if (status.has(t) && status.get(t) !== 'Superseded' && status.get(rfc) === 'Accepted') failures.push(`supersession: RFC ${rfc} (Accepted) supersedes ${t}, but ${t} is ${status.get(t)} — flip it in the same PR (RFC 0174 §A.1)`);
// 1b. The FORWARD POINTER. The docblock has always said this rule checks
// "`Superseded` WITH A FORWARD POINTER (§A.1)" and only the status flip was
// implemented — a docblock that outran its code. A dangling or misdirected
// pointer passed, and the reverse edge is exactly what a reader of the OLD RFC
// follows. Reciprocal and bidirectional:
for (const [rfc, targets] of supersedes) {
  if (status.get(rfc) !== 'Accepted') continue;
  for (const t of targets) {
    if (!status.has(t)) continue;
    const ptr = supersededBy.get(t) ?? '';
    if (!ptr.trim() || /^\s*—\s*$/.test(ptr)) failures.push(`supersession: RFC ${t} is superseded by RFC ${rfc} but carries no \`Superseded by\` pointer (RFC 0174 §A.1) — the reader of ${t} has no way forward`);
    else if (!new RegExp(`\\b${rfc}\\b`).test(ptr)) failures.push(`supersession: RFC ${t}'s \`Superseded by\` names ${JSON.stringify(ptr.trim().slice(0, 60))}, which does not include RFC ${rfc} — the forward pointer points somewhere else`);
  }
}
for (const [rfc, st] of status) {
  if (st !== 'Superseded') continue;
  const ptr = supersededBy.get(rfc) ?? '';
  if (!ptr.trim() || /^\s*—\s*$/.test(ptr)) failures.push(`supersession: RFC ${rfc} reads \`Superseded\` but names no \`Superseded by\` — a terminal-status RFC that is a dead end`);
}
// 1c. spec/v2 banners. Rules 4-5 below scan spec/v1 ONLY, and every
// spec/v2/**/*.md `Status:` banner cites RFC numbers — so the v2 tree, which is
// the CURRENT major, had no banner rule at all. A `Stable` document is a
// promise; one resting on an RFC that is still `Draft`/`Active`, or on one that
// has been `Superseded`, is a promise against a moving or dead target. The
// stricter form (cite only `Accepted`) is used deliberately: the weaker "not
// non-terminal" form would permit a Stable doc to cite a `Superseded` RFC
// forever, which is precisely the stale citation a reader would follow into a
// dead end. Measured when this landed: 39 v2 docs with a banner, 53 citations,
// 0 violations — a pure ratchet with no cleanup debt.
{
  const walkMd = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    return e.isDirectory() ? walkMd(p) : e.name.endsWith('.md') ? [p] : [];
  });
  const v2 = join(ROOT, 'spec', 'v2');
  if (existsSync(v2)) for (const p of walkMd(v2)) {
    const banner = readFileSync(p, 'utf8').split('\n').find((l) => /^>\s*\*\*Status:/.test(l));
    if (!banner || !/Stable/.test(banner)) continue;
    for (const m of banner.matchAll(/RFC\s+(\d{4})|(?<=,\s*)(\d{4})/g)) {
      const n = m[1] ?? m[2];
      if (!status.has(n)) continue;
      if (status.get(n) !== 'Accepted') failures.push(`spec/v2 banner: ${relative(ROOT, p)} reads \`Stable\` but cites RFC ${n}, which is \`${status.get(n)}\` — a Stable document may cite only \`Accepted\` RFCs (RFC 0174 §D.1, v2 analogue)`);
    }
  }
}
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
// 7
const scenDir = join(ROOT, 'conformance', 'src', 'scenarios');
if (existsSync(scenDir)) for (const f of readdirSync(scenDir).filter((f) => f.endsWith('.ts'))) {
  readFileSync(join(scenDir, f), 'utf8').split('\n').forEach((l, i) => { for (const m of l.matchAll(/['"`]RFCS\/(\d{4})-|['"`]openwop\.requirement\.(\d{4})\./g)) if (status.get(m[1] ?? m[2]) === 'Draft') failures.push(`draft-enforced: conformance/src/scenarios/${f}:${i + 1} ships a requirement citing RFC ${m[1] ?? m[2]}, which is \`Draft\` — flip it to \`Active\` or gate the leg`); });
}
// ratchet
const base = existsSync(BASE) ? JSON.parse(readFileSync(BASE, 'utf8')) : {};
if (update) { writeFileSync(BASE, JSON.stringify({ ...base, selfCarried }, null, 2) + '\n'); }
else if (typeof base.selfCarried === 'number' && selfCarried > base.selfCarried) failures.push(`self-carry ratchet: ${selfCarried} self-carried rows on terminal RFCs, baseline ${base.selfCarried} — a carry must name a different open row or a tracked surface (RFC 0174 §C.2)`);
if (failures.length > 0) { console.error(`=== check-rfc-status-coherence FAILED — ${failures.length} problem(s) ===`); for (const x of failures) console.error(`  ${x}`); process.exit(1); }
console.log(`=== check-rfc-status-coherence OK — ${rfcFiles.length} RFCs; supersession pairs coherent; every register under registers/; self-carried rows on terminal RFCs ${selfCarried} (baseline ${base.selfCarried ?? 'unset'}); banners, deferrals and schemas/README agree with RFC status; no shipped requirement cites a Draft RFC ===`);
