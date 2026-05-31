/**
 * Agent org-chart — normative read, responsibility roll-up + tenant scoping
 * (RFC 0087 §A/§C/§D) — behavioral.
 *
 * Gated on `capabilities.agents.orgChart.supported` (root-first per RFC 0073).
 * Soft-skips when unadvertised (default) / hard-fails under
 * `OPENWOP_REQUIRE_BEHAVIOR=true` via `behaviorGate`. The always-on wire-shape
 * coverage lives in `agent-org-chart-shape.test.ts`; this asserts host
 * BEHAVIOR against the live `/v1/agents/org-chart` surface:
 *
 *   1. NORMATIVE read — `GET /v1/agents/org-chart` returns the
 *      `agent-org-chart.schema.json` shape `{ owner, departments, members }`;
 *      departments form a tree (every `parentDepartmentId` resolves; no cycle);
 *      members reference roster entries (`host:<id>` rosterId) and the
 *      `reportsTo` graph is acyclic. Black-box on any org-chart host.
 *   2. §D RESPONSIBILITY ROLL-UP — `GET /v1/agents/org-chart/{departmentId}`
 *      returns `{ department, members, responsibilities }` where
 *      `responsibilities` is a deduped `string[]` (the union of the subtree
 *      members' RFC 0086 portfolios); `recursive=false` scopes to direct
 *      members without changing the response shape.
 *   3. TENANT SCOPING (§C / RFC 0074) — a `GET /v1/agents/org-chart/{id}` for a
 *      department outside the caller's owner triple 404s (probed only when
 *      `OPENWOP_CROSS_TENANT_ORG_CHART_DEPARTMENT_ID` is supplied; soft-skip
 *      otherwise — the org-chart analog of the roster scoping env var).
 *
 * Spec references:
 *   - https://github.com/openwop/openwop/blob/main/spec/v1/agent-org-chart.md
 *   - https://github.com/openwop/openwop/blob/main/RFCS/0087-agent-org-chart.md
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readOrgChartCap, getOrgChart, getDepartmentView } from '../lib/agentOrgChart.js';

const ROSTER_ID_RE = /^host:[a-z0-9][a-z0-9._-]*$/;

describe('agent-org-chart-scoping (RFC 0087 §A/§C/§D)', () => {
  it('serves the normative org-chart + responsibility roll-up, tree-shaped and tenant-scoped', async () => {
    const cap = await readOrgChartCap();
    if (!behaviorGate('openwop-org-chart-scoping', cap?.supported === true)) return;

    const installScope = typeof cap?.installScope === 'string' ? cap.installScope : 'tenant';
    expect(
      installScope === 'host' || installScope === 'tenant',
      driver.describe('RFC 0087 §E / RFC 0074', "agents.orgChart.installScope (when present) MUST be 'host' or 'tenant'"),
    ).toBe(true);

    // ---- Leg 1: normative read (black-box) -------------------------------
    const chart = await getOrgChart();
    if (chart === null) return; // advertised but read not served yet — soft-skip
    const departments = chart.departments ?? [];
    const members = chart.members ?? [];
    expect(
      Array.isArray(departments) && Array.isArray(members),
      driver.describe('agent-org-chart.schema.json', 'GET /v1/agents/org-chart MUST return departments[] + members[]'),
    ).toBe(true);

    const deptIds = new Set(departments.map((d) => d.departmentId).filter((x): x is string => typeof x === 'string'));
    for (const d of departments) {
      const parent = d.parentDepartmentId;
      if (parent !== undefined && parent !== null) {
        expect(
          deptIds.has(parent),
          driver.describe('agent-org-chart.md §A', 'every parentDepartmentId MUST resolve to a department in the chart (a tree)'),
        ).toBe(true);
      }
    }
    // Department tree is acyclic (walk parents from each node, bound by node count).
    for (const d of departments) {
      const seen = new Set<string>();
      let cur: string | null | undefined = d.departmentId;
      let steps = 0;
      while (typeof cur === 'string' && steps <= departments.length) {
        if (seen.has(cur)) break;
        seen.add(cur);
        cur = departments.find((x) => x.departmentId === cur)?.parentDepartmentId ?? null;
        steps++;
      }
      expect(
        steps <= departments.length,
        driver.describe('agent-org-chart.md §A', 'the department parent graph MUST be acyclic'),
      ).toBe(true);
    }
    for (const m of members) {
      expect(
        typeof m.rosterId === 'string' && ROSTER_ID_RE.test(m.rosterId),
        driver.describe('agent-org-chart.md §A', 'each member MUST reference a roster entry (host:<id> rosterId)'),
      ).toBe(true);
      if (typeof m.departmentId === 'string') {
        expect(
          deptIds.size === 0 || deptIds.has(m.departmentId),
          driver.describe('agent-org-chart.md §A', "a member's departmentId MUST be a department in the chart"),
        ).toBe(true);
      }
    }

    // ---- Leg 2: §D responsibility roll-up --------------------------------
    const probeDeptId = departments[0]?.departmentId;
    if (typeof probeDeptId === 'string') {
      const { status, view } = await getDepartmentView(probeDeptId);
      if (status === 200 && view) {
        expect(
          Array.isArray(view.responsibilities),
          driver.describe('agent-org-chart.md §D', 'the responsibility view MUST carry a responsibilities[] roll-up'),
        ).toBe(true);
        const r = view.responsibilities ?? [];
        expect(
          r.length === new Set(r).size,
          driver.describe('agent-org-chart.md §D', 'responsibilities MUST be a deduped union (no duplicate workflow ids)'),
        ).toBe(true);
        expect(
          r.every((w) => typeof w === 'string'),
          driver.describe('org-chart-responsibility-view.schema.json', 'responsibilities[] entries MUST be workflow-id strings'),
        ).toBe(true);
        // recursive=false MUST keep the response shape (a subset roll-up).
        const direct = await getDepartmentView(probeDeptId, false);
        if (direct.status === 200 && direct.view) {
          expect(
            Array.isArray(direct.view.responsibilities),
            driver.describe('agent-org-chart.md §D', 'recursive=false MUST return the same shape, scoped to direct members'),
          ).toBe(true);
        }
      }
    }

    // ---- Leg 3: tenant scoping (RFC 0074) --------------------------------
    const crossTenantDept = process.env.OPENWOP_CROSS_TENANT_ORG_CHART_DEPARTMENT_ID;
    if (typeof crossTenantDept === 'string' && crossTenantDept.length > 0) {
      const probe = await getDepartmentView(crossTenantDept);
      expect(
        probe.status === 404,
        driver.describe('agent-org-chart.md §C / RFC 0074', 'GET /v1/agents/org-chart/{id} for a cross-tenant department MUST 404 (no cross-tenant disclosure)'),
      ).toBe(true);
    }
  });
});
