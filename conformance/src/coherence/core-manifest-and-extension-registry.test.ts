/**
 * RFC 0155 §B + §C — the stable core manifest and the extension registry.
 *
 * §B's value is not the inventory. It is the sentence after it: *"prose and code
 * profile definitions MUST be generated from or checked against this manifest."*
 * Three places describe the core-standard floor independently — the profile
 * prose, `PROFILE_FLOOR_SCENARIOS`, and the requirement registry — and before
 * this they could only be assumed to agree.
 *
 * They did not. `PROFILE_FLOOR_SCENARIOS` was an incomplete transcription of
 * `profiles.md`, and every profile it omitted verified as floor-proven against
 * nothing (RFC 0148 §C). A manifest with a parity gate is the mechanism that
 * would have caught that, which is why the manifest is DERIVED and never
 * hand-listed: a hand-listed manifest drifts the moment the corpus moves and
 * then asserts the drift with a digest attached.
 *
 * §C's bar for `stable` is deliberately hard — normative prose, schemas,
 * non-vacuous conformance, SDK support, and at least one Tier-3 implementation.
 * The consequence, stated plainly rather than worked around: **nothing in this
 * corpus can currently be `stable`**, because no Tier-3 host exists. That is a
 * fact about adoption, not about the work.
 *
 * Server-free; reads the corpus.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { V1_DIR } from '../lib/paths.js';
import { PROFILE_FLOOR_SCENARIOS } from '../lib/profiles.js';
import { requirementsFor } from '../lib/requirement-registry.js';
import { req } from '../lib/requirement-ids.js';

const MATURITIES = ['experimental', 'draft', 'stable', 'deprecated'] as const;
type Maturity = (typeof MATURITIES)[number];

interface Extension {
  readonly id: string;
  readonly maturity: Maturity;
  readonly owningRfc: string | null;
  readonly capabilityPath: string;
  readonly dependsOn: readonly string[];
  readonly securityTier: string;
  readonly minimumSuiteVersion: string | null;
  readonly evidenceTier: string | null;
  readonly note?: string;
}

/** The capability schema, for `capabilityPath` resolution. */
function caps(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(V1_DIR as string, '..', '..', 'schemas', 'capabilities.schema.json'), 'utf8'),
  ) as Record<string, unknown>;
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(V1_DIR as string, name), 'utf8')) as T;
}

describe.skipIf(V1_DIR === null)('RFC 0155 §B — core-standard manifest parity', () => {
  const manifest = V1_DIR === null ? null : readJson<{
    profile: string;
    digest: string;
    floor: { requiredScenarios: string[]; requiredAnyPrefix: string[] };
    requirementIds: string[];
    openapiOperations: string[];
    schemas: { file: string; $id: string | null }[];
  }>('core-standard-manifest.json');

  it('the manifest exists and is non-trivial', () => {
    // Guard: an empty manifest would make every parity leg below vacuously true,
    // which is the exact shape RFC 0148 §C found in the floor verifier.
    expect(manifest, req('openwop.it.core-manifest-and-extension-registry.the-manifest-exists-and-is-non-trivial', 'RFC 0155 §B', 'RFC 0155 §B: the manifest MUST be published')).not.toBeNull();
    const m = manifest as NonNullable<typeof manifest>;
    expect(m.profile).toBe('openwop-core-standard');
    expect(m.digest, req('openwop.it.core-manifest-and-extension-registry.the-manifest-exists-and-is-non-trivial', 'RFC 0155 §B', 'the manifest MUST carry a digest')).toMatch(/^[0-9a-f]{64}$/);
    expect(m.floor.requiredScenarios.length).toBeGreaterThan(5);
    expect(m.openapiOperations.length).toBeGreaterThan(20);
    expect(m.schemas.length).toBeGreaterThan(20);
  });

  it('the manifest floor matches the floor the suite actually enforces', () => {
    // The parity §B asks for. If these drift, the manifest is asserting a floor
    // nobody runs — worse than no manifest, because it looks authoritative.
    const m = manifest as NonNullable<typeof manifest>;
    const live = PROFILE_FLOOR_SCENARIOS['openwop-core-standard'];
    expect(live, req('openwop.it.core-manifest-and-extension-registry.the-manifest-floor-matches-the-floor-the-suite-actually-enforces', 'RFC 0155 §B', 'the suite MUST define a core-standard floor')).toBeDefined();
    expect([...m.floor.requiredScenarios].sort()).toEqual([...(live?.required ?? [])].sort());
    expect([...m.floor.requiredAnyPrefix].sort()).toEqual([...(live?.requiredAnyPrefix ?? [])].sort());
  });

  it('the manifest requirement IDs match the requirement registry', () => {
    const m = manifest as NonNullable<typeof manifest>;
    const fromRegistry = requirementsFor('openwop-core-standard');
    expect(fromRegistry, req('openwop.it.core-manifest-and-extension-registry.the-manifest-requirement-ids-match-the-requirement-registry', 'RFC 0155 §B', 'core-standard MUST have registered requirements')).not.toBeNull();
    expect([...m.requirementIds].sort()).toEqual([...(fromRegistry as readonly string[])].sort());
  });

  it('every schema the manifest lists declares an $id', () => {
    const m = manifest as NonNullable<typeof manifest>;
    const missing = m.schemas.filter((s) => s.$id === null).map((s) => s.file);
    expect(missing, req('openwop.it.core-manifest-and-extension-registry.every-schema-the-manifest-lists-declares-an-id', 'RFC 0155 §B', 'CONTRIBUTING.md: every schema carries an `$id` under openwop.dev/spec/v1/')).toEqual([]);
  });
});

describe.skipIf(V1_DIR === null)('RFC 0155 §C — extension registry', () => {
  const registry = V1_DIR === null ? null : readJson<{ extensions: Extension[] }>('extensions.json');

  it('the registry exists and every record is closed', () => {
    expect(registry, req('openwop.it.core-manifest-and-extension-registry.the-registry-exists-and-every-record-is-closed', 'RFC 0155 §B', 'RFC 0155 §C: `spec/v1/extensions.json` MUST exist')).not.toBeNull();
    const exts = (registry as NonNullable<typeof registry>).extensions;
    expect(exts.length, req('openwop.it.core-manifest-and-extension-registry.the-registry-exists-and-every-record-is-closed', 'RFC 0155 §B', 'the registry MUST cover the program extensions')).toBeGreaterThan(3);
    for (const e of exts) {
      for (const k of ['id', 'maturity', 'owningRfc', 'capabilityPath', 'dependsOn', 'securityTier']) {
        expect(e[k as keyof Extension], req('openwop.it.core-manifest-and-extension-registry.the-registry-exists-and-every-record-is-closed', 'RFC 0155 §B', `${e.id} MUST declare ${k}`)).toBeDefined();
      }
      expect(MATURITIES, req('openwop.it.core-manifest-and-extension-registry.the-registry-exists-and-every-record-is-closed', 'RFC 0155 §B', `${e.id}: maturity is a closed enum`)).toContain(e.maturity);
    }
    expect(new Set(exts.map((e) => e.id)).size, req('openwop.it.core-manifest-and-extension-registry.the-registry-exists-and-every-record-is-closed', 'RFC 0155 §B', 'extension ids MUST be unique')).toBe(exts.length);
  });

  it('no extension is `stable` without a Tier-3 implementation', () => {
    // §C: stable requires normative prose, schemas, non-vacuous conformance, SDK
    // support where applicable, and at least one Tier-3 implementation. The last
    // one is the binding constraint here, and it is external to this repo — no
    // Tier-3 host exists, so NOTHING can currently be stable. Recording that
    // ceiling is the honest move; promoting anything past it would be the
    // overclaim RFC 0147 §A bans.
    const overclaimed = (registry as NonNullable<typeof registry>).extensions
      .filter((e) => e.maturity === 'stable' && (e.evidenceTier === null || e.evidenceTier === undefined))
      .map((e) => e.id);
    expect(
      overclaimed,
      req('openwop.it.core-manifest-and-extension-registry.no-extension-is-stable-without-a-tier-3-implementation', 'RFC 0155 §B', 'RFC 0155 §C: `stable` requires at least one Tier-3 implementation, recorded in `evidenceTier`. ' +
        'An extension marked stable with no evidence tier is a claim the corpus cannot substantiate.'),
    ).toEqual([]);
  });

  it('every dependency resolves to a known profile or listed extension', () => {
    // A dependency on something that does not exist is a closure hole: the
    // record looks complete and the graph does not.
    const exts = (registry as NonNullable<typeof registry>).extensions;
    const known = new Set<string>([...Object.keys(PROFILE_FLOOR_SCENARIOS), ...exts.map((e) => e.id)]);
    const dangling = exts.flatMap((e) =>
      e.dependsOn.filter((d) => !known.has(d)).map((d) => `${e.id} -> ${d}`),
    );
    expect(dangling, req('openwop.it.core-manifest-and-extension-registry.every-dependency-resolves-to-a-known-profile-or-listed-extension', 'RFC 0155 §B', 'RFC 0155 §C: `dependsOn` MUST resolve')).toEqual([]);
  });

  it('every capabilityPath resolves against the capability schema', () => {
    // Fifth axis of the named-list check, and it found four of six broken.
    // Three were typos introduced when this registry was written —
    // `a2a.protocolVersion` for `protocolVersions`, the same for MCP, and
    // `workloadIdentity.supported` omitting its `auth.` parent. The fourth,
    // `idempotency.supported`, pointed at a field the corpus USES in its own
    // examples but had never DECLARED; it validated only because that family
    // carries `additionalProperties: true`, so a typo like `suported` was
    // accepted silently.
    //
    // An extension whose capabilityPath does not resolve is unreachable: a
    // consumer following the registry to find the flag finds nothing, and the
    // registry looks complete while pointing at empty space.
    const schema = caps() as { properties: Record<string, unknown> };
    const unresolved: string[] = [];
    for (const e of (registry as NonNullable<typeof registry>).extensions) {
      let node = schema.properties as Record<string, { properties?: Record<string, unknown> }> | undefined;
      let ok = true;
      for (const part of e.capabilityPath.split('.')) {
        if (node === undefined || !(part in node)) {
          ok = false;
          break;
        }
        node = node[part]?.properties as typeof node;
      }
      if (!ok) unresolved.push(`${e.id} -> ${e.capabilityPath}`);
    }
    expect(
      unresolved,
      req('openwop.it.core-manifest-and-extension-registry.every-capabilitypath-resolves-against-the-capability-schema', 'RFC 0155 §B', 'RFC 0155 §C: `capabilityPath` MUST resolve to a declared property in ' +
        '`capabilities.schema.json`. An unresolvable path makes the extension unreachable — a ' +
        'consumer following the registry to find the flag finds nothing, while the registry ' +
        'still reads as complete.\n  ' + unresolved.join('\n  ')),
    ).toEqual([]);
  });

  it('the coverage block is present and accounts for every capability family (RFC 0155 §C, acceptance item 3)', () => {
    // "Unlisted means uncovered" was a sentence; this makes it a checked list.
    // The block is DERIVED by scripts/generate-extension-registry-coverage.mjs
    // (--check runs in openwop:check); here we assert the invariant it encodes
    // so a tarball consumer sees it too: every top-level capability family is
    // either a core predicate field, covered by a record's capabilityPath, or
    // listed as uncovered — and nothing is in two buckets.
    const reg = registry as unknown as {
      coverage?: {
        familiesTotal: number;
        coreFields: string[];
        metadataFields?: string[];
        metadataRationale?: Record<string, string>;
        covered: string[];
        uncovered: string[];
      };
      extensions: Extension[];
    };
    expect(reg.coverage, req('openwop.it.core-manifest-and-extension-registry.the-coverage-block-is-present-and-accounts-for-every-capability-family-rfc-0155', 'RFC 0155 §C', 'RFC 0155 §C: the registry MUST carry a derived `coverage` block')).toBeDefined();
    const cov = reg.coverage as NonNullable<typeof reg.coverage>;
    const metadata = cov.metadataFields ?? [];
    const families = Object.keys((caps().properties as Record<string, unknown>) ?? {}).sort();
    expect(cov.familiesTotal).toBe(families.length);
    const all = [...cov.coreFields, ...metadata, ...cov.covered, ...cov.uncovered].sort();
    expect(all, req('openwop.it.core-manifest-and-extension-registry.the-coverage-block-is-present-and-accounts-for-every-capability-family-rfc-0155', 'RFC 0155 §C', 'core + metadata + covered + uncovered MUST partition the family set exactly')).toEqual(families);
    expect(new Set(all).size, req('openwop.it.core-manifest-and-extension-registry.the-coverage-block-is-present-and-accounts-for-every-capability-family-rfc-0155', 'RFC 0155 §C', 'no family may sit in two buckets')).toBe(all.length);
    const reached = new Set(reg.extensions.map((e) => e.capabilityPath.split('.')[0]));
    for (const f of cov.covered) expect(reached.has(f), req('openwop.it.core-manifest-and-extension-registry.the-coverage-block-is-present-and-accounts-for-every-capability-family-rfc-0155', 'RFC 0155 §C', `${f} listed as covered MUST be reached by a record`)).toBe(true);
    for (const f of cov.uncovered) expect(reached.has(f), req('openwop.it.core-manifest-and-extension-registry.the-coverage-block-is-present-and-accounts-for-every-capability-family-rfc-0155', 'RFC 0155 §C', `${f} listed as uncovered MUST NOT be reached by a record`)).toBe(false);
    // Metadata is the one bucket a family can be moved INTO by hand, so it is
    // the one that could hide an extension: every entry MUST carry a stated
    // rationale, and no metadata key may carry a `supported` flag — a key that
    // gates behaviour is a family, not a description of the document.
    for (const f of metadata) {
      expect(typeof cov.metadataRationale?.[f], req('openwop.it.core-manifest-and-extension-registry.the-coverage-block-is-present-and-accounts-for-every-capability-family-rfc-0155', 'RFC 0155 §C', `${f}: a metadata field MUST state why it is not an extension`)).toBe('string');
      const props = (caps().properties as Record<string, { properties?: Record<string, unknown> }>)[f]?.properties ?? {};
      expect('supported' in props, req('openwop.it.core-manifest-and-extension-registry.the-coverage-block-is-present-and-accounts-for-every-capability-family-rfc-0155', 'RFC 0155 §C', `${f} is listed as metadata but carries a \`supported\` flag — that is an extension family`)).toBe(false);
    }
    // The honest number, asserted so it cannot silently shrink by deletion of the
    // uncovered list rather than by adding records.
    expect(cov.uncovered.length + cov.covered.length + cov.coreFields.length + metadata.length).toBe(families.length);
  });

  it('every record names the RFC — or, for a v1 base advertisement, the spec document — that owns it', () => {
    // Vendor extensions may not use an `openwop-*` id without an accepted RFC
    // (§F). The owning RFC is what makes that checkable. Six advertisements
    // predate the RFC process (they shipped in the v1 base corpus: `secrets`,
    // `webhooks`, `i18n`, `aiProviders`, `envelopeContracts`, `envelopeStrictness`);
    // those carry `owningRfc: null` and an `owningDoc` under spec/v1/ that MUST
    // exist — the steward's own corpus is the RFC-equivalent authority for them.
    for (const e of (registry as NonNullable<typeof registry>).extensions) {
      const rec = e as Extension & { owningDoc?: string; securityTier?: string };
      if (rec.owningRfc === null) {
        expect(typeof rec.owningDoc, req('openwop.it.core-manifest-and-extension-registry.every-record-names-the-rfc-or-for-a-v1-base-advertisement-the-spec-document-that', 'RFC 0155 §B', `${e.id}: \`owningRfc: null\` requires an \`owningDoc\``)).toBe('string');
        expect(rec.owningDoc, req('openwop.it.core-manifest-and-extension-registry.every-record-names-the-rfc-or-for-a-v1-base-advertisement-the-spec-document-that', 'RFC 0155 §B', `${e.id}: owningDoc MUST be a spec/v1 document`)).toMatch(/^spec\/v1\/[a-z0-9-]+\.md$/);
        if (V1_DIR !== null) {
          const file = join(V1_DIR, (rec.owningDoc as string).replace(/^spec\/v1\//, ''));
          expect(existsSync(file), req('openwop.it.core-manifest-and-extension-registry.every-record-names-the-rfc-or-for-a-v1-base-advertisement-the-spec-document-that', 'RFC 0155 §B', `${e.id}: owningDoc ${rec.owningDoc} MUST exist`)).toBe(true);
        }
      } else {
        expect(e.owningRfc, req('openwop.it.core-manifest-and-extension-registry.every-record-names-the-rfc-or-for-a-v1-base-advertisement-the-spec-document-that', 'RFC 0155 §B', `${e.id} MUST name an owning RFC`)).toMatch(/^\d{4}$/);
      }
      expect(['high', 'medium', 'low'], req('openwop.it.core-manifest-and-extension-registry.every-record-names-the-rfc-or-for-a-v1-base-advertisement-the-spec-document-that', 'RFC 0155 §B', `${e.id}: securityTier is a closed enum`)).toContain(rec.securityTier);
    }
  });
});
