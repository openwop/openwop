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
  roles: BuiltInRoleId[];
  teamIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EffectiveAccess {
  roles: BuiltInRoleId[];
  scopes: string[];
  basis: 'tenant-owner' | 'member' | 'none';
  memberId?: string;
}

const base = `${config.baseUrl}/v1/host/sample`;
const jsonHeaders = (): HeadersInit => authedHeaders({ 'content-type': 'application/json' });

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
  const res = await fetch(`${base}/roles`, fetchOpts({ headers: authedHeaders() }));
  return (await asJson<{ roles: AccessRole[] }>(res, 'listRoles')).roles;
}

export async function getEffectiveAccess(opts: { memberId?: string; subject?: string } = {}): Promise<EffectiveAccess> {
  const qs = new URLSearchParams();
  if (opts.memberId) qs.set('memberId', opts.memberId);
  if (opts.subject) qs.set('subject', opts.subject);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await fetch(`${base}/access/effective${suffix}`, fetchOpts({ headers: authedHeaders() }));
  return asJson<EffectiveAccess>(res, 'getEffectiveAccess');
}

// ── Organizations ──────────────────────────────────────────────────────────────

export async function listOrgs(): Promise<Organization[]> {
  const res = await fetch(`${base}/orgs`, fetchOpts({ headers: authedHeaders() }));
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
  const res = await fetch(`${base}/orgs/${encodeURIComponent(orgId)}`, fetchOpts({ method: 'DELETE', headers: authedHeaders() }));
  await expectOk(res, 'deleteOrg');
}

// ── Teams ────────────────────────────────────────────────────────────────────

export async function listTeams(orgId: string): Promise<Team[]> {
  const res = await fetch(`${base}/orgs/${encodeURIComponent(orgId)}/teams`, fetchOpts({ headers: authedHeaders() }));
  return (await asJson<{ teams: Team[] }>(res, 'listTeams')).teams;
}

export async function createTeam(orgId: string, input: { name: string; description?: string; color?: string }): Promise<Team> {
  const res = await fetch(`${base}/orgs/${encodeURIComponent(orgId)}/teams`, fetchOpts({ method: 'POST', headers: jsonHeaders(), body: JSON.stringify(input) }));
  return asJson<Team>(res, 'createTeam');
}

export async function deleteTeam(orgId: string, teamId: string): Promise<void> {
  const res = await fetch(`${base}/orgs/${encodeURIComponent(orgId)}/teams/${encodeURIComponent(teamId)}`, fetchOpts({ method: 'DELETE', headers: authedHeaders() }));
  await expectOk(res, 'deleteTeam');
}

// ── Members ──────────────────────────────────────────────────────────────────

export async function listMembers(orgId: string): Promise<OrgMember[]> {
  const res = await fetch(`${base}/orgs/${encodeURIComponent(orgId)}/members`, fetchOpts({ headers: authedHeaders() }));
  return (await asJson<{ members: OrgMember[] }>(res, 'listMembers')).members;
}

export async function createMember(
  orgId: string,
  input: { displayName: string; email?: string; subject?: string; roles?: BuiltInRoleId[]; teamIds?: string[] },
): Promise<OrgMember> {
  const res = await fetch(`${base}/orgs/${encodeURIComponent(orgId)}/members`, fetchOpts({ method: 'POST', headers: jsonHeaders(), body: JSON.stringify(input) }));
  return asJson<OrgMember>(res, 'createMember');
}

export async function updateMember(
  orgId: string,
  memberId: string,
  patch: { displayName?: string; email?: string | null; subject?: string | null; roles?: BuiltInRoleId[]; teamIds?: string[] },
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
    fetchOpts({ method: 'DELETE', headers: authedHeaders() }),
  );
  await expectOk(res, 'deleteMember');
}
