/**
 * Chat card pack manifest validation — `chat-card-packs.md` §"Manifest format"
 * + `schemas/chat-card-pack-manifest.schema.json` (RFC 0071 Phase 2).
 *
 * Server-free schema-validation scenario for `kind: "card"` packs:
 *   1. Positive: a valid card manifest validates.
 *   2. Negative — kind/contents mismatch: cards[] + a foreign artifactTypes[]
 *      is rejected (additionalProperties -> pack_kind_invalid at the registry).
 *   3. Negative — empty cards[] (minItems).
 *   4. Negative — invalid cardTypeId (uppercase scope -> pattern).
 *   5. Negative — a card missing prompt (required).
 *   6. Negative — a non-portable inputs[].type that is neither in the closed
 *      enum nor a vendor-prefixed extension (`canvas-reference` -> pattern).
 *   7. Positive — a vendor.*-prefixed inputs[].type extension is tolerated.
 *
 * Behavioral execution (`chat-card-pack-execution.test.ts` — prompt routed
 * through ctx.aiEnvelope.generate, output validated against the linked
 * outputArtifactType, untrusted-input trust-tag propagation) is the Phase-2
 * `Active` gate (R2) and lands with a host advertising `host.chat.cardPacks`.
 *
 * @see spec/v1/chat-card-packs.md
 * @see schemas/chat-card-pack-manifest.schema.json
 * @see RFCS/0071-artifact-type-and-chat-card-packs.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

const SCHEMA_PATH = join(SCHEMAS_DIR, 'chat-card-pack-manifest.schema.json');

function validManifest() {
  return {
    kind: 'card',
    name: 'vendor.acme.cad-cards',
    version: '1.0.0',
    engines: { openwop: '>=1.1' },
    cards: [
      {
        cardTypeId: 'vendor.acme.cad.model.create',
        prompt: {
          template: 'Design a model for: {{spec}}',
          placeholderMapping: { spec: 'inputs.spec' },
          temperature: 0.2,
        },
        inputs: [{ id: 'spec', type: 'text', label: 'Part spec', required: true }],
        outputArtifactType: 'vendor.acme.cad.model',
        outputSchemaRef: 'schemas/cad-model.schema.json',
      },
    ],
  };
}

describe('category: chat-card-pack manifest validation', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')));

  const failsWith = (manifest: unknown, keyword: string): ErrorObject[] => {
    expect(validate(manifest)).toBe(false);
    return (validate.errors ?? []).filter((e) => e.keyword === keyword);
  };

  it('positive: a valid chat card pack manifest validates cleanly', () => {
    expect(
      validate(validManifest()),
      req('openwop.it.chat-card-pack-manifest-validation.positive-a-valid-chat-card-pack-manifest-validates-cleanly', 'chat-card-packs.md', `chat-card-packs.md §"Manifest format": a well-formed kind:"card" manifest MUST validate. Errors: ${JSON.stringify(validate.errors)}`),
    ).toBe(true);
  });

  it('negative: a manifest mixing cards[] and artifactTypes[] is rejected', () => {
    const manifest = { ...validManifest(), artifactTypes: [{ artifactTypeId: 'vendor.acme.x', schemaRef: 'x.json' }] };
    const errs = failsWith(manifest, 'additionalProperties');
    expect(
      errs.some((e) => (e.params as { additionalProperty?: string }).additionalProperty === 'artifactTypes'),
      req('openwop.it.chat-card-pack-manifest-validation.negative-a-manifest-mixing-cards-and-artifacttypes-is-rejected', 'chat-card-packs.md', 'chat-card-packs.md §"Pack kind": one kind per pack (additionalProperties:false)'),
    ).toBe(true);
  });

  it('negative: an empty cards[] is rejected', () => {
    expect(failsWith({ ...validManifest(), cards: [] }, 'minItems').length, req('openwop.it.chat-card-pack-manifest-validation.negative-an-empty-cards-is-rejected', 'chat-card-packs.md', 'negative: an empty cards[] is rejected')).toBeGreaterThan(0);
  });

  it('negative: an uppercase-scope cardTypeId is rejected', () => {
    const m = validManifest();
    m.cards[0]!.cardTypeId = 'Vendor.Acme.Card';
    expect(failsWith(m, 'pattern').length, req('openwop.it.chat-card-pack-manifest-validation.negative-an-uppercase-scope-cardtypeid-is-rejected', 'chat-card-packs.md', 'negative: an uppercase-scope cardTypeId is rejected')).toBeGreaterThan(0);
  });

  it('negative: a card missing prompt is rejected', () => {
    const m = validManifest();
    delete (m.cards[0] as { prompt?: unknown }).prompt;
    expect(failsWith(m, 'required').length, req('openwop.it.chat-card-pack-manifest-validation.negative-a-card-missing-prompt-is-rejected', 'chat-card-packs.md', 'negative: a card missing prompt is rejected')).toBeGreaterThan(0);
  });

  it('negative: a non-portable inputs[].type (canvas-reference) is rejected', () => {
    const m = validManifest();
    m.cards[0]!.inputs[0]!.type = 'canvas-reference';
    expect(
      failsWith(m, 'pattern').length,
      req('openwop.it.chat-card-pack-manifest-validation.negative-a-non-portable-inputs-type-canvas-reference-is-rejected', 'chat-card-packs.md', 'chat-card-packs.md §"Input fields": type is the closed portable enum OR a vendor.*/x- extension'),
    ).toBeGreaterThan(0);
  });

  it('positive: a vendor.*-prefixed inputs[].type extension is tolerated', () => {
    const m = validManifest();
    m.cards[0]!.inputs[0]!.type = 'vendor.myndhyve.canvas-ref';
    expect(
      validate(m),
      req('openwop.it.chat-card-pack-manifest-validation.positive-a-vendor-prefixed-inputs-type-extension-is-tolerated', 'chat-card-packs.md', 'chat-card-packs.md §"Input fields": a vendor.<org>.<kind> input type extension MUST validate (other hosts ignore it)'),
    ).toBe(true);
  });

  it('positive: the full portable inputs[].type subset validates (G9, incl. multiselect + file)', () => {
    for (const t of ['text', 'longtext', 'number', 'boolean', 'select', 'multiselect', 'file', 'artifact-ref']) {
      const m = validManifest();
      m.cards[0]!.inputs[0]!.type = t;
      expect(
        validate(m),
        req('openwop.it.chat-card-pack-manifest-validation.positive-the-full-portable-inputs-type-subset-validates-g9-incl-multiselect-file', 'chat-card-packs.md', `chat-card-packs.md §"Input fields": portable inputs[].type "${t}" MUST validate (G9 resolved 2026-05-27)`),
      ).toBe(true);
    }
  });
});
