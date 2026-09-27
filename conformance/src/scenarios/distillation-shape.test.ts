/**
 * distillation-shape — RFC 0062 §A. The `capabilities.memory.distillation`
 * advertisement block is either absent or a well-formed object (with a positive
 * `maxTokenBudget` when present).
 *
 * Status: ACTIVE (advertisement-shape; always runs). Behavioral coverage lives
 * in the sibling distillation-*.test.ts scenarios, gated on `supported` + the
 * host memory-distillation seam.
 *
 * @see RFCS/0062-scheduled-memory-distillation.md §A
 * @see spec/v1/agent-memory.md §"Scheduled distillation"
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { softSkip } from '../lib/soft-skip.js';
import { readDistillationCap } from '../lib/distillation.js';
import { req } from '../lib/requirement-ids.js';

/**
 * The `memory.distillation` subtree of `capabilities.schema.json` (major 1 —
 * this file is `[1]` in scenario-majors.json). Self-contained (no `$ref`), so
 * it compiles alone.
 */
function distillationBlockValidator(): (doc: unknown) => { ok: boolean; errors: string } {
  const caps = JSON.parse(readFileSync(join(SCHEMAS_DIR, 'capabilities.schema.json'), 'utf8')) as {
    properties?: { memory?: { properties?: { distillation?: Record<string, unknown> } } };
  };
  const sub = caps.properties?.memory?.properties?.distillation;
  if (sub === undefined) throw new Error('capabilities.schema.json has no properties.memory.properties.distillation subtree');
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(sub);
  return (doc: unknown) => ({ ok: validate(doc) as boolean, errors: ajv.errorsText(validate.errors, { separator: '; ' }) });
}

describe('distillation-shape: advertisement (RFC 0062 §A)', () => {
  it('capabilities.memory.distillation is absent or a well-formed object', async () => {
    const cap = await readDistillationCap();
    if (cap === null) return softSkip('inapplicable', 'not advertised — valid');
    expect(
      typeof cap.supported,
      req('openwop.it.distillation-shape.capabilities-memory-distillation-is-absent-or-a-well-formed-object', 'capabilities.schema.json §memory.distillation', 'distillation.supported MUST be a boolean when the block is present'),
    ).toBe('boolean');
    if (cap.maxTokenBudget !== undefined) {
      expect(
        typeof cap.maxTokenBudget === 'number' && (cap.maxTokenBudget as number) >= 1,
        req('openwop.it.distillation-shape.capabilities-memory-distillation-is-absent-or-a-well-formed-object', 'capabilities.schema.json §memory.distillation', 'maxTokenBudget MUST be a positive integer when present'),
      ).toBe(true);
    }
    // unfailable-leg audit wave 2, 2026-09-27: the hand checks above accept a
    // fractional `maxTokenBudget` (1.5), a non-string `tokenizerName`, and any
    // unknown key — the schema says `integer`, `string`, and
    // `additionalProperties: false`. The whole block now validates against the
    // capabilities.schema.json `memory.distillation` subtree.
    const v = distillationBlockValidator()(cap);
    expect(
      v.ok,
      req('openwop.it.distillation-shape.capabilities-memory-distillation-is-absent-or-a-well-formed-object', 'capabilities.schema.json §memory.distillation', `the distillation block MUST validate against the schema subtree (${v.errors})`),
    ).toBe(true);
    for (const k of ['scheduled', 'indexEmitted'] as const) {
      if (cap[k] !== undefined) {
        expect(
          typeof cap[k],
          req('openwop.it.distillation-shape.capabilities-memory-distillation-is-absent-or-a-well-formed-object', 'capabilities.schema.json §memory.distillation', `distillation.${k} MUST be a boolean when present`),
        ).toBe('boolean');
      }
    }
  });
});
