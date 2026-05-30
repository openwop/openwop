/**
 * Standing agent roster + org-chart client (RFCS/0086 + 0087 reference impl).
 *
 *   GET/POST/DELETE /v1/host/sample/roster[/{rosterId}]   — named agents + portfolios
 *   GET/PUT/DELETE  /v1/host/sample/org-chart              — departments/roles/reportsTo
 *   GET            /v1/host/sample/org-chart/{departmentId} — responsibility roll-up
 *
 * Tenant scoping is the backend's job (ownership from the caller's principal);
 * the client never sends a tenantId.
 */

import { authedHeaders, config, fetchOpts } from '../client/config.js';

export interface RosterAgentRef {
  agentId: string;
  version?: string;
  channel?: string;
}

export interface RosterEntry {
  rosterId: string;
  persona: string;
  agentRef: RosterAgentRef;
  workflows: string[];
  tenantId: string;
  enabled: boolean;
  label?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrgRole { roleId: string; name: string }
export interface OrgDepartment { departmentId: string; name: string; parentDepartmentId: string | null; roles: OrgRole[] }
export interface OrgMember { rosterId: string; departmentId: string; roleId: string; reportsTo: string | null }
export interface OrgChart { tenantId: string; departments: OrgDepartment[]; members: OrgMember[]; updatedAt: string | null }
export interface ResponsibilityView { department: OrgDepartment; members: OrgMember[]; responsibilities: string[] }

const rosterBase = `${config.baseUrl}/v1/host/sample/roster`;
const orgBase = `${config.baseUrl}/v1/host/sample/org-chart`;
const jsonHeaders = (): HeadersInit => authedHeaders({ 'content-type': 'application/json' });

export async function listRoster(): Promise<RosterEntry[]> {
  const res = await fetch(rosterBase, fetchOpts({ headers: authedHeaders() }));
  if (!res.ok) throw new Error(`listRoster returned ${res.status}`);
  return ((await res.json()) as { roster: RosterEntry[] }).roster;
}

export async function createRosterEntry(input: {
  persona: string;
  agentRef: RosterAgentRef;
  workflows?: string[];
  description?: string;
}): Promise<RosterEntry> {
  const res = await fetch(rosterBase, fetchOpts({ method: 'POST', headers: jsonHeaders(), body: JSON.stringify(input) }));
  if (!res.ok) throw new Error(`createRosterEntry returned ${res.status}`);
  return (await res.json()) as RosterEntry;
}

export async function deleteRosterEntry(rosterId: string): Promise<void> {
  const res = await fetch(`${rosterBase}/${encodeURIComponent(rosterId)}`, fetchOpts({ method: 'DELETE', headers: authedHeaders() }));
  if (!res.ok) throw new Error(`deleteRosterEntry returned ${res.status}`);
}

export async function getOrgChart(): Promise<OrgChart> {
  const res = await fetch(orgBase, fetchOpts({ headers: authedHeaders() }));
  if (!res.ok) throw new Error(`getOrgChart returned ${res.status}`);
  return (await res.json()) as OrgChart;
}

export async function putOrgChart(input: { departments: OrgDepartment[]; members: OrgMember[] }): Promise<OrgChart> {
  const res = await fetch(orgBase, fetchOpts({ method: 'PUT', headers: jsonHeaders(), body: JSON.stringify(input) }));
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) detail = body.message;
    } catch { /* ignore */ }
    throw new Error(`putOrgChart failed: ${detail}`);
  }
  return (await res.json()) as OrgChart;
}

export async function getDepartmentRollup(departmentId: string): Promise<ResponsibilityView> {
  const res = await fetch(`${orgBase}/${encodeURIComponent(departmentId)}`, fetchOpts({ headers: authedHeaders() }));
  if (!res.ok) throw new Error(`getDepartmentRollup returned ${res.status}`);
  return (await res.json()) as ResponsibilityView;
}
