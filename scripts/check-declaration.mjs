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

if (failures.length) { console.error('=== check-declaration FAILED ===\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`=== check-declaration OK — ${decl.families.length} family rows (${decl.families.filter((f) => f.anchor === 'core').length} core / ${decl.families.filter((f) => f.anchor === 'ext').length} ext / ${decl.families.filter((f) => f.anchor === 'deleted').length} deleted), ${decl.metadata.length} metadata keys, ${decl.profiles.length} profiles; every v1 root key anchored ===`);
