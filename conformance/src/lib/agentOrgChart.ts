/**
 * Shared helpers for the RFC 0087 `agents.orgChart` conformance scenarios.
 * Lives in lib/ (not a `*.test.ts`) so scenarios import it via
 * `../lib/agentOrgChart.js`.
 *
 * The org-chart is structure + a read (like the RFC 0072 inventory), not an
 * event surface — so these helpers wrap the two NORMATIVE reads
 * (`GET /v1/agents/org-chart` + `GET /v1/agents/org-chart/{departmentId}`),
 * exercised black-box against any conformant host. Tenant scoping (RFC 0074)
 * is probed with the `OPENWOP_CROSS_TENANT_ORG_CHART_DEPARTMENT_ID` env var (a
 * department id outside the caller's owner triple), the org-chart analog of the
 * roster scenario's `OPENWOP_CROSS_TENANT_ROSTER_ID`.
 *
 * @see RFCS/0087-agent-org-chart.md
 * @see spec/v1/agent-org-chart.md
 */
import { driver } from './driver.js';
import { readCapabilityFamily } from './discovery-capabilities.js';

/** Reads `agents.orgChart` from discovery (root-first per RFC 0073); null when
 *  unadvertised. */
export async function readOrgChartCap(): Promise<Record<string, unknown> | null> {
  const agents = await readCapabilityFamily<{ orgChart?: unknown }>('agents');
  const oc = agents?.orgChart;
  return oc && typeof oc === 'object' ? (oc as Record<string, unknown>) : null;
}

export interface OrgDepartment {
  departmentId?: string;
  parentDepartmentId?: string | null;
  [k: string]: unknown;
}

export interface OrgMember {
  rosterId?: string;
  departmentId?: string;
  roleId?: string;
  reportsTo?: string | null;
  [k: string]: unknown;
}

export interface OrgChart {
  owner?: { tenantId?: string; workspaceId?: string };
  departments?: OrgDepartment[];
  members?: OrgMember[];
}

export interface ResponsibilityView {
  department?: { departmentId?: string; [k: string]: unknown };
  members?: OrgMember[];
  responsibilities?: string[];
}

/** GET the NORMATIVE org-chart (RFC 0087 §A `GET /v1/agents/org-chart`) and
 *  return the raw status alongside the parsed body, so a scenario can assert
 *  on the status itself (with a `req()` id) instead of a helper that folds it. */
export async function getOrgChartResponse(): Promise<{ status: number; chart: OrgChart | undefined }> {
  const res = await driver.get('/v1/agents/org-chart');
  const body = res.json;
  return { status: res.status, chart: body && typeof body === 'object' ? (body as OrgChart) : undefined };
}

/** GET the NORMATIVE org-chart (RFC 0087 §A `GET /v1/agents/org-chart`);
 *  null when the host doesn't serve it (404/405/501).
 *
 *  unfailable-leg audit wave 2, 2026-09-27: every other status used to fold to
 *  `{}` — an advertised host answering 500/403 read as an EMPTY chart, which
 *  the tree/member loops then passed vacuously. Any other non-200 (or a 200
 *  with no object body) now throws, failing the calling leg. */
export async function getOrgChart(): Promise<OrgChart | null> {
  const { status, chart } = await getOrgChartResponse();
  if (status === 404 || status === 405 || status === 501) return null;
  if (status !== 200 || chart === undefined) {
    throw new Error(`RFC 0087 §A: GET /v1/agents/org-chart MUST return 200 with the org-chart object on a host advertising agents.orgChart — got HTTP ${status}${chart === undefined ? ' with no JSON object body' : ''}`);
  }
  return chart;
}

/** GET a department's §D responsibility roll-up. `recursive` defaults to the
 *  host default (true) when undefined. Returns `{ status, view }` so a caller
 *  can distinguish a cross-tenant 404 from a served view. */
export async function getDepartmentView(
  departmentId: string,
  recursive?: boolean,
): Promise<{ status: number; view: ResponsibilityView | undefined }> {
  const qs = recursive === undefined ? '' : `?recursive=${recursive ? 'true' : 'false'}`;
  const res = await driver.get(`/v1/agents/org-chart/${encodeURIComponent(departmentId)}${qs}`);
  return { status: res.status, view: res.json as ResponsibilityView | undefined };
}

/** The descriptive key set a member object is allowed to carry on the wire
 *  (RFC 0087 §A). Anything outside this — in particular an authority-bearing
 *  field — is a §B `org-position-no-authority-escalation` violation. */
export const MEMBER_DESCRIPTIVE_KEYS = new Set(['rosterId', 'departmentId', 'roleId', 'reportsTo']);

/** Authority-bearing field names that MUST NEVER appear on an org-chart wire
 *  object (member / department / responsibility view) — position confers no
 *  authority (RFC 0087 §B). */
export const AUTHORITY_FIELDS = ['scopes', 'canDispatch', 'permissions', 'authority', 'roleGrants', 'capabilities'];
