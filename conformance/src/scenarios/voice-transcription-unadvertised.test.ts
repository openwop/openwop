/**
 * Streaming transcription on an unadvertising host (RFC 0106 §B) — behavioral.
 *
 * Gated by ABSENCE: active precisely when `realtimeVoice.transcription` is NOT
 * advertised but the seam exists. Soft-skips otherwise (default) / hard-fails
 * under `OPENWOP_REQUIRE_BEHAVIOR=true`. A host that does NOT advertise streaming
 * transcription MUST reject `ctx.callTranscriber` with `transcription_unsupported`
 * (never a 200 success, never a silent no-op) — paralleling RFC 0105's
 * `speech_synthesis_unsupported` / RFC 0091's `unsupported_modality`.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0106-realtime-voice-session-profile.md (§B)
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/host-capabilities.md (§host.aiProviders Failure modes)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const SEAM = '/v1/host/sample/ai/call-transcriber';

function realtimeVoiceOf(ai: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const rv = (ai as { realtimeVoice?: unknown })?.realtimeVoice;
  return rv && typeof rv === 'object' ? (rv as Record<string, unknown>) : undefined;
}
function errCode(json: unknown): string | undefined {
  return (json as { error?: { code?: string } })?.error?.code;
}

describe('voice-transcription-unadvertised (RFC 0106 §B)', () => {
  it('a host NOT advertising realtimeVoice.transcription MUST reject with transcription_unsupported', async () => {
    const ai = await readCapabilityFamily<Record<string, unknown>>('aiProviders');
    const advertised = realtimeVoiceOf(ai)?.transcription === 'streaming';
    if (!behaviorGate('openwop-voice-transcription-unadvertised', !advertised)) return;

    const res = await driver.post(SEAM, { audio: { streamRef: 'stream:conformance/mic' } });
    if (res.status === 404) return; // seam unwired — soft-skip

    expect(res.status !== 200, driver.describe('RFC 0106 §B', 'an unadvertising host MUST NOT return a 200 (never a no-op)')).toBe(true);
    expect(
      errCode(res.json) === 'transcription_unsupported',
      driver.describe('RFC 0106 §B', 'the call MUST be rejected with `transcription_unsupported`'),
    ).toBe(true);
  });
});
