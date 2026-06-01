/**
 * Organizations / teams / members + roles — host-extension (non-normative).
 *
 * Two layers:
 *   1. HTTP integration over /v1/host/sample/{roles,access,orgs,...} — CRUD,
 *      validation, cascade delete, effective-access, scope-gated mutations.
 *   2. Service-level unit tests for the protocol-safety guardrails the
 *      architect review called out: tenant isolation, fail-closed resolution,
 *      and decoupling from the descriptive org-chart (RFC 0087 §B — org
 *      position confers no authority).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createApp } from '../src/index.js';
import {
  resolveEffectiveAccess,
  scopesForRoles,
  createOrg,
  listOrgs,
  getOrg,
  createMember,
  createGroup,
  __resetAccessStores,
  BUILT_IN_ROLES,
} from '../src/host/accessControlService.js';

let server: http.Server;
const PORT = 18244;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'sample-token';

beforeAll(async () => {
  process.env.OPENWOP_STORAGE_DSN = 'memory://';
  const app = await createApp({
    port: PORT,
    storageDsn: 'memory://',
    serviceName: 'test',
    serviceVersion: '0.0.1',
    enableConsoleTracer: false,
  });
  await new Promise<void>((res) => {
    server = app.listen(PORT, res);
  });
});

afterAll(async () => {
  await new Promise<void>((res) => server.close(() => res()));
});

async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  return { status: res.status, body: (text.length ? JSON.parse(text) : null) as T };
}

interface Org { orgId: string; name: string; slug: string; tenantId: string }
interface Team { teamId: string; orgId: string; name: string }
interface Member { memberId: string; orgId: string; displayName: string; roles: string[]; teamIds: string[] }

describe('access-control host-extension — HTTP', () => {
  it('serves the built-in role catalog mapping roles to RFC 0049 scopes', async () => {
    const res = await api<{ roles: Array<{ id: string; scopes: string[] }> }>('/v1/host/sample/roles');
    expect(res.status).toBe(200);
    const ids = res.body.roles.map((r) => r.id);
    expect(ids).toEqual(['viewer', 'editor', 'admin', 'owner']);
    const viewer = res.body.roles.find((r) => r.id === 'viewer')!;
    expect(viewer.scopes).toContain('runs:read');
    expect(viewer.scopes).not.toContain('runs:create');
    const owner = res.body.roles.find((r) => r.id === 'owner')!;
    expect(owner.scopes).toContain('host:org:manage');
  });

  it('creates, lists, fetches, patches, and cascade-deletes an org with teams + members', async () => {
    const created = await api<Org>('/v1/host/sample/orgs', { method: 'POST', body: JSON.stringify({ name: 'Acme Inc' }) });
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe('acme-inc');
    const orgId = created.body.orgId;

    const team = await api<Team>(`/v1/host/sample/orgs/${orgId}/teams`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Growth', color: '#abc' }),
    });
    expect(team.status).toBe(201);

    const member = await api<Member>(`/v1/host/sample/orgs/${orgId}/members`, {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Dana', email: 'dana@acme.test', roles: ['editor'], teamIds: [team.body.teamId] }),
    });
    expect(member.status).toBe(201);
    expect(member.body.roles).toEqual(['editor']);

    const list = await api<{ orgs: Org[] }>('/v1/host/sample/orgs');
    expect(list.body.orgs.some((o) => o.orgId === orgId)).toBe(true);

    const patched = await api<Org>(`/v1/host/sample/orgs/${orgId}`, { method: 'PATCH', body: JSON.stringify({ name: 'Acme Corp' }) });
    expect(patched.body.slug).toBe('acme-corp');

    const del = await api<{ deleted: { teams: number; members: number } }>(`/v1/host/sample/orgs/${orgId}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(del.body.deleted.teams).toBe(1);
    expect(del.body.deleted.members).toBe(1);

    const gone = await api(`/v1/host/sample/orgs/${orgId}`);
    expect(gone.status).toBe(404);
  });

  it('rejects an unknown role id at the boundary (fail-closed)', async () => {
    const org = await api<Org>('/v1/host/sample/orgs', { method: 'POST', body: JSON.stringify({ name: 'RoleTest' }) });
    const bad = await api(`/v1/host/sample/orgs/${org.body.orgId}/members`, {
      method: 'POST',
      body: JSON.stringify({ displayName: 'X', roles: ['superuser'] }),
    });
    expect(bad.status).toBe(400);
  });

  it('effective access defaults to the implicit tenant owner; a member preview resolves that member\'s roles', async () => {
    const mine = await api<{ basis: string; roles: string[]; scopes: string[] }>('/v1/host/sample/access/effective');
    expect(mine.body.basis).toBe('tenant-owner');
    expect(mine.body.roles).toEqual(['owner']);

    const org = await api<Org>('/v1/host/sample/orgs', { method: 'POST', body: JSON.stringify({ name: 'Preview Co' }) });
    const m = await api<Member>(`/v1/host/sample/orgs/${org.body.orgId}/members`, {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Read Only', subject: 'subj-ro', roles: ['viewer'] }),
    });
    const preview = await api<{ basis: string; roles: string[]; scopes: string[] }>(
      `/v1/host/sample/access/effective?memberId=${m.body.memberId}`,
    );
    expect(preview.body.basis).toBe('member');
    expect(preview.body.roles).toEqual(['viewer']);
    expect(preview.body.scopes).toContain('runs:read');
    expect(preview.body.scopes).not.toContain('runs:create');
  });

  it('groups carry roles and grant them to members (batch RBAC, group-derived scopes)', async () => {
    const org = await api<Org>('/v1/host/sample/orgs', { method: 'POST', body: JSON.stringify({ name: 'Group Co' }) });
    const orgId = org.body.orgId;
    // A member with NO direct role beyond viewer.
    const m = await api<Member>(`/v1/host/sample/orgs/${orgId}/members`, {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Grace', roles: ['viewer'] }),
    });
    // A group that carries `editor` and contains the member.
    const grp = await api<{ groupId: string; roles: string[]; memberIds: string[] }>(
      `/v1/host/sample/orgs/${orgId}/groups`,
      { method: 'POST', body: JSON.stringify({ name: 'Editors', roles: ['editor'], memberIds: [m.body.memberId] }) },
    );
    expect(grp.status).toBe(201);

    const list = await api<{ groups: Array<{ groupId: string }> }>(`/v1/host/sample/orgs/${orgId}/groups`);
    expect(list.body.groups.some((g) => g.groupId === grp.body.groupId)).toBe(true);

    // Effective access now unions direct (viewer) + group (editor) → editor scopes.
    const eff = await api<{ roles: string[]; scopes: string[]; directRoles: string[]; groupRoles: string[] }>(
      `/v1/host/sample/access/effective?memberId=${m.body.memberId}`,
    );
    expect(eff.body.directRoles).toEqual(['viewer']);
    expect(eff.body.groupRoles).toContain('editor');
    expect(eff.body.scopes).toContain('runs:create'); // came from the group, not the direct role
  });

  it('404s a foreign/unknown orgId rather than leaking it', async () => {
    const res = await api('/v1/host/sample/orgs/org-doesnotexist');
    expect(res.status).toBe(404);
  });
});

describe('access-control — protocol-safety guardrails (service unit)', () => {
  beforeAll(async () => {
    await __resetAccessStores();
  });

  it('isolates orgs by tenant (no cross-tenant listing)', async () => {
    const a = await createOrg({ tenantId: 'iso-A', createdBy: 'iso-A', name: 'A Org' });
    await createOrg({ tenantId: 'iso-B', createdBy: 'iso-B', name: 'B Org' });
    const listA = await listOrgs('iso-A');
    expect(listA.map((o) => o.orgId)).toEqual([a.orgId]);
    // The store returns the row by id, but routes gate on tenant — the row
    // itself carries the owning tenant so a route can 404 a foreign read.
    expect((await getOrg(a.orgId))!.tenantId).toBe('iso-A');
  });

  it('resolves scopes ONLY from explicit member.roles, fail-closed on no match', async () => {
    const org = await createOrg({ tenantId: 'iso-C', createdBy: 'iso-C', name: 'C Org' });
    await createMember({ orgId: org.orgId, tenantId: 'iso-C', displayName: 'Ed', subject: 'ed@c', roles: ['editor'] });

    // Matched subject → that member's role scopes.
    const matched = await resolveEffectiveAccess('iso-C', { subject: 'ed@c' });
    expect(matched.basis).toBe('member');
    expect(matched.scopes).toContain('runs:create');

    // Unknown subject → zero scopes (fail-closed), NOT owner.
    const miss = await resolveEffectiveAccess('iso-C', { subject: 'nobody@c' });
    expect(miss.basis).toBe('none');
    expect(miss.scopes).toEqual([]);
  });

  it('drops unknown role ids when computing scopes (fail-closed union)', () => {
    const scopes = scopesForRoles(['viewer', 'not-a-role']);
    expect(scopes).toContain('runs:read');
    // No scope from the unknown role; viewer-only set, no escalation.
    expect(scopes).not.toContain('runs:create');
    expect(scopes.length).toBe(BUILT_IN_ROLES.viewer.scopes.length);
  });

  it('decoupling: resolver never consults org-chart — same member.roles → same scopes regardless of any org structure (RFC 0087 §B)', async () => {
    const org = await createOrg({ tenantId: 'iso-D', createdBy: 'iso-D', name: 'D Org' });
    const m = await createMember({ orgId: org.orgId, tenantId: 'iso-D', displayName: 'Mgr', subject: 'mgr@d', roles: ['viewer'] });
    // The resolver reads member.roles exclusively; there is no input by which
    // an org-chart reportsTo/manager edge could widen this. A 'viewer' resolves
    // to viewer scopes, period — no authority from position.
    const access = await resolveEffectiveAccess('iso-D', { memberId: m.memberId });
    expect(access.scopes.sort()).toEqual([...BUILT_IN_ROLES.viewer.scopes].sort());
  });

  it('unions group-carried roles into a member\'s effective access (and stays tenant-scoped)', async () => {
    const org = await createOrg({ tenantId: 'iso-E', createdBy: 'iso-E', name: 'E Org' });
    const m = await createMember({ orgId: org.orgId, tenantId: 'iso-E', displayName: 'Gina', subject: 'gina@e', roles: ['viewer'] });
    await createGroup({ orgId: org.orgId, tenantId: 'iso-E', name: 'Admins', roles: ['admin'], memberIds: [m.memberId] });
    // A group in ANOTHER tenant must not leak its roles in.
    await createGroup({ orgId: org.orgId, tenantId: 'iso-OTHER', name: 'Foreign', roles: ['owner'], memberIds: [m.memberId] });

    const eff = await resolveEffectiveAccess('iso-E', { memberId: m.memberId });
    expect(eff.directRoles).toEqual(['viewer']);
    expect(eff.groupRoles).toContain('admin');
    expect(eff.groupRoles).not.toContain('owner'); // foreign-tenant group ignored
    expect(eff.scopes).toContain('webhooks:manage'); // admin-only, via the group
    expect(eff.scopes).not.toContain('host:org:manage'); // owner-only, correctly absent
  });
});
