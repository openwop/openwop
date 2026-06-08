/**
 * Multimodal perception input on callAI (RFC 0091 §A/§B) — behavioral.
 *
 * Gated on `capabilities.aiProviders.input.modalities` including a non-text
 * modality (root-first per RFC 0073). Soft-skips when unadvertised (default) /
 * hard-fails under `OPENWOP_REQUIRE_BEHAVIOR=true`. The always-on wire-shape
 * coverage lives in `aiproviders-input-shape.test.ts`; this asserts host
 * BEHAVIOR via the documented host-sample callAI seam
 * `POST /v1/host/sample/ai/call` (soft-skips on 404 until a host wires it):
 *
 *   - an ADVERTISED non-text modality (e.g. an `image` ContentPart) is ACCEPTED
 *     (not rejected as unsupported);
 *   - an UNADVERTISED modality MUST be rejected with the canonical
 *     `unsupported_modality` error — never silently dropped (RFC 0091 §A).
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0091-multimodal-perception-input.md
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/host-capabilities.md (§host.aiProviders)
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';

const ALL_MODALITIES = ['text', 'image', 'audio', 'document'];

/** Read the canonical error code from a seam response body (tolerant of
 *  `{error}` / `{code}` / `{error:{code}}` shapes). */
function errCode(json: unknown): string | undefined {
  const j = json as { error?: unknown; code?: unknown };
  if (typeof j?.code === 'string') return j.code;
  if (typeof j?.error === 'string') return j.error;
  const e = j?.error as { code?: unknown } | undefined;
  if (e && typeof e.code === 'string') return e.code;
  return undefined;
}

const SEAM = '/v1/host/sample/ai/call';

describe('callai-multimodal (RFC 0091 §A/§B)', () => {
  it('accepts an advertised non-text modality and rejects an unadvertised one with unsupported_modality', async () => {
    const ai = await readCapabilityFamily<Record<string, unknown>>('aiProviders');
    const input = ai?.input as { modalities?: unknown } | undefined;
    const modalities = Array.isArray(input?.modalities) ? (input!.modalities as string[]) : [];
    const advertisedNonText = modalities.filter((m) => m !== 'text');
    // Gate on advertising at least one non-text input modality.
    if (!behaviorGate('openwop-callai-multimodal', advertisedNonText.length > 0)) return;

    const accepted = advertisedNonText[0]!; // an advertised non-text modality
    const unadvertised = ALL_MODALITIES.find((m) => m !== 'text' && !modalities.includes(m));

    // 1) An advertised modality part is ACCEPTED (not an unsupported_modality refusal).
    const okPart =
      accepted === 'image'
        ? { type: 'image', mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' }
        : accepted === 'audio'
          ? { type: 'audio', mimeType: 'audio/mp3', dataBase64: 'AAAA' }
          : { type: 'file', mimeType: 'application/pdf', dataBase64: 'JVBERi0=' };
    const okRes = await driver.post(SEAM, {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'describe this' }, okPart] }],
    });
    if (okRes.status === 404) return; // seam unwired — soft-skip the whole behavioral suite
    expect(
      errCode(okRes.json) !== 'unsupported_modality',
      driver.describe('RFC 0091 §B', `an advertised modality (${accepted}) MUST NOT be rejected as unsupported_modality`),
    ).toBe(true);

    // 2) An unadvertised modality MUST be rejected with unsupported_modality.
    if (unadvertised) {
      const badPart =
        unadvertised === 'audio'
          ? { type: 'audio', mimeType: 'audio/mp3', dataBase64: 'AAAA' }
          : unadvertised === 'document'
            ? { type: 'file', mimeType: 'application/pdf', dataBase64: 'JVBERi0=' }
            : { type: 'image', mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' };
      const badRes = await driver.post(SEAM, {
        messages: [{ role: 'user', content: [badPart] }],
      });
      expect(
        errCode(badRes.json) === 'unsupported_modality',
        driver.describe('RFC 0091 §A', `an unadvertised modality (${unadvertised}) MUST be rejected with unsupported_modality (never silently dropped)`),
      ).toBe(true);
    }
  });
});
