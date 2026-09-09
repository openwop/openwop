/**
 * Multimodal perception input (RFC 0091).
 *
 * Always-on, server-free schema-shape probe of the additive
 * `capabilities.aiProviders.input` block: the `modalities` enum is closed
 * (text/image/audio/document) and `maxBytesPerPart` is a positive integer.
 *
 * Behavioral assertions (a host accepting an image ContentPart on callAI and
 * rejecting an unadvertised modality with `unsupported_modality`) are gated on
 * `aiProviders.input.modalities` and land with a reference host
 * (RFC 0091 §Conformance — deferred to Active → Accepted).
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0091-multimodal-perception-input.md
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/host-capabilities.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

const BASE = 'https://openwop.dev/spec/v1/';
function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

describe('aiproviders-input-shape: callAI perception input (RFC 0091 §B, server-free)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  for (const f of readdirSync(SCHEMAS_DIR)) {
    if (f.endsWith('.schema.json')) {
      try {
        ajv.addSchema(loadSchema(f));
      } catch {
        /* duplicate/ignore */
      }
    }
  }
  const input = ajv.getSchema(`${BASE}capabilities.schema.json#/properties/aiProviders/properties/input`);

  it('the aiProviders.input sub-schema exists', () => {
    expect(input, req('openwop.it.aiproviders-input-shape.the-aiproviders-input-sub-schema-exists', 'RFC 0091', 'capabilities.aiProviders.input MUST be declared')).toBeTruthy();
  });

  it('accepts a conforming modalities advertisement', () => {
    expect(
      input!({ modalities: ['text', 'image', 'document'], maxBytesPerPart: 1048576 }),
      req('openwop.it.aiproviders-input-shape.accepts-a-conforming-modalities-advertisement', 'RFC 0091 §B', 'a conforming input advertisement MUST validate'),
    ).toBe(true);
  });

  it('rejects an out-of-enum modality', () => {
    expect(
      input!({ modalities: ['text', 'video'] }),
      req('openwop.it.aiproviders-input-shape.rejects-an-out-of-enum-modality', 'RFC 0091 §B', 'modalities is a closed enum (text/image/audio/document)'),
    ).toBe(false);
  });

  it('rejects a non-positive maxBytesPerPart', () => {
    expect(
      input!({ modalities: ['text'], maxBytesPerPart: 0 }),
      req('openwop.it.aiproviders-input-shape.rejects-a-non-positive-maxbytesperpart', 'RFC 0091 §B', 'maxBytesPerPart MUST be a positive integer'),
    ).toBe(false);
  });
});
