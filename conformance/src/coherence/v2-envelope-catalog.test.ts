/**
 * RFC 0193 — the three envelope families whose v1 payload the v2 generator
 * dropped in silence, and the guard that stops the fourth.
 *
 * Corpus-gate only (RFC 0168 §D.1). The generator leg SABOTAGES a scratch copy
 * — it removes a seat file and asserts the refusal names the family — because
 * the committed tree is clean and a bare exit-0 wrapper would pass just as
 * happily with the guard deleted. That is the vacuous-witness shape this corpus
 * keeps catching in others.
 *
 * The optionality leg is the one that would have caught the original defect
 * early only if it had existed: it asserts the seat is present AND not
 * required, because a required seat invalidates MyndHyve's already-published
 * closed record.
 *
 * @see RFCS/0193-envelope-catalog-seats.md
 */

import { describe, it, expect } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const root = join(SCHEMAS_DIR, '..');

/** Sabotage runs against a THROWAWAY COPY; mutating the tracked tree races v2-spec-artifacts-digest. */
function inScratchCorpus(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'openwop-envcat-'));
  try {
    for (const p of ['scripts', 'spec', 'schemas', 'docs', 'evidence']) {
      cpSync(join(root, p), join(dir, p), { recursive: true });
    }
    fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const all = (r: SpawnSyncReturns<string>): string => String(r.stderr ?? '') + String(r.stdout ?? '');
/**
 * The refusal is matched against the WHOLE output, not its tail: a thrown Error
 * puts the message FIRST and eight lines of node stack after it, so a tail-only
 * match reads the stack and reports "not refused" for a generator that refused
 * correctly. `tail` stays for the human-readable failure text.
 */
const tail = (r: SpawnSyncReturns<string>): string =>
  all(r).trim().split('\n').slice(-8).join(' | ');
const run = (cwd: string = root) =>
  spawnSync('node', [join(cwd, 'scripts', 'generate-from-declaration.mjs')], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

const SEATS: ReadonlyArray<readonly [string, string]> = [
  ['supportedEnvelopes', 'kinds'],
  ['schemaVersions', 'kinds'],
  ['envelopeStrictness', 'mode'],
];

type Record_ = { properties?: Record<string, unknown>; required?: string[] };
const caps = (): Record<string, Record_> =>
  (JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', 'capabilities.schema.json'), 'utf8')) as { properties: Record<string, Record_> }).properties;

describe('v2-envelope-catalog (RFC 0193 §A–§F)', () => {
  it('each of the three carries its seat', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const p = caps();
    const missing = SEATS.filter(([k, seat]) => !(p[k]?.properties && seat in p[k]!.properties!));
    expect(missing.length === 0,
      req('openwop.requirement.0193.seats-present', 'RFC 0193 §B',
        `a v1 array/map/enum holds its value in a named seat; without one the record is a claim with nothing in it — missing: ${missing.map(([k, s]) => `${k}.${s}`).join(', ') || 'none'}`)).toBe(true);
  }, 60_000);

  it('no seat is required — a published record without one stays valid', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const p = caps();
    const forced = SEATS.filter(([k, seat]) => (p[k]?.required ?? []).includes(seat));
    expect(forced.length === 0,
      req('openwop.requirement.0193.seats-optional', 'RFC 0193 §B',
        `MyndHyve already publishes supportedEnvelopes and schemaVersions with no seat, and the v2 root is additionalProperties:false — a required seat invalidates a live closed document with no host change. Forced: ${forced.map(([k, s]) => `${k}.${s}`).join(', ') || 'none'}`)).toBe(true);
  }, 60_000);

  it('the generator refuses a family whose payload it cannot carry', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    inScratchCorpus((dir) => {
      rmSync(join(dir, 'spec', 'v2', 'facets', 'supportedEnvelopes.schema.json'));
      const sab = run(dir);
      const refused = sab.status !== 0 && /supportedEnvelopes/.test(all(sab)) && /0193/.test(all(sab));
      const clean = run();
      expect(refused && clean.status === 0,
        req('openwop.requirement.0193.generator-refuses', 'RFC 0193 §A/§B',
          `the splice drops an array/map/enum payload with no error — the generator must fail by family name instead: refused=${refused}, clean=${clean.status === 0} — ${tail(sab)}`)).toBe(true);
    });
  }, 180_000);

  it('an absent catalog is stated to fail CLOSED', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const md = readFileSync(join(root, 'spec', 'v2', 'core', 'events.md'), 'utf8');
    const sec = md.split('## The envelope-kind catalog')[1]?.split('\n## ')[0] ?? '';
    const closed = /absent `kinds` is not an empty catalog and is not an unrestricted one/i.test(sec)
      && /MUST refuse every non-universal kind/.test(sec);
    expect(closed,
      req('openwop.requirement.0193.absence-is-closed', 'RFC 0193 §C',
        `unknown_envelope_kind is DEFINED as "not in supportedEnvelopes"; with no list at major 2 the prompt-injection-envelope-typecheck invariant fails open unless absence is pinned to refuse — got ${sec.length} chars`)).toBe(true);
  }, 60_000);

  it('both refusal codes are registered at major 2', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const reg = JSON.parse(readFileSync(join(root, 'spec', 'v2', 'errors.json'), 'utf8')) as { rows: Array<{ code: string }> };
    const have = new Set(reg.rows.map((r) => r.code));
    const missing = ['unknown_envelope_kind', 'unknown_schema_version'].filter((c) => !have.has(c));
    expect(missing.length === 0,
      req('openwop.requirement.0193.codes-registered', 'RFC 0193 §F',
        `v1 prose already requires a host to emit these; an unregistered code cannot be asserted against at major 2 — missing: ${missing.join(', ') || 'none'}`)).toBe(true);
  }, 60_000);

  it('versioning axis 6 no longer contradicts the record', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const row = readFileSync(join(root, 'spec', 'v2', 'core', 'versioning.md'), 'utf8')
      .split('\n').find((l) => l.startsWith('| 6 |')) ?? '';
    const ok = /propertyNames/.test(row) && !/`additionalProperties: false` over declared kinds/.test(row);
    expect(ok,
      req('openwop.requirement.0193.axis-6-agrees', 'RFC 0193 §D',
        `a closed enum over declared kinds forbids the vendor kinds ai-envelope.schema.json requires to be host-published — got: ${row.slice(0, 200)}`)).toBe(true);
  }, 60_000);
});
