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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { V1_DIR } from '../lib/paths.js';
import { PROFILE_FLOOR_SCENARIOS } from '../lib/profiles.js';
import { requirementsFor } from '../lib/requirement-registry.js';

const MATURITIES = ['experimental', 'draft', 'stable', 'deprecated'] as const;
type Maturity = (typeof MATURITIES)[number];

interface Extension {
  readonly id: string;
  readonly maturity: Maturity;
  readonly owningRfc: string;
  readonly capabilityPath: string;
  readonly dependsOn: readonly string[];
  readonly securityTier: string;
  readonly minimumSuiteVersion: string | null;
  readonly evidenceTier: string | null;
  readonly note?: string;
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
    expect(manifest, 'RFC 0155 §B: the manifest MUST be published').not.toBeNull();
    const m = manifest as NonNullable<typeof manifest>;
    expect(m.profile).toBe('openwop-core-standard');
    expect(m.digest, 'the manifest MUST carry a digest').toMatch(/^[0-9a-f]{64}$/);
    expect(m.floor.requiredScenarios.length).toBeGreaterThan(5);
    expect(m.openapiOperations.length).toBeGreaterThan(20);
    expect(m.schemas.length).toBeGreaterThan(20);
  });

  it('the manifest floor matches the floor the suite actually enforces', () => {
    // The parity §B asks for. If these drift, the manifest is asserting a floor
    // nobody runs — worse than no manifest, because it looks authoritative.
    const m = manifest as NonNullable<typeof manifest>;
    const live = PROFILE_FLOOR_SCENARIOS['openwop-core-standard'];
    expect(live, 'the suite MUST define a core-standard floor').toBeDefined();
    expect([...m.floor.requiredScenarios].sort()).toEqual([...(live?.required ?? [])].sort());
    expect([...m.floor.requiredAnyPrefix].sort()).toEqual([...(live?.requiredAnyPrefix ?? [])].sort());
  });

  it('the manifest requirement IDs match the requirement registry', () => {
    const m = manifest as NonNullable<typeof manifest>;
    const fromRegistry = requirementsFor('openwop-core-standard');
    expect(fromRegistry, 'core-standard MUST have registered requirements').not.toBeNull();
    expect([...m.requirementIds].sort()).toEqual([...(fromRegistry as readonly string[])].sort());
  });

  it('every schema the manifest lists declares an $id', () => {
    const m = manifest as NonNullable<typeof manifest>;
    const missing = m.schemas.filter((s) => s.$id === null).map((s) => s.file);
    expect(missing, 'CONTRIBUTING.md: every schema carries an `$id` under openwop.dev/spec/v1/').toEqual([]);
  });
});

describe.skipIf(V1_DIR === null)('RFC 0155 §C — extension registry', () => {
  const registry = V1_DIR === null ? null : readJson<{ extensions: Extension[] }>('extensions.json');

  it('the registry exists and every record is closed', () => {
    expect(registry, 'RFC 0155 §C: `spec/v1/extensions.json` MUST exist').not.toBeNull();
    const exts = (registry as NonNullable<typeof registry>).extensions;
    expect(exts.length, 'the registry MUST cover the program extensions').toBeGreaterThan(3);
    for (const e of exts) {
      for (const k of ['id', 'maturity', 'owningRfc', 'capabilityPath', 'dependsOn', 'securityTier']) {
        expect(e[k as keyof Extension], `${e.id} MUST declare ${k}`).toBeDefined();
      }
      expect(MATURITIES, `${e.id}: maturity is a closed enum`).toContain(e.maturity);
    }
    expect(new Set(exts.map((e) => e.id)).size, 'extension ids MUST be unique').toBe(exts.length);
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
      'RFC 0155 §C: `stable` requires at least one Tier-3 implementation, recorded in `evidenceTier`. ' +
        'An extension marked stable with no evidence tier is a claim the corpus cannot substantiate.',
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
    expect(dangling, 'RFC 0155 §C: `dependsOn` MUST resolve').toEqual([]);
  });

  it('every record names the RFC that owns it', () => {
    // Vendor extensions may not use an `openwop-*` id without an accepted RFC
    // (§F). The owning RFC is what makes that checkable.
    for (const e of (registry as NonNullable<typeof registry>).extensions) {
      expect(e.owningRfc, `${e.id} MUST name an owning RFC`).toMatch(/^\d{4}$/);
      if (e.id.startsWith('openwop-')) {
        expect(
          e.owningRfc.length,
          `${e.id}: an \`openwop-*\` id requires an accepted RFC (§F)`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
