/**
 * Streaming speech-synthesis arm (RFC 0106 §C) — behavioral.
 *
 * Gated on `capabilities.aiProviders.realtimeVoice.synthesis === 'streaming'`
 * (root-first per RFC 0073). Soft-skips when unadvertised (default) / hard-fails
 * under `OPENWOP_REQUIRE_BEHAVIOR=true`. Drives the documented host-sample seam
 * `POST /v1/host/sample/ai/call-speech-synthesizer` with `stream: true`
 * (soft-skips on 404 until a host wires it):
 *
 *   - returns 200 with the finalized RFC 0105 `audio` asset (EXACTLY ONE of
 *     `url` / `base64`) — `stream: true` resolves the Promise at completion,
 *     unchanged whole-file result shape;
 *   - emits `voice.synthesis_chunk` run-events carrying METADATA ONLY
 *     (`seq` + `mimeType`; bytes by `url`/`streamRef`, NOT inline base64 past
 *     the host cap — the G8 event-log-bounded rule), with a terminal `final: true`.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0106-realtime-voice-session-profile.md (§C)
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/host-capabilities.md (§host.aiProviders)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const SEAM = '/v1/host/sample/ai/call-speech-synthesizer';

function realtimeVoiceOf(ai: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const rv = (ai as { realtimeVoice?: unknown })?.realtimeVoice;
  return rv && typeof rv === 'object' ? (rv as Record<string, unknown>) : undefined;
}
function eventsOf(json: unknown): Array<{ type?: string; payload?: Record<string, unknown> }> {
  const e = (json as { events?: unknown })?.events;
  return Array.isArray(e) ? (e as Array<{ type?: string; payload?: Record<string, unknown> }>) : [];
}

describe('voice-synthesis-streaming (RFC 0106 §C)', () => {
  it('stream:true resolves the finalized asset and emits metadata-only voice.synthesis_chunk events', async () => {
    const ai = await readCapabilityFamily<Record<string, unknown>>('aiProviders');
    const advertised = realtimeVoiceOf(ai)?.synthesis === 'streaming';
    if (!behaviorGate('openwop-voice-synthesis', advertised)) return;

    const res = await driver.post(SEAM, { text: 'Welcome to the weekly digest.', voiceId: 'host:narrator-test', stream: true });
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip

    expect(
      res.status === 200,
      req('openwop.it.voice-synthesis-streaming.stream-true-resolves-the-finalized-asset-and-emits-metadata-only-voice-synthesis', 'RFC 0106 §C', 'an advertised host MUST resolve stream:true with 200'),
    ).toBe(true);

    const audio = (res.json as { audio?: Record<string, unknown> })?.audio;
    expect(audio !== undefined, req('openwop.it.voice-synthesis-streaming.stream-true-resolves-the-finalized-asset-and-emits-metadata-only-voice-synthesis', 'RFC 0106 §C', 'the response MUST carry the finalized `audio` asset')).toBe(true);
    if (audio) {
      const hasUrl = typeof audio.url === 'string' && (audio.url as string).length > 0;
      const hasB64 = typeof audio.base64 === 'string' && (audio.base64 as string).length > 0;
      expect(hasUrl !== hasB64, req('openwop.it.voice-synthesis-streaming.stream-true-resolves-the-finalized-asset-and-emits-metadata-only-voice-synthesis', 'RFC 0106 §C', 'audio MUST carry EXACTLY ONE of url/base64')).toBe(true);
    }

    const chunks = eventsOf(res.json).filter((e) => e.type === 'voice.synthesis_chunk');
    expect(chunks.length >= 1, req('openwop.it.voice-synthesis-streaming.stream-true-resolves-the-finalized-asset-and-emits-metadata-only-voice-synthesis', 'RFC 0106 §C', 'MUST emit ≥1 voice.synthesis_chunk run-event')).toBe(true);
    for (const c of chunks) {
      const p = c.payload ?? {};
      expect(typeof p.seq === 'number', req('openwop.it.voice-synthesis-streaming.stream-true-resolves-the-finalized-asset-and-emits-metadata-only-voice-synthesis', 'RFC 0106 §C', 'each chunk carries a numeric seq')).toBe(true);
      expect(typeof p.mimeType === 'string', req('openwop.it.voice-synthesis-streaming.stream-true-resolves-the-finalized-asset-and-emits-metadata-only-voice-synthesis', 'RFC 0106 §C', 'each chunk carries a mimeType')).toBe(true);
      // Metadata-only: bytes by reference. An inline base64 is permitted ONLY under the host cap;
      // a chunk over the RFC 0055 256 KiB inline cap MUST be a url/streamRef reference.
      if (typeof p.base64 === 'string') {
        expect((p.base64 as string).length <= 262144, req('openwop.it.voice-synthesis-streaming.stream-true-resolves-the-finalized-asset-and-emits-metadata-only-voice-synthesis', 'RFC 0106 §C (G8)', 'inline chunk base64 MUST stay under the 256 KiB cap; else url/streamRef')).toBe(true);
      }
    }
    expect(
      chunks.some((c) => (c.payload ?? {}).final === true),
      req('openwop.it.voice-synthesis-streaming.stream-true-resolves-the-finalized-asset-and-emits-metadata-only-voice-synthesis', 'RFC 0106 §C', 'a terminal chunk MUST carry final:true'),
    ).toBe(true);
  });
});
