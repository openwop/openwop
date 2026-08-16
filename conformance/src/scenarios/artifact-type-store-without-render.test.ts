/**
 * artifact-type-store-without-render — RFC 0071 Phase 1 §host.artifactTypes.
 * The cross-host negotiation guarantee: a host that can STORE an artifact type
 * but cannot RENDER it MUST still accept + store the artifact and MUST NOT fail
 * the run for lack of a renderer. An artifact produced on a richly-rendering
 * host stays storable + forwardable + inspectable on a store-only host.
 *
 * Gated on `host.artifactTypes.supported` AND the advertised facets
 * `store: true, render: false` (a host that renders everything can't exercise
 * this path — it soft-skips), plus the host-sample produce seam. `host-pending`
 * until a reference host advertises a store-without-render posture.
 *
 * @see spec/v1/artifact-type-packs.md §host.artifactTypes
 * @see spec/v1/host-capabilities.md §host.artifactTypes
 * @see RFCS/0071-artifact-type-and-chat-card-packs.md
 *
 * **RFC 0139 — G14 flip.** These legs previously used a bare `return` for both
 * the unadvertised-capability and seam-absent cases, so they reported GREEN
 * while exercising nothing — a host advertising the capability with no seam
 * passed invisibly. They now use `behaviorGate`: unadvertised stays a skip in
 * default mode, but **advertise-and-skip FAILS** under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`. Advertise-and-skip is the only combination
 * that can lie.
 */

import { describe, it, expect } from 'vitest';
import { softSkip } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { behaviorGate, behaviorGatePresent } from '../lib/behavior-gate.js';

const PROFILE = 'openwop-artifact-type-packs';
import {
  readArtifactTypesCap,
  artifactTypesSupported,
  installArtifactTypePack,
  produceArtifact,
  sampleArtifactTypePack,
} from '../lib/artifactTypes.js';

describe('artifact-type-store-without-render: store-only hosts must not fail the run (RFC 0071)', () => {
  it('a stored-but-unrendered artifact completes the run', async () => {
    const cap = await readArtifactTypesCap();
    if (!behaviorGate(PROFILE, artifactTypesSupported(cap))) return;
    // Only meaningful for a host that stores but does NOT render.
    // NOT a behaviorGate: this is a SHAPE precondition, not advertise-and-skip. A host that
    // renders is not failing to implement anything — this scenario simply does not apply to it.
    if (cap?.['store'] !== true || cap?.['render'] !== false) return softSkip('inapplicable', 'host does not advertise artifactTypes { store: true, render: false } — the store-without-render shape is not this host\'s');

    const { artifactTypeId, manifest, schema } = sampleArtifactTypePack();
    if (!behaviorGate(PROFILE, (await installArtifactTypePack(manifest, { [artifactTypeId]: schema })) !== null)) return;

    const produced = await produceArtifact(artifactTypeId, { title: 'Stored', body: 'Not rendered here' });
    if (!behaviorGatePresent(PROFILE, produced)) return; // seam absent: skip default, FAIL strict

    expect(
      produced.json['stored'],
      driver.describe('artifact-type-packs.md §host.artifactTypes', 'a host advertising store:true MUST persist the artifact'),
    ).toBe(true);
    expect(
      produced.json['rendered'],
      driver.describe('artifact-type-packs.md §host.artifactTypes', 'render:false host MUST NOT render'),
    ).toBe(false);
    expect(
      produced.json['runStatus'],
      driver.describe('artifact-type-packs.md §host.artifactTypes', 'a host MUST NOT fail the run solely because it lacks a renderer for a stored artifact type'),
    ).toBe('completed');
  });
});
