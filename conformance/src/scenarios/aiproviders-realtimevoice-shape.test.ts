/**
 * Real-time voice capability advertisement shape (RFC 0106 §A) — server-free.
 *
 * Always-on schema-shape probe for the RFC 0106 real-time voice profile. Verifies that:
 *   - `capabilities.aiProviders.realtimeVoice` is an OBJECT sibling of `speechSynthesis`/
 *     `input` in the `aiProviders` block, with the sub-flags `transcription`
 *     (const `"streaming"`), `synthesis` (const `"streaming"`), `turnDetection`
 *     (enum `vad|semantic`), and `bargeIn` (const `"supported"`).
 *   - `realtimeVoice` is NOT in `aiProviders.required`: absence is the default (a host
 *     WITHOUT live voice is a valid discovery doc).
 *   - the §A closures hold via Ajv2020: `turnDetection`/`bargeIn` imply `transcription`
 *     (`dependentRequired`), and `realtimeVoice.synthesis` implies
 *     `aiProviders.speechSynthesis` (the if/then on the `aiProviders` block).
 *
 * Behavioral assertions (the live `ctx.callTranscriber` Promise-resolves-at-turn_commit
 * + `voice.*` emission; the unadvertised-host reject; the streaming synthesis arm) are
 * gated on `aiProviders.realtimeVoice.{transcription,synthesis}` and live in the gated
 * `voice-transcription-streaming.test.ts` / `voice-transcription-unadvertised.test.ts` /
 * `voice-synthesis-streaming.test.ts` scenarios. This scenario asserts the wire contract,
 * not host behavior.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/host-capabilities.md (§host.aiProviders)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0106-realtime-voice-session-profile.md (§A, §B)
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

function aiProvidersSchema(): Record<string, unknown> {
  const caps = loadSchema('capabilities.schema.json');
  return (caps.properties as Record<string, Record<string, unknown>>).aiProviders;
}

describe('aiproviders-realtimevoice-shape: capability advertisement (RFC 0106 §A, server-free)', () => {
  it('aiProviders.realtimeVoice is an object with the four sub-flags', () => {
    const realtimeVoice = (aiProvidersSchema().properties as Record<string, { type?: unknown; properties?: Record<string, unknown> }>)
      .realtimeVoice;
    expect(
      realtimeVoice,
      why('host-capabilities.md §host.aiProviders', 'aiProviders.realtimeVoice MUST be declared'),
    ).toBeDefined();
    expect(realtimeVoice?.type, why('RFC 0106 §A', 'realtimeVoice MUST be an object')).toBe('object');
    const props = realtimeVoice?.properties ?? {};
    for (const flag of ['transcription', 'synthesis', 'turnDetection', 'bargeIn']) {
      expect(
        Object.prototype.hasOwnProperty.call(props, flag),
        why('RFC 0106 §A', `realtimeVoice.${flag} MUST be declared`),
      ).toBe(true);
    }
  });

  it('realtimeVoice is NOT in aiProviders.required — absence (no live voice) is a valid default', () => {
    const aiProviders = aiProvidersSchema() as { required?: unknown };
    const required = Array.isArray(aiProviders.required) ? (aiProviders.required as string[]) : [];
    expect(
      required.includes('realtimeVoice'),
      why('RFC 0106 §A', 'aiProviders.realtimeVoice MUST be optional (a host without live voice is valid)'),
    ).toBe(false);
  });

  it('Ajv: the realtimeVoice subschema accepts the floor and enforces the turnDetection/bargeIn ⇒ transcription closure', () => {
    const realtimeVoice = (aiProvidersSchema().properties as Record<string, Record<string, unknown>>).realtimeVoice;
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(realtimeVoice);

    expect(
      validate({ transcription: 'streaming', turnDetection: 'semantic', bargeIn: 'supported' }),
      why('RFC 0106 §A', 'a full transcription advertisement MUST validate'),
    ).toBe(true);
    expect(validate({}), why('RFC 0106 §A', 'an empty realtimeVoice object MUST validate')).toBe(true);
    expect(
      validate({ turnDetection: 'semantic' }),
      why('RFC 0106 §A', 'turnDetection without transcription MUST be rejected (dependentRequired)'),
    ).toBe(false);
    expect(
      validate({ bargeIn: 'supported' }),
      why('RFC 0106 §A', 'bargeIn without transcription MUST be rejected (dependentRequired)'),
    ).toBe(false);
    expect(
      validate({ transcription: 'streaming', turnDetection: 'aggressive' }),
      why('RFC 0106 §A', 'an out-of-enum turnDetection MUST be rejected'),
    ).toBe(false);
    expect(
      validate({ transcription: true }),
      why('RFC 0106 §A', 'transcription MUST be the string const "streaming", not a boolean'),
    ).toBe(false);
  });

  it('Ajv: the aiProviders subschema enforces realtimeVoice.synthesis ⇒ speechSynthesis', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(aiProvidersSchema());

    expect(
      validate({ realtimeVoice: { transcription: 'streaming', synthesis: 'streaming' } }),
      why('RFC 0106 §A', 'streaming synthesis without speechSynthesis: "supported" MUST be rejected'),
    ).toBe(false);
    expect(
      validate({ speechSynthesis: 'supported', realtimeVoice: { transcription: 'streaming', synthesis: 'streaming' } }),
      why('RFC 0106 §A', 'streaming synthesis WITH speechSynthesis: "supported" MUST validate'),
    ).toBe(true);
    expect(
      validate({ realtimeVoice: { transcription: 'streaming' } }),
      why('RFC 0106 §A', 'transcription-only (no synthesis) MUST validate without speechSynthesis'),
    ).toBe(true);
  });
});
