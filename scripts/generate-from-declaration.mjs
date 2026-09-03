#!/usr/bin/env node
/**
 * RFC 0169 §B — generate the artifacts that DERIVE from spec/v2/declaration.json.
 *
 *   schemas/v2/capabilities.schema.json  the closed v2 discovery root: every
 *                                        kept metadata key with its schema and
 *                                        every core-anchored family as a
 *                                        capability RECORD ({status, since,
 *                                        until?, witness, ...facets}); the
 *                                        `extensions` key with the <org>.<name>
 *                                        pattern; additionalProperties:false.
 *   spec/v2/profiles.json                the profile predicates (§C.1).
 *   spec/v2/peer-dependency-aliases.json the alias table (RFC 0177 §B.2) from
 *                                        the committed registry key inventory in
 *                                        evidence/cross-repo-manifests.json —
 *                                        never from a sibling checkout.
 *
 * Facet shapes are copied from the v1 capabilities schema property of the same
 * key (minus `supported`, `tier`, `experimentalUntil`) until a child's P3-B hand
 * edit replaces them; the copy is marked `x-openwop-seeded-from: v1` so the
 * closure scan can tell a seeded facet from a decided one.
 *
 *   --write   regenerate the three files
 *   --check   fail if any of them differs from what the declaration produces
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DECL = join(ROOT, 'spec', 'v2', 'declaration.json');
const V1 = join(ROOT, 'schemas', 'capabilities.schema.json');
const OUT_SCHEMA = join(ROOT, 'schemas', 'v2', 'capabilities.schema.json');
const OUT_PROFILES = join(ROOT, 'spec', 'v2', 'profiles.json');
const OUT_ALIASES = join(ROOT, 'spec', 'v2', 'peer-dependency-aliases.json');
const EVIDENCE = join(ROOT, 'evidence', 'cross-repo-manifests.json');
const VERSION_RE = '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$';

const decl = JSON.parse(readFileSync(DECL, 'utf8'));
const v1 = JSON.parse(readFileSync(V1, 'utf8'));

function metadataSchema(key) {
  // The v2 shapes of the metadata keys RFC 0169 §A.1a keeps. Anything not
  // decided by a child yet copies the v1 property (seeded).
  switch (key) {
    case 'protocolVersions': return { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', pattern: VERSION_RE }, description: 'RFC 0172 §A.1 — every <major>.<minor> this host serves.' };
    case 'preferredVersion': return { type: 'string', pattern: VERSION_RE, description: 'RFC 0172 §A.1 / RFC 0179 — the header-less default; MUST be a member of protocolVersions[].' };
    case 'protocolVersion': return { type: 'string', pattern: VERSION_RE, description: 'RFC 0172 §B axis 1 — kept as preferredVersion\'s twin for v1 readers through the overlap; removed after Phase 5.' };
    case 'engineVersion': return { type: 'integer', minimum: 0, description: 'RFC 0172 §B axis 3 — integer everywhere (openwop.codemod.engine-version-unify).' };
    case 'eventLogSchemaVersion': return { type: 'integer', minimum: 2, description: 'RFC 0176 §A.2 — the era key; a v2 host writes 3.' };
    case 'minClientVersion': return { type: 'string', description: 'RFC 0172 row C5.8 — MUST (426 client_version_unsupported).' };
    case 'extensions': return { type: 'object', additionalProperties: false, patternProperties: { [decl.extensionsKeyPattern]: { type: 'object' } }, description: 'RFC 0169 §A.4 — one key for every vendor/host extension, <org>.<name>; reserved orgs: ' + decl.reservedOrgs.join(', ') + '.' };
    default: {
      const p = v1.properties[key];
      if (!p) throw new Error(`metadata key ${key} has no v1 property to seed from`);
      return { ...p, 'x-openwop-seeded-from': 'v1' };
    }
  }
}

function stripSupported(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const out = { ...schema };
  if (out.properties) {
    out.properties = Object.fromEntries(Object.entries(out.properties).filter(([k]) => !['supported', 'tier', 'experimentalUntil'].includes(k)).map(([k, v]) => [k, stripSupported(v)]));
  }
  if (Array.isArray(out.required)) { out.required = out.required.filter((k) => !['supported', 'tier', 'experimentalUntil'].includes(k)); if (!out.required.length) delete out.required; }
  for (const k of ['allOf', 'anyOf', 'oneOf']) if (Array.isArray(out[k])) delete out[k]; // v1 if/then gates on `supported`; re-decided per child
  for (const k of ['if', 'then', 'else']) delete out[k];
  if (out.type === 'object' && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}

function familyRecord(f) {
  const v1p = v1.properties[f.key] ?? {};
  const facets = stripSupported(v1p);
  const props = {
    status: { enum: ['stable', 'experimental', 'deprecated'] },
    since: { type: 'string', pattern: VERSION_RE },
    until: { type: 'string', pattern: '^((0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)|\\d{4}-\\d{2}-\\d{2})$' },
    witness: { enum: decl.witnessClasses },
    ...(facets.properties ?? {}),
  };
  return {
    type: 'object', additionalProperties: false, required: ['status', 'since', 'witness'],
    properties: props,
    allOf: [
      { if: { properties: { status: { const: 'stable' } } }, then: { not: { required: ['until'] } } },
      { if: { properties: { status: { enum: ['experimental', 'deprecated'] } } }, then: { required: ['until'] } },
    ],
    description: `${f.section} — witness: ${f.witness}; maturity ${f.maturity.technical}/${f.maturity.adoption}${f.owningRfc ? `; RFC ${f.owningRfc}` : ''}`,
    'x-openwop-seeded-from': v1.properties[f.key] ? 'v1' : 'declaration',
  };
}

function buildSchema() {
  const properties = {};
  for (const m of decl.metadata) if (m.disposition === 'kept') properties[m.key] = metadataSchema(m.key);
  for (const f of decl.families) if (f.anchor === 'core') properties[f.key] = familyRecord(f);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://openwop.dev/spec/v2/capabilities.schema.json',
    title: 'OpenWOP v2 discovery document (/.well-known/openwop, OpenWOP-Version: 2)',
    description: 'GENERATED from spec/v2/declaration.json by scripts/generate-from-declaration.mjs (RFC 0169 §B.1). Do not edit; edit the declaration. Closed root (§A.4); every family is a capability record (§A.1); no supported field (§A.2); until absorbs tier/experimentalUntil (§A.3).',
    type: 'object', additionalProperties: false,
    required: ['protocolVersions', 'preferredVersion'],
    properties,
  };
}

function buildProfiles() {
  return {
    $comment: 'GENERATED from spec/v2/declaration.json (RFC 0169 §C.1). A profile is a predicate over the declaration: every listed family present as a record (and every listed metadata key present). No profiles[] exists at the v2 root.',
    generatedFrom: 'spec/v2/declaration.json',
    profiles: decl.profiles.map((p) => ({ id: p.id, predicate: p.predicate, floorScenarios: p.floorScenarios ?? [], requirementIds: p.requirementIds ?? [], ...(p.note ? { note: p.note } : {}) })),
  };
}

function buildAliases() {
  const keys = new Set([...decl.families.filter((f) => f.anchor !== 'deleted').map((f) => f.peerDependencyId)]);
  const facetOf = {}; for (const f of decl.families) if (f.facets) for (const x of f.facets) facetOf[`${f.key}.${x}`] = f.key;
  const inventory = existsSync(EVIDENCE) ? (JSON.parse(readFileSync(EVIDENCE, 'utf8')).registryPeerDependencyKeys ?? {}) : {};
  const rows = [];
  for (const [alias, count] of Object.entries(inventory).sort()) {
    if (keys.has(alias)) continue;
    let family = null, facets;
    if (alias.startsWith('host.') && keys.has(alias.slice(5))) family = alias.slice(5);
    else if (alias.startsWith('openwop.') && keys.has(alias.slice(8).split('.')[0])) { family = alias.slice(8).split('.')[0]; const rest = alias.slice(8).split('.').slice(1); if (rest.length) facets = rest; }
    else if (facetOf[alias]) { family = facetOf[alias]; facets = [alias.split('.').slice(1).join('.')]; }
    else if (alias.startsWith('host.') && facetOf[alias.slice(5)]) { family = facetOf[alias.slice(5)]; facets = [alias.slice(5).split('.').slice(1).join('.')]; }
    else if (decl.aliases?.[alias]) { family = decl.aliases[alias].family; if (decl.aliases[alias].facets) facets = decl.aliases[alias].facets; }
    rows.push({ alias, family, ...(facets ? { facets } : {}), publishedUses: count, removalTrigger: 'v1-end-of-support', ...(family ? {} : { unresolved: true }) });
  }
  return { $comment: 'GENERATED (RFC 0177 §B.2) from the registry peer-dependency key inventory recorded in evidence/cross-repo-manifests.json — never from a sibling checkout. A row with unresolved:true is a key no declaration family or facet explains; check-declaration.mjs fails on it.', generatedFrom: ['spec/v2/declaration.json', 'evidence/cross-repo-manifests.json#registryPeerDependencyKeys'], rows };
}

const outputs = [[OUT_SCHEMA, buildSchema()], [OUT_PROFILES, buildProfiles()], [OUT_ALIASES, buildAliases()]];
const render = (o) => JSON.stringify(o, null, 2) + '\n';
if (process.argv.includes('--write')) {
  for (const [p, o] of outputs) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, render(o)); console.log(`wrote ${p.replace(ROOT + '/', '')}`); }
} else {
  const stale = outputs.filter(([p, o]) => !existsSync(p) || readFileSync(p, 'utf8') !== render(o)).map(([p]) => p.replace(ROOT + '/', ''));
  if (stale.length) { console.error(`generate-from-declaration: stale — ${stale.join(', ')}. Run: node scripts/generate-from-declaration.mjs --write`); process.exit(1); }
  console.log(`=== generate-from-declaration OK — ${decl.families.filter((f) => f.anchor === 'core').length} core families, ${decl.families.filter((f) => f.anchor === 'ext').length} ext, ${decl.families.filter((f) => f.anchor === 'deleted').length} deleted, ${decl.metadata.filter((m) => m.disposition === 'kept').length} metadata keys; ${buildAliases().rows.length} alias row(s) ===`);
}
