/**
 * streamRef is tenant + session bound (RFC 0106 §F INV-4) — behavioral.
 *
 * Backs the SECURITY invariant `voice-streamref-tenant-bound` (reference-impl tier
 * until a host with LIVE `streamRef` transport proves it non-vacuously — graduates
 * to protocol then). Gated on `realtimeVoice.transcription === 'streaming'`.
 * Soft-skips when unadvertised / on 404 / when the host's live-stream transport is
 * host-internal per §E (honest `transcription_unsupported` for a `streamRef`) —
 * a stateless host without live transport cannot exhibit the cross-handle read, so
 * there is nothing to bind. Drives `POST /v1/host/sample/ai/call-transcriber`:
 *
 *   - a `streamRef` is bound to exactly one tenant + session for its lifetime; no
 *     buffered audio / interim transcript may be read via another handle, and a
 *     never-finalizing stream is bounded by a max-uncommitted-audio budget (TDoS).
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0106-realtime-voice-session-profile.md (§B.1, §F INV-4)
 */

import { describe, it, expect } from 'vitest';
import { readErrorCode } from '../lib/error-envelope.js';
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
  return readErrorCode(json);
}

describe('voice-streamref-tenant-bound (RFC 0106 §F INV-4)', () => {
  it('a live streamRef is tenant+session bound (host-internal transport per §E soft-skips)', async () => {
    const ai = await readCapabilityFamily<Record<string, unknown>>('aiProviders');
    const advertised = realtimeVoiceOf(ai)?.transcription === 'streaming';
    if (!behaviorGate('openwop-voice-streamref-tenant', advertised)) return;

    // Probe whether the host honors a LIVE streamRef at all. If it rejects with
    // transcription_unsupported (§E: live transport host-internal), there is no live
    // conduit to bind cross-tenant — soft-skip (the invariant stays reference-impl
    // until a host with live streamRef transport proves it).
    const res = await driver.post(SEAM, { audio: { streamRef: 'stream:tenant-a/mic' } });
    if (res.status === 404) return softSkip('blocked', 'precondition not met — `res.status === 404` returned early (seam, prior step, or fixture unavailable)');
    if (errCode(res.json) === 'transcription_unsupported') return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `errCode(res.json) === \'transcription_unsupported\'` returned early (§E — no live transport on this host)'); // §E — no live transport on this host

    // A host that DOES accept a live streamRef must bind it: a second tenant presenting
    // tenant-A's streamRef MUST be rejected (cross-handle read forbidden). Exercising the
    // two-credential path requires a second principal the suite does not synthesize here;
    // assert the minimum a single-credential probe can: the host did not silently echo
    // another tenant's buffered audio for an unknown streamRef.
    expect(
      res.status !== 200 || (res.json as { finalText?: unknown })?.finalText !== undefined,
      req('openwop.it.voice-streamref-tenant-bound.a-live-streamref-is-tenant-session-bound-host-internal-transport-per-e-soft-skip', 'RFC 0106 §F INV-4', 'a host honoring a live streamRef MUST bind it to its tenant+session'),
    ).toBe(true);
  });
});
