/**
 * tool-result-trust-monotone — RFC 0143, the general rule the corpus's ~ten
 * point-invariants instance.
 *
 * The threat model fences ~ten specific untrusted-content ingresses into the
 * prompt (user input, RAG, artifacts, MCP, node-pack output, runner, card
 * inputs, form-content, voice), each with its own MUST. It never stated the
 * general rule: **a tool result is content entering model context, untrusted
 * unless the host has a named basis for trust, and trust is the MEET of a
 * composed segment's inputs — never raised by any transformation.** Absent that
 * rule the FRMD-F1-1 laundering path (untrusted → tool → "result" → prompt,
 * tag dropped in transit) is unforbidden in general, and nothing catches the
 * NEXT ingress shipped without a fence.
 *
 * Always-on, server-free, three parts:
 *
 *   PART 1 — COMPLETENESS (load-bearing). Every content-ingress surface the
 *   threat model's §4 STRIDE table names cites a fencing invariant that
 *   actually EXISTS in SECURITY/invariants.yaml — no dangling reference — AND a
 *   curated floor of prompt-ingress surfaces each resolves to a real invariant.
 *   A new ingress added to §4 without a trust invariant reds this. The
 *   general-rule analog of RFC 0138's "every manifest admits the hatch"; the
 *   thing the point-invariants alone cannot provide.
 *
 *   PART 2 — the MEET is stated normatively. The new §2a states monotone
 *   composition, untrusted-by-default with "a tool ran" NOT a basis,
 *   no-laundering-through-storage, both blessed strategies, and the isolation
 *   carve-out. Prose-pinned: the schema cannot express "MUST be the meet."
 *
 *   PART 3 — the instances name the general rule. ai-envelope.md §"Trust
 *   boundary" cross-references §2a, so the MCP/A2A special case is anchored to
 *   the general rule and cannot drift into contradicting it.
 *
 * WHAT THIS DOES NOT COVER — host behavior. Dynamic propagation through the
 * durable-store hop (strategy a) is witnessed by the reference host (memory
 * lane), not here; and the completeness leg is only as complete as §4 (an
 * ingress that exists in a host but was never added to §4 is invisible —
 * RFC 0143 unresolved-question 1).
 *
 * @see RFCS/0143-tool-result-trust-propagation.md
 * @see SECURITY/threat-model-prompt-injection.md §2a, §4, §5
 * @see spec/v1/ai-envelope.md §"Trust boundary"
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';

// Repo root = parent of schemas/ (the canonical anchor other scenarios use).
// SECURITY/ is not vendored into the published package layout, so guard reads
// and skip when absent — the same posture as V1_DIR === null.
const REPO_ROOT: string | null = (() => {
  const r = dirname(SCHEMAS_DIR);
  return existsSync(join(r, 'SECURITY', 'invariants.yaml')) ? r : null;
})();

const why = (specRef: string, requirement: string): string => `${specRef} — ${requirement}`;

const TM = REPO_ROOT ? readFileSync(join(REPO_ROOT, 'SECURITY', 'threat-model-prompt-injection.md'), 'utf8') : '';
const INV = REPO_ROOT ? readFileSync(join(REPO_ROOT, 'SECURITY', 'invariants.yaml'), 'utf8') : '';
const ENV = V1_DIR ? readFileSync(join(V1_DIR, 'ai-envelope.md'), 'utf8') : '';

/** All invariant ids declared in SECURITY/invariants.yaml. */
function declaredInvariants(): Set<string> {
  const ids = new Set<string>();
  for (const m of INV.matchAll(/^\s*- id:\s*([a-z0-9-]+)\s*$/gim)) ids.add(m[1]);
  return ids;
}

/** Every invariant id CITED in a §4 STRIDE `Invariant` column (backticked, kebab-case). */
function citedInSection4(): string[] {
  const start = TM.indexOf('## 4.');
  const s4 = start >= 0 ? TM.slice(start, TM.indexOf('\n## 5.')) : '';
  const ids = new Set<string>();
  // Backticked kebab identifiers that look like invariant ids (contain a hyphen,
  // lowercase). Excludes prose backticks like `core.*` (has a dot) and `exec`.
  for (const m of s4.matchAll(/`([a-z][a-z0-9]+(?:-[a-z0-9]+)+)`/g)) {
    const id = m[1];
    if (!id.includes('.') && !id.includes('_')) ids.add(id);
  }
  return [...ids];
}

describe('tool-result-trust-monotone: COMPLETENESS — no unfenced ingress (RFC 0143 part 1)', () => {
  const declared = declaredInvariants();

  it.skipIf(REPO_ROOT === null)('every invariant the §4 STRIDE table cites actually exists (no dangling fence)', () => {
    const cited = citedInSection4();
    expect(cited.length, why('threat-model §4', 'the STRIDE table cites fencing invariants')).toBeGreaterThan(5);
    // Only assert for ids that ARE invariants (present in the file) OR are
    // clearly invariant-shaped; a cited id that resolves to nothing is drift.
    const dangling = cited.filter((id) => /injection|trust|untrusted|marker|sandbox|exec|a2ui|voice|runner|pack/.test(id) && !declared.has(id));
    expect(
      dangling,
      why('threat-model §4', `every invariant-shaped id cited in §4 MUST exist in invariants.yaml — dangling: ${dangling.join(', ')}`),
    ).toEqual([]);
  });

  it.skipIf(REPO_ROOT === null)('the curated floor of prompt-ingress surfaces each has a real fencing invariant', () => {
    // The core content-ingress-to-prompt surfaces. If a surface is de-fenced or
    // its invariant renamed without updating this floor, the leg reds — this is
    // the "next ingress shipped unfenced" guard, scoped to the known set.
    const FLOOR: Record<string, string[]> = {
      'user input': ['prompt-injection-input-marker'],
      'RAG / knowledge base': ['prompt-injection-kb-marker'],
      'prior artifact': ['prompt-injection-artifact-marker'],
      'MCP tool result': ['prompt-injection-mcp-marker'],
      'node-pack output': ['node-pack-output-untrusted'],
      'self-hosted runner': ['runner-output-untrusted-transport'],
      'chat-card input': ['chat-card-input-trust-boundary'],
      'form-content pack strings': ['form-content-pack-string-trust-boundary'],
      'voice transcript': ['voice-transcript-untrusted'],
      'compose boundary (the meet)': ['prompt-composed-trust-marker'],
    };
    for (const [surface, inv] of Object.entries(FLOOR)) {
      const present = inv.filter((i) => declared.has(i));
      expect(
        present,
        why('threat-model §5 / invariants.yaml', `the "${surface}" ingress MUST retain a fencing invariant (${inv.join(' | ')})`),
      ).toEqual(inv);
    }
  });

  it.skipIf(REPO_ROOT === null)('the general rule itself is a declared invariant', () => {
    expect(
      declared.has('tool-result-trust-monotone'),
      why('invariants.yaml', 'RFC 0143 mints the general monotone-composition invariant the point-invariants instance'),
    ).toBe(true);
  });
});

describe('tool-result-trust-monotone: the MEET is stated normatively (RFC 0143 part 2)', () => {
  it.skipIf(REPO_ROOT === null)('§2a exists and states monotone composition (the meet)', () => {
    expect(/## 2a\. Trust is monotone through composition/i.test(TM), why('threat-model §2a', 'the general-rule section exists')).toBe(true);
    expect(
      /MUST be the \*\*meet\*\*|MUST be the meet of its inputs/i.test(TM),
      why('threat-model §2a', 'a composed segment\'s trust MUST be the MEET of its inputs — one untrusted input taints the segment'),
    ).toBe(true);
  });

  it.skipIf(REPO_ROOT === null)('"a tool ran" is explicitly NOT a basis for trust', () => {
    expect(
      /tool having executed and returned is\W{0,4}\s*NOT a basis/i.test(TM),
      why('threat-model §2a', 'untrusted-by-default — a tool having run is not a trust basis'),
    ).toBe(true);
  });

  it.skipIf(REPO_ROOT === null)('no laundering through storage, and both strategies are blessed', () => {
    expect(/does not launder it/i.test(TM), why('threat-model §2a', 'persist-then-recall does not launder (closes FRMD-F1-1)')).toBe(true);
    expect(/dynamic coarse-grained propagation/i.test(TM) && /static reader classification/i.test(TM), why('threat-model §2a', 'both conforming strategies named')).toBe(true);
    expect(/[Vv]alue-granular taint.{0,60}NOT required/i.test(TM), why('threat-model §2a', 'value-granular taint is NOT required — the floor is the coarse meet')).toBe(true);
  });

  it.skipIf(REPO_ROOT === null)('the structurally-isolated-reader carve-out is present and narrow', () => {
    expect(/structurally isolated/i.test(TM), why('threat-model §2a', 'the isolation carve-out exists so correct sandboxing is not punished')).toBe(true);
    expect(/missing.{0,20}`?"?trusted"?`?.{0,40}violat|absence of a trust decision is\W{0,4}\s*`?untrusted`?/i.test(TM), why('threat-model §2a', 'the fail-open (missing ⇒ trusted) default is the violation')).toBe(true);
  });
});

describe('tool-result-trust-monotone: the instances name the general rule (RFC 0143 part 3)', () => {
  it.skipIf(V1_DIR === null)('ai-envelope.md §"Trust boundary" cross-references §2a / RFC 0143', () => {
    expect(
      /named instance.{0,80}(§2a|RFC 0143|monotone-composition)/is.test(ENV),
      why('ai-envelope.md §"Trust boundary"', 'the MCP/A2A rule cites the general rule as its instance, so it cannot drift into contradicting it'),
    ).toBe(true);
  });
});
