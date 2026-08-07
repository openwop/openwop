/**
 * artifact-type-pack-install — RFC 0071 Phase 1 §"Binding the existing artifact
 * surfaces". A host that advertises `host.artifactTypes` installs an
 * artifact-type pack, then produces an artifact of a registered type:
 *
 *   - a payload that conforms to the pack schema is stored and surfaces an
 *     `artifact.created` with `registered: true` (validated against the pack);
 *   - a payload that violates the schema is rejected (not stored, no
 *     `registered: true` artifact.created).
 *
 * Gated on `capabilities.host.artifactTypes.supported` + the host-sample
 * install/produce seam; soft-skips when either is absent (`host-pending`
 * until a reference host wires RFC 0071 — see the migration request at
 * docs/openwop-adoption/0071-artifact-type-packs-migration-request.md).
 *
 * @see spec/v1/artifact-type-packs.md §"Binding the existing artifact surfaces"
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

describe('artifact-type-pack-install: registered artifacts are schema-validated (RFC 0071)', () => {
  it('a conforming payload yields artifact.created { registered: true }', async () => {
    if (!behaviorGate(PROFILE, artifactTypesSupported(await readArtifactTypesCap()))) return;
    const { artifactTypeId, manifest, schema } = sampleArtifactTypePack();

    const installed = await installArtifactTypePack(manifest, { [artifactTypeId]: schema });
    if (!behaviorGatePresent(PROFILE, installed)) return; // seam absent: skip default, FAIL strict
    expect(
      installed.status >= 200 && installed.status < 300,
      driver.describe('artifact-type-packs.md §"Pack kind"', 'a valid artifact-type pack MUST install cleanly'),
    ).toBe(true);

    const produced = await produceArtifact(artifactTypeId, { title: 'Hello', body: 'World' });
    if (!behaviorGatePresent(PROFILE, produced)) return; // seam absent: skip default, FAIL strict
    expect(
      produced.json['registered'],
      driver.describe('artifact-type-packs.md §"Binding the existing artifact surfaces"', 'a payload matching a registered artifactTypeId MUST be marked registered'),
    ).toBe(true);
    expect(
      produced.json['validated'],
      driver.describe('artifact-type-packs.md', 'the host MUST validate the payload against the pack schema before emitting artifact.created'),
    ).toBe(true);
    const evt = produced.json['artifactCreated'] as { registered?: unknown } | undefined;
    if (evt && 'registered' in evt) {
      expect(
        evt.registered,
        driver.describe('run-event-payloads.schema.json §artifactCreated', 'artifact.created.registered MUST be true for a validated registered artifact'),
      ).toBe(true);
    }
  });

  it('a schema-violating payload is rejected (not stored as a validated registered artifact)', async () => {
    if (!behaviorGate(PROFILE, artifactTypesSupported(await readArtifactTypesCap()))) return;
    const { artifactTypeId, manifest, schema } = sampleArtifactTypePack();
    if (!behaviorGate(PROFILE, (await installArtifactTypePack(manifest, { [artifactTypeId]: schema })) !== null)) return;

    // `body` missing + a foreign key → fails additionalProperties:false + required.
    const produced = await produceArtifact(artifactTypeId, { title: 'Hello', extra: true });
    if (!behaviorGatePresent(PROFILE, produced)) return;
    const rejected =
      produced.status >= 400 ||
      produced.json['validated'] === false ||
      produced.json['stored'] === false;
    expect(
      rejected,
      driver.describe('artifact-type-packs.md §"Binding the existing artifact surfaces"', 'a payload that fails the pack schema MUST NOT be emitted as a validated registered artifact'),
    ).toBe(true);
  });
});
