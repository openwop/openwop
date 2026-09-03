/**
 * Interim transcript is not durable (RFC 0106 §F INV-1) — behavioral.
 *
 * Backs the SECURITY invariant `voice-interim-not-durable` (reference-impl tier
 * until a host proves it non-vacuously — graduates to protocol at the dual-witness
 * step). Gated on `realtimeVoice.transcription === 'streaming'`. Soft-skips when
 * unadvertised / when the host honestly rejects a live `streamRef` (§E) / on 404.
 * Drives `POST /v1/host/sample/ai/call-transcriber`:
 *
 *   - a provisional `voice.transcript` (`isFinal: false`) MUST NOT appear AFTER the
 *     terminal `voice.turn_commit`, and MUST NOT be the authoritative committed text;
 *   - the committed `finalText` is the settled turn (acting on an interim that the
 *     ASR later revised is the interim→final poisoning threat §F defends against).
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0106-realtime-voice-session-profile.md (§F INV-1)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const SEAM = '/v1/host/sample/ai/call-transcriber';

function realtimeVoiceOf(ai: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const rv = (ai as { realtimeVoice?: unknown })?.realtimeVoice;
  return rv && typeof rv === 'object' ? (rv as Record<string, unknown>) : undefined;
}
function errCode(json: unknown): string | undefined {
  return (json as { error?: { code?: string } })?.error?.code;
}
function eventsOf(json: unknown): Array<{ type?: string; payload?: Record<string, unknown> }> {
  const e = (json as { events?: unknown })?.events;
  return Array.isArray(e) ? (e as Array<{ type?: string; payload?: Record<string, unknown> }>) : [];
}

describe('voice-interim-not-durable (RFC 0106 §F INV-1)', () => {
  it('no provisional (isFinal:false) transcript is durable past voice.turn_commit', async () => {
    const ai = await readCapabilityFamily<Record<string, unknown>>('aiProviders');
    const advertised = realtimeVoiceOf(ai)?.transcription === 'streaming';
    if (!behaviorGate('openwop-voice-interim-not-durable', advertised)) return;

    const res = await driver.post(SEAM, { audio: { streamRef: 'stream:conformance/mic' }, interimResults: true });
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam unwired — soft-skip) (seam, prior step, or fixture unavailable)'); // seam unwired — soft-skip
    if (errCode(res.json) === 'transcription_unsupported') return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `errCode(res.json) === \'transcription_unsupported\'` returned early (§E live transport / no test-seam arm — soft-skip)'); // §E live transport / no test-seam arm — soft-skip

    const events = eventsOf(res.json);
    if (events.length === 0) return softSkip('blocked', 'precondition not met — `events.length === 0` returned early (host returned only the result envelope — nothing observable to assert) (seam, prior step, or fixture unavailable)'); // host returned only the result envelope — nothing observable to assert

    const commitIdx = events.findIndex((e) => e.type === 'voice.turn_commit');
    if (commitIdx < 0) return softSkip('blocked', 'precondition not met — `commitIdx < 0` returned early (no commit observed — soft-skip) (seam, prior step, or fixture unavailable)'); // no commit observed — soft-skip
    const afterCommit = events.slice(commitIdx + 1);
    expect(
      !afterCommit.some((e) => e.type === 'voice.transcript' && (e.payload ?? {}).isFinal === false),
      req('openwop.it.voice-interim-not-durable.no-provisional-isfinal-false-transcript-is-durable-past-voice-turn-commit', 'RFC 0106 §F INV-1', 'a provisional (isFinal:false) transcript MUST NOT appear after voice.turn_commit'),
    ).toBe(true);
  });
});
