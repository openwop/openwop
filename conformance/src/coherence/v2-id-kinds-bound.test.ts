/**
 * `spec/v2/core/identity.md` §5 — "Every id field in every v2 schema and every
 * `api/v2/openapi.yaml` parameter and response body MUST `$ref` its kind."
 *
 * The sentence was published and never checked. What that cost, measured:
 *
 *   - `components/parameters/RunId` was `{type: string, maxLength: 128}` while a
 *     conforming v2 `runId` reaches 128 + 1 + 128 = 257 characters. The v2 spec's
 *     own path parameter could not express a v2 runId. It read that way because
 *     `api/v2/openapi.yaml` is DERIVED from `api/openapi.yaml`, so v1's bare-id
 *     typing was inherited into a major whose grammar had changed.
 *   - `run-event-payloads.schema.json` typed `childRunId` as
 *     `{type: string, minLength: 1}` in the SAME FILE where `parentRunId` was
 *     correctly `$ref`'d. A child run's identifier therefore carried no tenant
 *     segment for §5's mandatory `403 id_tenant_mismatch` refusal to read.
 *   - `nodeStarted.typeId` had NO PATTERN AT ALL: the event announcing which node
 *     started accepted any non-empty string as a node type.
 *
 * WHY THE CHECK IS MAP-DRIVEN. The obvious predicate — fire when a property name
 * equals a `$defs` name — finds 7 of these. The real count is 34. Only 20 of the
 * 88 `*Id` properties under `schemas/v2/` share a name with a kind, so a
 * name-matching check enforces §5 exactly where naming happens to align and
 * reports green everywhere else. It would have passed over `childRunId`, which is
 * the defect the rule exists to prevent. `spec/v2/id-field-bindings.json` places
 * every `*Id` property in one of two sets — IS a kind, or is governed by nothing
 * in `ids.schema.json` (with the reason) — and a property in neither FAILS, so a
 * new id field cannot be added without someone deciding which it is.
 *
 * One grammar conflict had to be settled before any of this could bind. The
 * `typeId` kind forbade `_`; `node-pack-manifest.schema.json`'s `name` pattern
 * admits it, and a pack's node type ids are derived from its name. A pack legally
 * named `vendor.acme.my_tools` could not declare `vendor.acme.my_tools.echo`. The
 * kind was the newer artifact and the narrower one, so the kind moved. A scan of
 * 539 distinct `typeId` values found zero affected either way — the conflict was
 * in the GRAMMARS, not in the population, which is why counting values did not
 * reveal it.
 *
 * @see spec/v2/core/identity.md §5
 * @see spec/v2/id-field-bindings.json
 * @see scripts/check-id-kinds-bound.mjs
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';

const ID = 'openwop.requirement.0170.id-kinds-bound';
const root = join(SCHEMAS_DIR, '..');

const tail = (r: { stdout?: string; stderr?: string }) =>
  `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-14).join(' | ');

describe('v2-id-kinds-bound (identity.md §5)', () => {
  it('every v2 id field $refs its kind, and every *Id property is triaged', () => {
    // Reads the spec tree and drives no host: a corpus-coherence row, which the
    // registry recognises by this gate (spec-coherence-registry.test.ts).
    if (V1_DIR === null) return softSkip('inapplicable', 'not a spec checkout');
    const r = spawnSync('node', [join(root, 'scripts', 'check-id-kinds-bound.mjs')], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    expect(
      r.status,
      req(
        ID,
        'spec/v2/core/identity.md §5',
        `every id field in every v2 schema and every api/v2/openapi.yaml parameter MUST $ref its kind, and every *Id property MUST be triaged in spec/v2/id-field-bindings.json as either a kind or explicitly not one — an untriaged field fails, because the alternative is a check whose green means only "no name happened to collide" (check-id-kinds-bound.mjs exit 0) — ${tail(r)}`,
      ),
    ).toBe(0);
  });
});
