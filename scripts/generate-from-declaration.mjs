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

// Seeded descriptions are v1 prose and spell operations as `/v1/<op>`. Under
// major 2 a manifest-named operation is addressed by its unversioned key
// (versioning.md §1.2), so those spellings are rewritten at seed time — ONLY
// where `<op>` matches an operation or channel template in
// spec/v2/path-manifest.json. A `/v1/` spelling the manifest does not name
// (host-sample seams, packs-test, workspace files, `spec/v1/*.md` citations)
// is left exactly as written: rewriting it would invent a path no v2 host
// serves. Errata 2026-09-10: `prompts.renderEndpoint` shipped in the v2 schema
// saying "Defaults to `/v1/prompts:render`", and a host advertised exactly that.
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'spec', 'v2', 'path-manifest.json'), 'utf8'));
const MANIFEST_TEMPLATES = [...new Set([...MANIFEST.operations.map((o) => o.path), ...MANIFEST.channels.map((c) => c.address)])]
  .filter((p) => p !== '/.well-known/openwop' && p !== '/openapi.json')
  .sort((a, b) => b.length - a.length)
  .map((t) => new RegExp('^' + t.split('/').slice(1).map((s) => (s.startsWith('{') ? '(?:\\{[A-Za-z]+\\}|[A-Za-z0-9._~-]+)' : s.replace(/[.:]/g, '\\$&'))).join('/') + '(?=$|[^A-Za-z0-9._~{}/-])'));
function unversionManifestSpellings(text) {
  return text.replace(/\/v1\/([^\s"'`)\]>,\\]*)/g, (whole, rest) => (MANIFEST_TEMPLATES.some((re) => re.test(rest)) ? `/${rest}` : whole));
}

function metadataSchema(key) {
  // The v2 shapes of the metadata keys RFC 0169 §A.1a keeps. Anything not
  // decided by a child yet copies the v1 property (seeded).
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
    case 'minClientVersion': return { type: 'string', description: 'RFC 0172 row C5.8 — MUST (426 client_version_unsupported).' };
    case 'configurable': return { $ref: 'configurable.schema.json' };
    case 'conformance': {
      // RFC 0168 §C.1: the seams are a versioned profile a host ADVERTISES; they are never a
      // capability flag. `lib/seams.ts` gates every seam-driven scenario on this exact value,
      // so the key has to exist in the closed root or the profile is unadvertisable.
      const seeded = stripSupported(v1.properties.conformance);
      return { ...seeded, additionalProperties: false, properties: { ...seeded.properties,
        seamsProfile: { const: 'openwop-conformance-seams-v2', description: 'RFC 0168 §C.1 — the host serves the conformance seams profile (api/seams-v2.yaml) at /conformance/seams/…. Absent means the seam-driven scenarios record `blocked`, never a pass.' } },
        'x-openwop-seeded-from': 'v1' };
    }
    case 'observability': {
      // `testSeams` is a test-seam flag in the capability namespace, which
      // spec/v2/core/conformance.md §"The seams profile" forbids: seams are the
      // profile `openwop-conformance-seams-v2` in the /conformance/seams/ path
      // space. It is NOT removed at 2.x — MyndHyve's live v2 discovery document
      // advertises it and the v2 root is additionalProperties:false, so deleting
      // the property breaks a published closed record with no host change.
      // Deprecated here rather than stamped on afterwards by
      // generate-deprecation-annotations.mjs: both write this file, and these are
      // the first discovery-field rows sourced to schemas/v2/, so that ordering
      // had never been exercised and the two generators fought.
      const seeded = stripSupported(v1.properties.observability);
      const ts = seeded.properties?.testSeams;
      return { ...seeded, additionalProperties: false, properties: { ...seeded.properties,
        ...(ts ? { testSeams: { ...ts, deprecated: true, 'x-openwop-remove-in': '3.0' } } : {}) },
        'x-openwop-seeded-from': 'v1' };
    }
    case 'extensions': return { type: 'object', additionalProperties: false, patternProperties: { [decl.extensionsKeyPattern]: { type: 'object', additionalProperties: true, description: 'A vendor/host extension record; its shape is the org\'s, declared as open on purpose (RFC 0169 §A.4).' } }, description: 'RFC 0169 §A.4 — one key for every vendor/host extension, <org>.<name>; reserved orgs: ' + decl.reservedOrgs.join(', ') + '.' };
    default: {
      const p = v1.properties[key];
      if (!p) throw new Error(`metadata key ${key} has no v1 property to seed from`);
      const seeded = stripSupported(p);
      if (seeded.type === 'object' && seeded.additionalProperties === undefined) seeded.additionalProperties = false; // closed until the owning child decides (configurable → C.4's schema in P3-B)
      return { ...seeded, 'x-openwop-seeded-from': 'v1' };
    }
  }
}

// RFC 0192 §B — the `supported` ghost in seeded descriptions.
//
// v2 retired the `supported` flag but the prose came across untouched, so 26
// facet descriptions still condition a MUST on a field the closed schema
// forbids: "Hosts that advertise `supported: true` MUST include ...", "MUST be
// `true` when `supported` is `true`". In v2 those MUSTs can never fire — a MUST
// that cannot fire is a relaxed MUST.
//
// A bulk regex is not safe: the 26 say materially different things — opt-in,
// conditional-required, cross-family reference, and one three-way combinatorial
// explanation (`prompts.endpointsSupported`) that collapses entirely under
// presence-semantics. Each is rewritten by hand, keyed by the exact v1 sentence
// so a changed seed fails loudly rather than silently keeping the old text.
const SUPPORTED_REWRITES = [
  ['Hosts opt into the family via `supported: true` AND explicitly list the events they emit via `events[]`.',
   'Hosts advertise the family by emitting the record AND explicitly list the events they emit via `events[]`.'],
  ['Hosts that advertise `supported: true` MUST include', 'A host advertising this facet MUST include'],
  ['Independent of `supported` — a host MAY advertise `supported: true, endpointsSupported: false`',
   'Independent of the family record — a host MAY advertise the family with `endpointsSupported: false`'],
  ['`supported: false, endpointsSupported: true`', 'the family omitted and `endpointsSupported: true`'],
  ['MUST advertise `supported: true` and at least one entry', 'MUST advertise this facet and at least one entry'],
  ['a host WITH onward hops advertising `supported: true` MUST also propagate',
   'a host WITH onward hops that advertises this facet MUST also propagate'],
  ['MUST advertise this sub-block with `supported: true` and a stable `hostId`',
   'MUST advertise this sub-block with a stable `hostId`'],
  ['MUST advertise this sub-block with `supported: true`.', 'MUST advertise this sub-block.'],
  ['When `supported: true`, the host MAY replace older in-window turns',
   'When this facet is present, the host MAY replace older in-window turns'],
  ['(default when absent and supported:true)', '(the default when absent)'],
  ['When `supported: true`, the host implements RFC 0003 `installAgents`',
   'When this facet is present, the host implements RFC 0003 `installAgents`'],
  ['REQUIRED when `supported: true` per RFC 0012 §A (enforced via the `if/then` clause).',
   'REQUIRED when this facet is present, per RFC 0012 §A (enforced by this facet\'s `required`).'],
  ['Only meaningful when `supported: true`.', 'Only meaningful when the family record is present.'],
  ['MUST be set when `supported: true`.', 'MUST be set when this facet is present.'],
  ['MUST be `true` when `supported` (the `http-client-ssrf-guard` invariant).',
   'MUST be `true` when this facet is present (the `http-client-ssrf-guard` invariant).'],
  ['When `supported: true`, the host\'s `POST', 'When this facet is present, the host\'s `POST'],
  ['MUST be `true` when `supported` is `true` —', 'MUST be `true` when this facet is present —'],
  ['MUST NOT claim `supported: true` while doing so', 'MUST NOT advertise this facet while doing so'],
  // Cross-references to ANOTHER record's retired flag: "X.supported is true"
  // is now simply "X is advertised".
  ['`capabilities.secrets.supported` is also true', 'the `secrets` family is advertised'],
  ['REQUIRED when `injectionBudget.supported` (enforced via the `if/then` clause).', 'REQUIRED when `injectionBudget` is advertised (enforced by that facet\'s `required`).'],
  ['Distinct from `supported` only for hosts', 'Distinct from the family record only for hosts'],
  ['Optional even when crossHostCausation.supported is true', 'Optional even when `crossHostCausation` is advertised'],
  ['WITHOUT `summarization.supported`', 'WITHOUT `summarization`'],
  ['A host advertising `host.agentRuntime: supported` is treated', 'A host advertising `agentRuntime` is treated'],
  ['REQUIRES `agents.manifestRuntime.supported: true`', 'REQUIRES `agents.manifestRuntime`'],
  ['REQUIRES `agents.roster.supported: true`', 'REQUIRES `agents.roster`'],
  ['the host advertises `supported` but gates nothing', 'the host advertises the family but gates nothing'],
  ['Stricter than the existing `capabilities.debugBundle.supported` advertised', 'Stricter than the existing `capabilities.debugBundle` advertised'],
];
const rewriteSupportedProse = (d) => {
  let out = d;
  for (const [from, to] of SUPPORTED_REWRITES) out = out.split(from).join(to);
  return out;
};

function stripSupported(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const out = { ...schema };
  if (typeof out.description === 'string') out.description = rewriteSupportedProse(unversionManifestSpellings(out.description));
  if (out.properties) {
    out.properties = Object.fromEntries(Object.entries(out.properties).filter(([k]) => !['supported', 'tier', 'experimentalUntil'].includes(k)).map(([k, v]) => [k, stripSupported(v)]));
  }
  if (Array.isArray(out.required)) { out.required = out.required.filter((k) => !['supported', 'tier', 'experimentalUntil'].includes(k)); if (!out.required.length) delete out.required; }
  // A conditional is deleted ONLY when it gates on `supported`, the field v2
  // retired. The blanket delete this replaces was written on the premise that
  // every v1 if/then gates on `supported`; half of them do not, and dropping
  // those silently relaxed the schema. The worst was RFC 0132 §B.2 on
  // `anonymousActor` — "writeEgressControls is REQUIRED and non-empty when
  // bounded-write-egress is advertised … a control-less write/egress tier is
  // the fail-open shape this RFC forbids". Proved by construction: before this
  // fix, `{tiers:["bounded-write-egress"]}` with no controls VALIDATED at
  // major 2. A guard whose whole purpose is to forbid a fail-open shape had
  // been deleted by a comment's assumption.
  //
  // Also lost: fs `supported ⇒ sandboxRoot` (path-traversal root),
  // aiProviders `realtimeVoice.synthesis ⇒ speechSynthesis` (RFC 0106 §A),
  // memory.compaction `⇒ trigger`, memory.injectionBudget `⇒ tokenCounter` —
  // the last two still DESCRIBED as "enforced via the if/then clause", naming a
  // clause that was not there.
  const gatesOnSupported = (node) => JSON.stringify(node ?? null).includes('"supported"');
  // RFC 0192 §A — a `supported`-gated conditional is MIGRATED, not dropped.
  // v1 said "if supported:true then these fields are required". Under
  // presence-semantics the antecedent IS the facet being present, so the rule
  // becomes an unconditional `required` on the facet itself. Deleting these
  // silently relaxed memory.compaction ⇒ trigger and memory.injectionBudget ⇒
  // tokenCounter — both of which are still DESCRIBED as "enforced via the
  // if/then clause". Folding restores the obligation and makes the text true.
  const foldSupportedGate = (node) => {
    if (!node || typeof node !== 'object') return;
    const req = node.then?.required;
    if (gatesOnSupported(node.if) && Array.isArray(req)) {
      const add = req.filter((k) => !['supported', 'tier', 'experimentalUntil'].includes(k));
      if (add.length) out.required = [...new Set([...(out.required ?? []), ...add])];
    }
  };
  for (const k of ['allOf', 'anyOf', 'oneOf']) {
    if (!Array.isArray(out[k])) continue;
    for (const c of out[k]) if (gatesOnSupported(c)) foldSupportedGate(c);
    const kept = out[k].filter((c) => !gatesOnSupported(c)).map((c) => stripSupported(c));
    if (kept.length) out[k] = kept; else delete out[k];
  }
  if (gatesOnSupported(out.if)) { foldSupportedGate(out); delete out.if; delete out.then; delete out.else; }
  else { for (const k of ['if', 'then', 'else']) if (out[k]) out[k] = stripSupported(out[k]); }
  if (out.type === 'object' && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}

// RFC 0193 §B — a v1 property carries payload the family record cannot splice
// when it has no `properties` of its own but is not merely a presence flag.
// `boolean` is exempt: presence of the record IS the claim in v2 (RFC 0192), so
// a v1 boolean loses nothing. An open object (`additionalProperties: true`, or
// absent with no properties) is exempt for the same reason — it asserted no shape.
function carriesUnspliceablePayload(p) {
  if (!p || typeof p !== 'object') return false;
  if (p.properties && Object.keys(p.properties).length) return false;
  if (p.type === 'boolean') return false;
  if (Array.isArray(p.enum)) return true;
  if (p.type === 'array') return true;
  if (p.type === 'string' || p.type === 'integer' || p.type === 'number') return true;
  if (p.type === 'object' && p.additionalProperties && typeof p.additionalProperties === 'object') return true;
  return false;
}

function describeShape(p) {
  if (Array.isArray(p.enum)) return `enum[${p.enum.join('|')}]`;
  if (p.type === 'array') return `array<${p.items?.type ?? '?'}>`;
  if (p.type === 'object') return `map<${p.additionalProperties?.type ?? 'object'}>`;
  return String(p.type ?? 'unknown');
}

function familyRecord(f) {
  // A child's hand-decided facet schema (spec/v2/facets/<key>.schema.json)
  // replaces the seeded v1 copy: its `properties` are the facets and its
  // `required` is merged with the record's own.
  const overridePath = join(ROOT, 'spec', 'v2', 'facets', `${f.key}.schema.json`);
  const override = existsSync(overridePath) ? JSON.parse(readFileSync(overridePath, 'utf8')) : null;
  const v1p = v1.properties[f.key] ?? {};
  const facets = override ?? stripSupported(v1p);

  // RFC 0193 §B — the silent payload drop.
  //
  // The record below splices `facets.properties` in as siblings of the uniform
  // four. A v1 family that was an OBJECT therefore kept its payload (`limits`
  // still carries clarificationRounds/schemaRounds/envelopesPerTurn). A v1
  // family that was an ARRAY, a MAP, or an ENUM has no `.properties` at all, so
  // its payload was dropped — silently, with the record still validating and a
  // host still able to advertise it. That is how MyndHyve came to publish
  // `supportedEnvelopes: {status:"stable", since:"1.0", witness:"..."}`: a
  // stable claim to an envelope-kind catalog containing no catalog.
  //
  // The generator cannot invent the seat name — the v1 value was the whole
  // property, so there is nothing to name it after. So it refuses, and the
  // decision is made by hand in spec/v2/facets/<key>.schema.json.
  if (!override && carriesUnspliceablePayload(facets)) {
    throw new Error(
      `generate-from-declaration FAILED — family \`${f.key}\` has a v1 payload the record cannot carry (RFC 0193 §B).\n` +
      `  v1 shape: ${describeShape(facets)}. A v2 capability record is an object, so an array/map/enum value needs a NAMED SEAT,\n` +
      `  and only a person can name it. Add spec/v2/facets/${f.key}.schema.json with the seat, and state in its owning doc what an\n` +
      `  ABSENT seat means — absent MUST NOT be read as "unrestricted" for a catalog that gates a refusal.`);
  }
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
    ...(facets.properties ?? {}),
  };
  return {
    // `facets.required` is the SEEDED family's own required[] (minus `supported`,
    // which stripSupported already removed). Dropping it lost a non-`supported`
    // required field on eight families — anonymousActor.tiers, dataResidency.regions,
    // content.{baseLocale,supportedLocales}, limits.{clarificationRounds,schemaRounds,
    // envelopesPerTurn}, nondeterminismPolicy.declared (a floor predicate),
    // envelopeContracts.advertised, connections.packsSupported, a2a.agentCardUrl.
    type: 'object', additionalProperties: false, required: [...new Set(['status', 'since', 'witness', ...(override?.required ?? facets.required ?? [])])],
    properties: props,
    // The two status/until clauses are INJECTED; the seeded family's own
    // surviving conditionals are carried alongside them. Overwriting `allOf`
    // here is what actually dropped RFC 0132 §B.2 on anonymousActor — even once
    // stripSupported stopped deleting it, this assignment threw it away again.
    allOf: [
      { if: { properties: { status: { const: 'stable' } } }, then: { not: { required: ['until'] } } },
      { if: { properties: { status: { enum: ['experimental', 'deprecated'] } } }, then: { required: ['until'] } },
      ...(override?.allOf ?? facets.allOf ?? []),
      ...(facets.if && !override ? [{ ...(facets.if ? { if: facets.if } : {}), ...(facets.then ? { then: facets.then } : {}), ...(facets.else ? { else: facets.else } : {}) }] : []),
    ],
    description: `${f.section} — witness: ${f.witness}; maturity ${f.maturity.technical}/${f.maturity.adoption}${f.owningRfc ? `; RFC ${f.owningRfc}` : ''}`,
    ...(override ? { 'x-openwop-facets-from': `spec/v2/facets/${f.key}.schema.json` } : { 'x-openwop-seeded-from': v1.properties[f.key] ? 'v1' : 'declaration' }),
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
// RFC 0192 §C — the 27th occurrence cannot appear silently.
//
// The 26 stale descriptions were not a one-time cleanup: the v1 seed is still
// the source, so any newly-seeded family arrives with the same idiom. This
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
