/**
 * Artifact-type pack manifest validation — `artifact-type-packs.md` §"Manifest format"
 * + `schemas/artifact-type-pack-manifest.schema.json` (RFC 0071 Phase 1).
 *
 * Server-free schema-validation scenario. Exercises the new
 * `artifact-type-pack-manifest.schema.json` with a positive sample and the
 * negative samples derived from the RFC's "Examples" section that are
 * expressible at the JSON-Schema layer:
 *
 *   1. Positive: a valid `kind: "artifact-type"` manifest with a single
 *      `artifactTypes[]` entry validates cleanly.
 *   2. Negative — kind/contents mismatch: a manifest carrying BOTH
 *      `artifactTypes[]` AND `nodes[]` is rejected. Surface-level outcome at
 *      the registry HTTP API is `pack_kind_invalid` per the spec;
 *      schema-level outcome is an `additionalProperties` violation on
 *      `nodes` (this schema does not declare that field).
 *   3. Negative — empty `artifactTypes[]`: rejected with a `minItems`
 *      violation (a pack MUST declare at least one artifact type).
 *   4. Negative — invalid `artifactTypeId`: a value that does not match the
 *      reverse-DNS pattern (e.g. an uppercase scope) is rejected with a
 *      `pattern` violation.
 *   5. Negative — unknown `rendering.display`: a value outside the closed
 *      enum (`"3d-viewport"`) is rejected with an `enum` violation
 *      (the RenderingHint vocabulary is reused from RFC 0055, `card` excluded).
 *   6. Negative — non-conforming `exportFormats` identifier: an uppercase /
 *      unprefixed value is rejected with a `pattern` violation (reserved-core
 *      + `vendor.*`/`x-` extension idiom).
 *
 * NOTE: the RFC's "core scope published from a non-core account" negative is a
 * registry-PUT enforcement rule (account ↔ scope binding), NOT a schema
 * constraint — `core.*` is a valid `artifactTypeId` pattern. It is therefore
 * not asserted here; it belongs to the capability-gated publish scenario.
 *
 * Capability-gated end-to-end scenarios (install + validate; store-without-
 * render negotiation) are deferred and gate on `host.artifactTypes.supported`
 * per the RFC; behavior grade is `host-pending` until a reference host lands.
 *
 * @see spec/v1/artifact-type-packs.md
 * @see schemas/artifact-type-pack-manifest.schema.json
 * @see RFCS/0071-artifact-type-and-chat-card-packs.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';
import { SCHEMAS_DIR } from '../lib/paths.js';

const SCHEMA_PATH = join(SCHEMAS_DIR, 'artifact-type-pack-manifest.schema.json');

function validManifest() {
  return {
    kind: 'artifact-type',
    name: 'vendor.acme.cad',
    version: '1.0.0',
    engines: { openwop: '>=1.1 <2.0.0' },
    artifactTypes: [
      {
        artifactTypeId: 'vendor.acme.cad.model',
        schemaVersion: 1,
        schemaRef: 'schemas/cad-model.schema.json',
        rendering: { display: 'file', mimeType: 'model/step' },
        exportFormats: ['step', 'stl', 'pdf'],
        syncOn: 'completion',
        supportsCheckpoint: true,
      },
    ],
  };
}

describe('category: artifact-type-pack manifest validation', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const validate = ajv.compile(schema);

  const failsWith = (manifest: unknown, keyword: string): ErrorObject[] => {
    const ok = validate(manifest);
    expect(ok).toBe(false);
    const errs = (validate.errors ?? []).filter((e) => e.keyword === keyword);
    return errs;
  };

  it('positive: a valid artifact-type pack manifest validates cleanly', () => {
    const ok = validate(validManifest());
    expect(
      ok,
      `artifact-type-packs.md §"Manifest format": a well-formed kind:"artifact-type" manifest MUST validate. Errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  it('negative: a manifest mixing artifactTypes[] and nodes[] is rejected (pack_kind_invalid at the registry)', () => {
    const manifest = { ...validManifest(), nodes: [{ typeId: 'vendor.acme.x', version: '1.0.0', category: 'data', role: 'pure' }] };
    const errs = failsWith(manifest, 'additionalProperties');
    expect(
      errs.some((e) => (e.params as { additionalProperty?: string }).additionalProperty === 'nodes'),
      'artifact-type-packs.md §"Pack kind": one kind per pack — a foreign `nodes[]` field MUST be rejected (additionalProperties:false)',
    ).toBe(true);
  });

  it('negative: an empty artifactTypes[] is rejected (a pack MUST declare ≥1 type)', () => {
    const manifest = { ...validManifest(), artifactTypes: [] };
    const errs = failsWith(manifest, 'minItems');
    expect(errs.length, 'artifact-type-pack-manifest.schema.json: artifactTypes minItems:1').toBeGreaterThan(0);
  });

  it('negative: an artifactTypeId that is not reverse-DNS scoped is rejected', () => {
    const manifest = validManifest();
    manifest.artifactTypes[0]!.artifactTypeId = 'Vendor.Acme.Model'; // uppercase scope
    const errs = failsWith(manifest, 'pattern');
    expect(errs.length, 'artifact-type-packs.md: artifactTypeId MUST match the reverse-DNS pattern').toBeGreaterThan(0);
  });

  it('negative: an unknown rendering.display value is rejected (closed RFC 0055 enum, card excluded)', () => {
    const manifest = validManifest();
    (manifest.artifactTypes[0]!.rendering as { display: string }).display = '3d-viewport';
    const errs = failsWith(manifest, 'enum');
    expect(errs.length, 'artifact-type-packs.md: rendering.display reuses the closed ai-envelope §"Rendering hints" enum').toBeGreaterThan(0);
  });

  it('negative: a non-conforming exportFormats identifier is rejected (reserved-core + vendor.*/x- only)', () => {
    const manifest = validManifest();
    manifest.artifactTypes[0]!.exportFormats = ['PPTX']; // uppercase, unprefixed
    const errs = failsWith(manifest, 'pattern');
    expect(errs.length, 'artifact-type-packs.md: exportFormats identifiers are lowercase core ids OR vendor.*/x- extensions').toBeGreaterThan(0);
  });
});
