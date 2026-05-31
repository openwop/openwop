/**
 * Agent org-chart — host extension (sample-grade, non-normative).
 *
 * The reference implementation of RFCS/0087: a tenant-scoped, DESCRIPTIVE
 * grouping of RFC 0086 roster members (host/rosterService.ts) into
 * departments + roles with acyclic `reportsTo` edges, plus a derived
 * responsibility roll-up (the union of a department's members' workflow
 * portfolios — "what is Marketing collectively responsible for").
 *
 * The load-bearing constraint (RFC 0087 §B — `org-position-no-authority-
 * escalation`): an org edge confers NO authority. This store carries NO
 * `permissions` / `scopes` / `canDispatch` field by design; a `reportsTo`
 * edge is metadata only. Authority stays in toolAllowlist (RFC 0002 §A14),
 * RBAC (RFC 0049), and approval gates (RFC 0051) — none of which this
 * module touches. Position describes; it never authorizes.
 *
 * The store is a read-through, per-entity durable collection (one chart per
 * tenant, keyed by tenantId) — consistent across instances + restart-safe.
 * This module is pure data + validation; the roll-up reads roster portfolios
 * via rosterService.
 *
 * @see RFCS/0087-agent-org-chart.md §A/§B/§C/§D
 * @see src/host/rosterService.ts — the members are roster entries
 */

import { getRosterEntry } from './rosterService.js';
import { DurableCollection } from './hostExtPersistence.js';

export interface OrgRole {
  roleId: string;
  name: string;
}

export interface OrgDepartment {
  departmentId: string;
  name: string;
  /** Department nesting (a tree); null for a top-level department. */
  parentDepartmentId: string | null;
  roles: OrgRole[];
}

export interface OrgMember {
  /** An RFC 0086 roster entry id (the member IS a roster instance). */
  rosterId: string;
  departmentId: string;
  roleId: string;
  /** Another member's rosterId, or null for the root. Acyclic. */
  reportsTo: string | null;
}

/** The whole chart for one tenant. DESCRIPTIVE — no authority field exists
 *  on this type, by RFC 0087 §B design. */
export interface OrgChart {
  tenantId: string;
  departments: OrgDepartment[];
  members: OrgMember[];
  updatedAt: string;
}

export interface OrgChartValidationError {
  code: 'cycle' | 'cross_tenant_member' | 'unknown_member' | 'unknown_department' | 'unknown_role';
  message: string;
  detail?: string;
}

// One chart per tenant — the tenantId IS the entity id.
const charts = new DurableCollection<OrgChart>('orgchart', (c) => c.tenantId);

function nowIso(): string {
  return new Date().toISOString();
}

/** Detect a `reportsTo` cycle among members (Kahn-style: repeatedly drop
 *  members whose manager is absent/already-dropped; a remnant ⇒ cycle). */
function hasReportsToCycle(members: OrgMember[]): boolean {
  const byId = new Map(members.map((m) => [m.rosterId, m]));
  const settled = new Set<string>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const m of members) {
      if (settled.has(m.rosterId)) continue;
      const mgr = m.reportsTo;
      // A member is settled when it has no manager, its manager isn't in the
      // chart (an external/root edge), or its manager is already settled.
      if (mgr === null || !byId.has(mgr) || settled.has(mgr)) {
        settled.add(m.rosterId);
        progress = true;
      }
    }
  }
  return settled.size !== members.length;
}

/**
 * Validate + store a chart for a tenant. Enforces: every member references a
 * roster entry in the SAME tenant (no cross-tenant membership — §C); every
 * `departmentId`/`roleId` exists; the `reportsTo` edge set is acyclic (§A).
 * Returns the stored chart or a validation error. Note: there is no authority
 * to validate — the chart is descriptive (§B).
 */
export async function putChart(input: {
  tenantId: string;
  departments: OrgDepartment[];
  members: OrgMember[];
}): Promise<{ chart: OrgChart } | { error: OrgChartValidationError }> {
  const deptIds = new Set(input.departments.map((d) => d.departmentId));
  const roleIds = new Set(input.departments.flatMap((d) => d.roles.map((r) => r.roleId)));
  const memberIds = new Set(input.members.map((m) => m.rosterId));

  for (const m of input.members) {
    const entry = await getRosterEntry(m.rosterId);
    if (!entry || entry.tenantId !== input.tenantId) {
      return { error: { code: 'cross_tenant_member', message: 'Every member MUST reference a roster entry in this tenant.', detail: m.rosterId } };
    }
    if (!deptIds.has(m.departmentId)) {
      return { error: { code: 'unknown_department', message: 'Member references an unknown department.', detail: m.departmentId } };
    }
    if (!roleIds.has(m.roleId)) {
      return { error: { code: 'unknown_role', message: 'Member references an unknown role.', detail: m.roleId } };
    }
    if (m.reportsTo !== null && !memberIds.has(m.reportsTo)) {
      return { error: { code: 'unknown_member', message: '`reportsTo` MUST name another member in this chart, or null.', detail: m.reportsTo } };
    }
  }
  if (hasReportsToCycle(input.members)) {
    return { error: { code: 'cycle', message: 'The `reportsTo` edge set MUST be acyclic.' } };
  }

  const chart: OrgChart = {
    tenantId: input.tenantId,
    departments: input.departments.map((d) => ({ ...d, roles: d.roles.map((r) => ({ ...r })) })),
    members: input.members.map((m) => ({ ...m })),
    updatedAt: nowIso(),
  };
  await charts.put(chart);
  return { chart };
}

export async function getChart(tenantId: string): Promise<OrgChart | null> {
  return charts.get(tenantId);
}

export async function deleteChart(tenantId: string): Promise<boolean> {
  return charts.delete(tenantId);
}

export interface ResponsibilityView {
  department: OrgDepartment;
  members: OrgMember[];
  /** Union of the members' RFC 0086 workflow portfolios (deduped). */
  responsibilities: string[];
}

/** Collect a department's descendant department ids (inclusive). */
function departmentSubtree(chart: OrgChart, departmentId: string): Set<string> {
  const out = new Set<string>([departmentId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of chart.departments) {
      if (d.parentDepartmentId && out.has(d.parentDepartmentId) && !out.has(d.departmentId)) {
        out.add(d.departmentId);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * The §D responsibility roll-up: a department's members + the union of their
 * roster portfolios. Recurses through sub-departments unless `recursive` is
 * false. Computed from live roster entries (no stored field, grants nothing).
 * Returns undefined if the department is unknown.
 */
export async function responsibilityView(
  tenantId: string,
  departmentId: string,
  recursive = true,
): Promise<ResponsibilityView | undefined> {
  const chart = await charts.get(tenantId);
  if (!chart) return undefined;
  const department = chart.departments.find((d) => d.departmentId === departmentId);
  if (!department) return undefined;

  const scope = recursive ? departmentSubtree(chart, departmentId) : new Set([departmentId]);
  const members = chart.members.filter((m) => scope.has(m.departmentId));
  const portfolios = await Promise.all(
    members.map(async (m) => (await getRosterEntry(m.rosterId))?.workflows ?? []),
  );
  const responsibilities = [...new Set(portfolios.flat())];
  return { department, members, responsibilities };
}

/** Test-only: drop all charts. */
export async function __resetOrgChartStore(): Promise<void> {
  await charts.__clear();
}
