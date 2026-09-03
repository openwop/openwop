#!/usr/bin/env node
/**
 * check-falsifiability — RFC 0178 §C.1: the RFC 0167 family's falsifiability
 * tables parse, use the closed verdict vocabulary, justify `unwitnessable`,
 * and name scenario files that exist. Advisory (count only) for other RFCs.
 * Exit 0 on success, 1 on any failure.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERDICT = /^(witnessable(?: — (?:unaided|gated|seam-gated))?(?: \([^)]*\))?(?:[^|]*)|seam-gated|claims-check|negative-existence|unwitnessable[^|]*)$/;
const dir = join(ROOT, 'RFCS'); const failures = []; let family = 0, others = 0;
for (const f of readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f) && !f.startsWith('0000'))) {
  const t = readFileSync(join(dir, f), 'utf8'); const rfc = f.slice(0, 4);
  const isFamily = rfc === '0167' || /Part of:\s*RFC 0167/.test(t);
  const sec = t.split(/^### Falsifiability[^\n]*$/m)[1];
  if (!sec) { if (isFamily) failures.push(`RFCS/${f}: RFC 0167 family member with no "### Falsifiability" table`); continue; }
  const rows = sec.split(/^## /m)[0].split('\n').filter((l) => l.startsWith('| ') && !/^\| (Requirement|---)/.test(l));
  if (isFamily) family++; else others++;
  for (const r of rows) {
    const cells = r.split('|').slice(1, -1).map((c) => c.trim()); if (cells.length < 4) { if (isFamily) failures.push(`RFCS/${f}: falsifiability row has ${cells.length} cells: ${r.slice(0, 60)}`); continue; }
    const verdict = cells[3].replace(/\*\*/g, '');
    if (isFamily && !VERDICT.test(verdict)) failures.push(`RFCS/${f}: verdict ${JSON.stringify(verdict)} is not in the closed vocabulary`);
    if (isFamily && /^unwitnessable/.test(verdict) && verdict.length < 20) failures.push(`RFCS/${f}: unwitnessable row does not say why`);
    for (const m of r.matchAll(/`([a-z0-9-]+\.test\.ts)`/g)) if (isFamily && !existsSync(join(ROOT, 'conformance', 'src', 'scenarios', m[1])) && !/planned|Phase 3|suite 2\.0\.0/i.test(r)) failures.push(`RFCS/${f}: names ${m[1]}, which does not exist and is not marked planned`);
  }
}
if (failures.length > 0) { console.error(`=== check-falsifiability FAILED — ${failures.length} problem(s) ===`); for (const x of failures) console.error(`  ${x}`); process.exit(1); }
console.log(`=== check-falsifiability OK — ${family} RFC 0167-family table(s) parse with closed verdicts; ${others} other RFC(s) carry a table (advisory) ===`);
