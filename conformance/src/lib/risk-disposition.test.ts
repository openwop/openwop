/**
 * Unit tests for the closed/transferred predicate in
 * `scripts/generate-assurance-status.mjs`.
 *
 * This predicate is not cosmetic. Project-wide gates have been keyed to the
 * open-Critical count it produces, so a false closure silently loosens a
 * constraint — and a false open silently keeps one in force.
 *
 * It previously matched the bare substring `closed` anywhere in a row's status
 * cell, which produced two failures in opposite directions:
 *
 *   · RFC 0151 R1 ("Compensation executes twice", Critical) reads
 *     "Open — ... unwitnessed" and was counted CLOSED from 2026-08-16 onward,
 *     because the cell mentions "(G1 closed 2026-08-16)" — a DIFFERENT item's
 *     closure. A substring of an adjacent concept.
 *   · A row stating that a risk "cannot be closed by repository work" was
 *     counted closed by saying so.
 *
 * The predicate is duplicated here rather than imported because the generator is
 * a standalone ESM script with no exports; the duplication is pinned by
 * `matches the generator's source` below, which fails if the two drift.
 *
 * @see scripts/generate-assurance-status.mjs
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { V1_DIR } from './paths.js';

const NEGATED = /\b(cannot|can ?not|could not|will not|never|not)\s+be\s+(closed|resolved)\b|\bnot closed\b/i;
const EXPLICIT = /\*\*(CLOSED|Closed)\b|~~|Realised and remediated/i;
const TRANSFERRED = /\*\*(?:OPEN\s+—\s+)?TRANSFERRED\b/i;

function disposition(status: string): 'closed' | 'transferred' | 'open' {
  const closed = EXPLICIT.test(status) && !NEGATED.test(status);
  if (closed) return 'closed';
  return TRANSFERRED.test(status) ? 'transferred' : 'open';
}

describe('assurance risk disposition', () => {
  it('does NOT read a nested reference to another item as this row being closed', () => {
    // The exact RFC 0151 R1 shape. "Open", "unwitnessed", and a parenthetical
    // about gap G1 closing — a different thing entirely.
    const status =
      'Open — **Sweep 2026-08-16:** **Mitigated in prose** — inverse-action identity tuple stated; ' +
      '`compensation.md` §C now states the persistence shape (G1 closed 2026-08-16); unwitnessed for retry-stability';
    expect(disposition(status)).toBe('open');
  });

  it('does NOT read a row that says a risk cannot be closed as closed', () => {
    expect(disposition('**OPEN — TRANSFERRED.** This risk cannot be closed by repository work.')).not.toBe('closed');
  });

  it('reads an explicit marker as closed', () => {
    expect(disposition('**CLOSED.** The recurrence mechanism is in the tree and executing.')).toBe('closed');
    expect(disposition('~~superseded~~ — folded into RFC 0150 §D')).toBe('closed');
    expect(disposition('**Realised and remediated in scope:** bundle 1 invalidated')).toBe('closed');
  });

  it('distinguishes transferred from open, because §A.1 turns on the difference', () => {
    expect(disposition('**OPEN — TRANSFERRED to a named tracked surface.** Tracked in KNOWN-LIMITS.')).toBe('transferred');
    expect(disposition('Open — unwitnessed. No host advertises the capability.')).toBe('open');
  });

  it('is not fooled by the word appearing in ordinary prose', () => {
    expect(disposition('Open — the comment window closed without review.')).toBe('open');
    expect(disposition('Open — closes when a host implements fencing.')).toBe('open');
  });

  it('matches the generator source — fails if the two drift apart', () => {
    // `V1_DIR` is null in the PUBLISHED package layout, which ships no `spec/`
    // and no `scripts/`. Resolving the path at module scope — or casting the
    // null away — is what made six scenarios throw at import for every npm
    // consumer while staying green in a repo checkout. Resolve inside the test
    // and skip when the repo is not there.
    if (V1_DIR === null) return;
    const script = join(dirname(V1_DIR), '..', 'scripts', 'generate-assurance-status.mjs');
    if (!existsSync(script)) return;
    const src = readFileSync(script, 'utf8');
    // Guard the shape, not the byte-for-byte text: the generator must still gate
    // on an explicit marker AND a negation check, never on a bare substring.
    expect(src, 'generator must keep the negation guard').toMatch(/const negated = /);
    expect(src, 'generator must require an explicit closed marker').toMatch(/const explicitlyClosed =/);
    expect(src, 'generator must still separate transferred rows').toMatch(/const transferred = /);
    expect(
      /const closed = \/\(\^\|\\s\)\(closed\|resolved/.test(src),
      'the bare-substring test must not come back',
    ).toBe(false);
  });
});
