/**
 * The advertisement-shape witness at major 2, proven in both directions:
 * a conforming record passes every leg, and each case turns on ONE defect
 * and shows the leg that owns it convicts it. The legs are pure, so the
 * discovery document is the double.
 */

import { describe, expect, it } from 'vitest';
import { majorProfile } from './major-profile.js';
import {
  aiProvidersAuthModesShapeLeg, aiProvidersInlineMediaLeg, aiProvidersPromptPrefixCacheLeg, aiProvidersSelfHostedLeg,
  canonicalReliabilityEvent, envelopesCompletionLeg, envelopesReasoningLeg, envelopesReliabilityLeg, envelopesTierOneLeg, limitsCapLeg,
  modelCapabilitiesAdvertisedLeg, modelCapabilitiesSubstitutionLeg, recordSchemaLeg, type AdvertFamily, type AdvertOutcome,
  artifactTypesGlobalFacetsLeg, artifactTypesPerTypeLeg, authorizationFailClosedLeg, authorizationRolesLeg,
  credentialsRotationLeg, credentialsScopesLeg, deadLetterRetentionDaysLeg, portabilityImportDryRunLeg, portabilityKindsLeg,
  providerUsageCostEstimatesLeg, providerUsageCurrencyLeg, schedulingFormsLeg, selfHostedRunnerDispatchKindsLeg,
  subWorkflowInputMappingLeg,
  agentRuntimeImpliesManifestRuntimeLeg, dataResidencyRegionsLeg, multiPartyMaxParticipantsLeg, nodePackRuntimesWasmLeg,
  purposePropagatesOnwardLeg, uiPluginsHostApiLeg, uiPluginsIsolationLeg, uiPluginsMaxEntryBytesLeg, uiPluginsSurfacesLeg,
} from './family-advert-witness.js';

const V2 = majorProfile(2);
const head = { status: 'stable', since: '2.0', witness: 'claims-check' } as const;
const envelopes = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  envelopes: {
    ...head,
    reasoning: { promptDirective: 'advisory' },
    tierOneSubsetCompliance: 'warn',
    reliability: { events: ['envelope.retry-exhausted', 'envelope.refusal', 'envelope.truncated'], maxRetryAttempts: 2, completion: { distinguishesTruncation: true, truncationBudgetMultiplier: 2 } },
    ...o,
  },
});
const limits = (o: Record<string, unknown> = {}): Record<string, unknown> => ({ limits: { ...head, witness: 'witnessable-gated', clarificationRounds: 3, schemaRounds: 2, envelopesPerTurn: 5, ...o } });
const mc = (o: Record<string, unknown> = {}): Record<string, unknown> => ({ modelCapabilities: { ...head, witness: 'witnessable-gated', advertised: ['structured-output', 'vision-input', 'x-host-acme-long-memory'], substitutionSupported: true, ...o } });
const ap = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  aiProviders: { ...head, witness: 'witnessable-gated', providers: ['anthropic', 'openai'], byok: ['anthropic'], selfHosted: false, authModes: ['apiKey', 'oauth-pkce'], maxInlineMediaBytes: 262144, promptPrefixCache: true, ...o },
});

const failed = (o: AdvertOutcome): string[] => (o.kind === 'observed' ? o.findings.filter((x) => !x.ok).map((x) => x.message) : [`skip:${o.disposition}`]);
const passes = (o: AdvertOutcome): void => { expect(o.kind).toBe('observed'); expect(failed(o)).toEqual([]); };
const fails = (o: AdvertOutcome): void => { expect(o.kind).toBe('observed'); expect(failed(o).length).toBeGreaterThan(0); };
const inapplicable = (o: AdvertOutcome): void => { expect(o).toMatchObject({ kind: 'skip', disposition: 'inapplicable' }); };

describe('family-advert witness: envelopes (events.md §envelopes)', () => {
  it('a conforming record passes every leg', () => {
    const d = envelopes();
    passes(recordSchemaLeg(V2, d, 'envelopes', 'x'));
    passes(envelopesReasoningLeg(V2, d));
    passes(envelopesTierOneLeg(V2, d));
    passes(envelopesReliabilityLeg(V2, d));
    passes(envelopesCompletionLeg(V2, d));
  });

  it('the v1 dotted names are accepted as aliases until 3.0, and fold to the v2 MUST-tier names', () => {
    const d = envelopes({ reliability: { events: ['envelope.retry.attempted', 'envelope.retry.exhausted', 'envelope.refusal', 'envelope.nlToFormat.engaged', 'envelope.recovery.applied'] } });
    passes(recordSchemaLeg(V2, d, 'envelopes', 'x'));
    passes(envelopesReliabilityLeg(V2, d));
    expect(canonicalReliabilityEvent('envelope.retry.exhausted')).toBe('envelope.retry-exhausted');
  });

  it.each<[string, Record<string, unknown>, (d: unknown) => AdvertOutcome]>([
    ['a v1 `supported` seat on the record', { supported: true }, (d) => recordSchemaLeg(V2, d, 'envelopes', 'x')],
    ['a v1 `reasoning.supported` seat', { reasoning: { supported: true, promptDirective: 'advisory' } }, (d) => envelopesReasoningLeg(V2, d)],
    ['an unknown promptDirective', { reasoning: { promptDirective: 'always' } }, (d) => envelopesReasoningLeg(V2, d)],
    ['an unknown tierOneSubsetCompliance', { tierOneSubsetCompliance: 'lenient' }, (d) => envelopesTierOneLeg(V2, d)],
    ['reliability without envelope.refusal', { reliability: { events: ['envelope.retry-exhausted'] } }, (d) => envelopesReliabilityLeg(V2, d)],
    ['reliability without retry-exhausted (either spelling)', { reliability: { events: ['envelope.refusal', 'envelope.retry-attempted'] } }, (d) => envelopesReliabilityLeg(V2, d)],
    ['a non-reliability event listed', { reliability: { events: ['envelope.retry-exhausted', 'envelope.refusal', 'envelope.refused'] } }, (d) => envelopesReliabilityLeg(V2, d)],
    ['reliability with no events[]', { reliability: { maxRetryAttempts: 2 } }, (d) => envelopesReliabilityLeg(V2, d)],
    ['maxRetryAttempts out of range', { reliability: { events: ['envelope.retry-exhausted', 'envelope.refusal'], maxRetryAttempts: 17 } }, (d) => envelopesReliabilityLeg(V2, d)],
    ['a string distinguishesTruncation', { reliability: { events: ['envelope.retry-exhausted', 'envelope.refusal'], completion: { distinguishesTruncation: 'yes' } } }, (d) => envelopesCompletionLeg(V2, d)],
    ['a completion block without distinguishesTruncation', { reliability: { events: ['envelope.retry-exhausted', 'envelope.refusal'], completion: { truncationBudgetMultiplier: 2 } } }, (d) => envelopesCompletionLeg(V2, d)],
    ['a truncationBudgetMultiplier above 8', { reliability: { events: ['envelope.retry-exhausted', 'envelope.refusal'], completion: { distinguishesTruncation: true, truncationBudgetMultiplier: 9 } } }, (d) => envelopesCompletionLeg(V2, d)],
  ])('defect: %s fails its leg', (_what, over, leg) => {
    fails(leg(envelopes(over)));
  });

  it('an absent family or facet is inapplicable, never a pass', () => {
    inapplicable(recordSchemaLeg(V2, {}, 'envelopes', 'x'));
    inapplicable(envelopesReasoningLeg(V2, { envelopes: { ...head } }));
    inapplicable(envelopesTierOneLeg(V2, { envelopes: { ...head } }));
    inapplicable(envelopesReliabilityLeg(V2, { envelopes: { ...head } }));
    inapplicable(envelopesCompletionLeg(V2, { envelopes: { ...head, reliability: { events: ['envelope.retry-exhausted', 'envelope.refusal'] } } }));
  });
});

describe('family-advert witness: limits envelope caps (runs.md §Limits)', () => {
  const caps = ['clarificationRounds', 'schemaRounds', 'envelopesPerTurn'] as const;

  it('conforming caps pass; zero is a valid cap', () => {
    for (const c of caps) passes(limitsCapLeg(V2, limits(), c));
    for (const c of caps) passes(limitsCapLeg(V2, limits({ [c]: 0 }), c));
  });

  it.each(caps)('defect: %s absent, negative, fractional or a string fails', (c) => {
    const { [c]: _gone, ...rest } = (limits()['limits'] as Record<string, unknown>);
    fails(limitsCapLeg(V2, { limits: rest }, c));
    fails(limitsCapLeg(V2, limits({ [c]: -1 }), c));
    fails(limitsCapLeg(V2, limits({ [c]: 1.5 }), c));
    fails(limitsCapLeg(V2, limits({ [c]: '3' }), c));
  });

  it('a host that does not advertise limits is inapplicable', () => {
    inapplicable(limitsCapLeg(V2, {}, 'schemaRounds'));
  });
});

describe('family-advert witness: modelCapabilities (host-services.md §modelCapabilities)', () => {
  it('a conforming record passes every leg', () => {
    passes(recordSchemaLeg(V2, mc(), 'modelCapabilities', 'x'));
    passes(modelCapabilitiesAdvertisedLeg(V2, mc()));
    passes(modelCapabilitiesSubstitutionLeg(V2, mc()));
  });

  it.each<[string, Record<string, unknown>, (d: unknown) => AdvertOutcome]>([
    ['a v1 `supported` seat', { supported: true }, (d) => recordSchemaLeg(V2, d, 'modelCapabilities', 'x')],
    ['a host-private identifier without the x-host- prefix', { advertised: ['structured-output', 'long-memory'] }, (d) => modelCapabilitiesAdvertisedLeg(V2, d)],
    ['a non-string identifier', { advertised: ['structured-output', 7] }, (d) => modelCapabilitiesAdvertisedLeg(V2, d)],
    ['a duplicated identifier', { advertised: ['reasoning', 'reasoning'] }, (d) => modelCapabilitiesAdvertisedLeg(V2, d)],
    ['a string substitutionSupported', { substitutionSupported: 'true' }, (d) => modelCapabilitiesSubstitutionLeg(V2, d)],
  ])('defect: %s fails its leg', (_what, over, leg) => {
    fails(leg(mc(over)));
  });

  it('an absent family or facet is inapplicable', () => {
    inapplicable(modelCapabilitiesAdvertisedLeg(V2, {}));
    inapplicable(modelCapabilitiesSubstitutionLeg(V2, { modelCapabilities: { ...head, witness: 'witnessable-gated' } }));
  });
});

describe('family-advert witness: aiProviders (host-services.md §aiProviders)', () => {
  it('a conforming record passes every leg', () => {
    passes(recordSchemaLeg(V2, ap(), 'aiProviders', 'x'));
    passes(aiProvidersSelfHostedLeg(V2, ap()));
    passes(aiProvidersAuthModesShapeLeg(V2, ap()));
    passes(aiProvidersInlineMediaLeg(V2, ap()));
    passes(aiProvidersPromptPrefixCacheLeg(V2, ap()));
  });

  it.each<[string, Record<string, unknown>, (d: unknown) => AdvertOutcome]>([
    ['the v1 selfHosted[] id list', { selfHosted: ['compat:local'] }, (d) => aiProvidersSelfHostedLeg(V2, d)],
    ['the v1 per-provider authModes map', { authModes: { anthropic: ['apiKey'] } }, (d) => aiProvidersAuthModesShapeLeg(V2, d)],
    ['a zero maxInlineMediaBytes', { maxInlineMediaBytes: 0 }, (d) => aiProvidersInlineMediaLeg(V2, d)],
    ['a fractional maxInlineMediaBytes', { maxInlineMediaBytes: 1.5 }, (d) => aiProvidersInlineMediaLeg(V2, d)],
    ['the v1 promptPrefixCache object', { promptPrefixCache: { supported: true, providers: ['anthropic'] } }, (d) => aiProvidersPromptPrefixCacheLeg(V2, d)],
    ['a v1 `supported` seat on the record', { supported: ['anthropic'] }, (d) => recordSchemaLeg(V2, d, 'aiProviders', 'x')],
  ])('defect: %s fails its leg', (_what, over, leg) => {
    fails(leg(ap(over)));
  });

  it('an absent family or facet is inapplicable; a map-shaped authModes is left to the shape leg', () => {
    inapplicable(aiProvidersSelfHostedLeg(V2, {}));
    const bare = { aiProviders: { ...head, witness: 'witnessable-gated', providers: [] } };
    inapplicable(aiProvidersSelfHostedLeg(V2, bare));
    inapplicable(aiProvidersAuthModesShapeLeg(V2, bare));
    inapplicable(aiProvidersInlineMediaLeg(V2, bare));
    inapplicable(aiProvidersPromptPrefixCacheLeg(V2, bare));
  });
});

// ---------------------------------------------------------------------------
// Wave 2 — record and facet shapes. One conforming record per family passes
// every leg; each defect case changes ONE facet and fails only the leg that
// owns it (the other legs of that family still pass).
// ---------------------------------------------------------------------------

const exp = { status: 'experimental', since: '2.0', until: '2099-01-01', witness: 'witnessable-gated' } as const;
const CONFORMING: Readonly<Record<string, Record<string, unknown>>> = {
  selfHostedRunner: { ...exp, dispatchKinds: ['model', 'tool'] },
  credentials: { ...exp, scopes: ['user', 'workspace'], encryptionAtRest: true, rotation: 'two-key-overlap', sharing: true },
  authorization: { ...exp, failClosed: true, roles: [{ role: 'owner', scopes: ['admin:*'] }, { role: 'viewer', scopes: ['runs:read'] }] },
  providerUsage: { ...exp, costEstimates: true, currency: 'EUR' },
  subWorkflow: { ...exp, witness: 'claims-check', inputMapping: true },
  scheduling: { ...exp, cron: true, delayed: true, calendar: false, maxFutureHorizon: 'P90D' },
  artifactTypes: { ...exp, store: true, render: false, export: ['pdf'], types: { 'vendor.acme.prd': { validated: true, validation: 'open', schemaVersion: 1, registrationSource: 'host' } } },
  aiEnvelope: { ...exp, await: true },
  deadLetter: { ...exp, retentionDays: 7 },
  portability: { ...exp, export: true, import: true, kinds: ['agent', 'pack'], dryRun: true },
};
const doc2 = (family: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({ [family]: { ...CONFORMING[family], ...over } });

type LegFn = (p: typeof V2, d: unknown) => AdvertOutcome;
const LEGS: Readonly<Record<string, Readonly<Record<string, LegFn>>>> = {
  selfHostedRunner: { dispatchKinds: selfHostedRunnerDispatchKindsLeg },
  credentials: { scopes: credentialsScopesLeg, rotation: credentialsRotationLeg },
  authorization: { failClosed: authorizationFailClosedLeg, roles: authorizationRolesLeg },
  providerUsage: { costEstimates: providerUsageCostEstimatesLeg, currency: providerUsageCurrencyLeg },
  subWorkflow: { inputMapping: subWorkflowInputMappingLeg },
  scheduling: { forms: schedulingFormsLeg },
  artifactTypes: { global: artifactTypesGlobalFacetsLeg, perType: artifactTypesPerTypeLeg },
  aiEnvelope: {},
  deadLetter: { retentionDays: deadLetterRetentionDaysLeg },
  portability: { importDryRun: portabilityImportDryRunLeg, kinds: portabilityKindsLeg },
};

describe('family-advert witness wave 2: conforming records', () => {
  it.each(Object.keys(CONFORMING))('%s: the record and every facet leg pass', (family) => {
    const d = doc2(family);
    passes(recordSchemaLeg(V2, d, family as AdvertFamily, 'x'));
    for (const leg of Object.values(LEGS[family] ?? {})) passes(leg(V2, d));
  });

  it.each(Object.keys(CONFORMING))('%s: an unadvertised family is inapplicable on every leg', (family) => {
    inapplicable(recordSchemaLeg(V2, {}, family as AdvertFamily, 'x'));
    for (const leg of Object.values(LEGS[family] ?? {})) inapplicable(leg(V2, {}));
  });

  it.each(Object.keys(CONFORMING))('%s: a v1 `supported` seat fails the record leg (capabilities.md §2)', (family) => {
    fails(recordSchemaLeg(V2, doc2(family, { supported: true }), family as AdvertFamily, 'x'));
  });
});

describe('family-advert witness wave 2: each defect fails only its own leg', () => {
  it.each<[string, string, string, Record<string, unknown>]>([
    ['selfHostedRunner', 'dispatchKinds', 'an unknown dispatch kind', { dispatchKinds: ['model', 'agent'] }],
    ['selfHostedRunner', 'dispatchKinds', 'a duplicated dispatch kind', { dispatchKinds: ['tool', 'tool'] }],
    ['selfHostedRunner', 'dispatchKinds', 'a scalar dispatchKinds', { dispatchKinds: 'model' }],
    ['credentials', 'scopes', 'a scope outside user/workspace/tenant', { scopes: ['user', 'org'] }],
    ['credentials', 'scopes', 'a duplicated scope', { scopes: ['user', 'user'] }],
    ['credentials', 'rotation', 'an unknown rotation mode', { rotation: 'rolling' }],
    ['authorization', 'failClosed', 'failClosed: false', { failClosed: false }],
    ['authorization', 'failClosed', 'a string failClosed', { failClosed: 'true' }],
    ['authorization', 'roles', 'a role entry with no scopes', { roles: [{ role: 'owner' }] }],
    ['authorization', 'roles', 'an empty role name', { roles: [{ role: '', scopes: ['runs:read'] }] }],
    ['authorization', 'roles', 'an unknown key on a role entry', { roles: [{ role: 'owner', scopes: [], grants: ['*'] }] }],
    ['providerUsage', 'costEstimates', 'a string costEstimates', { costEstimates: 'yes' }],
    ['providerUsage', 'currency', 'a lower-case currency', { currency: 'usd' }],
    ['providerUsage', 'currency', 'a currency symbol', { currency: '$' }],
    ['subWorkflow', 'inputMapping', 'a string inputMapping', { inputMapping: 'true' }],
    ['scheduling', 'forms', 'a string cron', { cron: 'yes' }],
    ['scheduling', 'forms', 'a calendar object', { calendar: { supported: true } }],
    ['artifactTypes', 'global', 'a string store', { store: 'true' }],
    ['artifactTypes', 'global', 'a non-string export id', { export: ['pdf', 3] }],
    ['artifactTypes', 'perType', 'an unknown registrationSource', { types: { 'vendor.acme.prd': { registrationSource: 'vendor' } } }],
    ['artifactTypes', 'perType', 'an unknown validation mode', { types: { 'vendor.acme.prd': { validation: 'strict' } } }],
    ['artifactTypes', 'perType', 'a negative schemaVersion', { types: { 'vendor.acme.prd': { schemaVersion: -1 } } }],
    ['artifactTypes', 'perType', 'an unknown key on a per-type entry', { types: { 'vendor.acme.prd': { supported: true } } }],
    ['deadLetter', 'retentionDays', 'retentionDays 0', { retentionDays: 0 }],
    ['deadLetter', 'retentionDays', 'a fractional retentionDays', { retentionDays: 1.5 }],
    ['deadLetter', 'retentionDays', 'a string retentionDays', { retentionDays: '7' }],
    ['portability', 'importDryRun', 'import: true with dryRun: false', { dryRun: false }],
    ['portability', 'importDryRun', 'import: true with dryRun absent', { dryRun: undefined }],
    ['portability', 'kinds', 'an unknown kind', { kinds: ['agent', 'workflow'] }],
  ])('%s.%s: %s', (family, owner, _what, over) => {
    const d = doc2(family, over);
    for (const [name, leg] of Object.entries(LEGS[family] ?? {})) {
      if (name === owner) fails(leg(V2, d));
      else passes(leg(V2, d));
    }
    fails(recordSchemaLeg(V2, d, family as AdvertFamily, 'x'));
  });

  it('aiEnvelope: a non-boolean await fails the record leg', () => {
    fails(recordSchemaLeg(V2, doc2('aiEnvelope', { await: 'yes' }), 'aiEnvelope', 'x'));
  });

  it('the record leg convicts the record header too: experimental without until, stable with until', () => {
    fails(recordSchemaLeg(V2, doc2('deadLetter', { until: undefined }), 'deadLetter', 'x'));
    fails(recordSchemaLeg(V2, doc2('deadLetter', { status: 'stable' }), 'deadLetter', 'x'));
  });
});

describe('family-advert witness wave 2: absent facets are inapplicable, never a pass', () => {
  it.each(Object.entries(LEGS).flatMap(([family, legs]) => Object.entries(legs).map(([name, leg]) => [family, name, leg] as const)))('%s.%s', (family, _name, leg) => {
    inapplicable(leg(V2, { [family]: { ...exp } }));
  });

  it('portability: import false or absent leaves the dryRun rule inapplicable, whatever dryRun says', () => {
    inapplicable(portabilityImportDryRunLeg(V2, doc2('portability', { import: false, dryRun: false })));
    inapplicable(portabilityImportDryRunLeg(V2, doc2('portability', { import: undefined, dryRun: undefined })));
  });

  it('scheduling: a single advertised form is enough to observe', () => {
    passes(schedulingFormsLeg(V2, { scheduling: { ...exp, cron: true } }));
  });
});

// ---------------------------------------------------------------------------
// Wave 3 — the families no host serves at v2. Same shape as wave 2.
// ---------------------------------------------------------------------------

const CONFORMING3: Readonly<Record<string, Record<string, unknown>>> = {
  dataResidency: { ...exp, regions: ['eu-west', 'us-east'] },
  conversationTurnModelProvenance: { ...exp },
  multiPartyConversation: { ...exp, maxParticipants: 5 },
  channelPresence: { ...exp },
  nodePackRuntimes: { ...exp, wasm: { abiVersions: [1], maxMemoryBytes: 67108864 } },
  uiPlugins: { ...exp, isolation: 'cross-origin-iframe', surfaces: ['artifact-viewer', 'route'], hostApi: ['artifact.read', 'host.toast'], maxEntryBytes: 524288 },
  purposePropagation: { ...exp, propagatesOnward: true },
  nondeterminismPolicy: { ...exp, declared: true },
  promptLibrary: { ...exp, witness: 'claims-check' },
  envelopeContracts: { ...exp, witness: 'claims-check', advertised: true },
};
const doc3 = (family: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({ [family]: { ...CONFORMING3[family], ...over } });
const LEGS3: Readonly<Record<string, Readonly<Record<string, LegFn>>>> = {
  dataResidency: { regions: dataResidencyRegionsLeg },
  multiPartyConversation: { maxParticipants: multiPartyMaxParticipantsLeg },
  nodePackRuntimes: { wasm: nodePackRuntimesWasmLeg },
  uiPlugins: { isolation: uiPluginsIsolationLeg, surfaces: uiPluginsSurfacesLeg, hostApi: uiPluginsHostApiLeg, maxEntryBytes: uiPluginsMaxEntryBytesLeg },
  purposePropagation: { propagatesOnward: purposePropagatesOnwardLeg },
};

describe('family-advert witness wave 3: conforming records', () => {
  it.each(Object.keys(CONFORMING3))('%s: the record and every facet leg pass', (family) => {
    const d = doc3(family);
    passes(recordSchemaLeg(V2, d, family as AdvertFamily, 'x'));
    for (const leg of Object.values(LEGS3[family] ?? {})) passes(leg(V2, d));
  });

  it.each(Object.keys(CONFORMING3))('%s: an unadvertised family is inapplicable on every leg', (family) => {
    inapplicable(recordSchemaLeg(V2, {}, family as AdvertFamily, 'x'));
    for (const leg of Object.values(LEGS3[family] ?? {})) inapplicable(leg(V2, {}));
  });

  it.each(Object.keys(CONFORMING3))('%s: a v1 `supported` seat fails the record leg (capabilities.md §2)', (family) => {
    fails(recordSchemaLeg(V2, doc3(family, { supported: true }), family as AdvertFamily, 'x'));
  });
});

describe('family-advert witness wave 3: each defect fails only its own leg', () => {
  it.each<[string, string, string, Record<string, unknown>]>([
    ['dataResidency', 'regions', 'a duplicated region', { regions: ['eu-west', 'eu-west'] }],
    ['dataResidency', 'regions', 'an empty region code', { regions: [''] }],
    ['multiPartyConversation', 'maxParticipants', 'a council of one', { maxParticipants: 1 }],
    ['multiPartyConversation', 'maxParticipants', 'a fractional cap', { maxParticipants: 2.5 }],
    ['nodePackRuntimes', 'wasm', 'an empty abiVersions', { wasm: { abiVersions: [] } }],
    ['nodePackRuntimes', 'wasm', 'ABI version 0', { wasm: { abiVersions: [0] } }],
    ['nodePackRuntimes', 'wasm', 'a memory cap under 1 MiB', { wasm: { abiVersions: [1], maxMemoryBytes: 1024 } }],
    ['uiPlugins', 'isolation', 'same-origin isolation', { isolation: 'same-origin' }],
    ['uiPlugins', 'isolation', 'a malformed x-host value', { isolation: 'x-host-acme' }],
    ['uiPlugins', 'surfaces', 'an unknown surface', { surfaces: ['sidebar'] }],
    ['uiPlugins', 'hostApi', 'a method outside ui-plugin/1', { hostApi: ['host.eval'] }],
    ['uiPlugins', 'maxEntryBytes', 'maxEntryBytes 0', { maxEntryBytes: 0 }],
    ['purposePropagation', 'propagatesOnward', 'a string propagatesOnward', { propagatesOnward: 'yes' }],
  ])('%s.%s: %s', (family, owner, _what, over) => {
    const d = doc3(family, over);
    for (const [name, leg] of Object.entries(LEGS3[family] ?? {})) {
      if (name === owner) fails(leg(V2, d));
      else passes(leg(V2, d));
    }
    fails(recordSchemaLeg(V2, d, family as AdvertFamily, 'x'));
  });

  it.each<[string, Record<string, unknown>]>([
    ['nondeterminismPolicy', { declared: 'yes' }],
    ['nondeterminismPolicy', { declared: undefined }],
    ['envelopeContracts', { advertised: undefined }],
    ['conversationTurnModelProvenance', { maxParticipants: 3 }],
    ['channelPresence', { persisted: false }],
    ['promptLibrary', { pinned: true }],
  ])('%s: a record-only family fails the record leg on %j', (family, over) => {
    fails(recordSchemaLeg(V2, doc3(family, over), family as AdvertFamily, 'x'));
  });
});

describe('family-advert witness wave 3: absent facets are inapplicable, never a pass', () => {
  it.each(Object.entries(LEGS3).flatMap(([family, legs]) => Object.entries(legs).map(([name, leg]) => [family, name, leg] as const)))('%s.%s', (family, _name, leg) => {
    inapplicable(leg(V2, { [family]: { ...exp } }));
  });
});

describe('family-advert witness wave 3: agentRuntime implies agents.manifestRuntime (host-services.md §agentRuntime)', () => {
  const agentRuntime = { ...exp, witness: 'claims-check' };
  it('passes when agents.manifestRuntime is advertised', () => {
    passes(agentRuntimeImpliesManifestRuntimeLeg(V2, { agentRuntime, agents: { ...exp, manifestRuntime: { installScope: 'workspace' } } }));
    passes(recordSchemaLeg(V2, { agentRuntime }, 'agentRuntime', 'x'));
  });
  it('fails when agents is absent, or carries no manifestRuntime', () => {
    fails(agentRuntimeImpliesManifestRuntimeLeg(V2, { agentRuntime }));
    fails(agentRuntimeImpliesManifestRuntimeLeg(V2, { agentRuntime, agents: { ...exp } }));
  });
  it('is inapplicable when agentRuntime is not advertised, whatever agents says', () => {
    inapplicable(agentRuntimeImpliesManifestRuntimeLeg(V2, { agents: { ...exp } }));
  });
});
