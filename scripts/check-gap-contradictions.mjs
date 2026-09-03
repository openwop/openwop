#!/usr/bin/env node
/**
 * check-gap-contradictions — RFC 0178 §B.3: an OPEN gap that says an artifact
 * does not exist or is deferred, when the artifact exists, fails. Two resolvable
 * classes: conformance scenario files and OpenAPI paths. Anything else is
 * reported as unchecked, never as a pass.
 * Exit 0 on success, 1 on any failure.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const gaps = JSON.parse(readFileSync(join(ROOT, 'spec/v1/gaps.json'), 'utf8')).entries;
const openapi = readFileSync(join(ROOT, 'api/openapi.yaml'), 'utf8');
const failures = []; let checked = 0, unchecked = 0;
const NEG = /(does not exist|no (such )?(test|scenario)|not (yet )?(landed|in `?api\/openapi|declared)|deferred)/i;
for (const g of gaps) {
  if (g.disposition !== 'open') continue;
  const text = `${g.surface} ${g.note ?? ''}`;
  const scen = [...text.matchAll(/`?([a-z0-9-]+\.test\.ts)`?/g)].map((m) => m[1]);
  const paths = [...text.matchAll(/`(\/v1\/[A-Za-z0-9{}\/:._-]+)`/g)].map((m) => m[1]);
  if (scen.length === 0 && paths.length === 0) { unchecked++; continue; }
  checked++;
  if (!NEG.test(text)) continue;
  for (const s of scen) if (existsSync(join(ROOT, 'conformance/src/scenarios', s))) failures.push(`${g.id}: says ${s} is missing/deferred, but conformance/src/scenarios/${s} exists`);
  for (const p of paths) { const key = p.replace(/\{[^}]+\}/g, (x) => x); if (openapi.includes(`  ${key}:`) || openapi.includes(`'${key}':`)) failures.push(`${g.id}: says ${p} is missing/deferred, but api/openapi.yaml declares it`); }
}
if (failures.length > 0) { console.error(`=== check-gap-contradictions FAILED — ${failures.length} problem(s) ===`); for (const x of failures) console.error(`  ${x}`); process.exit(1); }
console.log(`=== check-gap-contradictions OK — ${checked} open gap(s) resolved against scenarios/paths, none contradicted; ${unchecked} open gap(s) name no resolvable artifact (unchecked, not passed) ===`);
