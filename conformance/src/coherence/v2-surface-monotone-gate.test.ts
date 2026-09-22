/**
 * v2-surface-monotone-gate — RFC 0197 §A.1 and §B. The corpus wrapper that
 * proves `scripts/check-v2-surface-monotone.mjs` fails a reshape, passes an
 * addition, and — the leg that decides whether the whole design works — passes
 * a branch re-cut of the shape RFC 0209 already landed.
 *
 * §A.1: "A re-cut that keeps the prior shape unchanged as one branch, such as a
 * root split into an `anyOf` whose one branch is the prior object … is a new
 * surface beside the old and not a reshape … A `$defs` name is not a surface."
 * A structural diff would call that a mass removal. So the positive control
 * here is a synthetic schema in exactly RFC 0209's shape: root `properties` →
 * `anyOf: [$ref payloadV1, $ref payloadV2]`, `$defs/component` renamed
 * `componentV1`. It MUST report zero removals. Without this leg, the gate
 * landing last in the 2.36.0 cycle would be a hope rather than a check.
 *
 * Every schema tree is synthetic and lives in a tmpdir. Driving the sabotages
 * against the REAL `schemas/v2/` would mean writing into the corpus from a
 * test, and a crashed run would leave a mutated schema behind.
 *
 * @see scripts/check-v2-surface-monotone.mjs
 * @see scripts/generate-v2-surface-baseline.mjs
 * @see schemas/v2/envelopes/ui.a2ui-surface.schema.json (RFC 0209's re-cut)
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const root = join(SCHEMAS_DIR, '..');
const GATE = join(root, 'scripts', 'check-v2-surface-monotone.mjs');
const GENERATOR = join(root, 'scripts', 'generate-v2-surface-baseline.mjs');
const ID = 'openwop.requirement.0197.no-reshape';
const DOC = 'spec/v2/core/overview.md §0a (RFC 0197 §A.1)';

/** The "before" schema: a closed object with two properties, one required. */
const BEFORE = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://openwop.dev/spec/v2/fixture.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['surface'],
  properties: {
    surface: { type: 'string' },
    transport: { type: 'string', enum: ['http', 'sse'] },
    config: { type: 'object', properties: { note: { type: 'string' } } },
  },
};

/**
 * Build a synthetic repo root, take its baseline, then apply `mutate` to the
 * schema and run the gate against the unchanged baseline.
 */
function drive(mutate: (schema: Record<string, unknown>) => void): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'openwop-0197-mono-'));
  mkdirSync(join(dir, 'schemas', 'v2'), { recursive: true });
  mkdirSync(join(dir, 'spec', 'v2'), { recursive: true });
  const schemaPath = join(dir, 'schemas', 'v2', 'fixture.schema.json');
  writeFileSync(schemaPath, JSON.stringify(BEFORE, null, 2));
  const release = { version: '2.35.0', corpusTag: 'v2.35.0', updated: '2026-09-22' };
  writeFileSync(join(dir, 'spec', 'v2', 'release.json'), JSON.stringify(release, null, 2));
  writeFileSync(join(dir, 'spec', 'v2', 'path-manifest.json'), JSON.stringify({ operations: [{ method: 'GET', path: '/fixture', operationId: 'getFixture' }], channels: [] }, null, 2));
  const baseline = join(dir, 'surface-baseline.json');
  const emptyRegister = (schemaName: string, key: string): string => {
    const f = join(dir, `${key}.json`);
    writeFileSync(f, JSON.stringify({ $schema: `./${schemaName}`, version: 1, updated: '2026-09-22', [key === 'deprecations' ? 'entries' : 'rows']: [] }, null, 2));
    return f;
  };
  const corrections = emptyRegister('corrections.schema.json', 'corrections');
  const migrations = emptyRegister('migrations.schema.json', 'migrations');
  const deprecations = emptyRegister('deprecations.schema.json', 'deprecations');
  const env = {
    ...process.env,
    OPENWOP_V2_SCHEMAS_ROOT: dir,
    OPENWOP_V2_BASELINE_FILE: baseline,
    OPENWOP_V2_RELEASE_FILE: join(dir, 'spec', 'v2', 'release.json'),
    OPENWOP_V2_CORRECTIONS_FILE: corrections,
    OPENWOP_V2_MIGRATIONS_FILE: migrations,
    OPENWOP_DEPRECATIONS_FILE: deprecations,
  };
  const gen = spawnSync('node', [GENERATOR, '--write'], { cwd: root, encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024 });
  if (gen.status !== 0) return { status: gen.status, out: `baseline generation failed: ${String(gen.stdout ?? '')}${String(gen.stderr ?? '')}` };
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;
  mutate(schema);
  writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
  const r = spawnSync('node', [GATE], { cwd: root, encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024 });
  return { status: r.status, out: String(r.stdout ?? '') + String(r.stderr ?? '') };
}

describe('v2-surface-monotone-gate (RFC 0197 §A.1 / §B)', () => {
  it('the committed tree equals the committed baseline and the gate is green', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = spawnSync('node', [GATE], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const out = String(r.stdout ?? '') + String(r.stderr ?? '');
    expect(r.status, req(ID, DOC, `check-v2-surface-monotone MUST be green on the committed corpus — ${out.slice(-800)}`)).toBe(0);
    expect(out, req(ID, DOC, 'the gate must print the baseline size, the release it was cut at and the addition/removal counts, so a green run says what it compared')).toMatch(/baseline \d+ surfaces at release \d+\.\d+\.\d+; tree \d+/);
  }, 180_000);

  it('the baseline is refused when it was cut at a different release than spec/v2/release.json (G3)', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const dir = mkdtempSync(join(tmpdir(), 'openwop-0197-g3-'));
    const baseline = JSON.parse(readFileSync(join(root, 'spec', 'v2', 'surface-baseline.json'), 'utf8')) as { release: string };
    baseline.release = '2.1';
    const p = join(dir, 'stale-baseline.json');
    writeFileSync(p, JSON.stringify(baseline, null, 2));
    const r = spawnSync('node', [GATE], { cwd: root, encoding: 'utf8', env: { ...process.env, OPENWOP_V2_BASELINE_FILE: p }, maxBuffer: 32 * 1024 * 1024 });
    const out = String(r.stdout ?? '') + String(r.stderr ?? '');
    expect(r.status, req(ID, DOC, `a baseline from another release measures the wrong before; the gate MUST refuse it rather than compare — it exited ${r.status}`)).not.toBe(0);
    expect(out, req(ID, DOC, 'the refusal must tell the release PR to regenerate the baseline with the bump')).toMatch(/regenerate spec\/v2\/surface-baseline\.json with the release bump/);
  }, 180_000);

  it('POSITIVE CONTROL — an RFC 0209-shaped branch re-cut reports ZERO removals', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = drive((s) => {
      // Root `properties` becomes an `anyOf` whose FIRST branch is the prior
      // object verbatim, reached through `$ref`; a second branch is added
      // beside it; and the `$defs` name is chosen freely, because a `$defs`
      // name is not a surface. This is RFC 0209's `ui.a2ui-surface` re-cut.
      const prior = { type: s['type'], additionalProperties: s['additionalProperties'], required: s['required'], properties: s['properties'] };
      delete s['type']; delete s['additionalProperties']; delete s['required']; delete s['properties'];
      s['anyOf'] = [{ $ref: '#/$defs/payloadV1' }, { $ref: '#/$defs/payloadV2' }];
      s['$defs'] = {
        payloadV1: prior,
        payloadV2: { type: 'object', additionalProperties: false, required: ['messages'], properties: { messages: { type: 'array', items: { type: 'object', properties: { componentUpdate: { type: 'object' } } } } } },
      };
    });
    expect(r.status, req(ID, DOC, `§A.1 says a branch re-cut that keeps every prior document valid is a NEW surface beside the old one, not a reshape. The gate MUST pass it — it exited ${r.status}: ${r.out.slice(-1200)}`)).toBe(0);
    expect(r.out, req(ID, DOC, 'the re-cut must report zero removal tuples, not merely fail to fail')).toMatch(/0 removal tuple\(s\)/);
  }, 180_000);

  it('POSITIVE CONTROL — an OPTIONAL property added to a CLOSED object is additive (§B.5)', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = drive((s) => { (s['properties'] as Record<string, unknown>)['addedOptional'] = { type: 'string' }; });
    expect(r.status, req(ID, DOC, `RFC 0197 §B.5 classifies this as additive; a gate that failed it would forbid every v2 minor — it exited ${r.status}: ${r.out.slice(-800)}`)).toBe(0);
    expect(r.out, req(ID, DOC, 'the addition must be counted and reported, not silently ignored')).toMatch(/1 addition\(s\) \(additive/);
  }, 180_000);

  it('an enum member removed without a retirement or corrections row is REFUSED', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = drive((s) => { ((s['properties'] as Record<string, Record<string, unknown>>)['transport'])['enum'] = ['http']; });
    expect(r.status, req(ID, DOC, `deleting "sse" from an advertised enum is a removal; without a licence the gate MUST refuse — it exited ${r.status}: ${r.out.slice(-800)}`)).not.toBe(0);
    expect(r.out, req(ID, DOC, 'the refusal must name the member and say what would license it')).toMatch(/enum-member removed without a due retirement row or a corrections\.json row.*"sse"/s);
  }, 180_000);

  it('a `required` entry added to a pre-existing object is REFUSED (§B.6)', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = drive((s) => { (s['required'] as string[]).push('transport'); });
    expect(r.status, req(ID, DOC, `a document that validated without the property no longer does; §B.6 calls that a major — it exited ${r.status}: ${r.out.slice(-800)}`)).not.toBe(0);
    expect(r.out, req(ID, DOC, 'the refusal must name the property and the object')).toMatch(/`required` entry "transport" added to the pre-existing object/);
  }, 180_000);

  it('an OPEN object closed to `additionalProperties: false` is REFUSED (§B.6)', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = drive((s) => { ((s['properties'] as Record<string, Record<string, unknown>>)['config'])['additionalProperties'] = false; });
    expect(r.status, req(ID, DOC, `closing an open object narrows what validates; §B.6 calls that a major — it exited ${r.status}: ${r.out.slice(-800)}`)).not.toBe(0);
    expect(r.out, req(ID, DOC, 'the refusal must name the object that closed')).toMatch(/went from open to `additionalProperties: false`/);
  }, 180_000);

  it('a narrowed `type` is REFUSED (§A.1 — add the new shape beside the old one)', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = drive((s) => { ((s['properties'] as Record<string, Record<string, unknown>>)['surface'])['type'] = 'number'; });
    expect(r.status, req(ID, DOC, `retyping a field in place is the reshape §A.1 forbids whatever the evidence — it exited ${r.status}: ${r.out.slice(-800)}`)).not.toBe(0);
    expect(r.out, req(ID, DOC, 'the refusal must name the type that is no longer permitted and the remedy')).toMatch(/type "string" no longer permitted at .* add the new shape beside the old one/s);
  }, 180_000);

  it('a removed OPERATION is REFUSED (a path-manifest row is a surface too)', () => {
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    // The mutation here is to the path manifest rather than the schema, so the
    // drive() helper's schema mutation is a no-op and the manifest is rewritten
    // through the same tmp root.
    const dir = mkdtempSync(join(tmpdir(), 'openwop-0197-op-'));
    mkdirSync(join(dir, 'schemas', 'v2'), { recursive: true });
    mkdirSync(join(dir, 'spec', 'v2'), { recursive: true });
    writeFileSync(join(dir, 'schemas', 'v2', 'fixture.schema.json'), JSON.stringify(BEFORE, null, 2));
    writeFileSync(join(dir, 'spec', 'v2', 'release.json'), JSON.stringify({ version: '2.35.0' }, null, 2));
    const manifest = join(dir, 'spec', 'v2', 'path-manifest.json');
    writeFileSync(manifest, JSON.stringify({ operations: [{ method: 'GET', path: '/fixture', operationId: 'getFixture' }, { method: 'POST', path: '/fixture', operationId: 'createFixture' }] }, null, 2));
    const baseline = join(dir, 'surface-baseline.json');
    for (const [name, key] of [['corrections', 'rows'], ['migrations', 'rows'], ['deprecations', 'entries']] as const) {
      writeFileSync(join(dir, `${name}.json`), JSON.stringify({ version: 1, updated: '2026-09-22', [key]: [] }, null, 2));
    }
    const env = {
      ...process.env,
      OPENWOP_V2_SCHEMAS_ROOT: dir,
      OPENWOP_V2_BASELINE_FILE: baseline,
      OPENWOP_V2_RELEASE_FILE: join(dir, 'spec', 'v2', 'release.json'),
      OPENWOP_V2_CORRECTIONS_FILE: join(dir, 'corrections.json'),
      OPENWOP_V2_MIGRATIONS_FILE: join(dir, 'migrations.json'),
      OPENWOP_DEPRECATIONS_FILE: join(dir, 'deprecations.json'),
    };
    expect(spawnSync('node', [GENERATOR, '--write'], { cwd: root, encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024 }).status, req(ID, DOC, 'the baseline generator must succeed before the gate can be driven')).toBe(0);
    writeFileSync(manifest, JSON.stringify({ operations: [{ method: 'GET', path: '/fixture', operationId: 'getFixture' }] }, null, 2));
    const r = spawnSync('node', [GATE], { cwd: root, encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024 });
    const out = String(r.stdout ?? '') + String(r.stderr ?? '');
    expect(r.status, req(ID, DOC, `an operation is a surface; deleting one without a licence MUST be refused — it exited ${r.status}: ${out.slice(-800)}`)).not.toBe(0);
    expect(out, req(ID, DOC, 'the refusal must name the operation')).toMatch(/operation removed without a due retirement row.*POST \/fixture/s);
  }, 180_000);
});
