/**
 * RFC 0149 §B — normative discovery examples place capability families at the
 * document root.
 *
 * RFC 0073 (`Accepted`) made the root layout "the normative MUST since Phase 1"
 * and, at Phase 4, made the suite enforce it: a wrapper-only host "grades as
 * non-conformant". The `capabilities` wrapper survives only as a deprecated
 * shape that runtime discovery tolerates through the v1.x window, retiring at
 * v2.0 when `capabilities.schema.json` tightens.
 *
 * Tolerating a shape at runtime and teaching it in a normative example are
 * different things. Eight `spec/v1` examples — several under headings like
 * "Capability advertisement (normative)", introduced by prose saying hosts
 * "advertise it under `/.well-known/openwop`" — showed the deprecated wrapper.
 * An implementer copying one produced a document RFC 0073 grades as
 * non-conformant, and no gate noticed, because a fenced example is prose to
 * every validator in the corpus.
 *
 * This gate is authoring-time only. It says nothing about what a server may
 * emit: RFC 0149 §B is explicit that the runtime schema MUST NOT reject an
 * otherwise legal unknown server-emitted property, and nothing here reads a
 * host.
 *
 * **Canonical-typo leg (RFC 0149 §B, second bullet; UQ2 decided 2026-08-16).** A
 * root key within edit distance ONE of a canonical family, in a discovery-shaped
 * example, that is not itself canonical and not vendor-namespaced, is a typo
 * (`compensaton`, `interupts`) — an implementer copying it advertises nothing.
 * UQ2 asked what rule avoids false positives on legitimate extension names; the
 * answer was measured, not guessed. Over every fenced root object in `spec/v1` +
 * `RFCS/` (218 on 2026-08-16), plain distance-one produced six near-misses —
 * `ts`/`fs`, `agent`/`agents`, `secret`/`secrets`, `context`/`content`,
 * `prompt`/`prompts`, `schemaVersion`/`schemaVersions` — every one of them a key
 * of an EVENT or RUN object, not a discovery document. So the predicate is
 * *discovery-shaped*: every root key is canonical, vendor-namespaced
 * (`host-extensions.md` §"Canonical prefixes"), the legacy `capabilities`
 * wrapper, or within distance one of a canonical family — and at least one key
 * is canonical-or-near. That excludes events (`ts`/`type`/`payload` are none of
 * those) while still catching a typo-only snippet whose single key is misspelt.
 * Scope: `spec/v1` and RFCs numbered >= 0149 (the rule's own RFC); older RFCs
 * are the dated record, on the same boundary logic as the wrapper leg's 0073.
 * Under that predicate and scope the corpus measured 53 discovery-shaped
 * objects and 0 findings; the one out-of-scope near-miss is RFC 0109's
 * `{ "agent": … }` payload fragment.
 *
 * `spec/v1/` and `RFCS/` ship in the repository, NOT in the published tarball,
 * so this self-skips under the published layout. That asymmetry has produced
 * three defects in this corpus — the `CORPUS-STAMP` gate, the link-checker's
 * filesystem walk, and RFC 0146 leg A4, which ENOENT'd for every adopter
 * running from the package.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

/** RFC 0073 established the root layout; examples in earlier RFCs are historical record. */
const ROOT_LAYOUT_RFC = 73;

const RFCS_DIR = V1_DIR === null ? null : pathResolve(V1_DIR, '..', '..', 'RFCS');

interface FencedExample {
  readonly file: string;
  readonly line: number;
  readonly rootWrapper: boolean;
}

/** Fenced ```json / ```jsonc blocks, flagged when the root object's first key is `capabilities`. */
function fencedExamples(dir: string): FencedExample[] {
  const found: FencedExample[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const lines = readFileSync(join(dir, name), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/^```(json|jsonc)\s*$/.test(lines[i]!.trim())) continue;
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j]!.trim() !== '```') {
        body.push(lines[j]!);
        j++;
      }
      const rootWrapper =
        body.length > 1 && /^\s*\{\s*$/.test(body[0]!) && /^\s*"capabilities"\s*:\s*\{\s*$/.test(body[1]!);
      found.push({ file: name, line: i + 2, rootWrapper });
      i = j;
    }
  }
  return found;
}

/** RFC 0149 introduced the typo lint; examples in earlier RFCs are historical record. */
const TYPO_LINT_RFC = 149;

const SCHEMA_PATH =
  V1_DIR === null ? null : pathResolve(V1_DIR, '..', '..', 'schemas', 'capabilities.schema.json');

/** The canonical families, read from the schema rather than hand-listed. */
function canonicalFamilies(): Set<string> {
  if (SCHEMA_PATH === null) return new Set();
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as { properties?: Record<string, unknown> };
  return new Set(Object.keys(schema.properties ?? {}));
}

/** `host-extensions.md` §"Canonical prefixes". */
function isVendorKey(key: string): boolean {
  return /^x-host-/.test(key) || /^(vendor|private)\./.test(key);
}

/** Levenshtein distance exactly one (one substitution, insertion, or deletion). */
export function withinOne(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false;
    return diff === 1;
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++;
      j++;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
      j++;
    }
  }
  return true;
}

export interface TypoFinding {
  readonly key: string;
  readonly near: readonly string[];
}

/**
 * The UQ2 rule. Returns the near-miss root keys of a DISCOVERY-SHAPED object, or
 * `null` when the object is not discovery-shaped (and so is out of scope: an
 * event, a run body, a manifest). Exported so the predicate is pinned below.
 */
export function canonicalTypos(value: unknown, families: Set<string>): TypoFinding[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) return null;
  const near = new Map<string, string[]>();
  for (const k of keys) {
    if (families.has(k) || isVendorKey(k) || k === 'capabilities') continue;
    const n = [...families].filter((f) => withinOne(k, f));
    if (n.length === 0) return null; // a key that is none of the four kinds ⇒ not discovery-shaped
    near.set(k, n);
  }
  if (!keys.some((k) => families.has(k) || near.has(k))) return null;
  return [...near.entries()].map(([key, n]) => ({ key, near: n }));
}

/** Every parseable fenced json/jsonc root object under `dir`, with its source line. */
function fencedObjects(dir: string): { file: string; line: number; value: unknown }[] {
  const out: { file: string; line: number; value: unknown }[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const lines = readFileSync(join(dir, name), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/^```(json|jsonc)\s*$/.test(lines[i]!.trim())) continue;
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j]!.trim() !== '```') body.push(lines[j++]!);
      try {
        out.push({ file: name, line: i + 2, value: JSON.parse(body.join('\n')) });
      } catch {
        // Unparseable blocks are RFC 0150 §D's problem, not this gate's.
      }
      i = j;
    }
  }
  return out;
}

describe.skipIf(V1_DIR === null)('RFC 0149 §B — discovery examples use the document-root layout', () => {
  const v1Dir = V1_DIR as string;

  it('the scan finds fenced examples at all', () => {
    // Guard: an extractor that silently matched nothing would make the
    // assertions below vacuously true, which is the failure mode RFC 0148
    // exists to close. This gate must not become an instance of it.
    const examples = fencedExamples(v1Dir);
    expect(examples.length, req('openwop.it.capability-example-root-layout.the-scan-finds-fenced-examples-at-all', 'RFC 0149 §B', 'spec/v1 MUST contain fenced json/jsonc examples to check')).toBeGreaterThan(20);
  });

  it('no spec/v1 example wraps capability families in a top-level `capabilities` object', () => {
    const offenders = fencedExamples(v1Dir)
      .filter((e) => e.rootWrapper)
      .map((e) => `spec/v1/${e.file}:${e.line}`);
    expect(
      offenders,
      req('openwop.it.capability-example-root-layout.no-spec-v1-example-wraps-capability-families-in-a-top-level-capabilities-object', 'RFC 0149 §B', 'RFC 0073: capability families are a property of the DOCUMENT ROOT; there is no `capabilities` wrapper. ' +
        'A normative example showing the deprecated shape teaches a document RFC 0073 grades as non-conformant.\n  ' +
        offenders.join('\n  ')),
    ).toEqual([]);
  });

  it('every RFC still showing the wrapper predates RFC 0073, which established root layout', () => {
    // RFCs are a dated record of what was proposed, so their examples are NOT
    // rewritten to match a later layout — that would make the record lie. The
    // exemption is asserted rather than assumed: a NEW post-0073 RFC that
    // introduces a wrapper fails here, so the historical carve-out cannot widen
    // into a licence.
    if (RFCS_DIR === null || !existsSync(RFCS_DIR)) return softSkip('blocked', 'precondition not met — `RFCS_DIR === null || !existsSync(RFCS_DIR)` returned early (RFCs are a dated record of what was proposed, so their examples are NOT rewritten to match a later layout — that would make the recor…');
    const late = fencedExamples(RFCS_DIR)
      .filter((e) => e.rootWrapper)
      .filter((e) => {
        const n = Number.parseInt(e.file.slice(0, 4), 10);
        return Number.isFinite(n) && n >= ROOT_LAYOUT_RFC;
      })
      .map((e) => `RFCS/${e.file}:${e.line}`);
    expect(
      late,
      req('openwop.it.capability-example-root-layout.every-rfc-still-showing-the-wrapper-predates-rfc-0073-which-established-root-lay', 'RFC 0073', `an RFC numbered >= ${ROOT_LAYOUT_RFC} uses the deprecated \`capabilities\` wrapper. ` +
        'Pre-0073 RFCs keep theirs as historical record; a later one has no such excuse.\n  ' +
        late.join('\n  ')),
    ).toEqual([]);
  });
  it('the UQ2 predicate is pinned: a typo-only snippet is flagged, an event object is out of scope, a vendor key is exempt', () => {
    const fams = new Set(['compensation', 'interrupts', 'fs', 'agents', 'content']);
    // A misspelt single-key discovery snippet: all keys near-canonical ⇒ in scope, flagged.
    expect(canonicalTypos({ compensaton: { supported: true } }, fams), req('openwop.it.capability-example-root-layout.the-uq2-predicate-is-pinned-a-typo-only-snippet-is-flagged-an-event-object-is-ou', 'RFC 0149 §B', 'the UQ2 predicate is pinned: a typo-only snippet is flagged, an event object is out of scope, a vendor key is exempt')).toEqual([{ key: 'compensaton', near: ['compensation'] }]);
    // Canonical + a typo ⇒ flagged.
    expect(canonicalTypos({ compensation: {}, interupts: {} }, fams)).toEqual([{ key: 'interupts', near: ['interrupts'] }]);
    // An event: `ts` is one from `fs` but `type`/`payload` are none of the four kinds ⇒ not discovery-shaped.
    expect(canonicalTypos({ ts: 1, type: 'x', payload: {} }, fams)).toBeNull();
    // Vendor-namespaced keys are exempt (RFC 0149 §B) and the legacy wrapper is the wrapper leg's business.
    expect(canonicalTypos({ compensation: {}, 'x-host-acme-agent': {} }, fams)).toEqual([]);
    expect(canonicalTypos({ capabilities: {} }, fams)).toBeNull();
    // Distance exactly one, both directions.
    expect(withinOne('agent', 'agents')).toBe(true);
    expect(withinOne('agents', 'agent')).toBe(true);
    expect(withinOne('agent', 'agentz')).toBe(true);
    expect(withinOne('agent', 'agenzs')).toBe(false);
    expect(withinOne('agents', 'agents')).toBe(false);
  });

  it('no discovery-shaped example in spec/v1 or a post-0149 RFC has a root key within one edit of a canonical family', () => {
    const families = canonicalFamilies();
    expect(families.size, req('openwop.it.capability-example-root-layout.no-discovery-shaped-example-in-spec-v1-or-a-post-0149-rfc-has-a-root-key-within', 'RFC 0149 §B', 'capabilities.schema.json MUST declare families')).toBeGreaterThan(50);
    const findings: string[] = [];
    let shaped = 0;
    const scan = (dir: string, rel: string, minRfc: number | null): void => {
      for (const { file, line, value } of fencedObjects(dir)) {
        if (minRfc !== null) {
          const n = Number.parseInt(file.slice(0, 4), 10);
          if (!Number.isFinite(n) || n < minRfc) continue;
        }
        const typos = canonicalTypos(value, families);
        if (typos === null) continue;
        shaped++;
        for (const t of typos) findings.push(`${rel}/${file}:${line} → \`${t.key}\` (did you mean ${t.near.map((x) => '`' + x + '`').join(' / ')}?)`);
      }
    };
    scan(v1Dir, 'spec/v1', null);
    if (RFCS_DIR !== null && existsSync(RFCS_DIR)) scan(RFCS_DIR, 'RFCS', TYPO_LINT_RFC);
    expect(shaped, req('openwop.it.capability-example-root-layout.no-discovery-shaped-example-in-spec-v1-or-a-post-0149-rfc-has-a-root-key-within', 'RFC 0149 §B', 'the scan MUST find discovery-shaped examples, or the leg is vacuous')).toBeGreaterThan(20);
    expect(
      findings,
      'RFC 0149 §B: a root key within one edit of a canonical family, in a discovery-shaped example, is a ' +
        'typo — an implementer copying it advertises nothing. Vendor surface goes under `x-host-*` / ' +
        '`vendor.*` / `private.*` (host-extensions.md).\n  ' +
        findings.join('\n  '),
    ).toEqual([]);
  });
});
