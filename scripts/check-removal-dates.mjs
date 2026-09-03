#!/usr/bin/env node
/**
 * RFC 0178 §A.2 / charter §F "Deprecation" — every alias in deprecations.json
 * has a removal version; no removal has passed with the surface still present.
 *
 * A row is DUE when its removeIn major ≤ the highest protocol major the tree
 * serves (spec/v2/ exists ⇒ 2). A due row's sources must not exist in the tree
 * of that major: a `schemas/v2/...` or `api/v2/...` or `spec/v2/...` source
 * whose token is still present fails. v1 sources are the v1 tree and are
 * removed only at v1 end-of-support (removalTrigger), so they are reported, not
 * failed, while the overlap runs.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reg = JSON.parse(readFileSync(join(ROOT, 'spec', 'v1', 'deprecations.json'), 'utf8'));
const servedMajor = existsSync(join(ROOT, 'spec', 'v2')) ? 2 : 1;
const failures = []; let due = 0, present1 = 0;
for (const e of reg.entries) {
  if (!/^\d+\.\d+$/.test(e.removeIn ?? '')) { failures.push(`${e.id}: no removeIn version`); continue; }
  if (Number(e.removeIn.split('.')[0]) > servedMajor) continue;
  due++;
  for (const s of e.sources ?? []) {
    const p = join(ROOT, s.file); if (!existsSync(p)) continue;
    const present = readFileSync(p, 'utf8').includes(s.token);
    if (!present) continue;
    if (/^(schemas|api|spec)\/v2\//.test(s.file)) failures.push(`${e.id}: removal ${e.removeIn} has passed and ${s.file} still carries \`${s.token}\``);
    else present1++;
  }
}
if (failures.length) { console.error('=== check-removal-dates FAILED ===\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`=== check-removal-dates OK — ${reg.entries.length} rows all carry removeIn; served major ${servedMajor}; ${due} row(s) due, none present in the v2 tree; ${present1} v1-tree source(s) remain through the overlap (removalTrigger governs) ===`);
