/**
 * The truth table for `v2-unmapped-type-refused`'s two preconditions
 * (lib/era2-seed `unmappedRefusalGate` / `vendorControlGate`).
 *
 * WHY THIS FILE EXISTS. Suite 2.0.5 gated both legs of that scenario on one
 * precondition — the control leg's, which requires a resolvable vendor-org
 * registry. On any published layout the registry did not resolve (the resolver
 * was anchored on `spec/v1/`, a repo-only directory; fixed in lib/paths), so
 * the REFUSAL leg soft-skipped `inapplicable` on precisely the hosts it exists
 * to catch. A host still answering `200` to an unmapped type and a host
 * correctly answering `500` were both green, and the ratchet called the file
 * STALE. It was reported by a host operator who kept a local witness for a
 * defect they knew was unfixed and re-measured before trusting a green.
 *
 * The rows below that matter most are the ones a scenario CANNOT check itself:
 * `registered === undefined`. A scenario runs against a live host in whatever
 * layout it finds; it can never put itself in the layout where its own gate
 * misfires. Only a pure unit can, which is why the gates are pure.
 */
import { describe, it, expect } from 'vitest';
import { unmappedRefusalGate, vendorControlGate } from './era2-seed.js';

const NO_MAP = new Map<string, string>();
const UNMAPPED = 'foo.bar';
const VENDOR = 'example.thing-happened';

describe('era-2 unmapped/vendor gates — the two legs gate on different facts', () => {
  it('THE REGRESSION: an unresolvable registry leaves the refusal leg DRIVABLE', () => {
    // This is the row 2.0.5 got wrong. `undefined` is not "unknown, so skip" —
    // an unreadable registry registers nothing, so `foo` is unregistered and
    // the refusal is still the required outcome. Fail-closed, not fail-open.
    expect(unmappedRefusalGate(undefined, NO_MAP, UNMAPPED).ok).toBe(true);
  });

  it('the same unresolvable registry stops the control leg — as BLOCKED, not inapplicable', () => {
    // Asymmetric on purpose: the control leg asserts an org IS registered, and
    // an absent registry cannot establish that. But the reason is a fact about
    // the SUITE, so it is `blocked` (conformance.md §Whose fact is the reason?).
    // 2.0.6 said `inapplicable` here, which asserts the requirement does not
    // bind this host — false, and silent: `inapplicable` certifies, `blocked`
    // is bundle-wide fatal. The disposition that is WRONG must not be the one
    // that is QUIET.
    const g = vendorControlGate(undefined, NO_MAP, VENDOR);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.kind).toBe('blocked');
  });

  it('NO suite-side predicate anywhere in these gates answers inapplicable', () => {
    // The general rule, measured over the whole gate surface rather than the
    // one row above: every reachable not-ok verdict these gates can return is
    // `blocked`, because every predicate they test is a fact about the suite's
    // own corpus. A future gate that soft-skips `inapplicable` on a corpus fact
    // reddens this row. Host facts (does the host advertise seams?) are gated
    // upstream in the scenario and never reach here.
    const verdicts = [
      vendorControlGate(undefined, NO_MAP, VENDOR),
      vendorControlGate(new Set<string>(), NO_MAP, VENDOR),
      vendorControlGate(new Set(['example']), new Map([[VENDOR, 'x.y']]), VENDOR),
      unmappedRefusalGate(new Set(['foo']), NO_MAP, UNMAPPED),
      unmappedRefusalGate(undefined, new Map([[UNMAPPED, 'x.y']]), UNMAPPED),
    ];
    for (const v of verdicts) {
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.kind).toBe('blocked');
    }
  });

  it('a registry that resolves and NAMES the driven org blocks the refusal leg', () => {
    // The only thing that legitimately invalidates the refusal leg: `foo`
    // became a real vendor org, so the type must now pass through, not be
    // refused. Blocking here is what keeps the leg from silently testing the
    // opposite rule and still passing.
    const g = unmappedRefusalGate(new Set(['foo']), NO_MAP, UNMAPPED);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.kind).toBe('blocked');
  });

  it('a resolvable registry without the control org blocks the control leg', () => {
    const g = vendorControlGate(new Set(['someone-else']), NO_MAP, VENDOR);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.kind).toBe('blocked');
  });

  it('both legs require a type the codemap does not name', () => {
    const mapped = new Map([[UNMAPPED, 'foo.bar-v2'], [VENDOR, 'example.thing-happened-v2']]);
    expect(unmappedRefusalGate(undefined, mapped, UNMAPPED).ok).toBe(false);
    expect(vendorControlGate(new Set(['example']), mapped, VENDOR).ok).toBe(false);
  });

  it('the happy row: registry resolves, org registered, codemap silent', () => {
    expect(unmappedRefusalGate(new Set(['example']), NO_MAP, UNMAPPED).ok).toBe(true);
    expect(vendorControlGate(new Set(['example']), NO_MAP, VENDOR).ok).toBe(true);
  });
});
