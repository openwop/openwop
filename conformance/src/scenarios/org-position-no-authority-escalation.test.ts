/**
 * Org position confers no authority — the §B invariant, behavioral leg
 * (RFC 0087 §B) — the protocol-tier `org-position-no-authority-escalation`.
 *
 * The STRUCTURAL leg (the `agent-org-chart.schema.json` is `additionalProperties:
 * false` and rejects an authority-bearing field on a member) is always-on /
 * server-free in `agent-org-chart-shape.test.ts`. This scenario is the
 * BEHAVIORAL leg, gated on `capabilities.agents.orgChart.supported`: it proves
 * against the LIVE host that the org-chart projector strips position-as-authority
 * — no member, department, or responsibility-view object served on the wire
 * carries an authority-bearing field (`scopes` / `canDispatch` / `permissions` /
 * `authority` / `roleGrants` / `capabilities`), at every install scope. An org
 * edge is an *ownership + reporting* record, never an authority grant.
 *
 * Soft-skips when unadvertised (default) / hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true`.
 *
 * The deeper authority-invariance legs — a manager agent cannot dispatch a
 * report's tools (RFC 0002 §A14), an RFC 0049 authorization decision is
 * invariant to org position, an RFC 0051 approval gate is not satisfied by org
 * seniority — require a non-normative host authorization-decide hook to force
 * black-box; a conformant host need not expose one, so (mirroring the RFC 0070
 * `agent-manifest-runtime` confidence-escalation note) they stay reference-impl
 * tier and are NOT asserted here. The wire-projection proof below is the
 * load-bearing, hook-free behavioral guarantee.
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-org-chart.md (§B)
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0087-agent-org-chart.md (§B)
 *   - https://github.com/openwop/openwop/blob/main/SECURITY/invariants.yaml (org-position-no-authority-escalation)
 */

import { describe, it, expect } from 'vitest';
import { seamAbsent } from '../lib/soft-skip.js';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readOrgChartCap, getOrgChart, getDepartmentView, AUTHORITY_FIELDS } from '../lib/agentOrgChart.js';

/** Assert an org-chart wire object carries no authority-bearing field. */
function expectNoAuthority(obj: Record<string, unknown> | undefined, where: string): void {
  if (!obj || typeof obj !== 'object') return;
  for (const f of AUTHORITY_FIELDS) {
    expect(
      !(f in obj),
      driver.describe('RFC 0087 §B / org-position-no-authority-escalation', `${where} MUST NOT carry the authority field "${f}" — org position confers no authority`),
    ).toBe(true);
  }
}

describe('org-position-no-authority-escalation (RFC 0087 §B, behavioral)', () => {
  it('the live org-chart wire carries no authority-bearing field on any member/department/view', async () => {
    const cap = await readOrgChartCap();
    if (!behaviorGate('openwop-org-position-no-authority', cap?.supported === true)) return;

    const chart = await getOrgChart();
    if (chart === null) return seamAbsent('host advertises org-position authority but GET /v1/agents/org-chart is not served');

    // An EMPTY chart has nothing that could carry authority: the invariant is
    // unobservable, and RFC 0148 §A says unobservable is `blocked`, not a
    // zero-assertion pass (which is what this leg recorded on such a host).
    if ((chart.members ?? []).length === 0 && (chart.departments ?? []).length === 0) {
      return seamAbsent('host advertises org-position authority but the org chart is EMPTY — no member or department to check; the invariant is unobservable until the host seeds one');
    }
    // The chart root is a wire object too.
    expectNoAuthority(chart as unknown as Record<string, unknown>, 'the org-chart root');

    for (const m of chart.members ?? []) {
      expectNoAuthority(m as Record<string, unknown>, 'an org-chart member');
    }
    for (const d of chart.departments ?? []) {
      expectNoAuthority(d as Record<string, unknown>, 'an org-chart department');
    }

    // The §D responsibility roll-up is a portfolio union (workflow ids), never an
    // authority grant — assert its members + the view object are authority-free too.
    const probeDeptId = (chart.departments ?? [])[0]?.departmentId;
    if (typeof probeDeptId === 'string') {
      const { status, view } = await getDepartmentView(probeDeptId);
      if (status === 200 && view) {
        expectNoAuthority(view as unknown as Record<string, unknown>, 'the responsibility view');
        expectNoAuthority(view.department as Record<string, unknown> | undefined, "the responsibility view's department");
        for (const m of view.members ?? []) {
          expectNoAuthority(m as Record<string, unknown>, 'a responsibility-view member');
        }
      }
    }
  });
});
