/**
 * Voice run-event payload shapes (RFC 0106 §B/§C/§D) — server-free.
 *
 * Always-on schema-shape probe for the `voice.*` run-event taxonomy — the single
 * canonical record of a live voice turn (the `ctx.callTranscriber` Promise resolves
 * at `turn_commit`; the events ARE the streaming representation). Verifies that:
 *   - all seven `voice.*` types are members of `run-event.schema.json#$defs.RunEventType`;
 *   - each has a payload `$def` in `run-event-payloads.schema.json` reachable via the
 *     `typeIndex` lookup map;
 *   - `voice.transcript` REQUIRES `contentTrust: "untrusted"` — the schema-enforced wire
 *     half of SECURITY invariant `voice-transcript-untrusted` (live transcript is
 *     untrusted ingress and MUST NOT be promoted to system/developer authority);
 *   - `voice.synthesis_chunk` is metadata-shaped (seq + mimeType required; bytes by
 *     `url`/`streamRef`, inline `base64` optional-only) — backing the G8 metadata-only
 *     event-log rule (`voice-streamref-tenant-bound` keeps the log bounded);
 *   - the content-free events (`speech_start`/`endpoint_candidate`/`turn_commit`/
 *     `barge_in`/`cancelled`) reject an unknown property (`additionalProperties:false`).
 *
 * The behavioral legs (interim-not-durable, barge-in no-partial-leak, streamRef
 * tenant-binding, the live `callTranscriber` Promise + emission) are the gated
 * reference-host scenarios that land at `Active → Accepted` — those invariants are
 * reference-impl tier until a host proves them non-vacuously.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0106-realtime-voice-session-profile.md (§B, §C, §D, §F)
 *   - https://github.com/openwop/openwop/blob/main/schemas/run-event-payloads.schema.json
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

function loadSchema(name: string): Record<string, any> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, any>;
}

const VOICE_TYPES = [
  'voice.speech_start',
  'voice.transcript',
  'voice.endpoint_candidate',
  'voice.turn_commit',
  'voice.synthesis_chunk',
  'voice.barge_in',
  'voice.cancelled',
] as const;

const DEF_KEY: Record<string, string> = {
  'voice.speech_start': 'voiceSpeechStart',
  'voice.transcript': 'voiceTranscript',
  'voice.endpoint_candidate': 'voiceEndpointCandidate',
  'voice.turn_commit': 'voiceTurnCommit',
  'voice.synthesis_chunk': 'voiceSynthesisChunk',
  'voice.barge_in': 'voiceBargeIn',
  'voice.cancelled': 'voiceCancelled',
};

describe('voice-event-payloads-shape: the voice.* run-event taxonomy (RFC 0106 §B/§C/§D, server-free)', () => {
  it('all seven voice.* types are in the RunEventType enum', () => {
    const enumVals: string[] = loadSchema('run-event.schema.json').$defs.RunEventType.enum;
    for (const t of VOICE_TYPES) {
      expect(enumVals.includes(t), req('openwop.it.voice-event-payloads-shape.all-seven-voice-types-are-in-the-runeventtype-enum', 'run-event.schema.json §RunEventType', `${t} MUST be a RunEventType`)).toBe(true);
    }
  });

  it('each voice.* type has a payload $def reachable via typeIndex', () => {
    const payloads = loadSchema('run-event-payloads.schema.json');
    const typeIndex = payloads.$defs._typeIndex.properties as Record<string, { $ref: string }>;
    for (const t of VOICE_TYPES) {
      expect(typeIndex[t], req('openwop.it.voice-event-payloads-shape.each-voice-type-has-a-payload-def-reachable-via-typeindex', 'run-event-payloads.schema.json §typeIndex', `${t} MUST map to a $def`)).toBeDefined();
      expect(payloads.$defs[DEF_KEY[t]], req('openwop.it.voice-event-payloads-shape.each-voice-type-has-a-payload-def-reachable-via-typeindex', 'run-event-payloads.schema.json', `$defs.${DEF_KEY[t]} MUST exist`)).toBeDefined();
    }
  });

  it('voice.transcript REQUIRES contentTrust:"untrusted" (SECURITY: voice-transcript-untrusted)', () => {
    const def = loadSchema('run-event-payloads.schema.json').$defs.voiceTranscript;
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(def);

    expect(
      validate({ text: 'book a table', isFinal: true, atMs: 1200, contentTrust: 'untrusted' }),
      req('openwop.it.voice-event-payloads-shape.voice-transcript-requires-contenttrust-untrusted-security-voice-transcript-untru', 'RFC 0106 §F INV-2', 'a transcript marked untrusted MUST validate'),
    ).toBe(true);
    expect(
      validate({ text: 'book a table', isFinal: true, atMs: 1200 }),
      req('openwop.it.voice-event-payloads-shape.voice-transcript-requires-contenttrust-untrusted-security-voice-transcript-untru', 'RFC 0106 §F INV-2 (voice-transcript-untrusted)', 'a transcript WITHOUT contentTrust MUST be rejected'),
    ).toBe(false);
    expect(
      validate({ text: 'book a table', isFinal: true, atMs: 1200, contentTrust: 'trusted' }),
      req('openwop.it.voice-event-payloads-shape.voice-transcript-requires-contenttrust-untrusted-security-voice-transcript-untru', 'RFC 0106 §F INV-2 (voice-transcript-untrusted)', 'contentTrust MUST be the const "untrusted" — never promoted'),
    ).toBe(false);
  });

  it('voice.synthesis_chunk is metadata-shaped (seq+mimeType required; bytes by reference, inline base64 optional)', () => {
    const def = loadSchema('run-event-payloads.schema.json').$defs.voiceSynthesisChunk;
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(def);

    expect(
      validate({ seq: 0, mimeType: 'audio/mpeg', durationMs: 240, url: 'https://host/seg/0', final: false }),
      req('openwop.it.voice-event-payloads-shape.voice-synthesis-chunk-is-metadata-shaped-seq-mimetype-required-bytes-by-referenc', 'RFC 0106 §C', 'a metadata chunk referencing bytes by url MUST validate'),
    ).toBe(true);
    expect(
      validate({ mimeType: 'audio/mpeg' }),
      req('openwop.it.voice-event-payloads-shape.voice-synthesis-chunk-is-metadata-shaped-seq-mimetype-required-bytes-by-referenc', 'RFC 0106 §C', 'a chunk without seq MUST be rejected'),
    ).toBe(false);
  });

  it('content-free voice events reject unknown properties (additionalProperties:false)', () => {
    const payloads = loadSchema('run-event-payloads.schema.json');
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    for (const key of ['voiceSpeechStart', 'voiceTurnCommit', 'voiceBargeIn', 'voiceCancelled', 'voiceEndpointCandidate']) {
      const validate = ajv.compile(payloads.$defs[key]);
      expect(
        validate({ atMs: 100, transcriptBody: 'should not be here' }),
        req('openwop.it.voice-event-payloads-shape.content-free-voice-events-reject-unknown-properties-additionalproperties-false', 'RFC 0106 §D', `${key} MUST reject an unknown (content-bearing) property`),
      ).toBe(false);
    }
  });
});
