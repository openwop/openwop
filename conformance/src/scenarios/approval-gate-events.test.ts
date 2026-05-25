/**
 * approval-gate-events — RFC 0051 §B event-shape verification.
 *
 * Status: DRAFT. RFC 0051 (approval & deployment-gate primitive) is `Draft`.
 * The `approval.granted` / `approval.rejected` / `approval.overridden` event
 * payloads have landed in `schemas/run-event-payloads.schema.json` (+ the
 * `RunEventType` enum).
 *
 * Server-free schema validation of the three governance events:
 *   - granted: requires `{ gateId, principal }`; optional `quorumProgress`.
 *   - rejected: requires `{ gateId, principal }`; optional `reason`.
 *   - overridden: requires `{ gateId, principal, reason }` (reason mandatory —
 *     the audit breadcrumb).
 *   - each rejects unknown properties (additionalProperties:false).
 *
 * @see RFCS/0051-approval-deployment-gate-primitive.md
 * @see spec/v1/interrupt-profiles.md §`core.openwop.governance.approvalGate`
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { SCHEMAS_DIR } from '../lib/paths.js';

interface PayloadsSchema {
  $schema: string;
  $defs: Record<string, Record<string, unknown>>;
}

const payloads = JSON.parse(
  readFileSync(join(SCHEMAS_DIR, 'run-event-payloads.schema.json'), 'utf8'),
) as PayloadsSchema;

function compile(defName: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile({ $schema: payloads.$schema, ...payloads.$defs[defName] });
}

describe('category: approval-gate governance events (RFC 0051 §B)', () => {
  it('approval.granted requires gateId + principal; quorumProgress optional', () => {
    const v = compile('approvalGranted');
    expect(v({ gateId: 'g1', principal: 'user_1' }), JSON.stringify(v.errors)).toBe(true);
    expect(v({ gateId: 'g1', principal: 'user_1', quorumProgress: { granted: 1, required: 2 } })).toBe(true);
    expect(v({ gateId: 'g1' })).toBe(false); // missing principal
    expect(v({ gateId: 'g1', principal: 'user_1', role: 'admin' })).toBe(false); // unknown prop
  });

  it('approval.rejected requires gateId + principal; reason optional', () => {
    const v = compile('approvalRejected');
    expect(v({ gateId: 'g1', principal: 'user_1' }), JSON.stringify(v.errors)).toBe(true);
    expect(v({ gateId: 'g1', principal: 'user_1', reason: 'incomplete' })).toBe(true);
    expect(v({ principal: 'user_1' })).toBe(false); // missing gateId
  });

  it('approval.overridden requires gateId + principal + reason (audit breadcrumb)', () => {
    const v = compile('approvalOverridden');
    expect(v({ gateId: 'g1', principal: 'owner_1', reason: 'emergency publish' }), JSON.stringify(v.errors)).toBe(true);
    expect(v({ gateId: 'g1', principal: 'owner_1' })).toBe(false); // reason MUST be present
  });
});
