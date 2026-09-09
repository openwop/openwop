/**
 * Barge-in: no partial-output leak (RFC 0106 §F INV-3) — behavioral.
 *
 * Backs the protocol-tier SECURITY invariant `voice-bargein-no-partial-leak`.
 * Gated on `capabilities.aiProviders.realtimeVoice.bargeIn === 'supported'`.
 * Soft-skips when unadvertised (default) / hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`. Drives `POST /v1/host/sample/voice/barge-in`
 * (soft-skips on 404):
 *
 *   - the host MUST emit `voice.barge_in` then `voice.cancelled` (distinct events);
 *   - NO `voice.synthesis_chunk` (nor any partial tool/model output) may appear
 *     AFTER the `voice.cancelled` — a cancellation is all-or-nothing and MUST NOT
 *     leak the un-guardrailed partial the end-of-turn pass would otherwise scrub.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0106-realtime-voice-session-profile.md (§F INV-3)
 *   - https://github.com/openwop/openwop/blob/main/SECURITY/invariants.yaml (voice-bargein-no-partial-leak)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const SEAM = '/v1/host/sample/voice/barge-in';

function realtimeVoiceOf(ai: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const rv = (ai as { realtimeVoice?: unknown })?.realtimeVoice;
  return rv && typeof rv === 'object' ? (rv as Record<string, unknown>) : undefined;
}
function eventsOf(json: unknown): Array<{ type?: string }> {
  const e = (json as { events?: unknown })?.events;
  return Array.isArray(e) ? (e as Array<{ type?: string }>) : [];
}

describe('voice-bargein-no-partial-leak (RFC 0106 §F INV-3)', () => {
  it('barge-in cancels with no synthesis chunk emitted after voice.cancelled', async () => {
    const ai = await readCapabilityFamily<Record<string, unknown>>('aiProviders');
    const advertised = realtimeVoiceOf(ai)?.bargeIn === 'supported';
    if (!behaviorGate('openwop-voice-bargein', advertised)) return;

    const res = await driver.post(SEAM, {});
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip

    expect(res.status === 200, req('openwop.it.voice-bargein-no-partial-leak.barge-in-cancels-with-no-synthesis-chunk-emitted-after-voice-cancelled', 'RFC 0106 §F', 'the barge-in seam MUST return 200')).toBe(true);

    const types = eventsOf(res.json).map((e) => e.type);
    const bargeIdx = types.indexOf('voice.barge_in');
    const cancelIdx = types.indexOf('voice.cancelled');
    expect(bargeIdx >= 0, req('openwop.it.voice-bargein-no-partial-leak.barge-in-cancels-with-no-synthesis-chunk-emitted-after-voice-cancelled', 'RFC 0106 §D', 'a barge-in MUST emit voice.barge_in')).toBe(true);
    expect(cancelIdx >= 0, req('openwop.it.voice-bargein-no-partial-leak.barge-in-cancels-with-no-synthesis-chunk-emitted-after-voice-cancelled', 'RFC 0106 §D', 'a barge-in that cancels work MUST emit voice.cancelled')).toBe(true);
    expect(cancelIdx > bargeIdx, req('openwop.it.voice-bargein-no-partial-leak.barge-in-cancels-with-no-synthesis-chunk-emitted-after-voice-cancelled', 'RFC 0106 §D', 'voice.cancelled MUST follow voice.barge_in')).toBe(true);

    // The load-bearing INV-3 assertion: nothing partial after the cancel.
    const afterCancel = types.slice(cancelIdx + 1);
    expect(
      !afterCancel.includes('voice.synthesis_chunk'),
      req('openwop.it.voice-bargein-no-partial-leak.barge-in-cancels-with-no-synthesis-chunk-emitted-after-voice-cancelled', 'RFC 0106 §F INV-3', 'NO voice.synthesis_chunk (partial output) may be emitted AFTER voice.cancelled'),
    ).toBe(true);
  });
});
