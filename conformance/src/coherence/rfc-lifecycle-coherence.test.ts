/**
 * RFC 0149 §D — an `Accepted` RFC's unticked acceptance items must say why.
 *
 * §D asks the corpus generator to fail when an `Accepted` RFC "retains an
 * unresolved acceptance blocker not explicitly carried to a register/known-limit".
 * The obvious signal is the `- [ ]` boxes under §"Acceptance criteria", and the
 * obvious gate — every box ticked before `Accepted` — was measured and rejected.
 *
 * `docs/RFC-LIFECYCLE-COHERENCE.md` recorded the distribution: of 141 `Accepted`
 * RFCs, 42% ticked every box, 25% ticked none, 24% ticked some. A blanket gate
 * fails 69 RFCs on its first run, mostly for an authoring convention, and a gate
 * that fires 69 times on its first run gets disabled rather than fixed.
 *
 * The first triage hypothesis was also wrong, and correcting it produced the rule
 * this gate actually enforces. The partially-ticked RFCs are not a blocker
 * backlog: reading `0027`/`0028`/`0029`/`0040`/`0041` shows every trailing item
 * deliberately unticked AND annotated with why — "(Will land alongside the first
 * non-steward advertisement.)", "(Path-to-Accepted.)", "(Follow-up — … not
 * normative gate-blockers.)". That inline annotation IS §D's "explicitly
 * carried", just carried in a parenthetical rather than a register row.
 *
 * So the signal is **annotated vs bare, not ticked vs unticked**. An unticked
 * item with no explanation is indistinguishable from one nobody checked; an
 * unticked item that states its external gate is a decision on record. Ticking
 * nothing stays legal — the RFC did not use the mechanism — but leaving a box
 * unticked and unexplained does not.
 *
 * Applies from `LIFECYCLE_RULE_RFC` forward. Earlier RFCs are the dated record
 * of a period when the convention did not exist, and rewriting them would make
 * the record lie; the boundary is asserted here rather than assumed, so a NEW
 * RFC cannot inherit the exemption. Same carve-out shape as RFC 0149 §B's
 * root-layout lint.
 *
 * Server-free. `RFCS/` is repository-only, so this self-skips under the
 * published tarball layout.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

/** RFC 0149 §D takes effect with the RFC 0147 program's own cohort. */
const LIFECYCLE_RULE_RFC = 147;

const RFCS_DIR = V1_DIR === null ? null : pathResolve(V1_DIR, '..', '..', 'RFCS');

interface BareItem {
  readonly rfc: number;
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/**
 * An item is "carried" when it states a reason: a parenthetical, or a pointer to
 * a gap register / known-limit / follow-up RFC. Anything else is bare.
 */
function isAnnotated(text: string): boolean {
  if (/\([^)]{12,}\)/.test(text)) return true;
  return /\b(gap register|known.limit|register row|carried|deferred|blocked on|gated on)\b/i.test(text);
}

function statusOf(doc: string): string | null {
  const m = /^\|\s*\*\*Status\*\*\s*\|\s*`([^`]+)`/m.exec(doc);
  return m === null ? null : m[1]!;
}

/** Unticked acceptance items lacking a stated reason, for `Accepted` RFCs at or after the cutoff. */
function bareItems(dir: string): BareItem[] {
  const found: BareItem[] = [];
  for (const name of readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort()) {
    const rfc = Number.parseInt(name.slice(0, 4), 10);
    if (!Number.isFinite(rfc) || rfc < LIFECYCLE_RULE_RFC) continue;
    const doc = readFileSync(join(dir, name), 'utf8');
    if (statusOf(doc) !== 'Accepted') continue;
    const lines = doc.split('\n');
    let inAcceptance = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (/^##\s/.test(line)) inAcceptance = /^##\s+Acceptance criteria\s*$/.test(line);
      if (!inAcceptance) continue;
      if (!/^\s*-\s*\[ \]\s/.test(line)) continue;
      const text = line.replace(/^\s*-\s*\[ \]\s*/, '');
      if (!isAnnotated(text)) found.push({ rfc, file: name, line: i + 1, text });
    }
  }
  return found;
}

describe.skipIf(RFCS_DIR === null || !existsSync(RFCS_DIR))('RFC 0149 §D — lifecycle coherence', () => {
  const dir = RFCS_DIR as string;

  it('the scan reaches Accepted RFCs in the governed range', () => {
    // Guard: a status regex that matched nothing, or a heading regex that never
    // entered the section, would make the assertion below vacuously true. That
    // is the failure RFC 0148 exists to close, and it is especially easy here
    // because the gate's PASSING state and its BROKEN state look identical.
    const governed = readdirSync(dir)
      .filter((f) => /^\d{4}-.*\.md$/.test(f))
      .filter((f) => Number.parseInt(f.slice(0, 4), 10) >= LIFECYCLE_RULE_RFC)
      .filter((f) => statusOf(readFileSync(join(dir, f), 'utf8')) === 'Accepted');
    expect(
      governed.length,
      req('openwop.it.rfc-lifecycle-coherence.the-scan-reaches-accepted-rfcs-in-the-governed-range', 'RFC 0149 §D', `at least one Accepted RFC numbered >= ${LIFECYCLE_RULE_RFC} MUST exist for this gate to mean anything`),
    ).toBeGreaterThan(0);

    const withBoxes = governed.filter((f) =>
      /^##\s+Acceptance criteria\s*$/m.test(readFileSync(join(dir, f), 'utf8')),
    );
    expect(withBoxes.length, req('openwop.it.rfc-lifecycle-coherence.the-scan-reaches-accepted-rfcs-in-the-governed-range', 'RFC 0149 §D', 'the acceptance-criteria heading MUST be found')).toBeGreaterThan(0);
  });

  it('every unticked acceptance item states why it is unticked', () => {
    const bare = bareItems(dir).map((b) => `RFCS/${b.file}:${b.line} — ${b.text}`);
    expect(
      bare,
      req('openwop.it.rfc-lifecycle-coherence.every-unticked-acceptance-item-states-why-it-is-unticked', 'RFC 0149 §D', 'RFC 0149 §D: an unticked acceptance item on an `Accepted` RFC MUST carry its reason — an ' +
        'external gate, a follow-up note, or a register / known-limit pointer. Unticked-and-' +
        'unexplained is indistinguishable from unchecked, which is what makes the checkbox ' +
        'signal unusable. Tick it, annotate it, or carry it to a register row.\n  ' +
        bare.join('\n  ')),
    ).toEqual([]);
  });

  it('the rule binds the cohort that proposed it', () => {
    // RFC 0149 is itself in the governed range. A gate whose author exempted
    // their own RFC would be the shape RFC 0147 §A.10 forbids — citing a
    // program's status as evidence its gaps are closed.
    const self = readFileSync(join(dir, '0149-machine-contract-and-version-reconciliation.md'), 'utf8');
    expect(statusOf(self), req('openwop.it.rfc-lifecycle-coherence.the-rule-binds-the-cohort-that-proposed-it', 'RFC 0149 §D', 'RFC 0149 is `Accepted`')).toBe('Accepted');
    expect(
      149 >= LIFECYCLE_RULE_RFC,
      req('openwop.it.rfc-lifecycle-coherence.the-rule-binds-the-cohort-that-proposed-it', 'RFC 0149 §D', 'RFC 0149 MUST fall inside the range its own §D governs'),
    ).toBe(true);
  });
});

/**
 * Every non-terminal RFC either carries the **Parked** annotation with a named
 * tripwire, or is genuinely in flight.
 *
 * `RFCS/README.md` §"Parked RFCs" extends the annotation from `Draft` to
 * `Active`, and the reason is the confusion this corpus has now made in both
 * directions: **an RFC blocked on the world and an RFC blocked on somebody's
 * unfinished work look identical from an index.** RFC 0038 was parked on an
 * external tripwire while three of its acceptance criteria were plain
 * repository work nobody had done; RFC 0121 sits on an unresolved legal
 * question and kept re-reading as an open action item.
 *
 * What this leg defends is the honesty of the annotation, not its presence. A
 * Parked RFC MUST name a **falsifiable** tripwire — a condition someone could
 * check and declare met. "Needs more adoption" is not one. Without this leg the
 * annotation would be a label anybody could apply to make an index look
 * finished, which is precisely the move RFC 0147 §A exists to stop: **Parked is
 * a reason an RFC has not graduated, never a substitute for having graduated.**
 */
describe.skipIf(RFCS_DIR === null || !existsSync(RFCS_DIR))('RFCS/README §Parked — a park names its tripwire', () => {
  const dir = RFCS_DIR as string;

  function nonTerminal(): { file: string; doc: string; status: string }[] {
    const out: { file: string; doc: string; status: string }[] = [];
    for (const name of readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort()) {
      if (name.startsWith('0000')) continue; // the template is not an RFC
      const doc = readFileSync(join(dir, name), 'utf8');
      const st = statusOf(doc);
      if (st === 'Draft' || st === 'Active') out.push({ file: name, doc, status: st });
    }
    return out;
  }

  it('the scan finds the non-terminal RFCs it is meant to govern', () => {
    // Guard: if every RFC were `Accepted` this leg would pass over an empty set,
    // which is the vacuity RFC 0148 §C found in the floor verifier. If the corpus
    // ever genuinely reaches zero, delete this leg deliberately rather than
    // letting it go quiet.
    expect(
      nonTerminal().length,
      req('openwop.it.rfc-lifecycle-coherence.the-scan-finds-the-non-terminal-rfcs-it-is-meant-to-govern', 'RFC 0149 §D', 'RFCS/README §"Status index" records non-terminal RFCs; a zero here means the scan broke, ' +
        'not that the corpus finished'),
    ).toBeGreaterThan(0);
  });

  it('every Parked RFC names a falsifiable tripwire', () => {
    const offenders: string[] = [];
    for (const { file, doc } of nonTerminal()) {
      const statusLine = /^\|\s*\*\*Status\*\*\s*\|[^\n]*$/m.exec(doc)?.[0] ?? '';
      if (!/\(\*\*Parked\*\*\)/.test(statusLine)) continue;
      const updated = /^\|\s*\*\*Updated\*\*\s*\|([^\n]*)$/m.exec(doc)?.[1] ?? '';
      if (!/tripwire/i.test(updated) || updated.length < 80) {
        offenders.push(`${file}: Parked without a named tripwire in \`Updated\``);
      }
    }
    expect(
      offenders,
      req('openwop.it.rfc-lifecycle-coherence.every-parked-rfc-names-a-falsifiable-tripwire', 'RFC 0149 §D', 'RFCS/README.md §"Parked RFCs" rule 1: a Parked RFC MUST name the condition that un-parks ' +
        'it, in `Updated`. An unfalsifiable park is a label that makes an index look finished ' +
        'while nothing was decided — Parked records why an RFC has NOT graduated, and is never a ' +
        'substitute for having graduated.\n  ' + offenders.join('\n  ')),
    ).toEqual([]);
  });

  it('no Parked RFC claims to be Accepted', () => {
    // Rule 2. The annotation confers nothing: an `Active` (**Parked**) RFC is
    // exactly as unimplemented as an `Active` one, and licenses no advertisement.
    for (const { file, doc, status } of nonTerminal()) {
      const statusLine = /^\|\s*\*\*Status\*\*\s*\|[^\n]*$/m.exec(doc)?.[0] ?? '';
      if (!/\(\*\*Parked\*\*\)/.test(statusLine)) continue;
      expect(
        status,
        req('openwop.it.rfc-lifecycle-coherence.no-parked-rfc-claims-to-be-accepted', 'RFC 0149 §D', `${file}: Parked applies to \`Draft\` and \`Active\` only — it never stands in for \`Accepted\``),
      ).not.toBe('Accepted');
    }
  });
});
