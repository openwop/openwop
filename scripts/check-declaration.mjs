#!/usr/bin/env node
/**
 * RFC 0169 §B.2 — the declaration file is checked AGAINST everything:
 *   1. schema-valid against spec/v2/declaration.schema.json;
 *   2. every v1 root key (schemas/capabilities.schema.json) appears exactly once
 *      as metadata, a family, or a deleted row — no reserved-undefined slot
 *      (§B.3); no key appears twice; peerDependencyId ≡ key;
 *   3. every core family's witness is one of the five wire classes
 *      (`unwitnessable` may not be advertised — RFC 0167 Axiom 1);
 *   4. when spec/v2/core/capabilities.md exists, every `§ <key>` heading names a
 *      declared core family and every core family has a heading;
 *   5. when spec/v2/ext/ exists, every ext family has a directory with a header
 *      that declares `witness:` and both maturity axes;
 *   6. the generated artifacts are current (delegates to the generator --check);
 *   7. every registry peer-dependency key in the committed inventory
 *      (evidence/cross-repo-manifests.json) resolves to a family, a facet, or an
 *      alias row — a key the declaration cannot explain fails (this is the
 *      `pack_peer_dependency_undefined` rule, run against the inventory, not a
 *      sibling checkout);
 *   8. requirement ids are real (conformance/requirements.json) or `planned:`.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const decl = read('spec/v2/declaration.json');
const failures = [];

const require = createRequire(join(ROOT, 'conformance', 'package.json'));
const { Ajv2020 } = require('ajv/dist/2020.js');
const addFormats = require('ajv-formats');
const ajv = new Ajv2020({ allErrors: true, strict: false }); addFormats(ajv);
const validate = ajv.compile(read('spec/v2/declaration.schema.json'));
if (!validate(decl)) failures.push(`schema: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);

const v1keys = Object.keys(read('schemas/capabilities.schema.json').properties);
const seen = new Map();
for (const m of decl.metadata) seen.set(m.key, (seen.get(m.key) ?? 0) + 1);
for (const f of decl.families) seen.set(f.key, (seen.get(f.key) ?? 0) + 1);
for (const k of v1keys) if (!seen.has(k)) failures.push(`v1 root key \`${k}\` has no row — a reserved-undefined slot is unrepresentable under a closed root (RFC 0169 §B.3)`);
for (const [k, n] of seen) if (n > 1) failures.push(`key \`${k}\` appears ${n} times`);
for (const f of decl.families) {
  if (f.anchor === 'deleted') continue;
  if (f.peerDependencyId !== f.key) failures.push(`${f.key}: peerDependencyId must equal the key (RFC 0169 §B.1)`);
  if (!decl.witnessClasses.includes(f.witness)) failures.push(`${f.key}: witness ${f.witness} is not a wire class`);
  if (f.disposition === 'externally-gated' && f.maturity.technical === 'stable') failures.push(`${f.key}: externally-gated MUST NOT be stable (RFC 0169 §C.4)`);
  const expected = f.anchor === 'core' ? `core/capabilities.md#${f.key}` : `ext/${f.key}/`;
  if (f.section !== expected) failures.push(`${f.key}: section ${f.section} ≠ ${expected}`);
}

const capsMd = join(ROOT, 'spec', 'v2', 'core', 'capabilities.md');
if (existsSync(capsMd)) {
  const heads = new Set([...readFileSync(capsMd, 'utf8').matchAll(/^#{2,4}\s+§\s*`?([A-Za-z][A-Za-z0-9]*)`?/gm)].map((m) => m[1]));
  for (const f of decl.families) if (f.anchor === 'core' && !heads.has(f.key)) failures.push(`core/capabilities.md has no § heading for ${f.key}`);
  const core = new Set(decl.families.filter((f) => f.anchor === 'core').map((f) => f.key));
  for (const h of heads) if (!core.has(h)) failures.push(`core/capabilities.md § ${h} names a family the declaration does not anchor in core`);
}
const extDir = join(ROOT, 'spec', 'v2', 'ext');
if (existsSync(extDir)) {
  const dirs = new Set(readdirSync(extDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name));
  for (const f of decl.families) if (f.anchor === 'ext') {
    if (!dirs.has(f.key)) { failures.push(`ext family ${f.key} has no spec/v2/ext/${f.key}/`); continue; }
    const readme = join(extDir, f.key, 'README.md');
    const text = existsSync(readme) ? readFileSync(readme, 'utf8') : '';
    for (const field of ['witness:', 'technical:', 'adoption:']) if (!text.includes(field)) failures.push(`spec/v2/ext/${f.key}/README.md header lacks \`${field}\` (RFC 0169 §C.2)`);
  }
}

try { execFileSync('node', [join(ROOT, 'scripts', 'generate-from-declaration.mjs'), '--check'], { stdio: 'pipe' }); }
catch (e) { failures.push(String(e.stderr ?? e.message).trim()); }

const evidencePath = join(ROOT, 'evidence', 'cross-repo-manifests.json');
if (existsSync(evidencePath)) {
  const inv = read('evidence/cross-repo-manifests.json').registryPeerDependencyKeys ?? {};
  const aliases = existsSync(join(ROOT, 'spec', 'v2', 'peer-dependency-aliases.json')) ? read('spec/v2/peer-dependency-aliases.json').rows : [];
  for (const row of aliases) if (row.unresolved) failures.push(`registry peer-dependency key \`${row.alias}\` (${row.publishedUses} published use(s)) resolves to no family, facet, or alias — pack_peer_dependency_undefined on a v2 host (RFC 0177 §B.1)`);
  if (!Object.keys(inv).length) console.warn('check-declaration: evidence/cross-repo-manifests.json carries no registryPeerDependencyKeys inventory yet — the alias leg is vacuous until generate-cross-repo-evidence.mjs --write runs with the registry checkout');
}

const reqIds = existsSync(join(ROOT, 'conformance', 'requirements.json')) ? new Set((read('conformance/requirements.json').records ?? []).map((r) => r.id)) : new Set();
for (const f of [...decl.families, ...decl.profiles]) for (const id of f.requirementIds ?? []) if (!id.startsWith('planned:') && !reqIds.has(id)) failures.push(`${f.key ?? f.id}: requirement id ${id} is neither planned: nor in conformance/requirements.json`);

// 9. Every profile floor names a scenario file that EXISTS. A floor the CLI
//    silently drops (v2ProfileFloorFiles keeps only files scenario-majors.json
//    knows) is a floor that certifies nothing while the declaration still
//    claims it — the shape that refused a tier-1 host's first production
//    bundle on 2026-09-05. `planned:<stem>` names `v2-<stem>.test.ts`.
for (const p of decl.profiles) {
  for (const entry of p.floorScenarios ?? []) {
    const stem = entry.startsWith('planned:') ? `v2-${entry.slice('planned:'.length)}` : entry.replace(/\.test\.ts$/, '');
    if (!existsSync(join(ROOT, 'conformance', 'src', 'scenarios', `${stem}.test.ts`))) {
      failures.push(`${p.id}: floorScenarios entry \`${entry}\` resolves to conformance/src/scenarios/${stem}.test.ts, which does not exist — a declared floor with no scenario certifies nothing`);
    }
  }
}

// 10. A v2 profile with a non-empty predicate MUST declare a non-empty floor
//     (an empty floor was certifiable on zero evidence until rc.45: the
//     verdict said `certifiable: false`, the emitter's flag ignored the verdict,
//     and `witnessCount` read the v1 hand table and printed 0). And a floor file
//     MUST be witnessable by an honest holder of the predicate: every family
//     gate it records (`openwop.family.<x>`) names a predicate family, and a
//     file driven through a seam sits on the seams floor only. Facet
//     conditionals (`refKinds`, a signed-token mount) leave no mechanical token
//     and are NOT decided here — the check says so rather than print a green
//     that covers them.
// `lib/seams.js` is the seam surface; `lib/era2-seed.js` is the era-2 event-log
// seed, reachable only through the seam (its gate is `seamsProfileAdvertised`).
const SEAM_TOKEN = /seamsProfileAdvertised|SEAMS_PREFIX|lib\/seams\.js|lib\/era2-seed\.js/;
// The seams profile is the INSTRUMENT (RFC 0168 §C.1: its own api/seams-v2.yaml,
// forbidden from the capability namespace), not a capability predicate — a
// host holds it by advertising `conformance.seamsProfile`, and its floor is the
// set of witnesses driven through the seam, each ALSO gated on the family it
// witnesses (a seam that forks a v1 run needs `replay`). So for it the family
// clause inverts: every floor file MUST carry the seam token; the family gates
// are the witnessed family's, not the profile's, and are not checked.
const SEAMS_PROFILE = 'openwop-conformance-seams-v2';
let floorFilesRead = 0;
for (const p of decl.profiles) {
  const families = p.predicate?.families ?? [];
  const metadata = p.predicate?.metadata ?? [];
  const floor = p.floorScenarios ?? [];
  if ((families.length > 0 || metadata.length > 0 || p.id === SEAMS_PROFILE) && floor.length === 0) {
    failures.push(`${p.id}: predicate names ${families.length} family(ies) and ${metadata.length} metadata key(s) but floorScenarios is empty — a profile with no floor certifies on no evidence`);
    continue;
  }
  for (const entry of floor) {
    const stem = entry.startsWith('planned:') ? `v2-${entry.slice('planned:'.length)}` : entry.replace(/\.test\.ts$/, '');
    const file = join(ROOT, 'conformance', 'src', 'scenarios', `${stem}.test.ts`);
    if (!existsSync(file)) continue; // rule 9 already failed it
    const text = readFileSync(file, 'utf8');
    floorFilesRead += 1;
    const seamDriven = SEAM_TOKEN.test(text);
    if (p.id === SEAMS_PROFILE) {
      if (!seamDriven) failures.push(`${p.id}: floor file ${stem} carries no seam token (${SEAM_TOKEN.source}) — the seams floor is the set of seam-driven witnesses, and a file that needs no seam belongs on the floor of the family it witnesses`);
      continue;
    }
    const gated = [...new Set([...text.matchAll(/openwop\.family\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))];
    for (const fam of gated) {
      if (!families.includes(fam)) failures.push(`${p.id}: floor file ${stem} records a gate on family \`${fam}\` (openwop.family.${fam}), which is not in the profile's predicate {${families.join(', ') || '—'}} — an honest holder of the predicate may not advertise it, and a floor it cannot reach is not a floor`);
    }
    if (seamDriven) {
      failures.push(`${p.id}: floor file ${stem} is driven through the conformance seam (${SEAM_TOKEN.source}) — a seam-driven witness belongs on the ${SEAMS_PROFILE} floor only`);
    }
  }
}
// 11. An ABSENT seams advert is `inapplicable`, never `blocked` (rc.62).
//     `blocked` is bundle-wide fatal (RFC 0168 §E.1) and means the suite could
//     not measure an obligation the host TOOK ON. A host that does not
//     advertise `conformance.seamsProfile` has not taken the instrument on, so
//     the honest record is `inapplicable` — the same sense as every other
//     "host does not advertise X" gate (`soft-skip.ts`). The DIFFERENT fact,
//     advert present and the seam answering 404, stays `blocked` and is not
//     matched here: this rule reads only the branch guarded by
//     `!seamsProfileAdvertised(...)`.
//     Until rc.62 fifteen scenarios blocked on the absent advert while the
//     profile's predicate was empty (hence vacuously claimed by every host),
//     which denied certification of EVERY profile to any host that had not
//     mounted the seams — 19 of 45 blocked rows on one production host, 9 of
//     29 on the other, for a profile neither had advertised.
{
  const dir = join(ROOT, 'conformance', 'src', 'scenarios');
  let scanned = 0;
  for (const f of existsSync(dir) ? readdirSync(dir).filter((x) => x.endsWith('.test.ts')) : []) {
    const text = readFileSync(join(dir, f), 'utf8');
    if (!text.includes('!seamsProfileAdvertised')) continue;
    scanned += 1;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].includes('!seamsProfileAdvertised')) continue;
      const window = lines.slice(i, i + 3).join('\n');
      const m = /kind: '(\w+)'|softSkip\('(\w+)'/.exec(window);
      const kind = m?.[1] ?? m?.[2];
      if (kind === 'blocked') {
        failures.push(`${f}: the branch guarded by \`!seamsProfileAdvertised(...)\` records \`blocked\`, but an absent advert means the host never claimed the seams instrument — record \`inapplicable\` with the reason. \`blocked\` is bundle-wide fatal (RFC 0168 §E.1) and belongs to the other fact: advert present, seam answering 404.`);
      }
      break;
    }
  }
  console.log(`check-declaration rule 11: ${scanned} scenario(s) check the seams advert; each records \`inapplicable\` when it is absent.`);
}

console.log(`check-declaration rule 10: ${floorFilesRead} floor file(s) read for family gates and seam tokens; facet conditionals (refKinds, a signed-token mount) are not decided by this rule`);

if (failures.length) { console.error('=== check-declaration FAILED ===\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`=== check-declaration OK — ${decl.families.length} family rows (${decl.families.filter((f) => f.anchor === 'core').length} core / ${decl.families.filter((f) => f.anchor === 'ext').length} ext / ${decl.families.filter((f) => f.anchor === 'deleted').length} deleted), ${decl.metadata.length} metadata keys, ${decl.profiles.length} profiles; every v1 root key anchored ===`);
