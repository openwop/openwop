/**
 * `carriesPayload` compares JSON values, not JSON text (RFC 0209 §C.11 on a
 * JSONB host; lib/carries-payload.ts).
 *
 * The positive leg is the measured pg16 reordering. The negative controls are
 * what keep the relaxation from becoming a pass for a regenerated surface: a
 * changed value, a dropped member, and a reordered array must all still fail.
 */

import { describe, expect, it } from 'vitest';
import { carriesPayload } from './carries-payload.js';

const SENT = {
  version: 'v0.9',
  catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
  surfaceId: 's-rec',
  messages: [
    { version: 'v0.9', createSurface: { surfaceId: 's-rec', catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json' } },
    { version: 'v0.9', updateDataModel: { surfaceId: 's-rec', value: { name: 'x', n: 1 } } },
  ],
};
/** What a JSONB host returns: every member, keys re-sorted (shorter first, then bytewise), at every depth. */
const JSONB = {
  version: 'v0.9',
  messages: [
    { version: 'v0.9', createSurface: { catalogId: SENT.catalogId, surfaceId: 's-rec' } },
    { version: 'v0.9', updateDataModel: { value: { n: 1, name: 'x' }, surfaceId: 's-rec' } },
  ],
  catalogId: SENT.catalogId,
  surfaceId: 's-rec',
};
const event = (payload: unknown) => ({ type: 'ai.envelope', payload: { envelope: { type: 'ui.a2ui-surface', payload } } });

describe('carriesPayload', () => {
  it('a JSONB-reordered payload is carried (the pg16 measurement), and the old text comparison would not have seen it', () => {
    expect(JSON.stringify(JSONB)).not.toBe(JSON.stringify(SENT));
    expect(carriesPayload([event(JSONB)], SENT)).toBe(true);
  });

  it('a changed value, a dropped member, an added member and a reordered array are NOT carried', () => {
    const changed = structuredClone(JSONB); changed.messages[1]!.updateDataModel!.value.n = 2;
    const dropped: Record<string, unknown> = structuredClone(JSONB); delete dropped['surfaceId'];
    const added = { ...structuredClone(JSONB), extra: true };
    const reordered = { ...structuredClone(JSONB), messages: [...structuredClone(JSONB).messages].reverse() };
    for (const p of [changed, dropped, added, reordered]) expect(carriesPayload([event(p)], SENT)).toBe(false);
  });

  it('a value JCS refuses matches nothing', () => {
    expect(carriesPayload([event({ n: Number.NaN })], { n: Number.NaN })).toBe(false);
  });
});
