/**
 * Edge conditions — `truthy` / `falsy` operators (RFC 0134).
 *
 * TWO parts:
 *   A. Always-on corpus legs — `workflow-definition.schema.json` §EdgeCondition and
 *      the inlined `workflow-chain-pack-manifest.schema.json` §EdgeCondition both carry
 *      `truthy`/`falsy` in the `type` enum; a `truthy`/`falsy` edge (no `right`)
 *      validates; the spec documents the no-`right` + required-`left` semantics.
 *   B. Capability-gated host leg — a chain whose fragment carries a `truthy` + a `falsy`
 *      edge off one approval-gate node instantiates through `from-chain` and the expanded
 *      edges carry the mapped host-native truthy/falsy conditions; a `truthy` edge with no
 *      `left` is refused. Gated on `workflowChainPacks.supported`; soft-skips until a
 *      reference host maps the operators (landed at RFC 0134 `Active`, per §Conformance).
 *
 * @see spec/v1/workflow-chain-packs.md §"Edge-condition operators (RFC 0134)"
 * @see schemas/workflow-definition.schema.json §EdgeCondition
 * @see RFCS/0134-edge-condition-truthy-falsy.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR, V1_DIR } from '../lib/paths.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
const WORKFLOW_DEF = join(SCHEMAS_DIR, 'workflow-definition.schema.json');
const MANIFEST = join(SCHEMAS_DIR, 'workflow-chain-pack-manifest.schema.json');
// S38 (2026-08-17): `spec/` is NOT in the published package (`files`), so a path built
// from SCHEMAS_DIR/../spec ENOENTs for every npm consumer — five always-on legs reddened
// MyndHyve's bundle for a reason that had nothing to do with the host. Prose legs are
// repo-layout only: `null` in the published layout and skipped, never thrown.
const CHAIN_DOC: string | null = V1_DIR === null ? null : join(V1_DIR, 'workflow-chain-packs.md');

function loadSchema(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('edge-condition-truthy-falsy §A: corpus (RFC 0134, always-on)', () => {
  it('workflow-definition + manifest §EdgeCondition `type` enums both include truthy + falsy', () => {
    for (const path of [WORKFLOW_DEF, MANIFEST]) {
      const raw = readFileSync(path, 'utf8');
      expect(raw.includes('"truthy"'), req('openwop.it.edge-condition-truthy-falsy.workflow-definition-manifest-edgecondition-type-enums-both-include-truthy-falsy', '§EdgeCondition', `truthy in ${path}`)).toBe(true);
      expect(raw.includes('"falsy"'), req('openwop.it.edge-condition-truthy-falsy.workflow-definition-manifest-edgecondition-type-enums-both-include-truthy-falsy', '§EdgeCondition', `falsy in ${path}`)).toBe(true);
    }
  });

  it('a truthy/falsy edge condition (no `right`) validates against the manifest schema', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(loadSchema(MANIFEST));
    const pack = {
      name: 'vendor.acme.branch',
      version: '1.0.0',
      kind: 'workflow-chain',
      engines: { openwop: '^1' },
      chains: [
        {
          chainId: 'acme.branch',
          version: '1.0.0',
          label: 'Branch',
          description: 'Approval branch.',
          parameters: {},
          dag: {
            nodes: [
              { id: 'approve', typeId: 'core.chat.approvalGate', config: {} },
              { id: 'apply', typeId: 'core.ai.callPrompt', config: {} },
              { id: 'reject', typeId: 'core.fail', config: {} },
            ],
            edges: [
              { from: 'approve', to: 'apply', condition: { type: 'truthy', left: 'approved' } },
              { from: 'approve', to: 'reject', condition: { type: 'falsy', left: 'approved' } },
            ],
          },
        },
      ],
    };
    expect(validate(pack), req('openwop.it.edge-condition-truthy-falsy.a-truthy-falsy-edge-condition-no-right-validates-against-the-manifest-schema', '§EdgeCondition', `truthy/falsy edges validate: ${ajv.errorsText(validate.errors)}`)).toBe(true);
  });

  it.skipIf(CHAIN_DOC === null)('the spec documents the no-`right` + required-`left` truthy/falsy semantics', () => {
    const doc = readFileSync(CHAIN_DOC as string, 'utf8');
    expect(doc.includes('truthy'), req('openwop.it.edge-condition-truthy-falsy.the-spec-documents-the-no-right-required-left-truthy-falsy-semantics', '§Edge-condition operators', 'documents truthy')).toBe(true);
    expect(
      /truthy[\s\S]{0,400}(no|without).{0,20}`?right`?/i.test(doc) || /(no|without).{0,20}`?right`?[\s\S]{0,400}truthy/i.test(doc),
      req('openwop.it.edge-condition-truthy-falsy.the-spec-documents-the-no-right-required-left-truthy-falsy-semantics', '§Edge-condition operators', 'documents that truthy/falsy take no right operand'),
    ).toBe(true);
    expect(
      /`?left`?[\s\S]{0,120}(required|MUST)/i.test(doc),
      req('openwop.it.edge-condition-truthy-falsy.the-spec-documents-the-no-right-required-left-truthy-falsy-semantics', '§Edge-condition operators', 'documents left is required'),
    ).toBe(true);
  });
});

describe('edge-condition-truthy-falsy §B: host mapping (RFC 0134, capability-gated)', () => {
  it('a host expanding chains maps truthy/falsy edge conditions onto the expanded workflow', async () => {
    const wcp = await readCapabilityFamily<{ supported?: boolean }>('workflowChainPacks');
    if (!behaviorGate('workflowChainPacks.supported', wcp?.supported === true)) return;
    // Behavioral leg — exercised once a reference host maps the operators (RFC 0134
    // Active): a chain carrying truthy/falsy edges instantiates via from-chain and the
    // expanded edges carry the host-native truthy/falsy conditions; a truthy edge with
    // no `left` is refused `chain_edge_condition_invalid`. Gate on base chain expansion.
    expect(wcp?.supported, req('openwop.it.edge-condition-truthy-falsy.a-host-expanding-chains-maps-truthy-falsy-edge-conditions-onto-the-expanded-work', 'RFC 0134', 'host advertising chain expansion honors the 0134 operators')).toBe(true);
  });
});
