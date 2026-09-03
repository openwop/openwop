/**
 * Portable HITL approver routing (RFC 0104; `spec/v1/interrupt.md` §`kind: "approval"`).
 *
 * Adds three OPTIONAL, ADVISORY fields to the approval `InterruptPayload` so
 * group/role approver routing is portable + capability-gated across hosts:
 * `approverGroupRefs`, `approverRoleRefs`, and an `audience` notification hint.
 * `approversList` advisory semantics are unchanged; enforcement stays host-side;
 * refs are opaque to the engine and decision-time-snapshotted for replay.
 *
 * Two layers:
 *
 *   A. Always-on, server-free legs — the `interrupt.approverRouting` capability
 *      block shape, the additive optionality of the three fields on the
 *      `ApprovalData` schema, and the §"Portable approver routing" reference
 *      rule that `audience` DEFAULTS to the resolved eligibility union when
 *      omitted and OVERRIDES it when present (`notifyTargets`).
 *
 *   B. Capability-gated advertisement-coherence leg — on a host advertising
 *      `capabilities.interrupt.approverRouting.supported`, the advertised shape
 *      MUST be honest: `refKinds` ⊆ {group, role}; `audience` boolean. Hosts
 *      that do not advertise the capability soft-skip via the gate (the fields
 *      are ignored and the host stays conformant).
 *
 * @see spec/v1/interrupt.md §"Portable approver routing (RFC 0104)"
 * @see spec/v1/capabilities.md — interrupt.approverRouting.*
 * @see schemas/suspend-request.schema.json — ApprovalData
 * @see RFCS/0104-hitl-approver-routing.md
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { readCapabilityFamily } from '../lib/discovery-capabilities.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { softSkip } from '../lib/soft-skip.js';
import { req } from '../lib/requirement-ids.js';
function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

interface ApproverRoutingCap {
  supported?: boolean;
  refKinds?: string[];
  audience?: boolean;
}
interface InterruptCap {
  approverRouting?: ApproverRoutingCap;
}

// ── §"Portable approver routing" reference rule — audience default/override ──
type ApprovalPayload = {
  approversList?: string[];
  approverGroupRefs?: string[];
  approverRoleRefs?: string[];
  audience?: { subjects?: string[]; groups?: string[]; roles?: string[] };
};
/**
 * The advisory routing union a notifying host SHOULD target. Mirrors the
 * normative rule: omitted `audience` ⇒ the eligibility union
 * (`approversList` ∪ `approverGroupRefs` ∪ `approverRoleRefs`); present
 * `audience` ⇒ its own union, overriding the default. Refs stay opaque —
 * this composes refs, it does NOT resolve membership.
 */
function notifyTargets(p: ApprovalPayload): string[] {
  const uniq = (xs: string[]): string[] => [...new Set(xs)];
  if (p.audience) {
    return uniq([...(p.audience.subjects ?? []), ...(p.audience.groups ?? []), ...(p.audience.roles ?? [])]);
  }
  return uniq([...(p.approversList ?? []), ...(p.approverGroupRefs ?? []), ...(p.approverRoleRefs ?? [])]);
}

// ════════════════════════════════════════════════════════════════════════════
// A. Server-free legs
// ════════════════════════════════════════════════════════════════════════════

describe('interrupt-approver-routing: capability advertisement shape (capabilities.md, server-free)', () => {
  const caps = loadSchema('capabilities.schema.json');
  const interrupt = (caps.properties as Record<string, { properties?: Record<string, { required?: string[]; properties?: Record<string, unknown> }> }>).interrupt;

  it('capabilities schema declares interrupt.approverRouting', () => {
    expect(interrupt, req('openwop.it.interrupt-approver-routing.capabilities-schema-declares-interrupt-approverrouting', 'capabilities.schema.json §interrupt', 'the interrupt block MUST be declared')).toBeDefined();
    const ar = interrupt?.properties?.approverRouting;
    expect(ar, req('openwop.it.interrupt-approver-routing.capabilities-schema-declares-interrupt-approverrouting', 'RFC 0104', 'interrupt.approverRouting MUST be declared')).toBeDefined();
    expect(ar?.required, req('openwop.it.interrupt-approver-routing.capabilities-schema-declares-interrupt-approverrouting', 'RFC 0104', 'approverRouting.supported MUST be required')).toEqual(expect.arrayContaining(['supported']));
    for (const f of ['supported', 'refKinds', 'audience']) {
      expect(ar?.properties?.[f], req('openwop.it.interrupt-approver-routing.capabilities-schema-declares-interrupt-approverrouting', 'RFC 0104', `approverRouting.${f} MUST be declared`)).toBeDefined();
    }
  });
});

describe('interrupt-approver-routing: ApprovalData additive optionality (interrupt.md §approval, server-free)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const suspend = loadSchema('suspend-request.schema.json');
  const validate = ajv.compile(suspend);

  const baseApproval = {
    kind: 'approval',
    key: 'run:node:0',
    data: { artifactId: 'a1', artifactType: 'prd', title: 'Approve budget', actions: ['accept', 'reject'] },
  };

  it('an approval payload WITHOUT the routing fields still validates (additive, optional)', () => {
    expect(validate(baseApproval), req('openwop.it.interrupt-approver-routing.an-approval-payload-without-the-routing-fields-still-validates-additive-optional', 'RFC 0104 Compatibility', `the fields are optional — Errors: ${JSON.stringify(validate.errors)}`)).toBe(true);
  });
  it('an approval payload WITH group/role refs + audience validates', () => {
    const withRouting = {
      ...baseApproval,
      data: {
        ...baseApproval.data,
        approverGroupRefs: ['grp:finance-approvers'],
        approverRoleRefs: ['role:controller'],
        audience: { groups: ['grp:finance-approvers'], roles: ['role:controller'], subjects: ['user:cfo'] },
      },
    };
    expect(validate(withRouting), req('openwop.it.interrupt-approver-routing.an-approval-payload-with-group-role-refs-audience-validates', 'RFC 0104 §Proposal', `routing fields MUST validate — Errors: ${JSON.stringify(validate.errors)}`)).toBe(true);
  });
  it('an audience with an unknown key is rejected (audience object is closed)', () => {
    const badAudience = { ...baseApproval, data: { ...baseApproval.data, audience: { teams: ['grp:x'] } } };
    expect(validate(badAudience), req('openwop.it.interrupt-approver-routing.an-audience-with-an-unknown-key-is-rejected-audience-object-is-closed', 'RFC 0104', 'audience MUST be additionalProperties:false')).toBe(false);
  });
});

describe('interrupt-approver-routing: audience default/override rule (interrupt.md §"Portable approver routing", server-free)', () => {
  it('omitted audience ⇒ notify the resolved eligibility union', () => {
    expect(
      notifyTargets({ approversList: ['user:a'], approverGroupRefs: ['grp:fin'], approverRoleRefs: ['role:ctrl'] }),
      req('openwop.it.interrupt-approver-routing.omitted-audience-notify-the-resolved-eligibility-union', 'RFC 0104', 'omitted audience MUST default to the eligibility union'),
    ).toEqual(['user:a', 'grp:fin', 'role:ctrl']);
  });
  it('present audience ⇒ overrides the eligibility union', () => {
    expect(
      notifyTargets({ approverGroupRefs: ['grp:fin'], audience: { subjects: ['user:cfo'], groups: ['grp:audit'] } }),
      req('openwop.it.interrupt-approver-routing.present-audience-overrides-the-eligibility-union', 'RFC 0104', 'present audience MUST override the default'),
    ).toEqual(['user:cfo', 'grp:audit']);
  });
  it('no eligibility refs and no audience ⇒ empty target set', () => {
    expect(notifyTargets({}), req('openwop.it.interrupt-approver-routing.no-eligibility-refs-and-no-audience-empty-target-set', 'RFC 0104', 'nothing to route when no refs')).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B. Capability-gated advertisement-coherence leg
// ════════════════════════════════════════════════════════════════════════════

describe('interrupt-approver-routing: advertised shape is honest (capability-gated)', () => {
  it('an advertising host advertises a coherent approverRouting block', async () => {
    if (!process.env.OPENWOP_BASE_URL) return softSkip('blocked', 'precondition not met — `!process.env.OPENWOP_BASE_URL` returned early (no live host → nothing to read) (seam, prior step, or fixture unavailable)'); // no live host → nothing to read
    const interrupt = await readCapabilityFamily<InterruptCap>('interrupt');
    const ar = interrupt?.approverRouting;
    // Soft-skip: host does not advertise the capability (fields ignored; still conformant).
    if (!behaviorGate('interrupt.approverRouting', ar?.supported === true)) return;

    // Opt-in established (supported === true): the advertised shape MUST be honest.
    const allowed = new Set(['group', 'role']);
    for (const k of ar?.refKinds ?? []) {
      expect(allowed.has(k), req('openwop.it.interrupt-approver-routing.an-advertising-host-advertises-a-coherent-approverrouting-block', 'RFC 0104 capabilities.md', `refKinds MUST be a subset of {group, role} — saw ${k}`)).toBe(true);
    }
    if (ar?.audience !== undefined) {
      expect(typeof ar.audience, req('openwop.it.interrupt-approver-routing.an-advertising-host-advertises-a-coherent-approverrouting-block', 'RFC 0104 capabilities.md', 'approverRouting.audience MUST be boolean')).toBe('boolean');
    }
  });
});
