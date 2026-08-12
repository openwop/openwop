/**
 * RFC 0150 §D — record reconciliation and effect authorization are separate
 * claims, and the capability vocabulary must not conflate them.
 *
 * Two defects, both in the corpus rather than in any host.
 *
 * 1. `crossRegion` read as a safety ladder while meaning something else at the
 *    top. `schemas/capabilities.schema.json` documented `strict` as
 *    "cross-region read-visibility is bounded by
 *    `multiRegion.replicationLagBoundMs`" — a LATENCY claim. A host can
 *    replicate synchronously at 0 ms and still issue duplicate external effects
 *    from two regions, because knowing what the other region wrote is not the
 *    same as being authorized to act. `strict` therefore sat at the top of an
 *    enum implementers read as an effect-safety claim while promising nothing
 *    about effects. Its latency content already had its own field, so it is
 *    removed rather than renamed: `fenced-effects` is a genuinely stronger
 *    property, and promoting existing `strict` advertisements into it by rename
 *    would assert evidence no host has produced.
 *
 * 2. `partitionRecoveryStrategy` offering rules the annex forbids.
 *    `spec/v1/idempotency.md` §"Guarantees under partition" MUSTs lex-min(runId)
 *    convergence, "deterministic without coordination", and the `multiRegion`
 *    block MUSTs that "re-running the same conflict input MUST produce the same
 *    survivor". Both `last-writer-wins` and `first-writer-wins` are time-ordered:
 *    under a partition there is no shared clock, so both regions believe they
 *    wrote last (or first), and neither can produce a reproducible survivor.
 *    They also select a different survivor than the lex-min rule the same
 *    document requires. The schema was advertising strategies that violate two
 *    MUSTs already in force. RFC 0150 §D names only `last-writer-wins`; leaving
 *    `first-writer-wins` would keep the identical defect under a different label.
 *
 * This gate reads the schema and the prose. It observes no host, and says
 * nothing about whether any engine fences correctly — that is gap G10.
 *
 * `spec/v1/` ships in the repository and NOT in the published tarball, so the
 * prose legs self-skip under the published layout; the schema ships in both.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { V1_DIR } from '../lib/paths.js';

const SCHEMA_PATH =
  V1_DIR === null ? null : pathResolve(V1_DIR, '..', '..', 'schemas', 'capabilities.schema.json');

interface EnumLike {
  readonly enum?: readonly string[];
  readonly anyOf?: readonly EnumLike[];
  readonly properties?: Record<string, EnumLike>;
}

function idempotencyCaps(): EnumLike | null {
  if (SCHEMA_PATH === null) return null;
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as {
    properties?: Record<string, EnumLike>;
  };
  return schema.properties?.['idempotency'] ?? null;
}

/** Every literal in an `enum`, including those nested under `anyOf`. */
function literals(node: EnumLike | undefined): string[] {
  if (node === undefined) return [];
  return [...(node.enum ?? []), ...(node.anyOf ?? []).flatMap(literals)];
}

describe.skipIf(V1_DIR === null)('RFC 0150 §D — multi-region effect vocabulary', () => {
  const idem = idempotencyCaps();
  const doc = V1_DIR === null ? '' : readFileSync(join(V1_DIR as string, 'idempotency.md'), 'utf8');

  it('the idempotency capability family is found at all', () => {
    // Guard: a lookup that silently returned null would make every leg below
    // vacuously true — the failure RFC 0148 exists to close.
    expect(idem, 'capabilities.schema.json MUST declare an `idempotency` family').not.toBeNull();
    expect(
      literals(idem?.properties?.['crossRegion']).length,
      'the `crossRegion` enum MUST be non-empty',
    ).toBeGreaterThan(0);
  });

  it('crossRegion offers the three RFC 0150 §D postures', () => {
    const values = literals(idem?.properties?.['crossRegion']);
    expect(
      [...values].sort(),
      'RFC 0150 §D: the canonical postures are `single-region` (no cross-region guarantee), ' +
        '`reconciled-records` (records converge, effects may remain at-least-once), and ' +
        '`fenced-effects` (records converge AND every effect is fenced or provider-idempotent).',
    ).toEqual(['fenced-effects', 'reconciled-records', 'single-region']);
  });

  it('crossRegion does not carry `strict`, which was a latency claim in a safety slot', () => {
    const values = literals(idem?.properties?.['crossRegion']);
    expect(
      values.includes('strict'),
      'RFC 0150 §D: `strict` promised bounded read-visibility, not effect authorization — a host ' +
        'replicating at 0 ms can still issue duplicate effects from two regions. Its latency ' +
        'content belongs to `multiRegion.replicationLagBoundMs`, which already carries it.',
    ).toBe(false);
  });

  it('partitionRecoveryStrategy offers no time-ordered rule', () => {
    const values = literals(idem?.properties?.['multiRegion']?.properties?.['partitionRecoveryStrategy']);
    const timeOrdered = values.filter((v) => v === 'last-writer-wins' || v === 'first-writer-wins');
    expect(
      timeOrdered,
      'RFC 0150 §D: under a partition there is no shared clock, so a time-ordered rule cannot ' +
        'satisfy the annex MUST that "re-running the same conflict input MUST produce the same ' +
        'survivor", and it selects a different survivor than the lex-min(runId) rule the same ' +
        'document requires. Removing only `last-writer-wins` leaves the identical defect under ' +
        `a different label. Found: ${timeOrdered.join(', ')}`,
    ).toEqual([]);
  });

  it('partitionRecoveryStrategy names the rule the annex actually requires', () => {
    const values = literals(idem?.properties?.['multiRegion']?.properties?.['partitionRecoveryStrategy']);
    expect(
      values,
      'the annex MUSTs lex-min(runId) convergence, so that rule MUST be nameable in the ' +
        'advertisement rather than reachable only through a vendor `x-host-*` extension.',
    ).toContain('lexicographic-min-run-id');
  });

  it('the spec states that reconciliation does not authorize effects', () => {
    const plain = doc.replace(/[`*_]/g, '').replace(/\s+/g, ' ');
    expect(
      /MUST NOT authorize effects/.test(plain),
      'RFC 0150 §D: run-record reconciliation and permission to issue effects are separate. ' +
        'Lexicographic run-ID reconciliation MAY select a surviving record but MUST NOT ' +
        'authorize an external effect — the sentence the whole section rests on.',
    ).toBe(true);
  });

  it('a host that can neither fence nor rely on provider dedup must say so', () => {
    const plain = doc.replace(/[`*_]/g, '').replace(/\s+/g, ' ');
    expect(
      /at-least-once-risk/.test(plain),
      'RFC 0150 §D: absent a fencing token or a provider guaranteeing duplicate suppression, a ' +
        'host MUST NOT claim strict multi-region effect safety and MUST classify the effect as ' +
        '`at-least-once-risk`. An unclassifiable risk is the one operators cannot plan around.',
    ).toBe(true);
  });

  it('the capability advertisement example parses as JSON', () => {
    // RFC 0149 §B found this and deliberately left it: the annex's example is
    // fenced as ```json while containing `"single-region" | "best-effort" |
    // "strict"`, which no parser accepts. An example that cannot parse is
    // exactly what RFC 0150 §D's extraction requirement exists to catch.
    const lines = doc.split('\n');
    const blocks: { line: number; body: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.trim() !== '```json') continue;
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j]!.trim() !== '```') body.push(lines[j++]!);
      blocks.push({ line: i + 2, body: body.join('\n') });
      i = j;
    }
    expect(blocks.length, 'idempotency.md MUST contain fenced json examples to check').toBeGreaterThan(0);
    const unparseable = blocks
      .filter((b) => {
        try {
          JSON.parse(b.body);
          return false;
        } catch {
          return true;
        }
      })
      .map((b) => `spec/v1/idempotency.md:${b.line}`);
    expect(
      unparseable,
      'a block fenced as ```json MUST parse as JSON. Union-type notation belongs in prose or a ' +
        '```text fence.\n  ' + unparseable.join('\n  '),
    ).toEqual([]);
  });
});
