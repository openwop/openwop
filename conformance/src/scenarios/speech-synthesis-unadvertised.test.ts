/**
 * Speech-synthesis on an unadvertised host (RFC 0105 §C) — behavioral.
 *
 * The mirror of `speech-synthesis-roundtrip.test.ts`: a host that does NOT
 * advertise `capabilities.aiProviders.speechSynthesis === 'supported'` MUST
 * REJECT a `ctx.callSpeechSynthesizer` call with the canonical
 * `speech_synthesis_unsupported` error — never a 200 success, never a silent
 * no-op (parallel to RFC 0091's `unsupported_modality`).
 *
 * Gating is BY ABSENCE: the leg is active precisely when TTS is NOT advertised
 * (`behaviorGate('openwop-speech-synthesis-unadvertised', !advertised)`), so
 * it soft-skips on a host that DOES advertise (where the round-trip leg runs
 * instead) / hard-fails under `OPENWOP_REQUIRE_BEHAVIOR=true` when the seam is
 * wired but the host fails to reject. Exercised via the documented host-sample
 * seam `POST /v1/host/sample/ai/call-speech-synthesizer` (soft-skips on 404
 * until a host wires it).
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0105-speech-synthesis-adapter.md (§C)
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/host-capabilities.md (§host.aiProviders)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const SEAM = '/v1/host/sample/ai/call-speech-synthesizer';

/** Read the canonical error code from a seam response body (tolerant of
 *  `{error}` / `{code}` / `{error:{code}}` shapes) — mirrors
 *  `callai-multimodal.test.ts`'s `errCode`. */
function errCode(json: unknown): string | undefined {
  const j = json as { error?: unknown; code?: unknown };
  if (typeof j?.code === 'string') return j.code;
  if (typeof j?.error === 'string') return j.error;
  const e = j?.error as { code?: unknown } | undefined;
  if (e && typeof e.code === 'string') return e.code;
  return undefined;
}

describe('speech-synthesis-unadvertised (RFC 0105 §C)', () => {
  it('a host NOT advertising speechSynthesis MUST reject the call with speech_synthesis_unsupported', async () => {
    const ai = await readCapabilityFamily<Record<string, unknown>>('aiProviders');
    const advertised = ai?.speechSynthesis === 'supported';
    // Active precisely when TTS is ABSENT but the seam exists.
    if (!behaviorGate('openwop-speech-synthesis-unadvertised', !advertised)) return;

    const res = await driver.post(SEAM, {
      text: 'Welcome to the weekly digest.',
      voiceId: 'host:narrator-test',
    });
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip

    // MUST reject — never a 200 success, never a silent no-op.
    expect(
      res.status !== 200,
      req('openwop.it.speech-synthesis-unadvertised.a-host-not-advertising-speechsynthesis-must-reject-the-call-with-speech-synthesi', 'RFC 0105 §C', 'an unadvertising host MUST NOT return a 200 success (never a no-op)'),
    ).toBe(true);
    expect(
      errCode(res.json) === 'speech_synthesis_unsupported',
      req('openwop.it.speech-synthesis-unadvertised.a-host-not-advertising-speechsynthesis-must-reject-the-call-with-speech-synthesi', 'RFC 0105 §C', 'the call MUST be rejected with `speech_synthesis_unsupported`'),
    ).toBe(true);
  });
});
