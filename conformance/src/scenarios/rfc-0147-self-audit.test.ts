/**
 * RFC 0147 §A.10 — the program audits itself, and silence is not compliance.
 *
 * §A states ten invariants that "apply to every workstream". §A.10 forbids using
 * the RFC's existence or partial implementation as evidence its gaps are closed.
 * A program that audits everything except itself has the same defect it was
 * written to fix, one level up.
 *
 * This gate does NOT assert the program is compliant. It asserts that every §A
 * invariant carries an **explicit disposition** — including the ones recorded as
 * VIOLATED. That is the RFC 0148 §A design applied to governance: an invariant
 * with no row is uncovered, not satisfied, and a self-audit that quietly omits
 * its uncomfortable rows is worth less than none because it looks like coverage.
 *
 * Two rows are currently VIOLATED and the gate is green, which is the intended
 * behavior. Making the gate fail on a violation would create pressure to delete
 * the row rather than fix the program — the failure mode RFC 0149 §D measured
 * when it declined to ship a gate that fires 69 times on its first run.
 *
 * Server-free.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { V1_DIR } from '../lib/paths.js';

const AUDIT = V1_DIR === null
  ? null
  : join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), 'docs', 'RFC-0147-SELF-AUDIT.md');

/** The ten §A invariants, by their heading anchor. */
const INVARIANTS = [
  'A.1',
  'A.2',
  'A.3',
  'A.4',
  'A.5',
  'A.6',
  'A.7',
  'A.8',
  'A.9',
  'A.10',
] as const;

const DISPOSITIONS = /satisfied|VIOLATED|not satisfied|partially satisfied/;

const AUDIT_PRESENT = AUDIT !== null && existsSync(AUDIT);

describe.skipIf(!AUDIT_PRESENT)('RFC 0147 §A.10 — program self-audit', () => {
  // `describe.skipIf` still EXECUTES this factory — it decides afterwards not to
  // run the tests it collected. So a read here throws at collection time even
  // when the suite is destined to skip, and one file's collection error takes
  // the whole file down rather than skipping it. The audit lives under `docs/`,
  // which is not bundled, so this is exactly the published-layout path.
  const doc = AUDIT_PRESENT ? readFileSync(AUDIT as string, 'utf8') : '';

  it('the audit exists and is substantive', () => {
    // Guard: a stub file would make every leg below vacuous, and this gate's
    // whole purpose is that an omitted row is visible.
    expect(doc.length, 'the self-audit MUST be substantive').toBeGreaterThan(2000);
    expect(doc).toMatch(/RFC 0147/);
  });

  it('every §A invariant carries an explicit disposition', () => {
    const missing = INVARIANTS.filter((id) => {
      const heading = new RegExp(`^## ${id.replace('.', '\\.')} — `, 'm');
      const at = heading.exec(doc);
      if (at === null) return true;
      // The disposition must appear in that section, not merely somewhere.
      const section = doc.slice(at.index, doc.indexOf('\n## ', at.index + 1) + 1 || undefined);
      return !DISPOSITIONS.test(section);
    });
    expect(
      missing,
      'RFC 0147 §A.10: an invariant with no recorded disposition is UNCOVERED, not satisfied. ' +
        'A self-audit that omits its uncomfortable rows is worth less than none, because it ' +
        'looks like coverage.',
    ).toEqual([]);
  });

  it('the audit records the violations it found rather than only the wins', () => {
    // The load-bearing leg. An audit that reported nothing adverse would be
    // indistinguishable from one nobody ran — and this program has two known
    // violations, so a clean sheet here means the file stopped being honest.
    expect(
      /VIOLATED/.test(doc),
      'RFC 0147 §A.5 and §A.6 are currently violated: four RFCs reached `Accepted` with no ' +
        'evidence, and five high-risk RFCs had their comment windows waived by the exact ' +
        'bootstrap mechanism §A.6 says must not shorten them. If those rows have been removed ' +
        'rather than resolved, this leg is the thing that notices.',
    ).toBe(true);
  });

  it('the audit does not claim the exit criteria are met', () => {
    // §A.10, applied to the audit itself.
    expect(
      /exit criteria in RFC 0147 are not met|exit criteria .{0,40}not met/i.test(doc),
      'RFC 0147 §A.10: the program MUST NOT be read as closed. Three remaining gates — external ' +
        'audit, second maintainer, Tier-3 host — cannot be closed by work in this repository.',
    ).toBe(true);
  });
});
