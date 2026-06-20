/**
 * Speech-synthesis capability advertisement shape (RFC 0105 §B) — server-free.
 *
 * Always-on schema-shape probe for the RFC 0105 TTS adapter. Verifies that:
 *   - `capabilities.aiProviders.speechSynthesis` is declared as the STRING
 *     const `"supported"` (a sibling of `byok` / `input` in the `aiProviders`
 *     block) — NOT an object. The const is what rejects an object-shaped
 *     advertisement.
 *   - `speechSynthesis` is NOT in `aiProviders.required`: absence is the
 *     default (a host WITHOUT TTS is a valid discovery doc).
 *   - via Ajv2020, a capabilities doc advertising
 *     `aiProviders: { supported: ['minimax'], speechSynthesis: 'supported' }`
 *     validates, while the object form
 *     `aiProviders: { speechSynthesis: { supported: true } }` FAILS (the const
 *     rejects the object).
 *
 * Behavioral assertions (the live `ctx.callSpeechSynthesizer` round-trip; the
 * unadvertised-host reject) are gated on
 * `aiProviders.speechSynthesis === 'supported'` and live in
 * `speech-synthesis-roundtrip.test.ts` / `speech-synthesis-unadvertised.test.ts`.
 * This scenario asserts the wire contract, not host behavior.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/host-capabilities.md (§host.aiProviders)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0105-speech-synthesis-adapter.md (§B)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';

/** Server-free assertion-message helper. */
const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

describe('aiproviders-speechsynth-shape: capability advertisement (RFC 0105 §B, server-free)', () => {
  it('aiProviders.speechSynthesis is declared as the string const "supported"', () => {
    const caps = loadSchema('capabilities.schema.json');
    const aiProviders = (caps.properties as Record<string, { properties?: Record<string, unknown> }>)
      .aiProviders;
    const speechSynthesis = aiProviders?.properties?.speechSynthesis as
      | { const?: unknown }
      | undefined;
    expect(
      speechSynthesis,
      why('host-capabilities.md §host.aiProviders', 'aiProviders.speechSynthesis MUST be declared'),
    ).toBeDefined();
    expect(
      speechSynthesis?.const,
      why('RFC 0105 §B', 'aiProviders.speechSynthesis MUST be the string const "supported" (not an object)'),
    ).toBe('supported');
  });

  it('speechSynthesis is NOT in aiProviders.required — absence (no TTS) is a valid default', () => {
    const caps = loadSchema('capabilities.schema.json');
    const aiProviders = (caps.properties as Record<string, { required?: unknown }>).aiProviders;
    const required = Array.isArray(aiProviders?.required) ? (aiProviders!.required as string[]) : [];
    expect(
      required.includes('speechSynthesis'),
      why('RFC 0105 §B', 'aiProviders.speechSynthesis MUST be optional (a host without TTS is valid)'),
    ).toBe(false);
  });

  it('Ajv accepts the string const form and rejects the object form', () => {
    // Compile ONLY the speechSynthesis subschema (`{ const: "supported" }`) — the
    // full capabilities.schema.json carries cross-file $refs that don't resolve
    // standalone; the const flag has none, so it validates in isolation.
    const caps = loadSchema('capabilities.schema.json');
    const aiProviders = (caps.properties as Record<string, { properties?: Record<string, unknown> }>).aiProviders;
    const speechSynthesisSchema = aiProviders?.properties?.speechSynthesis as Record<string, unknown>;

    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(speechSynthesisSchema);

    expect(
      validate('supported'),
      why('RFC 0105 §B', 'aiProviders.speechSynthesis === "supported" MUST validate'),
    ).toBe(true);

    expect(
      validate({ supported: true }),
      why('RFC 0105 §B', 'the object form { supported: true } MUST be rejected by the const'),
    ).toBe(false);
  });
});
