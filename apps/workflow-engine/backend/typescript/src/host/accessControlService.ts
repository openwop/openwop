/**
 * Organizations / teams / members + role-based access — host extension
 * (sample-grade, NON-NORMATIVE). Lives entirely under /v1/host/sample/* and
 * is NOT part of the canonical v1 wire contract (spec/v1/host-extensions.md).
 *
 * Models the "RBAC like myndhyve" surface on top of openwop's existing
 * authority model rather than inventing a new one:
 *
 *   • Built-in ROLES map to the RFC 0049 scope vocabulary (manifest:read,
 *     runs:create, …) — the protocol's authorization primitive — PLUS a small
 *     set of `host:`-prefixed management scopes that govern THESE entities
 *     (org/team/member CRUD) and are deliberately distinct so they can never
 *     be mistaken for, or advertised as, RFC 0049 protocol scopes.
 *
 *   • Authority is resolved ONLY from a member's explicit `roles[]`. It is
 *     NEVER derived from the descriptive org-chart (RFC 0087) — a department,
 *     a role label, or a `reportsTo` edge confers no authority
 *     (`org-position-no-authority-escalation`, a protocol-tier SECURITY
 *     invariant). Orgs/teams here are a SEPARATE layer from the org-chart.
 *
 *   • Resolution is FAIL-CLOSED (RFC 0049): a principal with no matching
 *     member, or a member with no/unknown roles, resolves to zero scopes. The
 *     one exception is the tenant owner — the principal that owns the tenant —
 *     who is implicitly `owner`. That holds ONLY because a demo tenant == one
 *     principal today; when multi-principal tenants are real, replace it with
 *     an explicit owner member seeded at org creation.
 *
 *   • The host does NOT advertise `capabilities.authorization`: enforcement is
 *     wired to the management routes here, NOT to the protocol runs/artifacts
 *     paths, so advertising RFC 0049 would be a false authorization-oracle.
 *
 * Everything is tenant-scoped through the same durable per-entity store the
 * roster/org-chart extensions use; the tenant remains the hard isolation
 * boundary and an org/team/member is a grouping INSIDE it.
 *
 * @see src/host/rosterService.ts, src/host/orgChartService.ts — sibling host-ext stores
 * @see RFCS/0049 (RBAC scopes), RFCS/0087 §B (org position confers no authority)
 */

import { randomUUID } from 'node:crypto';
import { DurableCollection } from './hostExtPersistence.js';

// ── Scope vocabularies ──────────────────────────────────────────────────────

/**
 * RFC 0049 protocol scope vocabulary (bare `resource:action`). These are the
 * ONLY scopes that could ever be enumerated in a `capabilities.authorization`
 * advertisement (not advertised today — see file header).
 */
export const PROTOCOL_SCOPES = [
  'manifest:read',
  'runs:read',
  'runs:create',
  'runs:cancel',
  'artifacts:read',
  'audit:read',
  'approvals:respond',
  'webhooks:manage',
  'packs:publish',
  'packs:yank',
  'workspace:read',
  'workspace:write',
] as const;

/**
 * Host-extension-local management scopes. `host:`-prefixed so they are visibly
 * NOT RFC 0049 protocol scopes (architect finding 3). They gate the org/team/
 * member management routes in this extension only.
 */
export const MANAGEMENT_SCOPES = [
  'host:org:manage',
  'host:teams:manage',
  'host:members:manage',
  'host:groups:manage',
  'host:roles:manage',
] as const;

export type Scope = (typeof PROTOCOL_SCOPES)[number] | (typeof MANAGEMENT_SCOPES)[number];

const PROTOCOL_SCOPES_SET: ReadonlySet<string> = new Set(PROTOCOL_SCOPES);
/**
 * A custom role may carry ONLY RFC 0049 protocol scopes. The `host:` management
 * scopes (administering orgs/teams/members/groups/roles) are reserved to the
 * built-in admin/owner roles — so a custom role can never grant the power to
 * administer the access-control surface itself (in particular, never mint a
 * role-that-mints-roles). Validated fail-closed at the route boundary.
 */
export function isProtocolScope(value: unknown): value is (typeof PROTOCOL_SCOPES)[number] {
  return typeof value === 'string' && PROTOCOL_SCOPES_SET.has(value);
}

// ── Built-in role catalog (role → scopes) ───────────────────────────────────

export type BuiltInRoleId = 'viewer' | 'editor' | 'admin' | 'owner';

export interface AccessRole {
  id: BuiltInRoleId;
  name: string;
  description: string;
  scopes: Scope[];
  builtIn: true;
}

const VIEWER_SCOPES: Scope[] = ['manifest:read', 'runs:read', 'artifacts:read', 'audit:read', 'workspace:read'];
const EDITOR_SCOPES: Scope[] = [...VIEWER_SCOPES, 'runs:create', 'runs:cancel', 'workspace:write', 'approvals:respond'];
const ADMIN_SCOPES: Scope[] = [
  ...EDITOR_SCOPES,
  'webhooks:manage',
  'packs:publish',
  'packs:yank',
  'host:teams:manage',
  'host:members:manage',
  'host:groups:manage',
  'host:roles:manage',
];
const OWNER_SCOPES: Scope[] = [...ADMIN_SCOPES, 'host:org:manage'];

export const BUILT_IN_ROLES: Record<BuiltInRoleId, AccessRole> = {
  viewer: { id: 'viewer', name: 'Viewer', description: 'Read-only access to runs, artifacts, audit, and workspace.', scopes: VIEWER_SCOPES, builtIn: true },
  editor: { id: 'editor', name: 'Editor', description: 'Create and cancel runs, write workspace, respond to approvals.', scopes: EDITOR_SCOPES, builtIn: true },
  admin: { id: 'admin', name: 'Admin', description: 'Editor plus webhook/pack management and team/member/group administration.', scopes: ADMIN_SCOPES, builtIn: true },
  owner: { id: 'owner', name: 'Owner', description: 'Full access including organization management.', scopes: OWNER_SCOPES, builtIn: true },
};

export const BUILT_IN_ROLE_IDS = Object.keys(BUILT_IN_ROLES) as BuiltInRoleId[];

export function isBuiltInRoleId(value: unknown): value is BuiltInRoleId {
  return typeof value === 'string' && value in BUILT_IN_ROLES;
}

/** Union of the scopes granted by a set of role ids. Unknown role ids are
 *  dropped (fail-closed — they grant nothing), never error. */
export function scopesForRoles(roles: readonly string[]): Scope[] {
  const set = new Set<Scope>();
  for (const r of roles) {
    if (isBuiltInRoleId(r)) for (const s of BUILT_IN_ROLES[r].scopes) set.add(s);
  }
  return [...set];
}

// ── Entities ─────────────────────────────────────────────────────────────────

export interface Organization {
  orgId: string;
  tenantId: string;
  name: string;
  slug: string;
  description?: string;
  /** The principal (tenant) that created the org — the implicit owner today. */
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
  /** Optional authenticated-principal identifier this member maps to. When a
   *  request's principal matches, the member's roles apply. Absent ⇒ a
   *  descriptive member (no principal binding yet). */
  subject?: string;
  displayName: string;
  email?: string;
  /** Role ids — each either a built-in (`viewer`…`owner`) or a custom role id. */
  roles: string[];
  teamIds: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * A cross-cutting RBAC unit (distinct from a Team, which is a collaboration
 * grouping with no authority). A Group CARRIES roles and grants them to its
 * members — batch permission management. A member's effective roles are the
 * union of its own `roles[]` and the roles of every group it belongs to.
 */
export interface Group {
  groupId: string;
  orgId: string;
  tenantId: string;
  name: string;
  description?: string;
  /** Role ids — each either a built-in or a custom role id. */
  roles: string[];
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * A tenant/org-scoped custom role — lets an org define roles beyond the
 * built-in four. `scopes` is validated fail-closed against the RFC 0049
 * PROTOCOL scopes at the route boundary (NOT the `host:` management scopes —
 * see `isProtocolScope`). Custom roles are NOT advertised via
 * capabilities.authorization (same posture as the built-ins).
 */
export interface CustomRole {
  roleId: string;
  orgId: string;
  tenantId: string;
  name: string;
  description?: string;
  scopes: Scope[];
  createdAt: string;
  updatedAt: string;
}

const orgs = new DurableCollection<Organization>('access-orgs', (o) => o.orgId);
const teams = new DurableCollection<Team>('access-teams', (t) => t.teamId);
const members = new DurableCollection<OrgMember>('access-members', (m) => m.memberId);
const groups = new DurableCollection<Group>('access-groups', (g) => g.groupId);
const customRoles = new DurableCollection<CustomRole>('access-custom-roles', (r) => r.roleId);

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48);
  return base.length > 0 ? base : 'org';
}

// ── Organizations ────────────────────────────────────────────────────────────

export async function createOrg(input: {
  tenantId: string;
  createdBy: string;
  name: string;
  description?: string;
}): Promise<Organization> {
  const now = nowIso();
  const org: Organization = {
    orgId: `org-${randomUUID().slice(0, 8)}`,
    tenantId: input.tenantId,
    name: input.name,
    slug: slugify(input.name),
    description: input.description,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  await orgs.put(org);
  return org;
}

export async function listOrgs(tenantId: string): Promise<Organization[]> {
  return (await orgs.list())
    .filter((o) => o.tenantId === tenantId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getOrg(orgId: string): Promise<Organization | null> {
  return orgs.get(orgId);
}

export async function updateOrg(
  orgId: string,
  patch: { name?: string; description?: string | null },
): Promise<Organization | null> {
  const org = await orgs.get(orgId);
  if (!org) return null;
  if (patch.name !== undefined) {
    org.name = patch.name;
    org.slug = slugify(patch.name);
  }
  if (patch.description !== undefined) {
    if (patch.description === null) delete org.description;
    else org.description = patch.description;
  }
  org.updatedAt = nowIso();
  await orgs.put(org);
  return org;
}

/** Delete an org and CASCADE its teams + members + groups (architect finding 7
 *  — no orphaned tenant-scoped rows). Returns the deleted counts. */
export async function deleteOrg(
  orgId: string,
): Promise<{ org: boolean; teams: number; members: number; groups: number; roles: number }> {
  const org = await orgs.get(orgId);
  if (!org) return { org: false, teams: 0, members: 0, groups: 0, roles: 0 };
  const orgTeams = (await teams.list()).filter((t) => t.orgId === orgId);
  const orgMembers = (await members.list()).filter((m) => m.orgId === orgId);
  const orgGroups = (await groups.list()).filter((g) => g.orgId === orgId);
  const orgRoles = (await customRoles.list()).filter((r) => r.orgId === orgId);
  for (const t of orgTeams) await teams.delete(t.teamId);
  for (const m of orgMembers) await members.delete(m.memberId);
  for (const g of orgGroups) await groups.delete(g.groupId);
  for (const r of orgRoles) await customRoles.delete(r.roleId);
  await orgs.delete(orgId);
  return { org: true, teams: orgTeams.length, members: orgMembers.length, groups: orgGroups.length, roles: orgRoles.length };
}

// ── Teams ─────────────────────────────────────────────────────────────────────

export async function createTeam(input: {
  orgId: string;
  tenantId: string;
  name: string;
  description?: string;
  color?: string;
}): Promise<Team> {
  const now = nowIso();
  const team: Team = {
    teamId: `team-${randomUUID().slice(0, 8)}`,
    orgId: input.orgId,
    tenantId: input.tenantId,
    name: input.name,
    description: input.description,
    color: input.color,
    createdAt: now,
    updatedAt: now,
  };
  await teams.put(team);
  return team;
}

export async function listTeams(tenantId: string, orgId: string): Promise<Team[]> {
  return (await teams.list())
    .filter((t) => t.tenantId === tenantId && t.orgId === orgId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getTeam(teamId: string): Promise<Team | null> {
  return teams.get(teamId);
}

export async function updateTeam(
  teamId: string,
  patch: { name?: string; description?: string | null; color?: string | null },
): Promise<Team | null> {
  const team = await teams.get(teamId);
  if (!team) return null;
  if (patch.name !== undefined) team.name = patch.name;
  if (patch.description !== undefined) {
    if (patch.description === null) delete team.description;
    else team.description = patch.description;
  }
  if (patch.color !== undefined) {
    if (patch.color === null) delete team.color;
    else team.color = patch.color;
  }
  team.updatedAt = nowIso();
  await teams.put(team);
  return team;
}

/** Delete a team and remove it from any member's `teamIds`. */
export async function deleteTeam(teamId: string): Promise<boolean> {
  const existed = await teams.delete(teamId);
  if (existed) {
    for (const m of (await members.list()).filter((m) => m.teamIds.includes(teamId))) {
      m.teamIds = m.teamIds.filter((id) => id !== teamId);
      m.updatedAt = nowIso();
      await members.put(m);
    }
  }
  return existed;
}

// ── Members ───────────────────────────────────────────────────────────────────

export async function createMember(input: {
  orgId: string;
  tenantId: string;
  displayName: string;
  subject?: string;
  email?: string;
  roles?: string[];
  teamIds?: string[];
}): Promise<OrgMember> {
  const now = nowIso();
  const member: OrgMember = {
    memberId: `mbr-${randomUUID().slice(0, 8)}`,
    orgId: input.orgId,
    tenantId: input.tenantId,
    subject: input.subject,
    displayName: input.displayName,
    email: input.email,
    roles: input.roles ? [...input.roles] : ['viewer'],
    teamIds: input.teamIds ? [...input.teamIds] : [],
    createdAt: now,
    updatedAt: now,
  };
  await members.put(member);
  return member;
}

export async function listMembers(tenantId: string, orgId: string): Promise<OrgMember[]> {
  return (await members.list())
    .filter((m) => m.tenantId === tenantId && m.orgId === orgId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getMember(memberId: string): Promise<OrgMember | null> {
  return members.get(memberId);
}

export async function updateMember(
  memberId: string,
  patch: { displayName?: string; email?: string | null; subject?: string | null; roles?: string[]; teamIds?: string[] },
): Promise<OrgMember | null> {
  const member = await members.get(memberId);
  if (!member) return null;
  if (patch.displayName !== undefined) member.displayName = patch.displayName;
  if (patch.email !== undefined) {
    if (patch.email === null) delete member.email;
    else member.email = patch.email;
  }
  if (patch.subject !== undefined) {
    if (patch.subject === null) delete member.subject;
    else member.subject = patch.subject;
  }
  if (patch.roles !== undefined) member.roles = [...patch.roles];
  if (patch.teamIds !== undefined) member.teamIds = [...patch.teamIds];
  member.updatedAt = nowIso();
  await members.put(member);
  return member;
}

/** Delete a member and remove it from any group's `memberIds`. */
export async function deleteMember(memberId: string): Promise<boolean> {
  const existed = await members.delete(memberId);
  if (existed) {
    for (const g of (await groups.list()).filter((g) => g.memberIds.includes(memberId))) {
      g.memberIds = g.memberIds.filter((id) => id !== memberId);
      g.updatedAt = nowIso();
      await groups.put(g);
    }
  }
  return existed;
}

// ── Groups (cross-cutting RBAC units) ──────────────────────────────────────────

export async function createGroup(input: {
  orgId: string;
  tenantId: string;
  name: string;
  description?: string;
  roles?: string[];
  memberIds?: string[];
}): Promise<Group> {
  const now = nowIso();
  const group: Group = {
    groupId: `grp-${randomUUID().slice(0, 8)}`,
    orgId: input.orgId,
    tenantId: input.tenantId,
    name: input.name,
    description: input.description,
    roles: input.roles ? [...input.roles] : [],
    memberIds: input.memberIds ? [...input.memberIds] : [],
    createdAt: now,
    updatedAt: now,
  };
  await groups.put(group);
  return group;
}

export async function listGroups(tenantId: string, orgId: string): Promise<Group[]> {
  return (await groups.list())
    .filter((g) => g.tenantId === tenantId && g.orgId === orgId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getGroup(groupId: string): Promise<Group | null> {
  return groups.get(groupId);
}

export async function updateGroup(
  groupId: string,
  patch: { name?: string; description?: string | null; roles?: string[]; memberIds?: string[] },
): Promise<Group | null> {
  const group = await groups.get(groupId);
  if (!group) return null;
  if (patch.name !== undefined) group.name = patch.name;
  if (patch.description !== undefined) {
    if (patch.description === null) delete group.description;
    else group.description = patch.description;
  }
  if (patch.roles !== undefined) group.roles = [...patch.roles];
  if (patch.memberIds !== undefined) group.memberIds = [...patch.memberIds];
  group.updatedAt = nowIso();
  await groups.put(group);
  return group;
}

export async function deleteGroup(groupId: string): Promise<boolean> {
  return groups.delete(groupId);
}

// ── Custom roles ───────────────────────────────────────────────────────────────

export async function createCustomRole(input: {
  orgId: string;
  tenantId: string;
  name: string;
  description?: string;
  scopes: Scope[];
}): Promise<CustomRole> {
  const now = nowIso();
  const role: CustomRole = {
    roleId: `role-${randomUUID().slice(0, 8)}`,
    orgId: input.orgId,
    tenantId: input.tenantId,
    name: input.name,
    description: input.description,
    scopes: [...new Set(input.scopes)],
    createdAt: now,
    updatedAt: now,
  };
  await customRoles.put(role);
  return role;
}

export async function listCustomRoles(tenantId: string, orgId: string): Promise<CustomRole[]> {
  return (await customRoles.list())
    .filter((r) => r.tenantId === tenantId && r.orgId === orgId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getCustomRole(roleId: string): Promise<CustomRole | null> {
  return customRoles.get(roleId);
}

export async function updateCustomRole(
  roleId: string,
  patch: { name?: string; description?: string | null; scopes?: Scope[] },
): Promise<CustomRole | null> {
  const role = await customRoles.get(roleId);
  if (!role) return null;
  if (patch.name !== undefined) role.name = patch.name;
  if (patch.description !== undefined) {
    if (patch.description === null) delete role.description;
    else role.description = patch.description;
  }
  if (patch.scopes !== undefined) role.scopes = [...new Set(patch.scopes)];
  role.updatedAt = nowIso();
  await customRoles.put(role);
  return role;
}

/** Delete a custom role and scrub it from every member's + group's `roles[]`
 *  in the same tenant (no dangling references). */
export async function deleteCustomRole(roleId: string): Promise<boolean> {
  const existed = await customRoles.delete(roleId);
  if (existed) {
    for (const m of (await members.list()).filter((m) => m.roles.includes(roleId))) {
      m.roles = m.roles.filter((r) => r !== roleId);
      m.updatedAt = nowIso();
      await members.put(m);
    }
    for (const g of (await groups.list()).filter((g) => g.roles.includes(roleId))) {
      g.roles = g.roles.filter((r) => r !== roleId);
      g.updatedAt = nowIso();
      await groups.put(g);
    }
  }
  return existed;
}

/** Resolve a set of role ids (built-in or custom) to a union of scopes against
 *  a custom-role lookup. Unknown ids are dropped — fail-closed. */
function unionScopes(roleIds: readonly string[], customById: ReadonlyMap<string, CustomRole>): Scope[] {
  const set = new Set<Scope>();
  for (const id of roleIds) {
    if (isBuiltInRoleId(id)) {
      for (const s of BUILT_IN_ROLES[id].scopes) set.add(s);
    } else {
      const cr = customById.get(id);
      if (cr) for (const s of cr.scopes) set.add(s);
    }
  }
  return [...set];
}

// ── Effective-access resolution ───────────────────────────────────────────────

export interface EffectiveAccess {
  /** Resolved role ids that applied (direct ∪ group-derived; built-in or custom). */
  roles: string[];
  /** Union of scopes granted by those roles. */
  scopes: Scope[];
  /** How the resolution was reached — for the UI + audit clarity. */
  basis: 'tenant-owner' | 'member' | 'none';
  /** The member the resolution matched, when basis === 'member'. */
  memberId?: string;
  /** Roles assigned directly on the member (provenance, when basis === 'member'). */
  directRoles?: string[];
  /** Roles inherited via group membership (provenance, when basis === 'member'). */
  groupRoles?: string[];
}

/**
 * Resolve the effective access for a principal acting in a tenant.
 *
 * FAIL-CLOSED (RFC 0049): if a specific member is requested (by memberId or
 * subject) and not found, the result is empty (`none`). Authority is computed
 * ONLY from the member's explicit `roles[]` plus the roles of any GROUP it
 * belongs to — NEVER from org-chart position (RFC 0087 §B). The org-chart is
 * not consulted here at all.
 *
 * Tenant-owner exception: when no member context is supplied, the caller is
 * the tenant's own principal (tenant == principal in this demo host) and is
 * implicitly `owner`. See the file header for the multi-principal caveat.
 */
export async function resolveEffectiveAccess(
  tenantId: string,
  opts: { memberId?: string; subject?: string } = {},
): Promise<EffectiveAccess> {
  if (opts.memberId !== undefined || opts.subject !== undefined) {
    const all = await members.list();
    const member = all.find(
      (m) =>
        m.tenantId === tenantId &&
        (opts.memberId !== undefined ? m.memberId === opts.memberId : m.subject === opts.subject),
    );
    if (!member) return { roles: [], scopes: [], basis: 'none' };
    // Custom roles defined in this member's org, for scope resolution.
    const orgCustom = (await customRoles.list()).filter((r) => r.tenantId === tenantId && r.orgId === member.orgId);
    const customById = new Map(orgCustom.map((r) => [r.roleId, r]));
    const directRoles = [...member.roles];
    // Roles inherited via group membership (batch permission management).
    const memberGroups = (await groups.list()).filter(
      (g) => g.tenantId === tenantId && g.memberIds.includes(member.memberId),
    );
    const groupRoles = [...new Set(memberGroups.flatMap((g) => g.roles))];
    const roles = [...new Set([...directRoles, ...groupRoles])];
    return { roles, scopes: unionScopes(roles, customById), basis: 'member', memberId: member.memberId, directRoles, groupRoles };
  }
  // No member context → the tenant owner principal, implicitly `owner`.
  return { roles: ['owner'], scopes: [...OWNER_SCOPES], basis: 'tenant-owner' };
}

// ── Test-only resets ───────────────────────────────────────────────────────────

export async function __resetAccessStores(): Promise<void> {
  await orgs.__clear();
  await teams.__clear();
  await members.__clear();
  await groups.__clear();
  await customRoles.__clear();
}
