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

describe.skipIf(V1_DIR === null)('RFC 0149 §B — discovery examples use the document-root layout', () => {
  const v1Dir = V1_DIR as string;

  it('the scan finds fenced examples at all', () => {
    // Guard: an extractor that silently matched nothing would make the
    // assertions below vacuously true, which is the failure mode RFC 0148
    // exists to close. This gate must not become an instance of it.
    const examples = fencedExamples(v1Dir);
    expect(examples.length, 'spec/v1 MUST contain fenced json/jsonc examples to check').toBeGreaterThan(20);
  });

  it('no spec/v1 example wraps capability families in a top-level `capabilities` object', () => {
    const offenders = fencedExamples(v1Dir)
      .filter((e) => e.rootWrapper)
      .map((e) => `spec/v1/${e.file}:${e.line}`);
    expect(
      offenders,
      'RFC 0073: capability families are a property of the DOCUMENT ROOT; there is no `capabilities` wrapper. ' +
        'A normative example showing the deprecated shape teaches a document RFC 0073 grades as non-conformant.\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('every RFC still showing the wrapper predates RFC 0073, which established root layout', () => {
    // RFCs are a dated record of what was proposed, so their examples are NOT
    // rewritten to match a later layout — that would make the record lie. The
    // exemption is asserted rather than assumed: a NEW post-0073 RFC that
    // introduces a wrapper fails here, so the historical carve-out cannot widen
    // into a licence.
    if (RFCS_DIR === null || !existsSync(RFCS_DIR)) return;
    const late = fencedExamples(RFCS_DIR)
      .filter((e) => e.rootWrapper)
      .filter((e) => {
        const n = Number.parseInt(e.file.slice(0, 4), 10);
        return Number.isFinite(n) && n >= ROOT_LAYOUT_RFC;
      })
      .map((e) => `RFCS/${e.file}:${e.line}`);
    expect(
      late,
      `an RFC numbered >= ${ROOT_LAYOUT_RFC} uses the deprecated \`capabilities\` wrapper. ` +
        'Pre-0073 RFCs keep theirs as historical record; a later one has no such excuse.\n  ' +
        late.join('\n  '),
    ).toEqual([]);
  });
});
