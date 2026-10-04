/**
 * The advertisement-shape witness at major 2. Wave 1: the claims-check AI
 * families `envelopes`, `limits` (the three envelope caps), `modelCapabilities`
 * and `aiProviders`. Wave 2: the record and facet shapes of `selfHostedRunner`,
 * `credentials`, `authorization`, `providerUsage`, `subWorkflow`, `scheduling`,
 * `artifactTypes`, `aiEnvelope`, `deadLetter` and `portability`. Wave 3: the
 * families no host serves at v2 — `dataResidency`, `multiPartyConversation`,
 * `nodePackRuntimes`, `uiPlugins`, `purposePropagation` and `agentRuntime` get
 * facet legs; `conversationTurnModelProvenance`, `channelPresence`,
 * `nondeterminismPolicy`, `promptLibrary` and `envelopeContracts` carry no facet
 * a host-binding v2 rule gives meaning to, so they get the record leg only.
 *
 * A claims-check family is witnessed by what the host says about itself, so
 * every leg here reads the discovery record alone. Each leg checks one facet
 * twice: against `schemas/v2/capabilities.schema.json` (the record seat or the
 * facet's subschema, through `v2RefValidator`) and against the v2 prose rule
 * that gives the facet its meaning. The schema and the prose do not always
 * agree; where they do not, the leg says which one it is enforcing.
 *
 * Not here, on purpose:
 *   - `limits.maxRunDurationMs` / `maxLoopIterations` — `run-bounds-witness.ts`;
 *   - every runtime rule of these families (retry routing, refusal, substitution,
 *     cap enforcement, credential resolution, dispatch, schedule firing, dead-
 *     letter retention, import) — they need a seam or a fixture run;
 *   - `scheduling.maxFutureHorizon` as an ISO-8601 duration: the v2 schema seat
 *     is a plain string and no v2 prose states the format as binding the host;
 *   - a `supported` field on any record: it is not a v2 field
 *     (`capabilities.md` §2). The record-schema leg rejects one as an unknown
 *     key; no leg ever asserts its presence.
 *
 * Every leg is pure: `(profile, discovery) → outcome`. A family the host does
 * not advertise, or a facet it does not carry, is `inapplicable` — never a
 * pass. Proven in both directions in `family-advert-witness.test.ts`.
 */

import type { MajorProfile } from './major-profile.js';
import { v2RefValidator } from './v2.js';

export interface AdvertFinding { readonly ok: boolean; readonly doc: string; readonly message: string }
export type AdvertOutcome =
  | { readonly kind: 'skip'; readonly disposition: 'inapplicable' | 'blocked'; readonly reason: string }
  | { readonly kind: 'observed'; readonly findings: readonly AdvertFinding[] };

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const inapplicable = (reason: string): AdvertOutcome => ({ kind: 'skip', disposition: 'inapplicable', reason });
const observed = (findings: AdvertFinding[]): AdvertOutcome => ({ kind: 'observed', findings });
const SCHEMA = 'schemas/v2/capabilities.schema.json';

/** Validate a value against a pointer into the v2 capabilities schema. */
function bySchema(pointer: string, value: unknown, doc: string, what: string): AdvertFinding {
  const r = v2RefValidator(`capabilities.schema.json#${pointer}`)(value);
  return { ok: r.ok, doc, message: `${what} MUST validate against ${SCHEMA}#${pointer}${r.ok ? '' : ` (${r.errors})`}` };
}

/** One leg: given the family record, judge one facet. */
type Leg = (rec: Record<string, unknown>) => AdvertOutcome;

/** Run a leg against a discovery document, gating on the family record. */
function onFamily(profile: MajorProfile, discovery: unknown, family: string, leg: Leg): AdvertOutcome {
  const rec = profile.family(discovery, family);
  if (rec === null) return inapplicable(`the host does not advertise ${family}`);
  return leg(rec);
}

/** The record as a whole against its seat in the capabilities schema. Catches every v1 shape v2 retired (`supported`, `selfHosted[]`, the per-provider `authModes` map, …). */
export type AdvertFamily =
  | 'envelopes' | 'modelCapabilities' | 'aiProviders'
  | 'selfHostedRunner' | 'credentials' | 'authorization' | 'providerUsage' | 'subWorkflow'
  | 'scheduling' | 'artifactTypes' | 'aiEnvelope' | 'deadLetter' | 'portability'
  | 'dataResidency' | 'conversationTurnModelProvenance' | 'multiPartyConversation' | 'channelPresence'
  | 'nodePackRuntimes' | 'uiPlugins' | 'purposePropagation' | 'nondeterminismPolicy'
  | 'agentRuntime' | 'promptLibrary' | 'envelopeContracts';

export function recordSchemaLeg(profile: MajorProfile, discovery: unknown, family: AdvertFamily, doc: string): AdvertOutcome {
  return onFamily(profile, discovery, family, (rec) => observed([bySchema(`/properties/${family}`, rec, doc, `the ${family} record`)]));
}

// ---------------------------------------------------------------------------
// envelopes — spec/v2/core/events.md §`envelopes`
// ---------------------------------------------------------------------------

const ENV_DOC = 'events.md §envelopes';
const ENV = '/properties/envelopes/properties';

/** `envelopes.reasoning`: an object whose `promptDirective` is one of three values; no `supported` seat at v2. */
export const envelopesReasoningLeg = (p: MajorProfile, d: unknown): AdvertOutcome => onFamily(p, d, 'envelopes', (rec) => {
  const r = rec['reasoning'];
  if (r === undefined) return inapplicable('the host does not advertise envelopes.reasoning (optional)');
  const out = [bySchema(`${ENV}/reasoning`, r, ENV_DOC, 'envelopes.reasoning')];
  if (isRecord(r) && r['promptDirective'] !== undefined) {
    out.push({ ok: ['mandatory', 'advisory', 'off'].includes(String(r['promptDirective'])), doc: ENV_DOC, message: `envelopes.reasoning.promptDirective MUST be mandatory, advisory or off (got ${JSON.stringify(r['promptDirective'])})` });
  }
  return observed(out);
});

/** `envelopes.tierOneSubsetCompliance`: one of strict, warn, off. */
export const envelopesTierOneLeg = (p: MajorProfile, d: unknown): AdvertOutcome => onFamily(p, d, 'envelopes', (rec) => {
  const v = rec['tierOneSubsetCompliance'];
  if (v === undefined) return inapplicable('the host does not advertise envelopes.tierOneSubsetCompliance (optional)');
  return observed([bySchema(`${ENV}/tierOneSubsetCompliance`, v, ENV_DOC, 'envelopes.tierOneSubsetCompliance')]);
});

/** The six reliability events by their v2 names, and the four v1 dotted names v2 accepts as aliases until 3.0 (RFC 0228 §G). */
export const RELIABILITY_EVENTS = ['envelope.retry-attempted', 'envelope.retry-exhausted', 'envelope.refusal', 'envelope.truncated', 'envelope.nl-to-format-engaged', 'envelope.recovery-applied'] as const;
export const RELIABILITY_ALIASES: Readonly<Record<string, string>> = {
  'envelope.retry.attempted': 'envelope.retry-attempted',
  'envelope.retry.exhausted': 'envelope.retry-exhausted',
  'envelope.nlToFormat.engaged': 'envelope.nl-to-format-engaged',
  'envelope.recovery.applied': 'envelope.recovery-applied',
};
/** A listed reliability event by its v2 name: an alias folds to its hyphenated equivalent; anything else is returned unchanged. */
export const canonicalReliabilityEvent = (e: string): string => RELIABILITY_ALIASES[e] ?? e;

/**
 * `envelopes.reliability`: `events[]` names only reliability events (v2 name
 * or v1 alias), and — after folding aliases — includes the two MUST-tier ones;
 * `maxRetryAttempts` is an integer in [1, 16].
 */
export const envelopesReliabilityLeg = (p: MajorProfile, d: unknown): AdvertOutcome => onFamily(p, d, 'envelopes', (rec) => {
  const r = rec['reliability'];
  if (r === undefined) return inapplicable('the host does not advertise envelopes.reliability (optional)');
  const out = [bySchema(`${ENV}/reliability`, r, ENV_DOC, 'envelopes.reliability')];
  const events = isRecord(r) ? r['events'] : undefined;
  if (!Array.isArray(events)) {
    out.push({ ok: false, doc: ENV_DOC, message: `a host advertising envelopes.reliability MUST list the events it emits in reliability.events[] (got ${JSON.stringify(events)})` });
    return observed(out);
  }
  const canonical = new Set(events.filter((e): e is string => typeof e === 'string').map(canonicalReliabilityEvent));
  for (const e of events) {
    const name = typeof e === 'string' ? canonicalReliabilityEvent(e) : undefined;
    out.push({ ok: name !== undefined && (RELIABILITY_EVENTS as readonly string[]).includes(name), doc: ENV_DOC, message: `reliability.events[] MUST name only reliability events, by v2 name or v1 alias (got ${JSON.stringify(e)})` });
  }
  for (const must of ['envelope.retry-exhausted', 'envelope.refusal']) {
    out.push({ ok: canonical.has(must), doc: ENV_DOC, message: `a host advertising envelopes.reliability MUST emit and list ${must} (aliases folded; listed: ${JSON.stringify(events)})` });
  }
  return observed(out);
});

/** `envelopes.reliability.completion`: `distinguishesTruncation` is a boolean; `truncationBudgetMultiplier` a number in [1, 8]. */
export const envelopesCompletionLeg = (p: MajorProfile, d: unknown): AdvertOutcome => onFamily(p, d, 'envelopes', (rec) => {
  const r = rec['reliability'];
  const c = isRecord(r) ? r['completion'] : undefined;
  if (c === undefined) return inapplicable('the host does not advertise envelopes.reliability.completion (optional)');
  const out = [bySchema(`${ENV}/reliability/properties/completion`, c, ENV_DOC, 'envelopes.reliability.completion')];
  const dt = isRecord(c) ? c['distinguishesTruncation'] : undefined;
  out.push({ ok: typeof dt === 'boolean', doc: ENV_DOC, message: `reliability.completion.distinguishesTruncation MUST be a boolean (got ${JSON.stringify(dt)})` });
  return observed(out);
});

// ---------------------------------------------------------------------------
// limits — spec/v2/core/runs.md §Limits: the three envelope caps
// ---------------------------------------------------------------------------

export const ENVELOPE_CAPS = ['clarificationRounds', 'schemaRounds', 'envelopesPerTurn'] as const;
export type EnvelopeCap = (typeof ENVELOPE_CAPS)[number];

/** `limits.<cap>`: present (runs.md: "`limits` always carries" it) and a non-negative integer. */
export const limitsCapLeg = (p: MajorProfile, d: unknown, cap: EnvelopeCap): AdvertOutcome => onFamily(p, d, 'limits', (rec) => {
  const v = rec[cap];
  const doc = 'runs.md §Limits';
  if (v === undefined) return observed([{ ok: false, doc, message: `limits MUST always carry ${cap} (absent)` }]);
  return observed([
    bySchema(`/properties/limits/properties/${cap}`, v, doc, `limits.${cap}`),
    { ok: Number.isInteger(v) && (v as number) >= 0, doc, message: `limits.${cap} MUST be a non-negative integer (got ${JSON.stringify(v)})` },
  ]);
});

// ---------------------------------------------------------------------------
// modelCapabilities — spec/v2/core/host-services.md §modelCapabilities
// ---------------------------------------------------------------------------

/** The spec-reserved identifiers (RFC 0031 §C, RFC 0055), as listed by the schema seat's description. */
export const RESERVED_MODEL_CAPABILITIES = ['structured-output', 'discriminator-enum', 'long-context', 'reasoning', 'function-calling', 'vision-input', 'audio-input', 'audio-output', 'image-output'] as const;
const HOST_PRIVATE = /^x-host-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$/;
const MC_DOC = 'host-services.md §modelCapabilities';

/** `modelCapabilities.advertised`: unique strings, each spec-reserved or prefixed `x-host-<host>-`. */
export const modelCapabilitiesAdvertisedLeg = (p: MajorProfile, d: unknown): AdvertOutcome => onFamily(p, d, 'modelCapabilities', (rec) => {
  const a = rec['advertised'];
  if (a === undefined) return inapplicable('the host does not advertise modelCapabilities.advertised');
  const out = [bySchema('/properties/modelCapabilities/properties/advertised', a, MC_DOC, 'modelCapabilities.advertised')];
  if (Array.isArray(a)) {
    for (const id of a) {
      const s = typeof id === 'string' ? id : '';
      out.push({ ok: (RESERVED_MODEL_CAPABILITIES as readonly string[]).includes(s) || HOST_PRIVATE.test(s), doc: MC_DOC, message: `a modelCapabilities.advertised identifier MUST be spec-reserved (${RESERVED_MODEL_CAPABILITIES.join(', ')}) or host-private, prefixed x-host-<host>- (got ${JSON.stringify(id)})` });
    }
  }
  return observed(out);
});

/** `modelCapabilities.substitutionSupported`: a boolean. */
export const modelCapabilitiesSubstitutionLeg = (p: MajorProfile, d: unknown): AdvertOutcome => onFamily(p, d, 'modelCapabilities', (rec) => {
  const v = rec['substitutionSupported'];
  if (v === undefined) return inapplicable('the host does not advertise modelCapabilities.substitutionSupported (absent means no substitution)');
  return observed([bySchema('/properties/modelCapabilities/properties/substitutionSupported', v, MC_DOC, 'modelCapabilities.substitutionSupported')]);
});

// ---------------------------------------------------------------------------
// aiProviders — spec/v2/core/host-services.md §aiProviders (v1 facets narrowed by C2.11)
// ---------------------------------------------------------------------------

const AP_DOC = 'host-services.md §aiProviders';
const AP = '/properties/aiProviders/properties';

/** The modes `host-services.md` §aiProviders names. The v2 schema seat is `string[]` with no enum; the vocabulary is the prose's. */

/** `aiProviders.selfHosted`: one boolean at v2 (the v1 `selfHosted[]` id list retired, C2.11). */
export const aiProvidersSelfHostedLeg = (p: MajorProfile, d: unknown): AdvertOutcome => onFamily(p, d, 'aiProviders', (rec) => {
  const v = rec['selfHosted'];
  if (v === undefined) return inapplicable('the host does not advertise aiProviders.selfHosted');
  return observed([bySchema(`${AP}/selfHosted`, v, AP_DOC, 'aiProviders.selfHosted (a boolean at v2, not the v1 id list)')]);
});

/** `aiProviders.authModes`: one flat list of modes at v2 (the v1 per-provider map retired, C2.11). */
export const aiProvidersAuthModesShapeLeg = (p: MajorProfile, d: unknown): AdvertOutcome => onFamily(p, d, 'aiProviders', (rec) => {
  const v = rec['authModes'];
  if (v === undefined) return inapplicable('the host does not advertise aiProviders.authModes');
  return observed([bySchema(`${AP}/authModes`, v, AP_DOC, 'aiProviders.authModes (one flat list at v2, not the v1 per-provider map)')]);
});

/** `aiProviders.maxInlineMediaBytes`: an integer ≥ 1. */
export const aiProvidersInlineMediaLeg = (p: MajorProfile, d: unknown): AdvertOutcome => onFamily(p, d, 'aiProviders', (rec) => {
  const v = rec['maxInlineMediaBytes'];
  if (v === undefined) return inapplicable('the host does not advertise aiProviders.maxInlineMediaBytes (default 256 KiB)');
  return observed([bySchema(`${AP}/maxInlineMediaBytes`, v, AP_DOC, 'aiProviders.maxInlineMediaBytes')]);
});

/** `aiProviders.promptPrefixCache`: one boolean at v2 (the v1 `{ supported, providers[] }` object retired, C2.11). */
export const aiProvidersPromptPrefixCacheLeg = (p: MajorProfile, d: unknown): AdvertOutcome => onFamily(p, d, 'aiProviders', (rec) => {
  const v = rec['promptPrefixCache'];
  if (v === undefined) return inapplicable('the host does not advertise aiProviders.promptPrefixCache');
  return observed([bySchema(`${AP}/promptPrefixCache`, v, AP_DOC, 'aiProviders.promptPrefixCache (a boolean at v2, not the v1 object)')]);
});

// ---------------------------------------------------------------------------
// Wave 2. Each facet leg validates the facet against its seat in the v2
// capabilities schema, and adds a prose check only where a v2 core document
// states the rule as binding the host. An absent facet is `inapplicable`.
// ---------------------------------------------------------------------------

/** One optional facet against its schema seat: absent ⇒ inapplicable. */
function facetBySchema(p: MajorProfile, d: unknown, family: AdvertFamily, facet: string, doc: string, what = `${family}.${facet}`): AdvertOutcome {
  return onFamily(p, d, family, (rec) => {
    const v = rec[facet];
    if (v === undefined) return inapplicable(`the host does not advertise ${family}.${facet} (optional)`);
    return observed([bySchema(`/properties/${family}/properties/${facet}`, v, doc, what)]);
  });
}

// selfHostedRunner — spec/v2/core/execution.md §selfHostedRunner

/** `selfHostedRunner.dispatchKinds`: unique members of {model, tool} ("`dispatchKinds` lists `model`, `tool` or both"). */
export const selfHostedRunnerDispatchKindsLeg = (p: MajorProfile, d: unknown): AdvertOutcome =>
  facetBySchema(p, d, 'selfHostedRunner', 'dispatchKinds', 'execution.md §selfHostedRunner', 'selfHostedRunner.dispatchKinds (unique members of model, tool)');

// credentials — spec/v2/core/oauth.md §Credentials

const CRED_DOC = 'oauth.md §Credentials';

/** `credentials.scopes`: unique members of {user, workspace, tenant}; a scope outside it is `credential_scope_unsupported`. */
export const credentialsScopesLeg = (p: MajorProfile, d: unknown): AdvertOutcome =>
  facetBySchema(p, d, 'credentials', 'scopes', CRED_DOC, 'credentials.scopes (a subset of user, workspace, tenant)');

/** `credentials.rotation`: `none` or `two-key-overlap`. */
export const credentialsRotationLeg = (p: MajorProfile, d: unknown): AdvertOutcome =>
  facetBySchema(p, d, 'credentials', 'rotation', CRED_DOC, 'credentials.rotation (none or two-key-overlap)');

// authorization — spec/v2/core/identity.md §2.1

const AUTHZ_DOC = 'identity.md §2.1 (authorization)';

/** `authorization.failClosed`: "MUST be `true` when present" (invariant `authorization-fail-closed`). */
export const authorizationFailClosedLeg = (p: MajorProfile, d: unknown): AdvertOutcome => onFamily(p, d, 'authorization', (rec) => {
  const v = rec['failClosed'];
  if (v === undefined) return inapplicable('the host does not advertise authorization.failClosed (optional)');
  return observed([
    bySchema('/properties/authorization/properties/failClosed', v, AUTHZ_DOC, 'authorization.failClosed'),
    { ok: v === true, doc: AUTHZ_DOC, message: `authorization.failClosed MUST be true when present (got ${JSON.stringify(v)})` },
  ]);
});

/** `authorization.roles`: each entry a non-empty `role` and a unique `scopes[]` of non-empty strings. */
export const authorizationRolesLeg = (p: MajorProfile, d: unknown): AdvertOutcome => onFamily(p, d, 'authorization', (rec) => {
  const v = rec['roles'];
  if (v === undefined) return inapplicable('the host does not advertise authorization.roles (optional)');
  const out = [bySchema('/properties/authorization/properties/roles', v, AUTHZ_DOC, 'authorization.roles')];
  if (Array.isArray(v)) {
    v.forEach((r, i) => out.push(bySchema('/properties/authorization/properties/roles/items', r, AUTHZ_DOC, `authorization.roles[${i}]`)));
  }
  return observed(out);
});

// providerUsage — spec/v2/core/events.md §providerUsage

const PU_DOC = 'events.md §providerUsage';

/** `providerUsage.costEstimates`: one boolean. */
export const providerUsageCostEstimatesLeg = (p: MajorProfile, d: unknown): AdvertOutcome =>
  facetBySchema(p, d, 'providerUsage', 'costEstimates', PU_DOC);

/** `providerUsage.currency`: "the ISO 4217 currency of `costEstimateUsd`" — three upper-case letters. */
export const providerUsageCurrencyLeg = (p: MajorProfile, d: unknown): AdvertOutcome =>
  facetBySchema(p, d, 'providerUsage', 'currency', PU_DOC, 'providerUsage.currency (an ISO 4217 code, ^[A-Z]{3}$)');

// subWorkflow — spec/v2/core/execution.md §subWorkflow

/** `subWorkflow.inputMapping`: one boolean (a host not advertising it refuses a non-empty `inputMapping`). */
export const subWorkflowInputMappingLeg = (p: MajorProfile, d: unknown): AdvertOutcome =>
  facetBySchema(p, d, 'subWorkflow', 'inputMapping', 'execution.md §subWorkflow');

// scheduling — spec/v2/core/host-services.md §scheduling

export const SCHEDULING_FORMS = ['cron', 'delayed', 'calendar'] as const;

/** `scheduling.{cron,delayed,calendar}`: each present form is one boolean. All three absent ⇒ inapplicable. */
export const schedulingFormsLeg = (p: MajorProfile, d: unknown): AdvertOutcome => onFamily(p, d, 'scheduling', (rec) => {
  const present = SCHEDULING_FORMS.filter((f) => rec[f] !== undefined);
  if (present.length === 0) return inapplicable('the host advertises none of scheduling.cron, delayed, calendar');
  return observed(present.map((f) => bySchema(`/properties/scheduling/properties/${f}`, rec[f], 'host-services.md §scheduling', `scheduling.${f}`)));
});

// artifactTypes — spec/v2/core/artifact-type-packs.md §The capability

const AT_DOC = 'artifact-type-packs.md §The capability';

/** `artifactTypes.{store,render,export}`: the global facets — two booleans and a list of export-format ids. */
export const artifactTypesGlobalFacetsLeg = (p: MajorProfile, d: unknown): AdvertOutcome => onFamily(p, d, 'artifactTypes', (rec) => {
  const present = (['store', 'render', 'export'] as const).filter((f) => rec[f] !== undefined);
  if (present.length === 0) return inapplicable('the host advertises none of artifactTypes.store, render, export');
  return observed(present.map((f) => bySchema(`/properties/artifactTypes/properties/${f}`, rec[f], AT_DOC, `artifactTypes.${f}`)));
});

/**
 * `artifactTypes.types`: each per-type entry validates against the entry seat —
 * closed, `validation` open | closed, `schemaVersion` a non-negative integer,
 * `registrationSource` pack | host (artifact-type-packs.md §Registration).
 */
export const artifactTypesPerTypeLeg = (p: MajorProfile, d: unknown): AdvertOutcome => onFamily(p, d, 'artifactTypes', (rec) => {
  const t = rec['types'];
  if (t === undefined) return inapplicable('the host does not advertise artifactTypes.types (optional)');
  if (!isRecord(t)) return observed([bySchema('/properties/artifactTypes/properties/types', t, AT_DOC, 'artifactTypes.types')]);
  const entries = Object.entries(t);
  if (entries.length === 0) return observed([bySchema('/properties/artifactTypes/properties/types', t, AT_DOC, 'artifactTypes.types')]);
  return observed(entries.map(([id, e]) => bySchema('/properties/artifactTypes/properties/types/additionalProperties', e, 'artifact-type-packs.md §Registration', `artifactTypes.types[${JSON.stringify(id)}]`)));
});

// deadLetter — spec/v2/core/runs.md §Dead letters

/** `deadLetter.retentionDays`: an integer ≥ 1 (the failed run stays fork-eligible that long). */
export const deadLetterRetentionDaysLeg = (p: MajorProfile, d: unknown): AdvertOutcome =>
  facetBySchema(p, d, 'deadLetter', 'retentionDays', 'runs.md §Dead letters', 'deadLetter.retentionDays (an integer of at least 1)');

// portability — spec/v2/core/portability.md §The portability record

const PORT_DOC = 'portability.md §The portability record';

/** "A host advertising `import` MUST advertise `dryRun: true`." Read as `import: true` ⇒ `dryRun: true`, as the schema's `allOf` if/then reads it. */
export const portabilityImportDryRunLeg = (p: MajorProfile, d: unknown): AdvertOutcome => onFamily(p, d, 'portability', (rec) => {
  if (rec['import'] !== true) return inapplicable('the host does not advertise portability.import: true');
  return observed([{ ok: rec['dryRun'] === true, doc: PORT_DOC, message: `a host advertising portability.import MUST advertise dryRun: true (got ${JSON.stringify(rec['dryRun'])})` }]);
});

/** `portability.kinds`: unique members of the seven export-bundle item kinds. */
export const portabilityKindsLeg = (p: MajorProfile, d: unknown): AdvertOutcome =>
  facetBySchema(p, d, 'portability', 'kinds', PORT_DOC, 'portability.kinds (unique export-bundle item kinds)');

// ---------------------------------------------------------------------------
// Wave 3 — families no host serves at v2 (architect ruling, 2026-10-04).
// ---------------------------------------------------------------------------

/** `dataResidency.regions`: unique non-empty region codes (runs.md §`dataResidency`). */
export const dataResidencyRegionsLeg = (p: MajorProfile, d: unknown): AdvertOutcome =>
  facetBySchema(p, d, 'dataResidency', 'regions', 'runs.md §dataResidency', 'dataResidency.regions (unique non-empty region codes)');

/** `multiPartyConversation.maxParticipants`: an integer of at least 2 (a council of one is not multi-party). */
export const multiPartyMaxParticipantsLeg = (p: MajorProfile, d: unknown): AdvertOutcome =>
  facetBySchema(p, d, 'multiPartyConversation', 'maxParticipants', 'conversation.md §multiPartyConversation', 'multiPartyConversation.maxParticipants (an integer ≥ 2)');

/** `nodePackRuntimes.wasm`: `abiVersions` unique integers ≥ 1 with at least one entry; `maxMemoryBytes` within 1 MiB – 8 GiB. */
export const nodePackRuntimesWasmLeg = (p: MajorProfile, d: unknown): AdvertOutcome =>
  facetBySchema(p, d, 'nodePackRuntimes', 'wasm', 'node-pack-runtimes.md §WASM', 'nodePackRuntimes.wasm (abiVersions non-empty unique integers ≥ 1; maxMemoryBytes 1 MiB – 8 GiB)');

const UIP_DOC = 'packs.md §Front-end plugin packs';
/** `uiPlugins.isolation`: one of the five mechanisms or an `x-host-<host>-<key>` value — it names the mechanism, never relaxes the property. */
export const uiPluginsIsolationLeg = (p: MajorProfile, d: unknown): AdvertOutcome =>
  facetBySchema(p, d, 'uiPlugins', 'isolation', UIP_DOC, 'uiPlugins.isolation (a closed mechanism or x-host-<host>-<key>)');
/** `uiPlugins.surfaces`: unique members of the closed surface set. */
export const uiPluginsSurfacesLeg = (p: MajorProfile, d: unknown): AdvertOutcome =>
  facetBySchema(p, d, 'uiPlugins', 'surfaces', UIP_DOC, 'uiPlugins.surfaces (unique members of the closed surface set)');
/** `uiPlugins.hostApi`: unique members of the closed `ui-plugin/1` method set. */
export const uiPluginsHostApiLeg = (p: MajorProfile, d: unknown): AdvertOutcome =>
  facetBySchema(p, d, 'uiPlugins', 'hostApi', UIP_DOC, 'uiPlugins.hostApi (unique members of the closed ui-plugin/1 method set)');
/** `uiPlugins.maxEntryBytes`: a positive integer. */
export const uiPluginsMaxEntryBytesLeg = (p: MajorProfile, d: unknown): AdvertOutcome =>
  facetBySchema(p, d, 'uiPlugins', 'maxEntryBytes', UIP_DOC, 'uiPlugins.maxEntryBytes (a positive integer)');

/** `purposePropagation.propagatesOnward`: a boolean (security-defaults.md §Onward hops). */
export const purposePropagatesOnwardLeg = (p: MajorProfile, d: unknown): AdvertOutcome =>
  facetBySchema(p, d, 'purposePropagation', 'propagatesOnward', 'security-defaults.md §Onward hops', 'purposePropagation.propagatesOnward (a boolean)');

/**
 * `agentRuntime` implies `agents.manifestRuntime` (host-services.md §`agentRuntime`:
 * "Advertising it implies `agents.manifestRuntime`, which the host MUST satisfy").
 * The suite reads both from discovery, so this is the one cross-family rule of
 * the wave the host's own claim can falsify.
 */
export const agentRuntimeImpliesManifestRuntimeLeg = (p: MajorProfile, d: unknown): AdvertOutcome => onFamily(p, d, 'agentRuntime', () => {
  const agents = p.family(d, 'agents');
  const ok = agents !== null && isRecord(agents['manifestRuntime']);
  return observed([{ ok, doc: 'host-services.md §agentRuntime', message: `a host advertising agentRuntime MUST also advertise agents.manifestRuntime${ok ? '' : agents === null ? ' (agents is absent)' : ' (agents.manifestRuntime is absent)'}` }]);
});
