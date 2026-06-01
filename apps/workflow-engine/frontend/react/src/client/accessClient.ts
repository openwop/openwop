/**
 * Access-control host-extension client (non-normative).
 *
 * Wraps /v1/host/sample/{roles,access,orgs,…} — organizations, teams, named
 * members, and the built-in role catalog. Roles map to RFC 0049 scopes;
 * authority resolves only from a member's explicit roles (never the org-chart).
 *
 * @see ../../../backend/typescript/src/routes/accessControl.ts
 */
import { authedHeaders, config, fetchOpts } from './config.js';

export type BuiltInRoleId = 'viewer' | 'editor' | 'admin' | 'owner';

export interface AccessRole {
  id: BuiltInRoleId;
  name: string;
  description: string;
  scopes: string[];
  builtIn: boolean;
}

export interface Organization {
  orgId: string;
  tenantId: string;
  name: string;
  slug: string;
  description?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Team {
  teamId: string;
  orgId: string;
  tenantId: string;
  name: string;
  description?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrgMember {
  memberId: string;
  orgId: string;
  tenantId: string;
  subject?: string;
  displayName: string;
  email?: string;
  /** Role ids — built-in (`viewer`…`owner`) or custom role ids. */
  roles: string[];
  teamIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomRole {
  roleId: string;
  orgId: string;
  tenantId: string;
  name: string;
  description?: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Group {
  groupId: string;
  orgId: string;
  tenantId: string;
  name: string;
  description?: string;
  roles: string[];
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EffectiveAccess {
  roles: string[];
  scopes: string[];
  basis: 'tenant-owner' | 'member' | 'none';
  memberId?: string;
  directRoles?: string[];
  groupRoles?: string[];
}

const base = `${config.baseUrl}/v1/host/sample`;

/**
 * "View as member" demo seam (reference host only). When set, every access
 * call carries `x-openwop-act-as: <memberId>` so the backend enforces that
 * member's role-derived scopes — letting the UI demonstrate role-based denial.
 * NOT an auth mechanism; a production host derives the acting principal from
 * real auth, never a client header.
 */
let actingMemberId: string | null = null;
export function setActingMember(memberId: string | null): void {
  actingMemberId = memberId && memberId.trim() ? memberId : null;
}

function acHeaders(extra?: Record<string, string>): Record<string, string> {
  const h = authedHeaders(extra);
  if (actingMemberId) h['x-openwop-act-as'] = actingMemberId;
  return h;
}
const jsonHeaders = (): Record<string, string> => acHeaders({ 'content-type': 'application/json' });

/** Resolve a JSON body, surfacing the host's error envelope message when present. */
async function asJson<T>(res: Response, ctx: string): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string }; message?: string };
      detail = body?.error?.message ?? body?.message ?? '';
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail || `${ctx} returned ${res.status}`);
  }
  return (await res.json()) as T;
}

async function expectOk(res: Response, ctx: string): Promise<void> {
  if (!res.ok && res.status !== 204) throw new Error(`${ctx} returned ${res.status}`);
}

// ── Roles + effective access ──────────────────────────────────────────────────

export async function listRoles(): Promise<AccessRole[]> {
  const res = await fetch(`${base}/roles`, fetchOpts({ headers: acHeaders() }));
  return (await asJson<{ roles: AccessRole[] }>(res, 'listRoles')).roles;
}

export async function getEffectiveAccess(opts: { memberId?: string; subject?: string } = {}): Promise<EffectiveAccess> {
  const qs = new URLSearchParams();
  if (opts.memberId) qs.set('memberId', opts.memberId);
  if (opts.subject) qs.set('subject', opts.subject);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await fetch(`${base}/access/effective${suffix}`, fetchOpts({ headers: acHeaders() }));
  return asJson<EffectiveAccess>(res, 'getEffectiveAccess');
}

// ── Organizations ──────────────────────────────────────────────────────────────

export async function listOrgs(): Promise<Organization[]> {
  const res = await fetch(`${base}/orgs`, fetchOpts({ headers: acHeaders() }));
  return (await asJson<{ orgs: Organization[] }>(res, 'listOrgs')).orgs;
}

export async function createOrg(input: { name: string; description?: string }): Promise<Organization> {
  const res = await fetch(`${base}/orgs`, fetchOpts({ method: 'POST', headers: jsonHeaders(), body: JSON.stringify(input) }));
  return asJson<Organization>(res, 'createOrg');
}

export async function updateOrg(orgId: string, patch: { name?: string; description?: string | null }): Promise<Organization> {
  const res = await fetch(`${base}/orgs/${encodeURIComponent(orgId)}`, fetchOpts({ method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(patch) }));
  return asJson<Organization>(res, 'updateOrg');
}

export async function deleteOrg(orgId: string): Promise<void> {
  const res = await fetch(`${base}/orgs/${encodeURIComponent(orgId)}`, fetchOpts({ method: 'DELETE', headers: acHeaders() }));
  await expectOk(res, 'deleteOrg');
}

// ── Teams ────────────────────────────────────────────────────────────────────

export async function listTeams(orgId: string): Promise<Team[]> {
  const res = await fetch(`${base}/orgs/${encodeURIComponent(orgId)}/teams`, fetchOpts({ headers: acHeaders() }));
  return (await asJson<{ teams: Team[] }>(res, 'listTeams')).teams;
}

export async function createTeam(orgId: string, input: { name: string; description?: string; color?: string }): Promise<Team> {
  const res = await fetch(`${base}/orgs/${encodeURIComponent(orgId)}/teams`, fetchOpts({ method: 'POST', headers: jsonHeaders(), body: JSON.stringify(input) }));
  return asJson<Team>(res, 'createTeam');
}

export async function deleteTeam(orgId: string, teamId: string): Promise<void> {
  const res = await fetch(`${base}/orgs/${encodeURIComponent(orgId)}/teams/${encodeURIComponent(teamId)}`, fetchOpts({ method: 'DELETE', headers: acHeaders() }));
  await expectOk(res, 'deleteTeam');
}

// ── Members ──────────────────────────────────────────────────────────────────

export async function listMembers(orgId: string): Promise<OrgMember[]> {
  const res = await fetch(`${base}/orgs/${encodeURIComponent(orgId)}/members`, fetchOpts({ headers: acHeaders() }));
  return (await asJson<{ members: OrgMember[] }>(res, 'listMembers')).members;
}

export async function createMember(
  orgId: string,
  input: { displayName: string; email?: string; subject?: string; roles?: string[]; teamIds?: string[] },
): Promise<OrgMember> {
  const res = await fetch(`${base}/orgs/${encodeURIComponent(orgId)}/members`, fetchOpts({ method: 'POST', headers: jsonHeaders(), body: JSON.stringify(input) }));
  return asJson<OrgMember>(res, 'createMember');
}

export async function updateMember(
  orgId: string,
  memberId: string,
  patch: { displayName?: string; email?: string | null; subject?: string | null; roles?: string[]; teamIds?: string[] },
): Promise<OrgMember> {
  const res = await fetch(
    `${base}/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(memberId)}`,
    fetchOpts({ method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(patch) }),
  );
  return asJson<OrgMember>(res, 'updateMember');
}

export async function deleteMember(orgId: string, memberId: string): Promise<void> {
  const res = await fetch(
    `${base}/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(memberId)}`,
    fetchOpts({ method: 'DELETE', headers: acHeaders() }),
  );
  await expectOk(res, 'deleteMember');
}

// ── Groups (cross-cutting RBAC units carrying roles) ──────────────────────────

export async function listGroups(orgId: string): Promise<Group[]> {
  const res = await fetch(`${base}/orgs/${encodeURIComponent(orgId)}/groups`, fetchOpts({ headers: acHeaders() }));
  return (await asJson<{ groups: Group[] }>(res, 'listGroups')).groups;
}

export async function createGroup(
  orgId: string,
  input: { name: string; description?: string; roles?: string[]; memberIds?: string[] },
): Promise<Group> {
  const res = await fetch(`${base}/orgs/${encodeURIComponent(orgId)}/groups`, fetchOpts({ method: 'POST', headers: jsonHeaders(), body: JSON.stringify(input) }));
  return asJson<Group>(res, 'createGroup');
}

export async function updateGroup(
  orgId: string,
  groupId: string,
  patch: { name?: string; description?: string | null; roles?: string[]; memberIds?: string[] },
): Promise<Group> {
  const res = await fetch(
    `${base}/orgs/${encodeURIComponent(orgId)}/groups/${encodeURIComponent(groupId)}`,
    fetchOpts({ method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(patch) }),
  );
  return asJson<Group>(res, 'updateGroup');
}

export async function deleteGroup(orgId: string, groupId: string): Promise<void> {
  const res = await fetch(
    `${base}/orgs/${encodeURIComponent(orgId)}/groups/${encodeURIComponent(groupId)}`,
    fetchOpts({ method: 'DELETE', headers: acHeaders() }),
  );
  await expectOk(res, 'deleteGroup');
}

// ── Custom roles ──────────────────────────────────────────────────────────────

/** The org's full role catalog: built-in roles + custom roles. */
export async function listOrgRoles(orgId: string): Promise<{ roles: AccessRole[]; customRoles: CustomRole[] }> {
  const res = await fetch(`${base}/orgs/${encodeURIComponent(orgId)}/roles`, fetchOpts({ headers: acHeaders() }));
  return asJson<{ roles: AccessRole[]; customRoles: CustomRole[] }>(res, 'listOrgRoles');
}

export async function createCustomRole(
  orgId: string,
  input: { name: string; description?: string; scopes: string[] },
): Promise<CustomRole> {
  const res = await fetch(`${base}/orgs/${encodeURIComponent(orgId)}/roles`, fetchOpts({ method: 'POST', headers: jsonHeaders(), body: JSON.stringify(input) }));
  return asJson<CustomRole>(res, 'createCustomRole');
}

export async function deleteCustomRole(orgId: string, roleId: string): Promise<void> {
  const res = await fetch(
    `${base}/orgs/${encodeURIComponent(orgId)}/roles/${encodeURIComponent(roleId)}`,
    fetchOpts({ method: 'DELETE', headers: acHeaders() }),
  );
  await expectOk(res, 'deleteCustomRole');
}
