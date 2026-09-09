/**
 * The per-`it` row reads the softSkip note its own test wrote (rc.56).
 *
 * Until rc.56 `setup.ts` derived the per-`it` row from the journal's
 * `behaviorGate` entries only. A leg that returned
 * `softSkip('inapplicable', 'a2a facet not advertised')` therefore produced a
 * per-`it` row of `blocked / unclassified return` while its FILE row (which
 * reads the notes through `resolveFileRecord`) was honestly `inapplicable`.
 * `verifyBundleV3` refuses `certifiedProfiles` for any bundle with a `blocked`
 * row (RFC 0168 §E.1), so on 2026-09-05 forty-five such rows on a host that
 * does not advertise A2A/MCP denied certification to every profile it claimed.
 *
 * Two halves pinned here: the pure rule (`resolveItRecord`) and the per-test
 * note window (`softSkipMark` / `softSkipDispositionSince`).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveItRecord } from './scenario-disposition.js';
import { resetSoftSkips, softSkip, softSkipDisposition, softSkipDispositionSince, softSkipMark } from './soft-skip.js';

// vitest sets `expect.getState().testPath` to THIS file, so `softSkip` notes
// land under this file's basename.
const THIS_FILE = 'it-record-softskip.test.ts';

describe('resolveItRecord (rc.56)', () => {
  it('a zero-assertion pass with an inapplicable note is inapplicable, not blocked', () => {
    const r = resolveItRecord('pass', 0, undefined, { kind: 'inapplicable', reason: 'a2a facet not advertised — no negotiation to audit' });
    expect(r.disposition).toBe('inapplicable');
    expect(r.detail).toBe('a2a facet not advertised — no negotiation to audit');
  });

  it('a zero-assertion pass with a blocked note is blocked WITH its reason', () => {
    const r = resolveItRecord('pass', 0, undefined, { kind: 'blocked', reason: 'seam /conformance/seams/sample/a2a/invoke answered 404' });
    expect(r.disposition).toBe('blocked');
    expect(r.detail).toBe('seam /conformance/seams/sample/a2a/invoke answered 404');
  });

  it('a zero-assertion pass with NO note is still the unclassified return (pressure to say why survives)', () => {
    const r = resolveItRecord('pass', 0, undefined, null);
    expect(r.disposition).toBe('blocked');
    expect(r.detail).toMatch(/unclassified return/);
  });

  it('a behaviorGate journal entry wins over a note', () => {
    const r = resolveItRecord('pass', 0, { disposition: 'skipped', detail: 'operator opted out' }, { kind: 'inapplicable', reason: 'x' });
    expect(r.disposition).toBe('skipped');
    expect(r.detail).toBe('operator opted out');
  });

  it('a pass with assertions is executed-pass regardless of notes', () => {
    expect(resolveItRecord('pass', 3, undefined, { kind: 'blocked', reason: 'later leg could not run' }).disposition).toBe('executed-pass');
  });

  it('a failure is executed-fail with the first error', () => {
    const r = resolveItRecord('fail', 1, undefined, null, 'expected 200 to be 409');
    expect(r.disposition).toBe('executed-fail');
    expect(r.detail).toBe('the test executed and failed: expected 200 to be 409');
  });

  it('a vitest skip takes the note written before the skip, else skipped', () => {
    expect(resolveItRecord('skip', 0, undefined, { kind: 'inapplicable', reason: 'mcp facet not advertised' })).toEqual({ disposition: 'inapplicable', detail: 'mcp facet not advertised' });
    expect(resolveItRecord('skip', 0, undefined, null).disposition).toBe('skipped');
  });
});

describe('softSkip per-test window (rc.56)', () => {
  beforeEach(() => resetSoftSkips());

  it('a note written after the mark is visible in the window; one written before is not', () => {
    softSkip('blocked', 'from an earlier test in the same file');
    const mark = softSkipMark();
    expect(softSkipDispositionSince(THIS_FILE, mark)).toBeNull();
    softSkip('inapplicable', 'a2a facet not advertised');
    expect(softSkipDispositionSince(THIS_FILE, mark)).toEqual({ kind: 'inapplicable', reason: 'a2a facet not advertised' });
    // The file rule still folds everything, worst-first.
    expect(softSkipDisposition(THIS_FILE)?.kind).toBe('blocked');
  });

  it('the window folds worst-first and de-duplicates identical notes', () => {
    const mark = softSkipMark();
    softSkip('inapplicable', 'a2a facet not advertised');
    softSkip('inapplicable', 'a2a facet not advertised');
    softSkip('blocked', 'seam answered 404');
    const d = softSkipDispositionSince(THIS_FILE, mark);
    expect(d?.kind).toBe('blocked');
    expect(d?.reason).toBe('[inapplicable] a2a facet not advertised; [blocked] seam answered 404');
  });

  it('the same note in two consecutive tests is seen by both windows (no cross-test de-duplication)', () => {
    const m1 = softSkipMark();
    softSkip('inapplicable', 'mcp facet not advertised');
    expect(softSkipDispositionSince(THIS_FILE, m1)?.kind).toBe('inapplicable');
    const m2 = softSkipMark();
    softSkip('inapplicable', 'mcp facet not advertised');
    expect(softSkipDispositionSince(THIS_FILE, m2)?.kind).toBe('inapplicable');
  });
});
