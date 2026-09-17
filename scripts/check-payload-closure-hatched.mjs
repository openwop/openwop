#!/usr/bin/env node
/**
 * check-payload-closure-hatched — a payload def that v1 left OPEN and v2 CLOSED
 * must carry the RFC 0185 §B hatch, and `$ref` must not hide it.
 *
 * ## Why this exists
 *
 * RFC 0185 hatched 53 defs by selecting on `type: "object"` +
 * `additionalProperties: false`. **A def that is a bare `$ref` has neither**, so
 * the selector could not see it — and two defs that genuinely went open → closed
 * were missed: `approvalRequested` and `clarificationRequested`, both
 * `additionalProperties: true` inline objects in v1, both collapsed in v2 onto
 * `interruptRequested` → `suspend-request.schema.json`, which is closed and was
 * closed in v1 too.
 *
 * That is the FOURTH appearance of one shape this week, and the first three were
 * other people's:
 *
 *   - a generator filtering on inline `properties` skipped every `$ref`-composed
 *     def (tier-2 host);
 *   - `approvalGranted` is nothing but a `$ref` to `interruptResolved`, so
 *     RFC 0183's enum close landed on two event types whose diff mentions
 *     neither — and a host's ratchet reported green (tier-1 host);
 *   - and this one, in the very RFC that was written about hosts losing data.
 *
 * **A def that is a `$ref` is invisible to anything that reads defs as literals.**
 * So this check resolves the chain — within-file `#/$defs/x` and cross-file
 * `foo.schema.json` — on BOTH sides before comparing, and asks the question about
 * effective schemas rather than about the text at the def's own key.
 *
 * Usage: node scripts/check-payload-closure-hatched.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HATCH = '^(openwop-|x-|vendor\\.)';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/**
 * Known open → closed defs with no reachable hatch, each with why it is not
 * simply hatched. SHRINK-ONLY: a waived def that turns out to BE hatched fails
 * as loudly as an unwaived one, so the list cannot become a parking lot.
 */
const PENDING = new Map([
  ['approvalRequested', 'v1 inline object with additionalProperties:true; v2 collapses onto suspend-request.schema.json, which is closed AND was closed in v1. Hatching that file would widen a schema that was never open, so the remedy depends on whether hosts record extras here — asked 2026-09-17, not guessed (RFC 0185 §E).'],
  ['clarificationRequested', 'same chain and same question as approvalRequested.'],
]);

/** Resolve a schema through `$ref` (within-file and cross-file) to its effective form. */
function effective(node, docPath, seen = new Set()) {
  if (!node || typeof node !== 'object') return null;
  const ref = node.$ref;
  if (typeof ref !== 'string') return node;
  if (seen.has(ref)) return node;
  seen.add(ref);

  if (ref.startsWith('#/$defs/')) {
    const doc = readJson(docPath);
    return effective(doc.$defs?.[ref.slice('#/$defs/'.length)], docPath, seen);
  }
  // `$ref` here is usually an ABSOLUTE $id URL, not a relative path. The first
  // draft of this resolver joined it as relative, produced
  // `schemas/v2/https:/openwop.dev/...`, found no file, and returned the
  // unresolved node — so the def was silently skipped and the gate reported
  // green over the exact two defs it was written to catch. A resolver that
  // cannot resolve must not pass quietly, which is why the miss below throws.
  const file = ref.split('#')[0]
    .replace(/^https?:\/\/openwop\.dev\/spec\/v2\//, `${ROOT}/schemas/v2/`)
    .replace(/^https?:\/\/openwop\.dev\/spec\/v1\//, `${ROOT}/schemas/`);
  const target = file.startsWith('/') ? file : join(dirname(docPath), file);
  if (!existsSync(target)) {
    throw new Error(`unresolvable $ref ${ref} (looked at ${target}) — a resolver that cannot resolve must not report green`);
  }
  const doc = readJson(target);
  const frag = ref.split('#')[1];
  if (!frag || frag === '/') return effective(doc, target, seen);
  const parts = frag.replace(/^\//, '').split('/');
  let cur = doc;
  for (const p of parts) cur = cur?.[p];
  return effective(cur, target, seen);
}

const V1 = join(ROOT, 'schemas', 'run-event-payloads.schema.json');
const V2 = join(ROOT, 'schemas', 'v2', 'run-event-payloads.schema.json');
const v1Defs = readJson(V1).$defs ?? {};
const v2Defs = readJson(V2).$defs ?? {};

const problems = [];
const pending = [];
let narrowed = 0;

for (const [name, raw2] of Object.entries(v2Defs)) {
  if (name.startsWith('_')) continue;
  let e1, e2;
  try {
    e2 = effective(raw2, V2);
    e1 = effective(v1Defs[name], V1);
  } catch (err) {
    // A stack trace is not a finding. Report it as one so the output says what
    // to fix rather than where the resolver stood when it gave up.
    problems.push(`${name}: ${(err instanceof Error ? err.message : String(err))}`);
    continue;
  }
  if (!e1 || !e2) continue;
  if (e1.additionalProperties !== true) continue;      // was not open in v1
  if (e2.additionalProperties !== false) continue;     // is not closed in v2
  narrowed++;

  // the hatch may sit on the def OR on whatever it resolves to
  const hatched = Boolean(raw2.patternProperties?.[HATCH] ?? e2.patternProperties?.[HATCH]);
  const waived = PENDING.get(name);
  if (hatched && waived) {
    problems.push(`${name} is waived as PENDING but IS hatched — drop the waiver`);
  } else if (hatched) {
    continue;
  } else if (waived) {
    pending.push(`${name} — ${waived}`);
  } else {
    problems.push(
      `${name} was additionalProperties:true in v1 and is closed in v2 with no reachable RFC 0185 §B hatch` +
        (raw2.$ref ? ` (it is a bare $ref to ${raw2.$ref} — a def that is a $ref is invisible to anything reading defs as literals)` : ''),
    );
  }
}

for (const p of pending) console.warn(`  PENDING (RFC 0185 §E, awaiting host input): ${p}`);
if (problems.length) {
  console.error(`=== check-payload-closure-hatched FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('===');
  process.exit(1);
}
console.log(`=== check-payload-closure-hatched OK — ${narrowed} def(s) went open → closed; all hatched or waived (${pending.length} pending), $ref chains resolved on both sides ===`);
