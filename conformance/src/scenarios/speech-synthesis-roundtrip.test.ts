/**
 * Speech-synthesis round-trip (RFC 0105 §A) — behavioral.
 *
 * Gated on `capabilities.aiProviders.speechSynthesis === 'supported'`
 * (root-first per RFC 0073). Soft-skips when unadvertised (default) /
 * hard-fails under `OPENWOP_REQUIRE_BEHAVIOR=true`. The always-on wire-shape
 * coverage lives in `aiproviders-speechsynth-shape.test.ts`; this asserts host
 * BEHAVIOR via the documented host-sample seam
 * `POST /v1/host/sample/ai/call-speech-synthesizer` (soft-skips on 404 until a
 * host wires it):
 *
 *   - the synthesizer returns 200 with an `audio` object;
 *   - EXACTLY ONE of `audio.url` / `audio.base64` is present (a host-served URL
 *     reference OR an inline base64 asset — never both, never neither);
 *   - `audio.mimeType` is a non-empty string;
 *   - `audio.voiceId` echoes the input `voiceId` (the opaque host-resolved id).
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0105-speech-synthesis-adapter.md (§A)
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/host-capabilities.md (§host.aiProviders)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const SEAM = '/v1/host/sample/ai/call-speech-synthesizer';
const VOICE_ID = 'host:narrator-test';

/** Pull the `audio` object out of a seam response body (tolerant). */
function audioOf(json: unknown): Record<string, unknown> | undefined {
  const a = (json as { audio?: unknown })?.audio;
  return a && typeof a === 'object' ? (a as Record<string, unknown>) : undefined;
}

describe('speech-synthesis-roundtrip (RFC 0105 §A)', () => {
  it('synthesizes an audio asset with exactly one of url/base64 and echoes the voiceId', async () => {
    const ai = await readCapabilityFamily<Record<string, unknown>>('aiProviders');
    const advertised = ai?.speechSynthesis === 'supported';
    if (!behaviorGate('openwop-speech-synthesis', advertised)) return;

    const res = await driver.post(SEAM, {
      text: 'Welcome to the weekly digest.',
      voiceId: VOICE_ID,
    });
    if (res.status === 404) return; // seam unwired — soft-skip the behavioral suite

    expect(
      res.status === 200,
      driver.describe('RFC 0105 §A', 'an advertised host MUST synthesize and return 200'),
    ).toBe(true);

    const audio = audioOf(res.json);
    expect(
      audio !== undefined,
      driver.describe('RFC 0105 §A', 'the response MUST carry an `audio` object'),
    ).toBe(true);
    if (!audio) return;

    const hasUrl = typeof audio.url === 'string' && (audio.url as string).length > 0;
    const hasBase64 = typeof audio.base64 === 'string' && (audio.base64 as string).length > 0;
    expect(
      hasUrl !== hasBase64,
      driver.describe('RFC 0105 §A', 'audio MUST carry EXACTLY ONE of `url` / `base64`'),
    ).toBe(true);

    expect(
      typeof audio.mimeType === 'string' && (audio.mimeType as string).length > 0,
      driver.describe('RFC 0105 §A', 'audio.mimeType MUST be a non-empty string'),
    ).toBe(true);

    expect(
      audio.voiceId === VOICE_ID,
      driver.describe('RFC 0105 §A', 'audio.voiceId MUST echo the input voiceId'),
    ).toBe(true);
  });
});
