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
  modelCapabilitiesAdvertisedLeg, modelCapabilitiesSubstitutionLeg, recordSchemaLeg, type AdvertOutcome,
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
