/**
 * Suite 2.0.0 — helpers for v2 scenarios (`v2-*.test.ts`, target major 2).
 *
 *   v2Discovery()          the v2 representation of /.well-known/openwop
 *                          (OpenWOP-Version: 2.0), memoized per worker.
 *   familyAdvertised(key)  RFC 0169 §A.2: presence of the family record IS the
 *                          claim; there is no `supported` field. Returns the
 *                          record or null.
 *   v2Validator(name)      an Ajv 2020 validator for schemas/v2/<name>, with the
 *                          whole v2 tree registered so cross-file $refs resolve
 *                          (SCHEMAS_DIR is the spec-artifacts peer in the
 *                          published layout — lib/paths.ts).
 *   gateFamily(key)        the RFC 0148 §B gate for a v2 family: records
 *                          `inapplicable` (family absent) or `skipped`
 *                          (opted out) through behaviorGate under the
 *                          requirement id `openwop.family.<key>`, and returns
 *                          the record when advertised.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { driver } from './driver.js';
import { SCHEMAS_DIR } from './paths.js';
import { behaviorGate } from './behavior-gate.js';

let cached: Record<string, unknown> | null | undefined;
export async function v2Discovery(): Promise<Record<string, unknown> | null> {
  if (cached !== undefined) return cached;
  const res = await driver.get('/.well-known/openwop', { authenticated: false, headers: { 'OpenWOP-Version': '2.0' } });
  cached = res.status === 200 && res.json && typeof res.json === 'object' ? (res.json as Record<string, unknown>) : null;
  return cached;
}
export function resetV2Discovery(): void { cached = undefined; }

export async function familyAdvertised(key: string): Promise<Record<string, unknown> | null> {
  const doc = await v2Discovery();
  const rec = doc?.[key];
  return rec && typeof rec === 'object' && !Array.isArray(rec) ? (rec as Record<string, unknown>) : null;
}

export async function gateFamily(key: string): Promise<Record<string, unknown> | null> {
  const rec = await familyAdvertised(key);
  return behaviorGate(`family.${key}`, rec !== null) ? rec : null;
}

let ajv: Ajv2020 | undefined;
function v2Ajv(): Ajv2020 {
  if (ajv) return ajv;
  ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const root = join(SCHEMAS_DIR, 'v2');
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.schema.json') ? [p] : []; });
  for (const p of walk(root)) { try { ajv.addSchema(JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>); } catch { /* a duplicate $id is registered once */ } }
  return ajv;
}
export function v2Validator(name: string): (doc: unknown) => { ok: boolean; errors: string } {
  const id = `https://openwop.dev/spec/v2/${name.endsWith('.schema.json') ? name : `${name}.schema.json`}`;
  const a = v2Ajv();
  const validate = a.getSchema(id) ?? a.compile(JSON.parse(readFileSync(join(SCHEMAS_DIR, 'v2', ...name.split('/')), 'utf8')) as Record<string, unknown>);
  return (doc: unknown) => ({ ok: validate(doc) as boolean, errors: a.errorsText(validate.errors, { separator: '; ' }) });
}
