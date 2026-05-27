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
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
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
    if (!artifactTypesSupported(cap)) return; // unadvertised — soft-skip
    // Only meaningful for a host that stores but does NOT render.
    if (cap?.['store'] !== true || cap?.['render'] !== false) return; // not a store-without-render host — soft-skip

    const { artifactTypeId, manifest, schema } = sampleArtifactTypePack();
    if ((await installArtifactTypePack(manifest, { [artifactTypeId]: schema })) === null) return;

    const produced = await produceArtifact(artifactTypeId, { title: 'Stored', body: 'Not rendered here' });
    if (produced === null) return; // seam absent — soft-skip

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
