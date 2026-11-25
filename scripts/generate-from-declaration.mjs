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
 * Facet shapes come from spec/v2/facets/<key>.schema.json (families) and
 * spec/v2/facets/metadata/<key>.schema.json (kept metadata keys without an
 * inline shape below), edited by hand. Until 2.49.12 the undecided ones were
 * projected from the frozen v1 discovery schema at every run; the RFC 0266 §C
 * cut-over wrote each projection to its v2 file (the generated schema was
 * unchanged but for the provenance marker) and this generator stopped reading
 * any v1 file.
 *
 *   --write   regenerate the three files
 *   --check   fail if any of them differs from what the declaration produces
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DECL = join(ROOT, 'spec', 'v2', 'declaration.json');
const OUT_SCHEMA = join(ROOT, 'schemas', 'v2', 'capabilities.schema.json');
const OUT_PROFILES = join(ROOT, 'spec', 'v2', 'profiles.json');
const OUT_ALIASES = join(ROOT, 'spec', 'v2', 'peer-dependency-aliases.json');
const EVIDENCE = join(ROOT, 'evidence', 'cross-repo-manifests.json');
const VERSION_RE = '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$';

const decl = JSON.parse(readFileSync(DECL, 'utf8'));

function metadataSchema(key) {
  // The v2 shapes of the metadata keys RFC 0169 §A.1a keeps.
  switch (key) {
    case 'signingKeys': return {
      type: 'array',
      description: 'RFC 0168 §E.2 — the public keys this host signs certification bundles with. A bundle signature names a keyId; a verifier resolves it HERE, in the discovery document of the host the bundle is about, and checks the Ed25519 signature with the matching publicKey. Without this array a signature attests integrity only: it proves the bundle was not altered after signing and says nothing about who signed it, because a signer can mint a keypair and a keyId at will. RFC 0168 disposed of "an Ed25519 attestation without a key registry is a signature nobody can check" by naming this surface; this is that surface.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['keyId', 'alg', 'publicKey'],
        properties: {
          keyId: { $ref: 'ids.schema.json#/$defs/keyId', description: 'The identifier a bundle signature carries in signature.keyId. Unique within this array.' },
          alg: { const: 'ed25519', description: 'RFC 0168 §E.2 fixes the attestation algorithm; no other value is defined.' },
          publicKey: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$', description: 'The Ed25519 public key, base64url, unpadded (32 bytes) — the half that verifies, never the half that signs.' },
          use: { enum: ['certification-bundle'], description: 'What the key signs. Closed, so a future use is an explicit addition rather than a reinterpretation of a key already published for something else.' },
          retiredAt: { type: 'string', format: 'date-time', description: 'When the key stopped signing. A retired key stays listed so bundles it already signed remain verifiable; dropping it would silently invalidate historical evidence, which is the opposite of what an evidence trail is for.' },
        },
      },
    };
    case 'protocolVersions': return { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', pattern: VERSION_RE }, description: 'RFC 0172 §A.1 — every <major>.<minor> this host serves.' };
    case 'preferredVersion': return { type: 'string', pattern: VERSION_RE, description: 'RFC 0172 §A.1 / RFC 0179 — the header-less default; MUST be a member of protocolVersions[].' };
    case 'protocolVersion': return { type: 'string', pattern: VERSION_RE, description: 'RFC 0172 §B axis 1 — kept as preferredVersion\'s twin for v1 readers through the overlap; removed after Phase 5.' };
    case 'engineVersion': return { type: 'integer', minimum: 0, description: 'RFC 0172 §B axis 3 — integer everywhere (openwop.codemod.engine-version-unify).' };
    case 'eventLogSchemaVersion': return { type: 'integer', minimum: 2, description: 'RFC 0176 §A.2 — the era key; a v2 host writes 3.' };
    case 'minClientVersion': return { type: 'string', pattern: VERSION_RE, description: 'Optional. The lowest <major>.<minor> client this host serves (versioning.md §1.5). A host MAY refuse a client below it; a refusal MUST be 426 client_version_unsupported.' };
    case 'configurable': return { $ref: 'configurable.schema.json' };
    case 'implementation': return {
      type: 'object', additionalProperties: false,
      description: 'RFC 0208 §G — self-reported server identity; informational (capabilities.md §3.1): a client SHOULD NOT change behaviour because of it or authorize from it.',
      properties: {
        name: { type: 'string' }, version: { type: 'string' }, vendor: { type: 'string' },
        url: { type: 'string', format: 'uri', description: "The operator's site — A2A AgentProvider.url, MCP Implementation.websiteUrl. Informational." },
      },
    };
    case 'extensions': return { type: 'object', additionalProperties: false, patternProperties: { [decl.extensionsKeyPattern]: { type: 'object', additionalProperties: true, description: 'A vendor/host extension record; its shape is the org\'s, declared as open on purpose (RFC 0169 §A.4).' } }, description: 'RFC 0169 §A.4 — one key for every vendor/host extension, <org>.<name>; reserved orgs: ' + decl.reservedOrgs.join(', ') + '.' };
    default: {
      // Every other kept metadata key is hand-edited in spec/v2/facets/metadata/<key>.schema.json
      // (seeded from the frozen v1 discovery schema once, at the RFC 0266 §C cut-over).
      // Its `$comment` is the file's own provenance and is not copied into the root schema.
      const p = join(ROOT, 'spec', 'v2', 'facets', 'metadata', `${key}.schema.json`);
      if (!existsSync(p)) throw new Error(`metadata key ${key} has no schema: add spec/v2/facets/metadata/${key}.schema.json`);
      const { $comment, ...schema } = JSON.parse(readFileSync(p, 'utf8'));
      return schema;
    }
  }
}

function familyRecord(f) {
  // The family's facet schema is hand-edited in spec/v2/facets/<key>.schema.json:
  // its `properties` are the facets, its `required` is merged with the record's
  // own and its `allOf` is carried after the record's two status/until clauses.
  // A family with no file carries the uniform four only. Every family that was
  // seeded from the frozen v1 discovery schema got its file at the RFC 0266 §C
  // cut-over; this generator reads no v1 file.
  const facetsPath = join(ROOT, 'spec', 'v2', 'facets', `${f.key}.schema.json`);
  const facets = existsSync(facetsPath) ? JSON.parse(readFileSync(facetsPath, 'utf8')) : null;
  const props = {
    status: { enum: ['stable', 'experimental', 'deprecated'] },
    since: {
      type: 'string',
      pattern: VERSION_RE,
      description:
        "The minor of THIS HOST's own contract at which it began serving the family — a point on its protocolVersions[] timeline, not the corpus minor that introduced the family. The corpus states no per-family since (spec/v2/declaration.json carries witness and maturity and no since), and `status`/`until` are the host's stability claim absorbed from v1 tier/experimentalUntil, so all three describe the host's offering and `witness` is the record's one corpus-derived field. A since naming a minor absent from protocolVersions[] puts adjacent same-grammar fields on two different timelines and is a defect. Ruled 2026-09-11.",
    },
    until: { type: 'string', pattern: '^((0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)|\\d{4}-\\d{2}-\\d{2})$' },
    witness: { enum: decl.witnessClasses },
    ...(facets?.properties ?? {}),
  };
  return {
    type: 'object', additionalProperties: false, required: [...new Set(['status', 'since', 'witness', ...(facets?.required ?? [])])],
    properties: props,
    allOf: [
      { if: { properties: { status: { const: 'stable' } } }, then: { not: { required: ['until'] } } },
      { if: { properties: { status: { enum: ['experimental', 'deprecated'] } } }, then: { required: ['until'] } },
      ...(facets?.allOf ?? []),
    ],
    description: `${f.section} — witness: ${f.witness}; maturity ${f.maturity.technical}/${f.maturity.adoption}${f.owningRfc ? `; RFC ${f.owningRfc}` : ''}`,
    ...(facets ? { 'x-openwop-facets-from': `spec/v2/facets/${f.key}.schema.json` } : {}),
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
    $comment: 'GENERATED from spec/v2/declaration.json (RFC 0169 §C.1). A profile is a predicate over the declaration: every listed family present as a record (and every listed metadata entry present: a key, or `key.member`). No profiles[] exists at the v2 root.',
    generatedFrom: 'spec/v2/declaration.json',
    profiles: decl.profiles.map((p) => ({ id: p.id, ...(p.summary ? { summary: p.summary } : {}), predicate: p.predicate, floorScenarios: p.floorScenarios ?? [], requirementIds: p.requirementIds ?? [], ...(p.note ? { note: p.note } : {}) })),
  };
}

function buildAliases() {
  const keys = new Set([...decl.families.filter((f) => f.anchor !== 'deleted').map((f) => f.peerDependencyId)]);
  const facetOf = {}; for (const f of decl.families) if (f.facets) for (const x of f.facets) facetOf[`${f.key}.${x}`] = f.key;
  const evidence = existsSync(EVIDENCE) ? JSON.parse(readFileSync(EVIDENCE, 'utf8')) : {};
  const inventory = evidence.registryPeerDependencyKeys ?? {};
  const current = evidence.registryCurrentPeerDependencyKeys ?? null;
  const deletedKeys = new Set(decl.families.filter((f) => f.anchor === 'deleted').map((f) => f.key));
  const rows = [];
  for (const [alias, count] of Object.entries(inventory).sort()) {
    if (keys.has(alias)) continue;
    let family = null, facets;
    if (alias.startsWith('host.') && keys.has(alias.slice(5))) family = alias.slice(5);
    else if (alias.startsWith('openwop.') && keys.has(alias.slice(8).split('.')[0])) { family = alias.slice(8).split('.')[0]; const rest = alias.slice(8).split('.').slice(1); if (rest.length) facets = rest; }
    else if (facetOf[alias]) { family = facetOf[alias]; facets = [alias.split('.').slice(1).join('.')]; }
    else if (alias.startsWith('host.') && facetOf[alias.slice(5)]) { family = facetOf[alias.slice(5)]; facets = [alias.slice(5).split('.').slice(1).join('.')]; }
    else if (decl.aliases?.[alias]) { family = decl.aliases[alias].family; if (decl.aliases[alias].facets) facets = decl.aliases[alias].facets; }
    // RFC 0255 §D — a key naming a family a steward deletion tombstoned stays in the
    // immutable published inventory. It is not an alias; it is unresolved on purpose,
    // and check-declaration fails it only while a pack's current version still needs it.
    const deletedFamily = family ? null : [alias, alias.replace(/^(host|openwop)\./, '')].map((a) => a.split('.')[0]).find((k) => deletedKeys.has(k)) ?? null;
    rows.push({ alias, family, ...(facets ? { facets } : {}), publishedUses: count, removalTrigger: 'v1-end-of-support', ...(deletedFamily ? { deletedFamily, currentUses: current?.[alias] ?? 0 } : family ? {} : { unresolved: true }) });
  }
  return { $comment: 'GENERATED (RFC 0177 §B.2) from the registry peer-dependency key inventory recorded in evidence/cross-repo-manifests.json — never from a sibling checkout. A row with unresolved:true is a key no declaration family or facet explains; check-declaration.mjs fails on it. A row with deletedFamily names a family a steward deletion removed (RFC 0255 §D); it fails only while currentUses, its count among each pack\'s newest non-yanked v2 version, is above 0.', generatedFrom: ['spec/v2/declaration.json', 'evidence/cross-repo-manifests.json#registryPeerDependencyKeys'], rows };
}

const outputs = [[OUT_SCHEMA, buildSchema()], [OUT_PROFILES, buildProfiles()], [OUT_ALIASES, buildAliases()]];
const render = (o) => JSON.stringify(o, null, 2) + '\n';
// RFC 0192 §C — the 27th occurrence cannot appear silently.
//
// The 26 stale descriptions were not a one-time cleanup: a facet file copied or
// written in the v1 idiom arrives with the same `supported` wording. This
// fails the GENERATOR — not a separate checker — because generate-deprecation-
// annotations.mjs also writes this file, and 2.10.0 established that a
// correction applied as a post-pass gets overwritten by whichever generator
// runs last.
function assertNoSupportedGhost(schema) {
  const bad = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) { node.forEach((x) => walk(x, path)); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.description === 'string' && !node.description.startsWith('GENERATED from')
        && /(^|[^A-Za-z0-9])`?supported`?([^A-Za-z0-9]|$)/.test(node.description)) {
      bad.push(`${path || '(root)'}: ${node.description.slice(0, 120)}`);
    }
    for (const [k, v] of Object.entries(node)) walk(v, k === 'properties' ? path : `${path}.${k}`);
  };
  walk(schema, '');
  if (bad.length) {
    console.error(`=== generate-from-declaration FAILED — ${bad.length} description(s) still condition on \`supported\`, a field v2 retired (RFC 0192 §B).\n  A MUST that cannot fire is a relaxed MUST. Add a rewrite to SUPPORTED_REWRITES, or edit the spec/v2/facets/<key>.schema.json override if the text is hand-authored:\n  ${bad.join('\n  ')}`);
    process.exit(1);
  }
}

// Runs on BOTH paths: --write must not emit a ghost, and --check must not
// pass a tree that already contains one.
for (const [p, o] of outputs) if (p.endsWith('capabilities.schema.json')) assertNoSupportedGhost(o);

if (process.argv.includes('--write')) {
  for (const [p, o] of outputs) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, render(o)); console.log(`wrote ${p.replace(ROOT + '/', '')}`); }
} else {
  const stale = outputs.filter(([p, o]) => !existsSync(p) || readFileSync(p, 'utf8') !== render(o)).map(([p]) => p.replace(ROOT + '/', ''));
  if (stale.length) { console.error(`generate-from-declaration: stale — ${stale.join(', ')}. Run: node scripts/generate-from-declaration.mjs --write`); process.exit(1); }
  console.log(`=== generate-from-declaration OK — ${decl.families.filter((f) => f.anchor === 'core').length} core families, ${decl.families.filter((f) => f.anchor === 'ext').length} ext, ${decl.families.filter((f) => f.anchor === 'deleted').length} deleted, ${decl.metadata.filter((m) => m.disposition === 'kept').length} metadata keys; ${buildAliases().rows.length} alias row(s) ===`);
}
