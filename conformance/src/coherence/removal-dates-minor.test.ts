/**
 * removal-dates-minor — RFC 0197 §A.2 / §A.3. The corpus wrapper that proves
 * `scripts/check-removal-dates.mjs` gained a MINOR axis and that the axis can
 * go red.
 *
 * Before RFC 0197 the script compared MAJORS only: "removeIn major ≤ the served
 * major ⇒ due". A row scheduled for `2.40` was therefore due the instant it was
 * written, so no deprecation window could exist INSIDE major 2 — that absence
 * is the mechanism RFC 0197 §Motivation says was missing.
 *
 * The negative control is run, not asserted from memory: the SAME fixture row,
 * with the SAME `removeIn: "2.99"` and the SAME present source, is driven twice
 * — once with the pre-0197 trigger (`v2.0-cut`, the only way a v2 removal could
 * be scheduled before this RFC) and once with `v2-minor`. The first FAILS
 * immediately; the second passes and prints "not due at v2 release 2.35.0".
 * One difference, opposite verdicts.
 *
 * Every fixture is built in a tmpdir rather than committed under
 * `conformance/fixtures/`: it only ever feeds a spawned gate, it is never sent
 * to a host, and `check-npm-pack-contents` would have to carry an allowlist row
 * for each file the tarball then shipped to consumers who cannot use it. This
 * follows `v2-eos-clock.test.ts`, which drives the same script the same way.
 *
 * @see scripts/check-removal-dates.mjs
 * @see spec/v1/deprecations.schema.json (`removalTrigger: v2-minor`)
 * @see RFCS/0197-v2-surfaces-retired-never-reshaped.md §A.2, §A.3
 */

import { describe, it, expect } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const root = join(SCHEMAS_DIR, '..');
const ID = 'openwop.requirement.0197.retirement-predicate';
// §A.3's CORPUS half — "the reader schema still carries the member with
// `x-openwop-retired-in`". The HOST half (a host still accepting a shape
// retired before the run existed) is unwitnessable today and is recorded as
// gap G4, not claimed here.
const READER_ID = 'openwop.requirement.0197.reader-accepts-retired';
const DOC = 'spec/v2/core/overview.md §0a (RFC 0197 §A.2)';
const SCRIPT = join(root, 'scripts', 'check-removal-dates.mjs');

function out(r: SpawnSyncReturns<string>): string {
  return String(r.stdout ?? '') + String(r.stderr ?? '');
}

interface RowOpts {
  removeIn: string;
  trigger: string | string[];
  persistence?: 'advertised' | 'persisted';
  sourcePresent?: boolean;
  annotated?: boolean;
}

/** A tmp register + a tmp source tree; returns the spawn result. */
function run(opts: RowOpts): SpawnSyncReturns<string> {
  const dir = mkdtempSync(join(tmpdir(), 'openwop-0197-removal-'));
  const sourceFile = 'spec/v2/facets/fixture.schema.json';
  mkdirSync(join(dir, 'spec', 'v2', 'facets'), { recursive: true });
  const body: Record<string, unknown> = { $comment: 'RFC 0197 coherence fixture', properties: {} };
  if (opts.sourcePresent !== false) {
    (body['properties'] as Record<string, unknown>)['fixtureSurface'] = opts.annotated === false ? { type: 'string' } : { type: 'string', 'x-openwop-retired-in': opts.removeIn };
  }
  writeFileSync(join(dir, sourceFile), JSON.stringify(body, null, 2));
  const register = {
    $schema: './deprecations.schema.json',
    version: 1,
    updated: '2026-09-22',
    entries: [{
      id: 'openwop.deprecation.rfc-0197-fixture',
      status: 'deprecated',
      surface: 'fixtureSurface',
      kind: 'schema-field',
      deprecatedIn: '2.10',
      authority: 'RFC 0197 coherence fixture',
      removeIn: opts.removeIn,
      replacement: 'fixtureSurfaceV2',
      codemod: null,
      removalTrigger: opts.trigger,
      retirement: { class: 'facet', family: 'connections', deprecatedInMinor: '2.10', persistence: opts.persistence ?? 'advertised' },
      sources: [{ file: sourceFile, token: 'fixtureSurface' }],
    }],
  };
  const registerPath = join(dir, 'deprecations.json');
  writeFileSync(registerPath, JSON.stringify(register, null, 2));
  return spawnSync('node', [SCRIPT], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, OPENWOP_DEPRECATIONS_FILE: registerPath, OPENWOP_REMOVAL_SOURCE_ROOT: dir },
  });
}

describe('removal-dates-minor (RFC 0197 §A.2 — the minor axis of check-removal-dates)', () => {
  it('the committed register passes and the script PRINTS its v2 minor-lane state', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = spawnSync('node', [SCRIPT], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    expect(r.status, req(ID, DOC, `check-removal-dates MUST be green on the committed register — ${out(r).slice(-400)}`)).toBe(0);
    expect(out(r), req(ID, DOC, 'a gate green because it has no v2-minor row prints the same nothing as one green because the comparison never ran; the script MUST print the lane state on every run')).toMatch(/check-removal-dates v2 minor lane \(RFC 0197 .A\.2\): v2 release \d+\.\d+\.\d+; \d+ row\(s\) with trigger v2-minor/);
  }, 120_000);

  it('NEGATIVE CONTROL — the same 2.99 row is DUE under the pre-0197 trigger and NOT due under v2-minor', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const legacy = run({ removeIn: '2.99', trigger: 'v2.0-cut' });
    expect(legacy.status, req(ID, DOC, `with the only pre-0197 v2 trigger, a removal scheduled at 2.99 is due AT ONCE — that is the major-granular behaviour RFC 0197 replaces. It exited ${legacy.status}: ${out(legacy).slice(-400)}`)).not.toBe(0);
    expect(out(legacy), req(ID, DOC, 'the legacy failure must be the major rule firing, naming the still-present source')).toMatch(/removal 2\.99 has passed/);

    const minor = run({ removeIn: '2.99', trigger: ['v2-minor'] });
    expect(minor.status, req(ID, DOC, `the SAME row under the v2-minor trigger is NOT due until the v2 release reaches 2.99 — it exited ${minor.status}: ${out(minor).slice(-400)}`)).toBe(0);
    expect(out(minor), req(ID, DOC, 'the minor lane must say which release it compared against and that the row is not due')).toMatch(/removeIn 2\.99 \(advertised\) — not due at v2 release/);
  }, 120_000);

  it('a DUE advertised-class row whose v2 source is still present FAILS', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const current = JSON.parse(readFileSync(join(root, 'spec', 'v2', 'release.json'), 'utf8')) as { version: string };
    const [maj, min] = current.version.split('.');
    const r = run({ removeIn: `${maj}.${min}`, trigger: ['v2-minor'] });
    expect(r.status, req(ID, DOC, `a v2-minor row whose removeIn the released version has reached, with its source still in the tree, MUST fail — it exited ${r.status}: ${out(r).slice(-400)}`)).not.toBe(0);
    expect(out(r), req(ID, DOC, 'the failure must name the release, the removeIn and the source')).toMatch(/has reached removeIn .* still carries/s);
  }, 120_000);

  it('a DUE persisted-class row whose member was DELETED from the reader schema FAILS (§A.3: only emission narrows)', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const current = JSON.parse(readFileSync(join(root, 'spec', 'v2', 'release.json'), 'utf8')) as { version: string };
    const [maj, min] = current.version.split('.');
    const r = run({ removeIn: `${maj}.${min}`, trigger: ['v2-minor'], persistence: 'persisted', sourcePresent: false });
    expect(r.status, req(READER_ID, DOC, `a persisted-class retirement narrows EMISSION only; a reader schema that lost the member breaks replay, fork and poll, and MUST fail — it exited ${r.status}: ${out(r).slice(-400)}`)).not.toBe(0);
    expect(out(r), req(READER_ID, DOC, 'the failure must say the reader MUST keep accepting the shape')).toMatch(/persisted-class retirement/);
  }, 120_000);

  it('a DUE persisted-class row whose member survives but is UNANNOTATED fails; annotated, it passes', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const current = JSON.parse(readFileSync(join(root, 'spec', 'v2', 'release.json'), 'utf8')) as { version: string };
    const [maj, min] = current.version.split('.');
    const bad = run({ removeIn: `${maj}.${min}`, trigger: ['v2-minor'], persistence: 'persisted', annotated: false });
    expect(bad.status, req(READER_ID, DOC, `an unannotated surviving member is indistinguishable from one a host may still emit — it exited ${bad.status}: ${out(bad).slice(-400)}`)).not.toBe(0);
    expect(out(bad), req(READER_ID, DOC, 'the failure must name the missing x-openwop-retired-in annotation')).toMatch(/x-openwop-retired-in/);

    const good = run({ removeIn: `${maj}.${min}`, trigger: ['v2-minor'], persistence: 'persisted', annotated: true });
    expect(good.status, req(READER_ID, DOC, `the positive control: annotated and present is the CORRECT persisted-class state and MUST pass — it exited ${good.status}: ${out(good).slice(-400)}`)).toBe(0);
  }, 120_000);
});
