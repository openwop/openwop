/**
 * Organizations / teams / members + roles — host-extension routes
 * (sample-grade, NON-NORMATIVE). Surface under /v1/host/sample/*:
 *
 *   GET    /roles                         built-in role catalog (role → scopes)
 *   GET    /access/effective[?memberId|?subject]  resolve effective access
 *   GET    /orgs                          list the caller's orgs (tenant-scoped)
 *   POST   /orgs                          create an org              [host:org:manage]
 *   GET    /orgs/:orgId                   one org
 *   PATCH  /orgs/:orgId                   rename / edit              [host:org:manage]
 *   DELETE /orgs/:orgId                   delete (cascades teams+members) [host:org:manage]
 *   GET    /orgs/:orgId/teams             list teams
 *   POST   /orgs/:orgId/teams             create a team              [host:teams:manage]
 *   PATCH  /orgs/:orgId/teams/:teamId     edit                       [host:teams:manage]
 *   DELETE /orgs/:orgId/teams/:teamId     delete                     [host:teams:manage]
 *   GET    /orgs/:orgId/members           list members
 *   POST   /orgs/:orgId/members           add a member               [host:members:manage]
 *   PATCH  /orgs/:orgId/members/:memberId edit roles/teams/identity  [host:members:manage]
 *   DELETE /orgs/:orgId/members/:memberId remove                     [host:members:manage]
 *   GET    /orgs/:orgId/groups            list groups
 *   POST   /orgs/:orgId/groups            create a group (roles+members) [host:groups:manage]
 *   PATCH  /orgs/:orgId/groups/:groupId   edit roles/members          [host:groups:manage]
 *   DELETE /orgs/:orgId/groups/:groupId   delete                      [host:groups:manage]
 *
 * Tenant-scoped per entity: every by-id read/write verifies the stored row's
 * tenantId matches the caller's tenant (404 otherwise) — the IDOR guard
 * (architect finding 2). Nested team/member routes additionally verify the
 * row's orgId matches the path :orgId so a valid-but-foreign id can't be
 * addressed through another org.
 *
 * Enforcement is INCREMENTAL: `requireScope` gates the management mutations
 * here. It is NOT yet wired onto the protocol runs/artifacts paths, so the
 * host deliberately does NOT advertise capabilities.authorization (RFC 0049) —
 * advertising authz it doesn't enforce on the protocol surface would be a
 * false authorization-oracle (architect finding 1).
 *
 * @see src/host/accessControlService.ts
 * @see RFCS/0049 (RBAC scopes), RFCS/0087 §B (org position confers no authority)
 */

import type { Express, Request } from 'express';
import { OpenwopError } from '../types.js';
import {
  BUILT_IN_ROLES,
  BUILT_IN_ROLE_IDS,
  isBuiltInRoleId,
  resolveEffectiveAccess,
  createOrg,
  listOrgs,
  getOrg,
  updateOrg,
  deleteOrg,
  createTeam,
  listTeams,
  getTeam,
  updateTeam,
  deleteTeam,
  createMember,
  listMembers,
  getMember,
  updateMember,
  deleteMember,
  createGroup,
  listGroups,
  getGroup,
  updateGroup,
  deleteGroup,
  type BuiltInRoleId,
  type Scope,
} from '../host/accessControlService.js';

function tenantOf(req: Request): string {
  return (req as { tenantId?: string }).tenantId ?? 'default';
}

/**
 * Gate a management mutation on a scope. Resolves the caller's effective
 * access (no member context ⇒ the tenant owner principal, implicitly `owner`)
 * and 403s when the scope is absent. Fail-closed.
 */
async function requireScope(req: Request, scope: Scope): Promise<void> {
  const access = await resolveEffectiveAccess(tenantOf(req));
  if (!access.scopes.includes(scope)) {
    throw new OpenwopError('forbidden_scope', `Missing required scope: ${scope}`, 403, { requiredScope: scope });
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new OpenwopError('validation_error', `Field \`${field}\` is required and MUST be a non-empty string.`, 400, { field });
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new OpenwopError('validation_error', `Field \`${field}\` MUST be a string.`, 400, { field });
  }
  return value;
}

/** `string` → set, `null`/'' → clear, `undefined` → leave. */
function patchString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new OpenwopError('validation_error', `Field \`${field}\` MUST be a string, null, or omitted.`, 400, { field });
  }
  return value;
}

/** Validate a `roles` array against the built-in catalog (fail-closed: unknown
 *  ids are rejected at the boundary so the stored member only carries valid
 *  roles; the resolver also drops unknowns defensively). */
function parseRoles(value: unknown): BuiltInRoleId[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new OpenwopError('validation_error', 'Field `roles` MUST be an array of role ids.', 400, { field: 'roles' });
  }
  const out: BuiltInRoleId[] = [];
  for (const r of value) {
    if (!isBuiltInRoleId(r)) {
      throw new OpenwopError('validation_error', `Unknown role id \`${String(r)}\`. Valid: ${BUILT_IN_ROLE_IDS.join(', ')}.`, 400, {
        field: 'roles',
        valid: BUILT_IN_ROLE_IDS,
      });
    }
    out.push(r);
  }
  return out;
}

function parseTeamIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((t) => typeof t === 'string')) {
    throw new OpenwopError('validation_error', 'Field `teamIds` MUST be an array of team ids.', 400, { field: 'teamIds' });
  }
  return value as string[];
}

function parseMemberIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((m) => typeof m === 'string')) {
    throw new OpenwopError('validation_error', 'Field `memberIds` MUST be an array of member ids.', 400, { field: 'memberIds' });
  }
  return value as string[];
}

/** Load an org owned by the caller's tenant, or throw 404 (IDOR guard). */
async function loadOrgOwned(req: Request, orgId: string) {
  const org = await getOrg(orgId);
  if (!org || org.tenantId !== tenantOf(req)) {
    throw new OpenwopError('not_found', 'Organization not found.', 404, { orgId });
  }
  return org;
}

export function registerAccessControlRoutes(app: Express): void {
  // ── Role catalog (read-only) ──
  app.get('/v1/host/sample/roles', (_req, res) => {
    res.json({ roles: BUILT_IN_ROLE_IDS.map((id) => BUILT_IN_ROLES[id]) });
  });

  // ── Effective access ──
  app.get('/v1/host/sample/access/effective', async (req, res, next) => {
    try {
      const memberId = typeof req.query.memberId === 'string' ? req.query.memberId : undefined;
      const subject = typeof req.query.subject === 'string' ? req.query.subject : undefined;
      const access = await resolveEffectiveAccess(tenantOf(req), { memberId, subject });
      res.json(access);
    } catch (err) {
      next(err);
    }
  });

  // ── Organizations ──
  app.get('/v1/host/sample/orgs', async (req, res, next) => {
    try {
      res.json({ orgs: await listOrgs(tenantOf(req)) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/v1/host/sample/orgs', async (req, res, next) => {
    try {
      await requireScope(req, 'host:org:manage');
      const body = (req.body ?? {}) as { name?: unknown; description?: unknown };
      const name = requireString(body.name, 'name');
      const org = await createOrg({
        tenantId: tenantOf(req),
        createdBy: tenantOf(req),
        name,
        description: optionalString(body.description, 'description'),
      });
      res.status(201).json(org);
    } catch (err) {
      next(err);
    }
  });

  app.get('/v1/host/sample/orgs/:orgId', async (req, res, next) => {
    try {
      res.json(await loadOrgOwned(req, req.params.orgId));
    } catch (err) {
      next(err);
    }
  });

  app.patch('/v1/host/sample/orgs/:orgId', async (req, res, next) => {
    try {
      await loadOrgOwned(req, req.params.orgId);
      await requireScope(req, 'host:org:manage');
      const body = (req.body ?? {}) as { name?: unknown; description?: unknown };
      const updated = await updateOrg(req.params.orgId, {
        name: optionalString(body.name, 'name'),
        description: patchString(body.description, 'description'),
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/v1/host/sample/orgs/:orgId', async (req, res, next) => {
    try {
      await loadOrgOwned(req, req.params.orgId);
      await requireScope(req, 'host:org:manage');
      const counts = await deleteOrg(req.params.orgId);
      res.status(200).json({ deleted: counts });
    } catch (err) {
      next(err);
    }
  });

  // ── Teams (nested under an org) ──
  app.get('/v1/host/sample/orgs/:orgId/teams', async (req, res, next) => {
    try {
      await loadOrgOwned(req, req.params.orgId);
      res.json({ teams: await listTeams(tenantOf(req), req.params.orgId) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/v1/host/sample/orgs/:orgId/teams', async (req, res, next) => {
    try {
      await loadOrgOwned(req, req.params.orgId);
      await requireScope(req, 'host:teams:manage');
      const body = (req.body ?? {}) as { name?: unknown; description?: unknown; color?: unknown };
      const team = await createTeam({
        orgId: req.params.orgId,
        tenantId: tenantOf(req),
        name: requireString(body.name, 'name'),
        description: optionalString(body.description, 'description'),
        color: optionalString(body.color, 'color'),
      });
      res.status(201).json(team);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/v1/host/sample/orgs/:orgId/teams/:teamId', async (req, res, next) => {
    try {
      await loadOrgOwned(req, req.params.orgId);
      await requireScope(req, 'host:teams:manage');
      const team = await getTeam(req.params.teamId);
      if (!team || team.tenantId !== tenantOf(req) || team.orgId !== req.params.orgId) {
        throw new OpenwopError('not_found', 'Team not found.', 404, { teamId: req.params.teamId });
      }
      const body = (req.body ?? {}) as { name?: unknown; description?: unknown; color?: unknown };
      const updated = await updateTeam(req.params.teamId, {
        name: optionalString(body.name, 'name'),
        description: patchString(body.description, 'description'),
        color: patchString(body.color, 'color'),
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/v1/host/sample/orgs/:orgId/teams/:teamId', async (req, res, next) => {
    try {
      await loadOrgOwned(req, req.params.orgId);
      await requireScope(req, 'host:teams:manage');
      const team = await getTeam(req.params.teamId);
      if (!team || team.tenantId !== tenantOf(req) || team.orgId !== req.params.orgId) {
        throw new OpenwopError('not_found', 'Team not found.', 404, { teamId: req.params.teamId });
      }
      await deleteTeam(req.params.teamId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // ── Members (nested under an org) ──
  app.get('/v1/host/sample/orgs/:orgId/members', async (req, res, next) => {
    try {
      await loadOrgOwned(req, req.params.orgId);
      res.json({ members: await listMembers(tenantOf(req), req.params.orgId) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/v1/host/sample/orgs/:orgId/members', async (req, res, next) => {
    try {
      await loadOrgOwned(req, req.params.orgId);
      await requireScope(req, 'host:members:manage');
      const body = (req.body ?? {}) as {
        displayName?: unknown;
        subject?: unknown;
        email?: unknown;
        roles?: unknown;
        teamIds?: unknown;
      };
      const member = await createMember({
        orgId: req.params.orgId,
        tenantId: tenantOf(req),
        displayName: requireString(body.displayName, 'displayName'),
        subject: optionalString(body.subject, 'subject'),
        email: optionalString(body.email, 'email'),
        roles: parseRoles(body.roles),
        teamIds: parseTeamIds(body.teamIds),
      });
      res.status(201).json(member);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/v1/host/sample/orgs/:orgId/members/:memberId', async (req, res, next) => {
    try {
      await loadOrgOwned(req, req.params.orgId);
      await requireScope(req, 'host:members:manage');
      const member = await getMember(req.params.memberId);
      if (!member || member.tenantId !== tenantOf(req) || member.orgId !== req.params.orgId) {
        throw new OpenwopError('not_found', 'Member not found.', 404, { memberId: req.params.memberId });
      }
      const body = (req.body ?? {}) as {
        displayName?: unknown;
        email?: unknown;
        subject?: unknown;
        roles?: unknown;
        teamIds?: unknown;
      };
      const updated = await updateMember(req.params.memberId, {
        displayName: optionalString(body.displayName, 'displayName'),
        email: patchString(body.email, 'email'),
        subject: patchString(body.subject, 'subject'),
        roles: parseRoles(body.roles),
        teamIds: parseTeamIds(body.teamIds),
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/v1/host/sample/orgs/:orgId/members/:memberId', async (req, res, next) => {
    try {
      await loadOrgOwned(req, req.params.orgId);
      await requireScope(req, 'host:members:manage');
      const member = await getMember(req.params.memberId);
      if (!member || member.tenantId !== tenantOf(req) || member.orgId !== req.params.orgId) {
        throw new OpenwopError('not_found', 'Member not found.', 404, { memberId: req.params.memberId });
      }
      await deleteMember(req.params.memberId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // ── Groups (cross-cutting RBAC units carrying roles) ──
  app.get('/v1/host/sample/orgs/:orgId/groups', async (req, res, next) => {
    try {
      await loadOrgOwned(req, req.params.orgId);
      res.json({ groups: await listGroups(tenantOf(req), req.params.orgId) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/v1/host/sample/orgs/:orgId/groups', async (req, res, next) => {
    try {
      await loadOrgOwned(req, req.params.orgId);
      await requireScope(req, 'host:groups:manage');
      const body = (req.body ?? {}) as { name?: unknown; description?: unknown; roles?: unknown; memberIds?: unknown };
      const group = await createGroup({
        orgId: req.params.orgId,
        tenantId: tenantOf(req),
        name: requireString(body.name, 'name'),
        description: optionalString(body.description, 'description'),
        roles: parseRoles(body.roles),
        memberIds: parseMemberIds(body.memberIds),
      });
      res.status(201).json(group);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/v1/host/sample/orgs/:orgId/groups/:groupId', async (req, res, next) => {
    try {
      await loadOrgOwned(req, req.params.orgId);
      await requireScope(req, 'host:groups:manage');
      const group = await getGroup(req.params.groupId);
      if (!group || group.tenantId !== tenantOf(req) || group.orgId !== req.params.orgId) {
        throw new OpenwopError('not_found', 'Group not found.', 404, { groupId: req.params.groupId });
      }
      const body = (req.body ?? {}) as { name?: unknown; description?: unknown; roles?: unknown; memberIds?: unknown };
      const updated = await updateGroup(req.params.groupId, {
        name: optionalString(body.name, 'name'),
        description: patchString(body.description, 'description'),
        roles: parseRoles(body.roles),
        memberIds: parseMemberIds(body.memberIds),
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/v1/host/sample/orgs/:orgId/groups/:groupId', async (req, res, next) => {
    try {
      await loadOrgOwned(req, req.params.orgId);
      await requireScope(req, 'host:groups:manage');
      const group = await getGroup(req.params.groupId);
      if (!group || group.tenantId !== tenantOf(req) || group.orgId !== req.params.orgId) {
        throw new OpenwopError('not_found', 'Group not found.', 404, { groupId: req.params.groupId });
      }
      await deleteGroup(req.params.groupId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });
}
