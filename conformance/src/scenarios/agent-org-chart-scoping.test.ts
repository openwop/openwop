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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { behaviorGate } from '../lib/behavior-gate.js';
import { readOrgChartCap, getOrgChartResponse, getDepartmentView, type OrgChart } from '../lib/agentOrgChart.js';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { req } from '../lib/requirement-ids.js';

function loadSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, name), 'utf8')) as Record<string, unknown>;
}

/** A validator for `schemas/<name>.schema.json` (this file targets major 1;
 *  the major-2 twin is `v2-agent-org-chart-served-shape.test.ts`). The
 *  responsibility view `$ref`s the chart's `$defs`, so the chart schema is
 *  registered first. */
function servedShapeValidator(name: 'agent-org-chart' | 'org-chart-responsibility-view'): (d: unknown) => { ok: boolean; errors: string } {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  if (name !== 'agent-org-chart') ajv.addSchema(loadSchema('agent-org-chart.schema.json'));
  const validate = ajv.compile(loadSchema(`${name}.schema.json`));
  return (d: unknown) => ({ ok: validate(d) as boolean, errors: ajv.errorsText(validate.errors, { separator: '; ' }) });
}

const ROSTER_ID_RE = /^host:[a-z0-9][a-z0-9._-]*$/;

describe('agent-org-chart-scoping (RFC 0087 §A/§C/§D)', () => {
  it('serves the normative org-chart + responsibility roll-up, tree-shaped and tenant-scoped', async () => {
    const cap = await readOrgChartCap();
    if (!behaviorGate('openwop-org-chart-scoping', cap?.supported === true)) return;

    const installScope = typeof cap?.installScope === 'string' ? cap.installScope : 'tenant';
    expect(
      installScope === 'host' || installScope === 'tenant',
      req('openwop.it.agent-org-chart-scoping.serves-the-normative-org-chart-responsibility-roll-up-tree-shaped-and-tenant-sco', 'RFC 0087 §E / RFC 0074', "agents.orgChart.installScope (when present) MUST be 'host' or 'tenant'"),
    ).toBe(true);

    // ---- Leg 1: normative read (black-box) -------------------------------
    // unfailable-leg audit wave 2, 2026-09-27: a host that ADVERTISES
    // agents.orgChart but 404s the normative read (or answers 500/403, which
    // getOrgChart used to fold into an empty `{}` chart) previously passed —
    // the 404 as `inapplicable`, the error status as a vacuous empty tree.
    // The behaviorGate above already established the advertisement, so the
    // read MUST now be served: any non-200 fails here.
    const chartRes = await getOrgChartResponse();
    expect(
      chartRes.status,
      req('openwop.it.agent-org-chart-scoping.serves-the-normative-org-chart-responsibility-roll-up-tree-shaped-and-tenant-sco', 'agent-org-chart.md §A / §E', 'a host advertising agents.orgChart.supported MUST serve GET /v1/agents/org-chart with 200'),
    ).toBe(200);
    expect(
      chartRes.chart !== undefined,
      req('openwop.it.agent-org-chart-scoping.serves-the-normative-org-chart-responsibility-roll-up-tree-shaped-and-tenant-sco', 'agent-org-chart.schema.json', 'GET /v1/agents/org-chart MUST return a JSON org-chart object'),
    ).toBe(true);
    const chart: OrgChart = chartRes.chart ?? {};
    const departments = chart.departments ?? [];
    const members = chart.members ?? [];
    expect(
      Array.isArray(departments) && Array.isArray(members),
      req('openwop.it.agent-org-chart-scoping.serves-the-normative-org-chart-responsibility-roll-up-tree-shaped-and-tenant-sco', 'agent-org-chart.schema.json', 'GET /v1/agents/org-chart MUST return departments[] + members[]'),
    ).toBe(true);

    const deptIds = new Set(departments.map((d) => d.departmentId).filter((x): x is string => typeof x === 'string'));
    for (const d of departments) {
      const parent = d.parentDepartmentId;
      if (parent !== undefined && parent !== null) {
        expect(
          deptIds.has(parent),
          req('openwop.it.agent-org-chart-scoping.serves-the-normative-org-chart-responsibility-roll-up-tree-shaped-and-tenant-sco', 'agent-org-chart.md §A', 'every parentDepartmentId MUST resolve to a department in the chart (a tree)'),
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
        req('openwop.it.agent-org-chart-scoping.serves-the-normative-org-chart-responsibility-roll-up-tree-shaped-and-tenant-sco', 'agent-org-chart.md §A', 'the department parent graph MUST be acyclic'),
      ).toBe(true);
    }
    for (const m of members) {
      expect(
        typeof m.rosterId === 'string' && ROSTER_ID_RE.test(m.rosterId),
        req('openwop.it.agent-org-chart-scoping.serves-the-normative-org-chart-responsibility-roll-up-tree-shaped-and-tenant-sco', 'agent-org-chart.md §A', 'each member MUST reference a roster entry (host:<id> rosterId)'),
      ).toBe(true);
      if (typeof m.departmentId === 'string') {
        expect(
          deptIds.size === 0 || deptIds.has(m.departmentId),
          req('openwop.it.agent-org-chart-scoping.serves-the-normative-org-chart-responsibility-roll-up-tree-shaped-and-tenant-sco', 'agent-org-chart.md §A', "a member's departmentId MUST be a department in the chart"),
        ).toBe(true);
      }
    }

    // ---- Leg 2: §D responsibility roll-up --------------------------------
    const probeDeptId = departments[0]?.departmentId;
    if (typeof probeDeptId === 'string') {
      const { status, view } = await getDepartmentView(probeDeptId);
      // unfailable-leg audit wave 2, 2026-09-27: a host advertising
      // `responsibilityView: true` whose GET /v1/agents/org-chart/{id} errored
      // or 404'd for a department IN ITS OWN chart previously skipped the whole
      // roll-up leg silently. The advertised view MUST be served.
      if (cap?.responsibilityView === true) {
        expect(
          status,
          req('openwop.it.agent-org-chart-scoping.serves-the-normative-org-chart-responsibility-roll-up-tree-shaped-and-tenant-sco', 'agent-org-chart.md §D / §E', 'a host advertising agents.orgChart.responsibilityView MUST serve GET /v1/agents/org-chart/{departmentId} with 200 for a department in the caller\'s chart'),
        ).toBe(200);
      }
      if (status === 200 && view) {
        expect(
          Array.isArray(view.responsibilities),
          req('openwop.it.agent-org-chart-scoping.serves-the-normative-org-chart-responsibility-roll-up-tree-shaped-and-tenant-sco', 'agent-org-chart.md §D', 'the responsibility view MUST carry a responsibilities[] roll-up'),
        ).toBe(true);
        const r = view.responsibilities ?? [];
        expect(
          r.length === new Set(r).size,
          req('openwop.it.agent-org-chart-scoping.serves-the-normative-org-chart-responsibility-roll-up-tree-shaped-and-tenant-sco', 'agent-org-chart.md §D', 'responsibilities MUST be a deduped union (no duplicate workflow ids)'),
        ).toBe(true);
        expect(
          r.every((w) => typeof w === 'string'),
          req('openwop.it.agent-org-chart-scoping.serves-the-normative-org-chart-responsibility-roll-up-tree-shaped-and-tenant-sco', 'org-chart-responsibility-view.schema.json', 'responsibilities[] entries MUST be workflow-id strings'),
        ).toBe(true);
        // recursive=false MUST keep the response shape (a subset roll-up).
        const direct = await getDepartmentView(probeDeptId, false);
        if (direct.status === 200 && direct.view) {
          expect(
            Array.isArray(direct.view.responsibilities),
            req('openwop.it.agent-org-chart-scoping.serves-the-normative-org-chart-responsibility-roll-up-tree-shaped-and-tenant-sco', 'agent-org-chart.md §D', 'recursive=false MUST return the same shape, scoped to direct members'),
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
        req('openwop.it.agent-org-chart-scoping.serves-the-normative-org-chart-responsibility-roll-up-tree-shaped-and-tenant-sco', 'agent-org-chart.md §C / RFC 0074', 'GET /v1/agents/org-chart/{id} for a cross-tenant department MUST 404 (no cross-tenant disclosure)'),
      ).toBe(true);
    }
  });
});

// Org-chart served-shape leg (2026-09-28). Leg 1 above walks the chart's tree
// and member references but never validated the body against the schema, so a
// host serving its stored record (`{ tenantId, departments, members, updatedAt }`
// — `owner` missing, two extra keys on an `additionalProperties:false` object)
// passed at both majors; openwop-app did exactly that (fixed in openwop-app
// #4189). This leg validates the SERVED bodies of the normative read pair
// against `agent-org-chart.schema.json` / `org-chart-responsibility-view.schema.json`;
// `v2-agent-org-chart-served-shape.test.ts` is the same leg at major 2.
describe('agent-org-chart-scoping: served shape (RFC 0087 §A/§D)', () => {
  it('serves the org-chart read pair in the exact schema shape', async () => {
    const cap = await readOrgChartCap();
    if (!behaviorGate('openwop-org-chart-scoping', cap?.supported === true)) return;

    const chartRes = await getOrgChartResponse();
    expect(
      chartRes.status,
      req('openwop.it.agent-org-chart-scoping.serves-the-org-chart-read-pair-in-the-exact-schema-shape', 'agent-org-chart.md §A / §E', 'a host advertising agents.orgChart.supported MUST serve GET /v1/agents/org-chart with 200'),
    ).toBe(200);
    const chartCheck = servedShapeValidator('agent-org-chart')(chartRes.chart);
    expect(
      chartCheck.ok ? 'valid' : chartCheck.errors,
      req('openwop.it.agent-org-chart-scoping.serves-the-org-chart-read-pair-in-the-exact-schema-shape', 'agent-org-chart.schema.json (RFC 0087 §A)', 'the served GET /v1/agents/org-chart body MUST validate against agent-org-chart.schema.json (owner required; no extra keys)'),
    ).toBe('valid');

    const probeDeptId = chartRes.chart?.departments?.[0]?.departmentId;
    // The view leg needs a department to read; an empty chart is still
    // validated above (an empty chart is a conforming chart).
    if (cap?.responsibilityView === true && typeof probeDeptId === 'string') {
      const { status, view } = await getDepartmentView(probeDeptId);
      expect(
        status,
        req('openwop.it.agent-org-chart-scoping.serves-the-org-chart-read-pair-in-the-exact-schema-shape', 'agent-org-chart.md §D / §E', "a host advertising agents.orgChart.responsibilityView MUST serve GET /v1/agents/org-chart/{departmentId} with 200 for a department in the caller's chart"),
      ).toBe(200);
      const viewCheck = servedShapeValidator('org-chart-responsibility-view')(view);
      expect(
        viewCheck.ok ? 'valid' : viewCheck.errors,
        req('openwop.it.agent-org-chart-scoping.serves-the-org-chart-read-pair-in-the-exact-schema-shape', 'org-chart-responsibility-view.schema.json (RFC 0087 §D)', 'the served GET /v1/agents/org-chart/{departmentId} body MUST validate against org-chart-responsibility-view.schema.json'),
      ).toBe('valid');
    }
  });
});
