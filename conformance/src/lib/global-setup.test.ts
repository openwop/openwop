/**
 * Pins the run-end disposition summary (`src/global-setup.ts`, RFC 0148 §A).
 *
 * The defect this guards is not "the summary is ugly" — it is that the suite
 * computed an honest disposition on every run and PUBLISHED it on one. Two
 * host implementers read vitest's `1 passed` as coverage for a requirement the
 * suite had internally classified `blocked`, because the classification had no
 * reader outside `--certify`.
 *
 * Server-free and pure: `summarise` takes the raw JSONL and returns the text.
 */

import { describe, expect, it } from 'vitest';
import { summarise } from '../global-setup.js';

const line = (o: Record<string, unknown>): string => JSON.stringify(o);

describe('global-setup: RFC 0148 §A disposition summary', () => {
  it('reads the ledger key the ledger actually writes (`requirementId`, not `id`)', () => {
    // Regression: the first draft of this reader keyed on `entry.id`, a field
    // `recordRequirement` has never written, and fell back to `(unnamed)`.
    // The fallback made a WRONG READER look like MISSING DATA — the same
    // failure shape the summary exists to expose, reproduced in the exposer.
    const out = summarise(
      line({ requirementId: 'openwop.scenario.webhook-signed-delivery', disposition: 'blocked', detail: 'guard rejected loopback' }),
    );
    expect(out).toContain('openwop.scenario.webhook-signed-delivery');
    expect(out).not.toContain('(unnamed)');
  });

  it('lists blocked / skipped / inapplicable as NOT witnessed, with the reason', () => {
    const out = summarise(
      [
        line({ requirementId: 'a', disposition: 'blocked', detail: 'seam absent' }),
        line({ requirementId: 'b', disposition: 'skipped', detail: 'operator opted out' }),
        line({ requirementId: 'c', disposition: 'inapplicable', detail: 'profile not advertised' }),
      ].join('\n'),
    );
    expect(out).toContain('did NOT witness');
    for (const s of ['seam absent', 'operator opted out', 'profile not advertised']) {
      expect(out).toContain(s);
    }
  });

  it('flags an executed-pass that asserted nothing — the other RFC 0148 §A vacuity shape', () => {
    const out = summarise(line({ requirementId: 'vacuous', disposition: 'executed-pass', assertionCount: 0 }));
    expect(out).toContain('executed-pass (0 assertions)');
    expect(out).toContain('vacuous');
  });

  it('does NOT flag a real executed-pass', () => {
    const out = summarise(line({ requirementId: 'real', disposition: 'executed-pass', assertionCount: 12 }));
    expect(out).toContain('executed-pass 1');
    expect(out).not.toContain('did NOT witness');
  });

  it('announces truncation rather than capping silently', () => {
    // A capped list that does not say it was capped reads as a complete one.
    const many = Array.from({ length: 45 }, (_, i) =>
      line({ requirementId: `r${i}`, disposition: 'blocked', detail: 'why' }),
    ).join('\n');
    const out = summarise(many);
    expect(out).toContain('5 more not listed');
  });

  it('returns null on an empty ledger so teardown prints nothing', () => {
    expect(summarise('')).toBeNull();
    expect(summarise('\n\n')).toBeNull();
  });

  it('skips unparseable lines without discarding the rest of the run', () => {
    const out = summarise(['{ not json', line({ requirementId: 'ok', disposition: 'blocked', detail: 'r' })].join('\n'));
    expect(out).toContain('ok');
    expect(out).toContain('blocked 1');
  });
});
