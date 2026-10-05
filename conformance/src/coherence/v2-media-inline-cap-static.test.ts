/**
 * v2 — the `media.*` payload shapes, statically (`spec/v2/core/host-services.md`
 * §aiProviders: "A `media.*` envelope inlines base64 only up to
 * `maxInlineMediaBytes` (default 256 KiB); above that the host MUST use a
 * `url`"; RFC 0055 §C). The v1 twin is the static half of
 * `media-url-inline-cap`. Its advertisement leg (`aiProviders.maxInlineMediaBytes`)
 * is in `v2-ai-providers-advertisement`; its seam legs (the media store and the
 * debug-bundle walk) are not ported.
 *
 *   compile   the three `media.{image,audio,file}` schemas compile;
 *   url       a URL-reference payload validates;
 *   inline    an inline-base64 payload validates;
 *   bytes     a payload without `bytes` is rejected (`bytes` is what a cap is
 *             judged against);
 *   closed    an unknown property is rejected.
 *
 * A corpus gate (`conformance.md` §Two products): it reads only the corpus, runs in
 * the spec repo's CI, and never reaches a host bundle. Moved from src/scenarios/ in 2.45.18.
 *
 * @see spec/v2/core/host-services.md §aiProviders
 * @see schemas/v2/envelopes/media.image.schema.json
 */

import { describe, it, expect } from 'vitest';
import { v2Validator } from '../lib/v2.js';
import { req } from '../lib/requirement-ids.js';
import { V1_DIR } from '../lib/paths.js';
import { softSkip } from '../lib/soft-skip.js';

const NOT_A_CHECKOUT = 'inapplicable to any host: the subject is the spec corpus, which this layout does not carry (not a spec checkout)';

const DOC = 'host-services.md §aiProviders';
const MEDIA_KINDS = ['media.image', 'media.audio', 'media.file'] as const;
const ID_COMPILE = 'openwop.requirement.media.payload-schemas-compile';
const ID_URL = 'openwop.requirement.media.url-reference-accepted';
const ID_INLINE = 'openwop.requirement.media.inline-base64-accepted';
const ID_BYTES = 'openwop.requirement.media.bytes-required';
const ID_CLOSED = 'openwop.requirement.media.payload-closed';

describe('v2 media payload shapes (host-services.md §aiProviders)', () => {
  for (const kind of MEDIA_KINDS) {
    it(`envelopes/${kind}.schema.json compiles under Ajv 2020`, () => {
      if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
      expect(() => v2Validator(`envelopes/${kind}`), req(ID_COMPILE, DOC, `schemas/v2/envelopes/${kind}.schema.json MUST compile`)).not.toThrow();
    });
  }

  it('accepts a URL-reference image payload', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const r = v2Validator('envelopes/media.image')({ url: 'https://host.example/runs/run_1/assets/img_9.png', bytes: 184320, mimeType: 'image/png' });
    expect(r.ok, req(ID_URL, DOC, `a URL-reference media payload MUST validate (${r.errors})`)).toBe(true);
  });

  it('accepts an inline-base64 audio payload', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    const r = v2Validator('envelopes/media.audio')({ base64: 'AAAA', bytes: 3, mimeType: 'audio/ogg', durationSeconds: 1.2 });
    expect(r.ok, req(ID_INLINE, DOC, `an inline-base64 media payload MUST validate (${r.errors})`)).toBe(true);
  });

  it('rejects a media payload missing bytes', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    expect(v2Validator('envelopes/media.file')({ url: 'https://host.example/runs/run_1/assets/report.pdf' }).ok, req(ID_BYTES, DOC, 'bytes is required on a media payload — it is what the inline cap is judged against')).toBe(false);
  });

  it('rejects a media payload with an unknown property', () => {
    if (V1_DIR === null) return softSkip('inapplicable', NOT_A_CHECKOUT);
    expect(v2Validator('envelopes/media.image')({ bytes: 1, wat: true }).ok, req(ID_CLOSED, DOC, 'a media payload is closed: an unknown property MUST be rejected')).toBe(false);
  });
});
