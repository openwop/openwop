/**
 * Self-test for `emitsWriteEvents`: the v1 block carries `supported: true` (its
 * schema `const`); a v2 family record has no `supported` field — presence is
 * the claim (RFC 0169 §A.2). Requiring `supported` at major 2 soft-skipped
 * `memory-attribution-replay-stable` on every v2 host.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { emitsWriteEvents } from './memoryAttribution.js';

const saved = process.env['OPENWOP_TARGET_MAJOR'];
afterEach(() => {
  if (saved === undefined) delete process.env['OPENWOP_TARGET_MAJOR'];
  else process.env['OPENWOP_TARGET_MAJOR'] = saved;
});

describe('emitsWriteEvents', () => {
  it('major 1 keeps the v1 rule: supported AND emitsWriteEvents', () => {
    delete process.env['OPENWOP_TARGET_MAJOR'];
    expect(emitsWriteEvents({ supported: true, emitsWriteEvents: true })).toBe(true);
    expect(emitsWriteEvents({ emitsWriteEvents: true })).toBe(false);
    expect(emitsWriteEvents({ supported: true })).toBe(false);
    expect(emitsWriteEvents(null)).toBe(false);
  });

  it('major 2 reads the v2 record: emitsWriteEvents on a present attribution object', () => {
    process.env['OPENWOP_TARGET_MAJOR'] = '2';
    expect(emitsWriteEvents({ emitsWriteEvents: true })).toBe(true);
    expect(emitsWriteEvents({ emitsWriteEvents: false })).toBe(false);
    expect(emitsWriteEvents({})).toBe(false);
    expect(emitsWriteEvents(null)).toBe(false);
  });
});
