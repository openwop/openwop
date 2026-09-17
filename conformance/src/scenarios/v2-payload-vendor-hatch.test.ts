/**
 * `spec/v2/core/events.md` §Era-2 + RFC 0185 §B — a run-event payload def that
 * v1 left open carries a vendor hatch, so a host has a CONFORMING place for a
 * fact the corpus does not model (suite 2.2.3, target major 2; server-free).
 *
 * v1's `run-event-payloads.schema.json` declares `additionalProperties: true`.
 * v2's declares `false` on the same defs — 53 of them — with no hatch and no
 * migration row. Every extra key a host legitimately recorded under v1, because
 * v1 explicitly invited them, became invalid at the cut with nowhere to go.
 *
 * Two production hosts lost data to that independently: one drops 32 distinct
 * keys at the major-2 read (the conversation content among them), the other
 * projects era-3 rows ON WRITE and lost a variable's value AT REST. Both had a
 * validator that got happier the more they deleted.
 *
 * The load-bearing leg is the THIRD one. A hatch that accepts a vendor key is
 * satisfied by spraying `patternProperties` across every def in the file; what
 * makes it a scoped decision is that a def closed DELIBERATELY in v2 still
 * refuses one. `refineFeedback` is that def — RFC 0183 modelled it closed on
 * purpose — and this leg fails if a later edit hatches it by reflex.
 *
 * @see RFCS/0185-run-event-payload-closure.md §B
 * @see spec/v2/core/events.md §Era-2 logs
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0185.payload-vendor-hatch';
const DOC = 'RFCS/0185-run-event-payload-closure.md §B';

/** Compile a validator for ONE `$def` of the payload schema. */
function defValidator(def: string): (doc: unknown) => boolean {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  // Register the whole v2 tree: the payload defs $ref `ids.schema.json` for
  // their id kinds, so compiling the file alone cannot resolve.
  const dir = join(SCHEMAS_DIR, 'v2');
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.schema.json') || statSync(join(dir, f)).isDirectory()) continue;
    try { ajv.addSchema(JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>); } catch { /* duplicate $id */ }
  }
  // No cast (code-review banned-pattern): the compiled validator is callable
  // and returns `boolean` for a synchronous schema; `=== true` narrows it.
  const fn = ajv.compile({ $ref: `https://openwop.dev/spec/v2/run-event-payloads.schema.json#/$defs/${def}` });
  return (doc: unknown): boolean => fn(doc) === true;
}

describe('v2 payload vendor hatch (RFC 0185 §B)', () => {
  it('a def v1 left open carries the hatch, still refuses a bare key, and a deliberately-closed def refuses both', () => {
    const variableChanged = defValidator('variableChanged');
    const base = { nodeId: 'n1', name: 'total', previous: 1, next: 2 };

    // 1. the hatch admits a vendor-prefixed key
    for (const key of ['vendor.myndhyve.value', 'x-legacy-value', 'openwop-internal']) {
      expect(
        variableChanged({ ...base, [key]: 'carried' }),
        req(ID, DOC, `\`variableChanged\` MUST admit the hatched property \`${key}\` — v1 was additionalProperties:true, so a host may hold keys v2 does not name and needs a conforming home for them`),
      ).toBe(true);
    }

    // 2. and the closure it was made for still holds
    expect(
      variableChanged({ ...base, value: 2 }),
      req(ID, DOC, '`variableChanged` MUST still REJECT a bare unmodelled key (`value`) — the hatch is an escape valve, not a reopening; `additionalProperties: false` stays'),
    ).toBe(false);

    // 3. THE LOAD-BEARING LEG: the hatch is scoped to the DEF, not inherited by
    //    the objects nested inside it. `interruptResolved` was open in v1 and is
    //    hatched; `refineFeedback` sits INSIDE it, was modelled closed on purpose
    //    by RFC 0183, and was never open in v1 — so it is outside §B.
    const interruptResolved = defValidator('interruptResolved');
    const resolved = { interruptId: 't/0123456789abcdef', nodeId: 'n1', kind: 'approval' };

    expect(
      interruptResolved({ ...resolved, 'vendor.example.extra': 1 }),
      req(ID, DOC, '`interruptResolved` was open in v1, so its own hatch MUST admit a vendor key'),
    ).toBe(true);

    expect(
      interruptResolved({ ...resolved, action: 'refine', refineFeedback: { scope: 'whole', 'vendor.example.extra': 1 } }),
      req(ID, DOC, 'a vendor key inside `refineFeedback` MUST be REFUSED — RFC 0183 modelled that object closed on purpose and it was never open in v1. The hatch belongs to the 53 defs that were narrowed, not to everything nested under them; this leg fails if a later edit sprays `patternProperties` down the tree'),
    ).toBe(false);
  });
});
