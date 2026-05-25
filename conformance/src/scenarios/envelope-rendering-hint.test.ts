/**
 * envelope-rendering-hint — RFC 0055 §B `meta.rendering` shape conformance.
 *
 * Server-free schema assertions that the optional rendering hint is exactly
 * that — optional and additive:
 *   1. An envelope WITH a well-formed `meta.rendering` validates.
 *   2. An envelope WITHOUT `meta.rendering` still validates (proves the
 *      property is optional — existing envelopes are unaffected).
 *   3. An unknown `display` value is rejected by the closed enum (the
 *      vocabulary is fixed; consumers fall back, producers don't invent).
 *   4. An unknown property under `rendering` is rejected
 *      (additionalProperties:false on the hint object).
 *
 * Always runs (pure on-disk Ajv2020 validation).
 *
 * @see RFCS/0055-multimodal-envelope-variants-and-rendering-hints.md §B
 * @see spec/v1/ai-envelope.md §"Rendering hints"
 * @see schemas/ai-envelope.schema.json ($defs.EnvelopeMeta.rendering)
 */

import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from '../lib/paths.js';

function compileEnvelope(): ReturnType<Ajv2020['compile']> {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const schema = JSON.parse(
    readFileSync(join(SCHEMAS_DIR, 'ai-envelope.schema.json'), 'utf8'),
  ) as Record<string, unknown>;
  return ajv.compile(schema);
}

const baseEnvelope = {
  type: 'error',
  schemaVersion: 1,
  envelopeId: 'env-rendering-1',
  correlationId: 'run-1:node-2:turn-0:abc123',
  payload: { code: 'x', message: 'y' },
  meta: { source: 'ai-generation' as const, ts: '2026-05-25T10:00:00Z' },
};

describe('envelope-rendering-hint: meta.rendering shape (RFC 0055 §B)', () => {
  const validate = compileEnvelope();

  it('accepts an envelope carrying a well-formed meta.rendering hint', () => {
    const env = {
      ...baseEnvelope,
      meta: {
        ...baseEnvelope.meta,
        rendering: { display: 'image', mimeType: 'image/png', alt: 'Q3 revenue chart', title: 'Revenue' },
      },
    };
    const ok = validate(env);
    expect(
      ok,
      'ai-envelope.md §"Rendering hints": ' + `meta.rendering MUST validate; errors: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
  });

  it('accepts an envelope with NO meta.rendering (proves the property is optional)', () => {
    const ok = validate(baseEnvelope);
    expect(
      ok,
      'ai-envelope.md §"Rendering hints": ' + 'meta.rendering MUST be optional — envelopes omitting it still validate',
    ).toBe(true);
  });

  it('rejects an unknown display value (closed enum)', () => {
    const env = {
      ...baseEnvelope,
      meta: { ...baseEnvelope.meta, rendering: { display: 'hologram' } },
    };
    const ok = validate(env);
    expect(
      ok,
      'ai-envelope.md §"Rendering hints": ' + 'display is a closed enum — unknown families MUST be rejected',
    ).toBe(false);
  });

  it('rejects an unknown property under rendering (additionalProperties:false)', () => {
    const env = {
      ...baseEnvelope,
      meta: { ...baseEnvelope.meta, rendering: { display: 'markdown', wat: true } },
    };
    const ok = validate(env);
    expect(
      ok,
      'ai-envelope.md §"Rendering hints": ' + 'rendering is additionalProperties:false',
    ).toBe(false);
  });
});
