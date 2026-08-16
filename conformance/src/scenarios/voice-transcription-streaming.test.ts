/**
 * Streaming transcription round-trip (RFC 0106 §B) — behavioral.
 *
 * Gated on `capabilities.aiProviders.realtimeVoice.transcription === 'streaming'`.
 * Soft-skips when unadvertised (default) / hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`. Drives `POST /v1/host/sample/ai/call-transcriber`
 * (soft-skips on 404 and on `transcription_unsupported` — a host whose live-stream
 * transport is host-internal per §E honestly rejects a `streamRef`, so the
 * non-vacuous turn requires the deterministic test-seam arm
 * (`OPENWOP_TEST_SEAM_ENABLED`) or a finalized media asset):
 *
 *   - resolves with the settled turn (`finalText`, non-empty) at `voice.turn_commit`;
 *   - any emitted `voice.transcript` carries `contentTrust: "untrusted"` (§F);
 *   - the turn terminates with `voice.turn_commit`.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0106-realtime-voice-session-profile.md (§B, §F)
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/host-capabilities.md (§host.aiProviders)
 */

import { describe, it, expect } from 'vitest';
import { readErrorCode } from '../lib/error-envelope.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const SEAM = '/v1/host/sample/ai/call-transcriber';

function realtimeVoiceOf(ai: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const rv = (ai as { realtimeVoice?: unknown })?.realtimeVoice;
  return rv && typeof rv === 'object' ? (rv as Record<string, unknown>) : undefined;
}
function errCode(json: unknown): string | undefined {
  return readErrorCode(json);
}
function eventsOf(json: unknown): Array<{ type?: string; payload?: Record<string, unknown> }> {
  const e = (json as { events?: unknown })?.events;
  return Array.isArray(e) ? (e as Array<{ type?: string; payload?: Record<string, unknown> }>) : [];
}

describe('voice-transcription-streaming (RFC 0106 §B)', () => {
  it('resolves a settled turn at voice.turn_commit with untrusted transcript events', async () => {
    const ai = await readCapabilityFamily<Record<string, unknown>>('aiProviders');
    const advertised = realtimeVoiceOf(ai)?.transcription === 'streaming';
    if (!behaviorGate('openwop-voice-transcription', advertised)) return;

    const res = await driver.post(SEAM, { audio: { streamRef: 'stream:conformance/mic' }, languageCode: 'en-US' });
    if (res.status === 404) return; // seam unwired — soft-skip
    // §E: a stateless host with no live transport honestly rejects a live streamRef.
    if (errCode(res.json) === 'transcription_unsupported') return; // soft-skip (no live transport / no test-seam arm)

    expect(res.status === 200, driver.describe('RFC 0106 §B', 'a produced turn MUST return 200')).toBe(true);

    const finalText = (res.json as { finalText?: unknown })?.finalText;
    expect(typeof finalText === 'string' && (finalText as string).length > 0, driver.describe('RFC 0106 §B', 'the turn MUST resolve a non-empty finalText at turn_commit')).toBe(true);

    const events = eventsOf(res.json);
    if (events.length > 0) {
      for (const ev of events.filter((e) => e.type === 'voice.transcript')) {
        expect((ev.payload ?? {}).contentTrust === 'untrusted', driver.describe('RFC 0106 §F INV-2', 'every voice.transcript MUST carry contentTrust:"untrusted"')).toBe(true);
      }
      expect(events.some((e) => e.type === 'voice.turn_commit'), driver.describe('RFC 0106 §B', 'the turn MUST terminate with voice.turn_commit')).toBe(true);
    }
  });
});
