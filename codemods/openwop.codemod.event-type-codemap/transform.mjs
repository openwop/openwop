/**
 * openwop.codemod.event-type-codemap — RFC 0171 §A.2 / rows C4.3 + C4.4: rename
 * run-event `type` values (and the payload-definition keys that mirror them)
 * from the v1 vocabulary to the v2 vocabulary using spec/v1/event-codemap.json
 * as the ONLY source of the mapping (RFC 0167 Axiom 4: the map is data; every
 * host backfills from the same file). Accepts a run event, an event array, a
 * snapshot-with-events, or a debug bundle fragment: any object whose `type`
 * is a v1 protocol event type is renamed; a v2 name passes through; a `core.*`
 * or other reserved-prefix name that is NOT in the map is refused — a codemod
 * never guesses a rename. Vendor types (not in the map, not reserved) pass.
 * The map is loaded once at import from the corpus file; the transform itself
 * is pure. Idempotent.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const id = 'openwop.codemod.event-type-codemap';
export const inputSchema = 'schemas/run-event.schema.json';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const map = JSON.parse(readFileSync(join(ROOT, 'spec', 'v1', 'event-codemap.json'), 'utf8'));
const V1_TO_V2 = new Map(map.rows.map((r) => [r.v1, r.v2]));
const V2 = new Set(map.rows.map((r) => r.v2));
const RESERVED = /^(openwop|core|community|vendor|private|local)\./;
function rename(type, path) {
  if (V1_TO_V2.has(type)) return V1_TO_V2.get(type);
  if (V2.has(type)) return type;
  if (RESERVED.test(type)) throw new Error(`${id}: ${path}.type ${JSON.stringify(type)} is a reserved-prefix name with no codemap row; refusing to guess`);
  return type; // vendor event — out of the map's scope
}
function walk(v, path) {
  if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = k === 'type' && typeof val === 'string' && val.includes('.') ? rename(val, path) : walk(val, `${path}.${k}`);
    return out;
  }
  return v;
}
export function transform(doc) {
  if (doc === null || typeof doc !== 'object') throw new TypeError(`${id}: input must be an event, an array of events, or an object containing them`);
  return walk(doc, '$');
}
