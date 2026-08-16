/**
 * RFC 0148 §C — `certification-bundle-redaction`: secret canaries never enter
 * evidence (`threat-model-secret-leakage.md` §SR-1 applied to the one
 * observable channel the suite itself produces).
 *
 * A certification bundle captures the discovery document verbatim, host
 * self-description, and per-requirement `detail` strings written by scenarios
 * and gates. Any of those can carry a credential — a host that echoes its
 * bearer token in an error, a scenario that quotes a response body, an
 * operator secret in an `OPENWOP_*` variable a scenario reports. RFC 0148 §C
 * says a canary never enters evidence; the only way to make that TRUE rather
 * than hoped-for is to scrub the finished document at the emitter with every
 * secret the run was given, and to have the consumer verifier reject the one
 * canary it can know without knowing any operator secret.
 *
 * Legs:
 *   - `scrubEvidence` replaces every occurrence of every configured secret —
 *     nested values AND object keys — with a stable non-reversible marker, and
 *     reports where; empty secrets are ignored (scrubbing "" would blank the
 *     document); the longest secret wins when one is a prefix of another.
 *   - `evidenceSecretsFromEnv` selects `OPENWOP_*` key/token/secret/password
 *     variables and always includes the conformance canary.
 *   - `verifyBundleV2` REJECTS a bundle carrying the conformance canary
 *     anywhere (`secret-canary`), and accepts the scrubbed twin.
 *   - the emitter's own configuration digest is a digest: the API key it was
 *     handed is not a substring of anything in the document.
 *
 * Server-free, always-on; MUST NOT capability-skip (RFC 0148 §Conformance).
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { PROFILE_FLOOR_SCENARIOS } from '../lib/profiles.js';
import { requirementIdForScenario, requirementIdForPrefix } from '../lib/requirement-registry.js';
import {
  CONFORMANCE_SECRET_CANARY,
  evidenceSecretsFromEnv,
  findLiteral,
  redactionMarker,
  scrubEvidence,
  verifyBundleV2,
  type BundleV2Like,
  type BundleV2Requirement,
} from '../lib/certification-bundle-verify.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'server-free: scrubs and verifies bundle documents built in-process; no host is contacted';

const HEX = 'b'.repeat(64);
const API_KEY = 'sk-live-0123456789abcdefFEDCBA';
const DISCOVERY = {
  protocolVersion: '1.0',
  supportedEnvelopes: ['clarification.request'],
  supportedTransports: ['rest'],
  schemaVersions: { workflow: '1.0' },
  limits: { clarificationRounds: 3, schemaRounds: 3, envelopesPerTurn: 8 },
};

function rows(): BundleV2Requirement[] {
  const f = PROFILE_FLOOR_SCENARIOS['openwop-core-standard'];
  if (f === undefined) throw new Error('core-standard floor missing');
  const out: BundleV2Requirement[] = f.required.map((file) => ({ requirementId: requirementIdForScenario(file), scenarioId: file, disposition: 'executed-pass', assertionCount: 5 }));
  for (const p of f.requiredAnyPrefix ?? []) {
    out.push({ requirementId: `openwop.scenario.${p}alpha`, scenarioId: `${p}alpha.test.ts`, disposition: 'executed-pass', assertionCount: 2 });
    out.push({ requirementId: requirementIdForPrefix(p), scenarioId: `${p}*`, disposition: 'executed-pass', assertionCount: 2 });
  }
  return out;
}

function bundle(rs: readonly BundleV2Requirement[], host: Record<string, unknown> = { name: 'h', version: '1' }, document: Record<string, unknown> = DISCOVERY): BundleV2Like {
  const c = (d: string): number => rs.filter((r) => r.disposition === d).length;
  return {
    bundleVersion: '2',
    suite: { package: '@openwop/openwop-conformance', version: '1.114.0' },
    host,
    discovery: { url: 'https://example.invalid/.well-known/openwop', sha256: HEX, document },
    claimedProfiles: ['openwop-core-standard'],
    results: {
      totals: { executedPass: c('executed-pass'), executedFail: c('executed-fail'), skipped: c('skipped'), inapplicable: c('inapplicable'), blocked: c('blocked') },
      requirements: [...rs],
    },
    scenarioManifestSha256: HEX,
    targetConfigurationSha256: createHash('sha256').update(`base-url|${API_KEY}`).digest('hex'),
  } as BundleV2Like;
}

describe('RFC 0148 §C — certification-bundle-redaction: secret canaries never enter evidence', () => {
  it('scrubEvidence replaces every occurrence of every secret in nested values and reports where', () => {
    const rs = rows();
    rs[0] = { ...(rs[0] as BundleV2Requirement), disposition: 'executed-fail', assertionCount: 3, detail: `401 body: {"error":"bad key ${API_KEY}"} (canary ${CONFORMANCE_SECRET_CANARY} echoed)` };
    const b = bundle(rs);
    const { value, redactedAt } = scrubEvidence(b, [API_KEY, CONFORMANCE_SECRET_CANARY]);
    expect(findLiteral(value, API_KEY)).toEqual([]);
    expect(findLiteral(value, CONFORMANCE_SECRET_CANARY)).toEqual([]);
    expect(redactedAt).toEqual(['$.results.requirements[0].detail']);
    const detail = value.results.requirements[0]?.detail ?? '';
    expect(detail).toContain(redactionMarker(API_KEY));
    expect(detail).toContain(redactionMarker(CONFORMANCE_SECRET_CANARY));
    // untouched fields are byte-identical
    expect(value.discovery).toEqual(b.discovery);
    expect(value.results.totals).toEqual(b.results.totals);
  });

  it('scrubs the captured discovery document and host self-description too — evidence is the WHOLE document', () => {
    const b = bundle(rows(), { name: 'h', version: '1', vendor: `acme (token ${API_KEY})` }, { ...DISCOVERY, ['x-host-debug']: { echo: CONFORMANCE_SECRET_CANARY } });
    const { value, redactedAt } = scrubEvidence(b, [API_KEY, CONFORMANCE_SECRET_CANARY]);
    expect(findLiteral(value, API_KEY)).toEqual([]);
    expect(findLiteral(value, CONFORMANCE_SECRET_CANARY)).toEqual([]);
    expect([...redactedAt].sort()).toEqual(['$.discovery.document.x-host-debug.echo', '$.host.vendor']);
  });

  it('scrubs object KEYS as well as values — a secret used as a map key is still a secret', () => {
    const doc = { ...DISCOVERY, ['x-host-keys']: { [API_KEY]: 'tenant-a' } };
    const { value } = scrubEvidence(bundle(rows(), { name: 'h', version: '1' }, doc), [API_KEY]);
    expect(findLiteral(value, API_KEY)).toEqual([]);
    const keys = Object.keys((value.discovery.document as Record<string, Record<string, unknown>>)['x-host-keys'] ?? {});
    expect(keys).toEqual([redactionMarker(API_KEY)]);
  });

  it('empty and whitespace-only secrets are ignored (scrubbing "" would blank every string)', () => {
    const b = bundle(rows());
    const { value, redactedAt } = scrubEvidence(b, ['', '   ']);
    expect(value).toEqual(b);
    expect(redactedAt).toEqual([]);
  });

  it('when one secret is a prefix of another the longer one is scrubbed whole (no partial marker inside a marker)', () => {
    const short = 'abc123';
    const long = 'abc123-longer-secret';
    const { value } = scrubEvidence({ detail: `x ${long} y ${short} z` }, [short, long]);
    expect(value.detail).toBe(`x ${redactionMarker(long)} y ${redactionMarker(short)} z`);
  });

  it('the redaction marker is stable, non-reversible, and does not contain the secret', () => {
    const m = redactionMarker(API_KEY);
    expect(m).toBe(redactionMarker(API_KEY));
    expect(m).not.toContain(API_KEY);
    expect(m).toMatch(/^«redacted:[0-9a-f]{12}»$/);
    expect(redactionMarker('other')).not.toBe(m);
  });

  it('evidenceSecretsFromEnv selects OPENWOP_* key/token/secret/password variables, the handed credential, and ALWAYS the canary', () => {
    const env = {
      OPENWOP_API_KEY: 'k1',
      OPENWOP_MESSAGING_BRIDGE_TOKEN: 't1',
      OPENWOP_DB_PASSWORD: 'p1',
      OPENWOP_CLIENT_SECRET: 's1',
      OPENWOP_BASE_URL: 'https://example.invalid', // not a secret
      OPENWOP_REQUIRE_BEHAVIOR: 'true',
      PATH: '/usr/bin',
      SOME_OTHER_TOKEN: 'not-ours',
    } as NodeJS.ProcessEnv;
    const secrets = evidenceSecretsFromEnv(env, [API_KEY, undefined, '']);
    expect(secrets.sort()).toEqual([API_KEY, 'k1', 'p1', 's1', 't1', CONFORMANCE_SECRET_CANARY].sort());
  });

  it('verifyBundleV2 REJECTS a bundle carrying the conformance canary anywhere, and accepts the scrubbed twin', () => {
    const rs = rows();
    rs[1] = { ...(rs[1] as BundleV2Requirement), detail: `resolved ${CONFORMANCE_SECRET_CANARY} in plain text` };
    const leaked = bundle(rs);
    const v = verifyBundleV2(leaked);
    expect(v.evidenceValid).toBe(false);
    expect(v.rejections.map((r) => r.kind)).toEqual(['secret-canary']);
    expect(v.rejections[0]?.detail).toContain('$.results.requirements[1].detail');

    const { value: clean } = scrubEvidence(leaked, [CONFORMANCE_SECRET_CANARY]);
    const v2 = verifyBundleV2(clean);
    expect(v2.evidenceValid).toBe(true);
    expect(v2.certified).toBe(true);
  });

  it('the canary in a discovery-document KEY is still a rejection (keys are evidence)', () => {
    const doc = { ...DISCOVERY, [`x-host-${CONFORMANCE_SECRET_CANARY}`]: true };
    const v = verifyBundleV2(bundle(rows(), { name: 'h', version: '1' }, doc));
    expect(v.rejections.some((r) => r.kind === 'secret-canary')).toBe(true);
  });

  it('the target-configuration digest is a digest: the API key is not a substring of any string in the document', () => {
    const b = bundle(rows());
    expect((b as unknown as { targetConfigurationSha256: string }).targetConfigurationSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(findLiteral(b, API_KEY)).toEqual([]);
  });
});
