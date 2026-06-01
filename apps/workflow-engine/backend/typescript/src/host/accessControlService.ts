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
export const MANAGEMENT_SCOPES = ['host:org:manage', 'host:teams:manage', 'host:members:manage'] as const;

export type Scope = (typeof PROTOCOL_SCOPES)[number] | (typeof MANAGEMENT_SCOPES)[number];

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
];
const OWNER_SCOPES: Scope[] = [...ADMIN_SCOPES, 'host:org:manage'];

export const BUILT_IN_ROLES: Record<BuiltInRoleId, AccessRole> = {
  viewer: { id: 'viewer', name: 'Viewer', description: 'Read-only access to runs, artifacts, audit, and workspace.', scopes: VIEWER_SCOPES, builtIn: true },
  editor: { id: 'editor', name: 'Editor', description: 'Create and cancel runs, write workspace, respond to approvals.', scopes: EDITOR_SCOPES, builtIn: true },
  admin: { id: 'admin', name: 'Admin', description: 'Editor plus webhook/pack management and team/member administration.', scopes: ADMIN_SCOPES, builtIn: true },
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
  roles: BuiltInRoleId[];
  teamIds: string[];
  createdAt: string;
  updatedAt: string;
}

const orgs = new DurableCollection<Organization>('access-orgs', (o) => o.orgId);
const teams = new DurableCollection<Team>('access-teams', (t) => t.teamId);
const members = new DurableCollection<OrgMember>('access-members', (m) => m.memberId);

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

/** Delete an org and CASCADE its teams + members (architect finding 7 — no
 *  orphaned tenant-scoped rows). Returns the deleted counts. */
export async function deleteOrg(orgId: string): Promise<{ org: boolean; teams: number; members: number }> {
  const org = await orgs.get(orgId);
  if (!org) return { org: false, teams: 0, members: 0 };
  const orgTeams = (await teams.list()).filter((t) => t.orgId === orgId);
  const orgMembers = (await members.list()).filter((m) => m.orgId === orgId);
  for (const t of orgTeams) await teams.delete(t.teamId);
  for (const m of orgMembers) await members.delete(m.memberId);
  await orgs.delete(orgId);
  return { org: true, teams: orgTeams.length, members: orgMembers.length };
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
  roles?: BuiltInRoleId[];
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
  patch: { displayName?: string; email?: string | null; subject?: string | null; roles?: BuiltInRoleId[]; teamIds?: string[] },
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

export async function deleteMember(memberId: string): Promise<boolean> {
  return members.delete(memberId);
}

// ── Effective-access resolution ───────────────────────────────────────────────

export interface EffectiveAccess {
  /** Resolved role ids that applied. */
  roles: BuiltInRoleId[];
  /** Union of scopes granted by those roles. */
  scopes: Scope[];
  /** How the resolution was reached — for the UI + audit clarity. */
  basis: 'tenant-owner' | 'member' | 'none';
  /** The member the resolution matched, when basis === 'member'. */
  memberId?: string;
}

/**
 * Resolve the effective access for a principal acting in a tenant.
 *
 * FAIL-CLOSED (RFC 0049): if a specific member is requested (by memberId or
 * subject) and not found, the result is empty (`none`). Authority is computed
 * ONLY from the member's explicit `roles[]` — NEVER from org-chart position
 * (RFC 0087 §B). The org-chart is not consulted here at all.
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
    const roles = member.roles.filter(isBuiltInRoleId);
    return { roles, scopes: scopesForRoles(roles), basis: 'member', memberId: member.memberId };
  }
  // No member context → the tenant owner principal, implicitly `owner`.
  return { roles: ['owner'], scopes: [...OWNER_SCOPES], basis: 'tenant-owner' };
}

// ── Test-only resets ───────────────────────────────────────────────────────────

export async function __resetAccessStores(): Promise<void> {
  await orgs.__clear();
  await teams.__clear();
  await members.__clear();
}
