/**
 * v2-form-when-reuses-edge-conditions — RFC 0177 §E.4;
 * `spec/v2/core/form-content-packs.md` §"Conditional visibility".
 *
 * Suite 2.0.0, target major 2. A form field MAY carry `when: <EdgeCondition>`;
 * the grammar is the `WorkflowEdge.condition` object `{ type, left, right }` of
 * `schemas/v2/workflow-definition.schema.json` with the operator set
 * `expression | equals | notEquals | contains | regex | truthy | falsy`, and no
 * second expression language is accepted.
 *
 * Witnessed against `schemas/v2/form-content-pack-manifest.schema.json` (no
 * reference host: `host-pending`), gated on the `forms` family: a form-content
 * pack whose field carries `when: { type: "equals", left, right }` validates,
 * and a field whose `when` names an operator outside the set is rejected. If
 * the schema does not carry `when` yet (RFC 0177 §E.4 schema follow-up) the
 * leg records `blocked` naming the gap rather than a pass.
 *
 * @see RFCS/0177-v2-registry-packs-and-extension-tail.md §E.4
 * @see spec/v2/core/form-content-packs.md §"Conditional visibility"
 * @see spec/v2/core/workflow-chain-packs.md §"Edge conditions"
 */

import { describe, it, expect } from 'vitest';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';
import { targetMajor } from '../lib/seams.js';
import { v2Discovery, gateFamily, v2Validator } from '../lib/v2.js';

const SECTION = 'form-content-packs.md §"Conditional visibility" (RFC 0177 §E.4)';

function formPack(when: Record<string, unknown>): Record<string, unknown> {
  return {
    name: 'core.openwop.v2-form-when-fixture',
    version: '1.0.0',
    kind: 'form-content',
    engines: { openwop: '>=2.0.0 <3.0.0' },
    templates: [{
      templateId: 'core.openwop.v2-form-when-fixture.shipping',
      version: '1.0.0',
      label: 'Shipping',
      title: 'Shipping details',
      fields: [
        { id: 'shipping', type: 'text', label: 'Shipping' },
        { id: 'region', type: 'text', label: 'Region', when },
      ],
    }],
  };
}

describe('v2-form-when-reuses-edge-conditions (RFC 0177 §E.4)', () => {
  it('a field `when` is the edge-condition grammar { type, left, right } and no other expression language', async () => {
    if (targetMajor() !== 2) return softSkip('inapplicable', 'suite 2.0.0 v2 scenario: OPENWOP_TARGET_MAJOR is not 2');
    let doc: Record<string, unknown> | null;
    try {
      doc = await v2Discovery();
    } catch {
      doc = null;
    }
    if (!doc) return softSkip('blocked', 'discovery unreachable — /.well-known/openwop (OpenWOP-Version: 2.0) did not answer 200 JSON');
    if (!(await gateFamily('forms'))) return softSkip('inapplicable', 'v2 discovery does not advertise the forms family (RFC 0169 §A.2)');
    const validate = v2Validator('form-content-pack-manifest');
    const edge = validate(formPack({ type: 'equals', left: 'fields.shipping', right: 'international' }));
    if (!edge.ok && /\bwhen\b/.test(edge.errors)) return softSkip('blocked', 'form-content-pack-manifest.schema.json lacks `when` — RFC 0177 §E.4 schema follow-up');
    expect(edge.ok, req('openwop.requirement.0177.form-when-reuses-edge-conditions', SECTION, `a field carrying when: { type: "equals", left, right } MUST validate (${edge.errors})`)).toBe(true);
    const foreign = validate(formPack({ op: 'eq', path: 'fields.shipping', value: 'international' }));
    expect(foreign.ok, req('openwop.requirement.0177.form-when-reuses-edge-conditions', SECTION, 'a `when` outside the edge-condition grammar (a second expression language) MUST be rejected')).toBe(false);
    const operator = validate(formPack({ type: 'jsonata', left: 'fields.shipping', right: 'international' }));
    expect(operator.ok, req('openwop.requirement.0177.form-when-reuses-edge-conditions', SECTION, 'an operator outside expression|equals|notEquals|contains|regex|truthy|falsy MUST be rejected')).toBe(false);
  });
});
