/**
 * v2-colocated-companion — RFC 0216 (corpus gate; never reaches a host bundle).
 *
 * A colocated companion is the served host's image, booted beside the suite so
 * it can trust a suite-held trust anchor that a host serving production traffic
 * MUST NOT trust. It runs the served host's verifier code. It does not serve the
 * served front. Before RFC 0216 nothing marked one, and
 * `check-accepted-predicate.mjs` counted every row it passed: the committed
 * companion was the ONLY witness for 16 ids, including four RFC 0200
 * public-surface rows it measured on loopback.
 *
 * Legs, one id each:
 *   - the anchor list is closed (§A.3): `check-harness-trust-anchors.mjs` on a
 *     self-contained fixture corpus, with one clause sabotaged at a time;
 *   - the marker is inside the signed digest (§B.7);
 *   - a companion counts only for listed rows (§C.9), only with the same host
 *     and image (§C.9(a)/(b)), only when signed under the served bundle's
 *     published key (§C.9(c)), and only with equivalent discovery (§C.9(d)).
 *     These run `check-companion-pairing.mjs`, the same code rule 4 runs, on
 *     fixture evidence directories;
 *   - the committed unmarked companion witnesses nothing (§C.10).
 *
 * The discipline, as in v2-retirement-gate: **a fixture that fails for the
 * wrong reason is a defect in the fixture, not a pass.** Each sabotage changes
 * ONE input from a base the gate accepts, and asserts the exact reason set. The
 * base passing is asserted in the same leg.
 *
 * The fixtures are signed by this file with the suite's own `signBundleV3` and
 * `witnessDigest`, and checked by the gate's `.mjs` code. So a preimage or
 * attestation disagreement between the suite and the gate shows up as a red
 * base, not as a silent pass.
 *
 * Sabotages run 2026-09-26 (each turned its leg red, then was reverted):
 *   - `companion-pairing.mjs`: drop `anchorIds.has(r.id)`, and prm-served is counted;
 *   - compare `build.id` without `kind`, and the `commit` pair counts;
 *   - skip the `edVerify`, and the wrong-key companion counts;
 *   - remove the `oidc`-issuers normalisation, and the base stops pairing;
 *   - `witnessDigest`: drop `deployment` from the preimage, and the stripped bundle digests equal.
 *
 * @see RFCS/0216-colocated-witness-for-harness-trust-anchor-rows.md
 * @see scripts/check-harness-trust-anchors.mjs
 * @see scripts/lib/companion-pairing.mjs
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, createHash, type KeyObject } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { canonicalJSON, signBundleV3, verifyBundleV3, witnessDigest, type BundleV3, type BundleV3Requirement } from '../lib/certification-bundle-v3.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const root = join(SCHEMAS_DIR, '..');
const corpusAbsent = (): boolean => V1_DIR === null;
const SPEC = 'RFC 0216 · spec/v2/core/conformance.md §"Bundle v3"';

const ID_LIST = 'openwop.requirement.0216.anchor-list-closed';
const ID_PREIMAGE = 'openwop.requirement.0216.deployment-in-preimage';
const ID_ROWS = 'openwop.requirement.0216.companion-anchor-rows-only';
const ID_IMAGE = 'openwop.requirement.0216.companion-same-image';
const ID_KEY = 'openwop.requirement.0216.companion-attributable';
const ID_DISCOVERY = 'openwop.requirement.0216.companion-equivalent';
const ID_LEGACY = 'openwop.requirement.0216.legacy-companion';

const ANCHOR_ROW = 'openwop.requirement.0210.exp-only-lifetime-bound';
const SURFACE_ROW = 'openwop.requirement.0200.prm-served';

// ---------------------------------------------------------------- pairing fixtures

interface Key { pem: string; raw: string }
function key(): Key {
  const { privateKey, publicKey }: { privateKey: KeyObject; publicKey: KeyObject } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, raw: der.subarray(der.length - 32).toString('base64url') };
}
const K = key();
const K2 = key();

interface Opts {
  origin: string;
  build?: { kind: 'image-digest' | 'commit'; id: string };
  name?: string;
  deployment?: 'colocated-companion';
  issuers: string[];
  window?: number;
  apiKeyRevocation?: string;
  published?: { keyId: string; k: Key }[];
  signWith?: Key;
  signKeyId?: string;
  certified?: boolean;
  rows: string[];
}
function bundle(o: Opts): BundleV3 {
  const published = o.published ?? [{ keyId: 'op-1', k: K }];
  const document = {
    implementation: { name: o.name ?? 'app', vendor: 'acme' },
    signingKeys: published.map((p) => ({ keyId: p.keyId, alg: 'ed25519', publicKey: p.k.raw, use: 'certification-bundle' })),
    auth: { status: 'stable', lanes: [
      { lane: 'oidc', issuers: o.issuers, revocation: 'short-lived', revocationWindowSeconds: o.window ?? 3600, minimumAssurance: 'bearer' },
      { lane: 'api-key', issuers: ['urn:acme:key'], revocation: o.apiKeyRevocation ?? 'next-request', minimumAssurance: 'bearer' },
    ] },
    links: { self: `${o.origin}/.well-known/openwop`, mcp: `${o.origin}/mcp` },
  };
  const rows: BundleV3Requirement[] = o.rows.map((id) => ({ id, scenario: 'fixture.test.ts', result: 'executed-pass', assertions: 1 }));
  const unsigned: Omit<BundleV3, 'signature'> = {
    bundleVersion: '3', generatedAt: '2026-09-26T00:00:00Z',
    suite: { name: '@openwop/openwop-conformance', version: '2.40.2', targetMajor: 2, specArtifactsVersion: '2.40.2' },
    host: { name: o.name ?? 'app', version: '1.0.0', vendor: 'acme', build: o.build ?? { kind: 'image-digest', id: 'sha256:aaaa' }, ...(o.deployment ? { deployment: o.deployment } : {}) },
    discovery: { url: `${o.origin}/.well-known/openwop`, sha256: createHash('sha256').update(canonicalJSON(document)).digest('hex'), protocolVersions: ['2'], preferredVersion: '2', document },
    claimedProfiles: [{ id: 'openwop-core-standard', evidenceTier: 'self', witnessCount: rows.length, certified: o.certified ?? true }],
    results: { totals: { executedPass: rows.length, executedFail: 0, skipped: 0, inapplicable: 0, blocked: 0 }, requirements: rows },
    witnessSha256: witnessDigest(rows, undefined, o.deployment),
    assertionCount: rows.length,
  };
  return { ...unsigned, signature: signBundleV3(unsigned, (o.signWith ?? K).pem, o.signKeyId ?? 'op-1') };
}

const SERVED: Opts = { origin: 'https://app.example', issuers: ['https://idp.example'], rows: ['openwop.requirement.0200.challenge-401'] };
const COMPANION: Opts = { origin: 'http://127.0.0.1:18099', deployment: 'colocated-companion', issuers: ['https://idp.example', 'http://127.0.0.1:9999/issuer'], rows: [ANCHOR_ROW, SURFACE_ROW] };

interface Verdict { name: string; pairedWith: string | null; counted: string[]; discarded: string[]; failures: Record<string, string[]> }
function pair(served: BundleV3, companion: BundleV3): Verdict {
  const dir = mkdtempSync(join(tmpdir(), 'owp-0216-'));
  writeFileSync(join(dir, 'served.json'), JSON.stringify(served));
  writeFileSync(join(dir, 'companion.json'), JSON.stringify(companion));
  const r = spawnSync('node', [join(root, 'scripts', 'check-companion-pairing.mjs'), '--dir', dir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`check-companion-pairing exited ${r.status}: ${r.stderr}`);
  const out = JSON.parse(r.stdout) as { companions: Verdict[] };
  return out.companions.find((c) => c.name === 'companion.json') as Verdict;
}
const base = (): Verdict => pair(bundle(SERVED), bundle(COMPANION));

// ---------------------------------------------------------------- anchor-list fixtures

const RFC_ROW = (id: string): string => `| \`${id}\` | \`fixture-anchor.test.ts\` | \`oidc-test-issuer\` |`;
interface ListSabotage { id?: string; anchor?: string; tableIds?: string[]; gates?: boolean; floor?: boolean }
function anchorGate(s: ListSabotage = {}): { status: number | null; lines: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'owp-0216-list-'));
  const id = s.id ?? 'openwop.requirement.9216.fixture-row';
  for (const d of ['RFCS', 'spec/v2', 'conformance/src/scenarios']) mkdirSync(join(dir, d), { recursive: true });
  copyFileSync(join(root, 'spec', 'v2', 'harness-trust-anchors.schema.json'), join(dir, 'spec', 'v2', 'harness-trust-anchors.schema.json'));
  writeFileSync(join(dir, 'spec', 'v2', 'harness-trust-anchors.json'), JSON.stringify({ rows: [{ requirementId: id, scenario: 'fixture-anchor.test.ts', anchor: s.anchor ?? 'oidc-test-issuer', rfc: '9216' }] }));
  writeFileSync(join(dir, 'RFCS', '9216-fixture.md'), `# RFC 9216\n\n| **Status** | \`Active\` |\n\n### Harness-trust-anchor rows\n\n| Requirement id | Scenario | Anchor |\n| --- | --- | --- |\n${(s.tableIds ?? [id]).map(RFC_ROW).join('\n')}\n\n## Next\n`);
  writeFileSync(join(dir, 'conformance', 'requirements.json'), JSON.stringify({ records: [{ file: 'fixture-anchor.test.ts', explicitId: id }] }));
  writeFileSync(join(dir, 'conformance', 'src', 'scenarios', 'fixture-anchor.test.ts'), s.gates === false ? '// reads nothing\n' : 'if (!harnessClaimed(lane, url)) skip();\n');
  writeFileSync(join(dir, 'spec', 'v2', 'profiles.json'), JSON.stringify({ profiles: [{ id: 'p', floorScenarios: s.floor ? ['fixture-anchor'] : ['other'] }] }));
  const r = spawnSync('node', [join(root, 'scripts', 'check-harness-trust-anchors.mjs'), '--root', dir], { encoding: 'utf8' });
  return { status: r.status, lines: `${r.stderr}`.split('\n').filter((l) => /^\s+\([a-e]\)/.test(l)).map((l) => l.trim()) };
}
/** The clause letters a run named, deduplicated and sorted. */
const clauses = (lines: string[]): string[] => [...new Set(lines.map((l) => l.slice(1, 2)))].sort();

describe('RFC 0216 — a colocated companion is marked, and witnesses only the harness-trust-anchor rows', () => {
  it('§A.3 the anchor list is closed and exact', () => {
    if (corpusAbsent()) return softSkip('inapplicable', 'corpus not present in this layout (published package) — the gate scripts ship only in the spec repo');
    const ok = anchorGate();
    expect(ok.status, req(ID_LIST, SPEC, 'the base fixture list MUST pass the anchor gate, or every sabotage below proves nothing')).toBe(0);
    const cases: [string, ListSabotage, string][] = [
      ['a wildcard id', { id: 'openwop.requirement.9216.*', tableIds: ['openwop.requirement.9216.*'] }, 'a'],
      ['an anchor outside the enum', { anchor: 'prod-signing-key' }, 'b'],
      ['a row no RFC table lists', { tableIds: [] }, 'c'],
      ['a scenario that does not gate on the anchor', { gates: false }, 'd'],
      ['a floor scenario', { floor: true }, 'e'],
    ];
    for (const [what, s, clause] of cases) {
      const r = anchorGate(s);
      expect(r.status, req(ID_LIST, SPEC, `the anchor gate MUST refuse ${what}`)).toBe(1);
      expect(clauses(r.lines), req(ID_LIST, SPEC, `${what} MUST be refused by clause (${clause}) alone — another clause firing means the fixture is wrong`)).toEqual([clause]);
    }
  });

  it('§B.7 the marker is inside the signed digest', () => {
    const rows: BundleV3Requirement[] = [{ id: ANCHOR_ROW, scenario: 'x.test.ts', result: 'executed-pass', assertions: 1 }];
    expect(witnessDigest(rows, undefined, 'colocated-companion'), req(ID_PREIMAGE, SPEC, 'host.deployment MUST enter the witnessSha256 preimage when present')).not.toBe(witnessDigest(rows));
    expect(witnessDigest(rows, [], undefined), req(ID_PREIMAGE, SPEC, 'a bundle without the marker MUST digest exactly as before RFC 0216')).toBe(createHash('sha256').update(canonicalJSON([{ id: ANCHOR_ROW, scenario: 'x.test.ts', result: 'executed-pass', assertions: 1 }])).digest('hex'));
    const c = bundle(COMPANION);
    const stripped = { ...c, host: { ...c.host } };
    delete (stripped.host as { deployment?: string }).deployment;
    const kinds = verifyBundleV3(stripped).rejections.map((r) => r.kind);
    expect(kinds, req(ID_PREIMAGE, SPEC, 'a signed companion that sheds host.deployment MUST fail verification with witness-digest')).toContain('witness-digest');
    expect(verifyBundleV3(c).rejections.map((r) => r.kind), req(ID_PREIMAGE, SPEC, 'the unaltered companion MUST NOT be refused for its digest')).not.toContain('witness-digest');
  });

  it('§C.9 a companion counts only for listed rows', () => {
    if (corpusAbsent()) return softSkip('inapplicable', 'corpus not present in this layout (published package) — the gate scripts ship only in the spec repo');
    const v = base();
    expect(v.pairedWith, req(ID_ROWS, SPEC, 'the base companion MUST pair with the served-host bundle of the same image, key and configuration')).toBe('served.json');
    expect(v.counted, req(ID_ROWS, SPEC, 'a paired companion MUST witness its harness-trust-anchor rows')).toEqual([ANCHOR_ROW]);
    expect(v.discarded, req(ID_ROWS, SPEC, 'a paired companion MUST NOT witness a row off the anchor list, however it passed')).toEqual([SURFACE_ROW]);
    const uncertified = pair(bundle(SERVED), bundle({ ...COMPANION, certified: false }));
    expect(uncertified.counted, req(ID_ROWS, SPEC, 'an uncertified companion MUST witness nothing')).toEqual([]);
  });

  it('§C.9(a)/(b) the same host and the same image digest', () => {
    if (corpusAbsent()) return softSkip('inapplicable', 'corpus not present in this layout (published package) — the gate scripts ship only in the spec repo');
    expect(base().counted, req(ID_IMAGE, SPEC, 'the base MUST pair')).toEqual([ANCHOR_ROW]);
    const commit = { kind: 'commit' as const, id: 'sha256:aaaa' };
    const both = pair(bundle({ ...SERVED, build: commit }), bundle({ ...COMPANION, build: commit }));
    expect(both.failures['served.json'], req(ID_IMAGE, SPEC, 'a commit-kind build MUST NOT pair — a commit does not name the bytes that ran')).toEqual(['same-image']);
    const other = pair(bundle(SERVED), bundle({ ...COMPANION, build: { kind: 'image-digest', id: 'sha256:aaab' } }));
    expect(other.failures['served.json'], req(ID_IMAGE, SPEC, 'image digests differing in one byte MUST NOT pair')).toEqual(['same-image']);
    const host = pair(bundle(SERVED), bundle({ ...COMPANION, name: 'other-app' }));
    expect([host.pairedWith, host.counted], req(ID_IMAGE, SPEC, 'a companion of another host MUST NOT pair')).toEqual([null, []]);
  });

  it('§C.9(c) signed under a key the served bundle publishes', () => {
    if (corpusAbsent()) return softSkip('inapplicable', 'corpus not present in this layout (published package) — the gate scripts ship only in the spec repo');
    expect(base().counted, req(ID_KEY, SPEC, 'the base MUST pair')).toEqual([ANCHOR_ROW]);
    const forged = pair(bundle(SERVED), bundle({ ...COMPANION, signWith: K2 }));
    expect(forged.failures['served.json'], req(ID_KEY, SPEC, 'a companion whose attestation does not verify under the named published key MUST NOT pair')).toEqual(['attributable']);
    const unpublished = pair(bundle(SERVED), bundle({ ...COMPANION, signWith: K2, signKeyId: 'throwaway' }));
    expect(unpublished.failures['served.json'], req(ID_KEY, SPEC, 'a companion signed under a key the served bundle does not publish MUST NOT pair')).toEqual(['attributable']);
  });

  it('§C.9(d) equivalent discovery, origin and oidc issuers aside', () => {
    if (corpusAbsent()) return softSkip('inapplicable', 'corpus not present in this layout (published package) — the gate scripts ship only in the spec repo');
    expect(base().counted, req(ID_DISCOVERY, SPEC, 'a companion differing only in origin and oidc issuers MUST pair')).toEqual([ANCHOR_ROW]);
    const window = pair(bundle(SERVED), bundle({ ...COMPANION, window: 300 }));
    expect(window.failures['served.json'], req(ID_DISCOVERY, SPEC, 'a different revocationWindowSeconds MUST NOT pair — it is a different claim')).toEqual(['equivalent-discovery']);
    const lane = pair(bundle(SERVED), bundle({ ...COMPANION, apiKeyRevocation: 'short-lived' }));
    expect(lane.failures['served.json'], req(ID_DISCOVERY, SPEC, 'a difference in a non-oidc lane MUST NOT pair')).toEqual(['equivalent-discovery']);
  });

  it('§C.10 the committed unmarked companion witnesses nothing', () => {
    if (corpusAbsent()) return softSkip('inapplicable', 'corpus not present in this layout (published package) — evidence/v2-host-bundles ships only in the spec repo');
    const r = spawnSync('node', [join(root, 'scripts', 'check-companion-pairing.mjs')], { encoding: 'utf8' });
    const out = JSON.parse(r.stdout) as { companions: Verdict[] };
    const legacy = out.companions.find((c) => c.name === 'openwop-app-colocated-companion.json');
    expect(legacy, req(ID_LEGACY, SPEC, 'the committed 2026-09-25 companion MUST be recognised as a companion by its witnessSha256')).toBeDefined();
    expect(legacy?.counted, req(ID_LEGACY, SPEC, 'the committed unmarked companion MUST witness nothing (commit-kind build, throwaway key)')).toEqual([]);
    const raw = JSON.parse(readFileSync(join(root, 'evidence', 'v2-host-bundles', 'openwop-app-colocated-companion.json'), 'utf8')) as BundleV3;
    expect(raw.host.deployment, req(ID_LEGACY, SPEC, 'the legacy file carries no marker — it is caught by digest, not by a field it could drop')).toBeUndefined();
  });
});
