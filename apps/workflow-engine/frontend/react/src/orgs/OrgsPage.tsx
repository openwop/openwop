/**
 * Organizations / teams / members + roles — management UI for the
 * access-control host-extension (non-normative).
 *
 * Left: the caller's organizations + a create form. Right: the selected org's
 * teams and members, with per-member role assignment, an effective-access
 * preview (principal → roles → RFC 0049 scopes), and the built-in role catalog
 * for reference.
 *
 * Authority shown here resolves ONLY from a member's explicit roles — never
 * from the descriptive org-chart (RFC 0087 §B). This surface manages WHO has
 * WHICH role; it does not enforce on the protocol runs/artifacts paths yet, so
 * the host does not advertise capabilities.authorization.
 *
 * @see ../client/accessClient.ts
 */
import { useCallback, useEffect, useState } from 'react';
import { Notice } from '../ui/Notice.js';
import { StateCard } from '../ui/StateCard.js';
import { PageHeader } from '../ui/PageHeader.js';
import { BriefcaseIcon, ColumnsIcon, LockIcon, PencilIcon, ShieldIcon, TrashIcon, UserIcon } from '../ui/icons/index.js';
import {
  type AccessRole,
  type BuiltInRoleId,
  type CustomRole,
  type EffectiveAccess,
  type Group,
  type Organization,
  type OrgMember,
  type Team,
  createCustomRole,
  createGroup,
  setActingMember,
  createMember,
  createOrg,
  createTeam,
  deleteCustomRole,
  deleteGroup,
  deleteMember,
  deleteOrg,
  deleteTeam,
  getEffectiveAccess,
  listGroups,
  listMembers,
  listOrgRoles,
  listOrgs,
  listRoles,
  listTeams,
  updateGroup,
  updateMember,
} from '../client/accessClient.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: '0.85rem' };

/**
 * Roles, teams, and scopes are non-status LABEL dimensions, so per
 * DESIGN.app.md §5.3/§5.4 they differentiate by their text label — never by a
 * functional/accent color (those are reserved for run/agent/node status +
 * severity). Every such chip is the one neutral pill; selected/unselected in a
 * toggle is shown by opacity, not color.
 */
const NEUTRAL_CHIP = 'chip chip--muted';
const ALL_ROLES: BuiltInRoleId[] = ['viewer', 'editor', 'admin', 'owner'];

export function OrgsPage(): JSX.Element {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Create-org form.
  const [orgName, setOrgName] = useState('');
  // Create-team form.
  const [teamName, setTeamName] = useState('');
  // Create-member form (role ids: built-in or custom).
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRoles, setMemberRoles] = useState<Set<string>>(new Set(['viewer']));

  // Inline per-member editor + access preview.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftRoles, setDraftRoles] = useState<Set<string>>(new Set());
  const [accessFor, setAccessFor] = useState<string | null>(null);
  const [access, setAccess] = useState<EffectiveAccess | null>(null);

  // Create-group form + inline group-membership editor.
  const [groupName, setGroupName] = useState('');
  const [groupRoles, setGroupRoles] = useState<Set<string>>(new Set(['editor']));
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [draftGroupMembers, setDraftGroupMembers] = useState<Set<string>>(new Set());

  // Create-custom-role form.
  const [roleName, setRoleName] = useState('');
  const [roleScopes, setRoleScopes] = useState<Set<string>>(new Set());

  // "View as member" enforcement seam: when set, the client sends
  // x-openwop-act-as and the backend enforces that member's scopes. viewScopes
  // drives which management actions are enabled.
  const [viewAs, setViewAs] = useState<string | null>(null);
  const [viewScopes, setViewScopes] = useState<Set<string>>(new Set());

  const fail = (err: unknown) => setError(err instanceof Error ? err.message : String(err));

  const loadOrgs = useCallback(async () => {
    try {
      const [o, r] = await Promise.all([listOrgs(), listRoles()]);
      setOrgs(o);
      setRoles(r);
      setError(null);
    } catch (err) {
      fail(err);
    }
  }, []);

  const loadOrgDetail = useCallback(async (orgId: string) => {
    try {
      const [t, m, g, r] = await Promise.all([listTeams(orgId), listMembers(orgId), listGroups(orgId), listOrgRoles(orgId)]);
      setTeams(t);
      setMembers(m);
      setGroups(g);
      setCustomRoles(r.customRoles);
      setError(null);
    } catch (err) {
      fail(err);
    }
  }, []);

  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  useEffect(() => {
    if (selectedOrgId) void loadOrgDetail(selectedOrgId);
  }, [selectedOrgId, loadOrgDetail]);

  // Switching orgs resets the "view as" lens — members are org-scoped, so a
  // lens from another org would be confusing. Back to owner (full access).
  useEffect(() => {
    setViewAs(null);
    setActingMember(null);
    setViewScopes(new Set());
  }, [selectedOrgId]);

  const selectedOrg = orgs.find((o) => o.orgId === selectedOrgId) ?? null;

  // ── Org actions ──
  const onCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim()) return;
    try {
      const org = await createOrg({ name: orgName.trim() });
      setOrgName('');
      await loadOrgs();
      setSelectedOrgId(org.orgId);
    } catch (err) {
      fail(err);
    }
  };

  const onDeleteOrg = async (org: Organization) => {
    if (!window.confirm(`Delete organization "${org.name}" and all its teams + members? This can't be undone.`)) return;
    try {
      await deleteOrg(org.orgId);
      if (selectedOrgId === org.orgId) setSelectedOrgId(null);
      await loadOrgs();
    } catch (err) {
      fail(err);
    }
  };

  // ── Team actions ──
  const onCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId || !teamName.trim()) return;
    try {
      await createTeam(selectedOrgId, { name: teamName.trim() });
      setTeamName('');
      await loadOrgDetail(selectedOrgId);
    } catch (err) {
      fail(err);
    }
  };

  const onDeleteTeam = async (team: Team) => {
    if (!selectedOrgId) return;
    if (!window.confirm(`Delete team "${team.name}"?`)) return;
    try {
      await deleteTeam(selectedOrgId, team.teamId);
      await loadOrgDetail(selectedOrgId);
    } catch (err) {
      fail(err);
    }
  };

  // ── Member actions ──
  const onCreateMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId || !memberName.trim()) return;
    try {
      await createMember(selectedOrgId, {
        displayName: memberName.trim(),
        ...(memberEmail.trim() ? { email: memberEmail.trim() } : {}),
        roles: [...memberRoles],
      });
      setMemberName('');
      setMemberEmail('');
      setMemberRoles(new Set(['viewer']));
      await loadOrgDetail(selectedOrgId);
    } catch (err) {
      fail(err);
    }
  };

  const startEdit = (m: OrgMember) => {
    setEditingId(m.memberId);
    setDraftRoles(new Set(m.roles));
    setAccessFor(null);
  };

  const onSaveRoles = async (m: OrgMember) => {
    if (!selectedOrgId) return;
    try {
      await updateMember(selectedOrgId, m.memberId, { roles: [...draftRoles] });
      setEditingId(null);
      await loadOrgDetail(selectedOrgId);
    } catch (err) {
      fail(err);
    }
  };

  const onDeleteMember = async (m: OrgMember) => {
    if (!selectedOrgId) return;
    if (!window.confirm(`Remove member "${m.displayName}"?`)) return;
    try {
      await deleteMember(selectedOrgId, m.memberId);
      await loadOrgDetail(selectedOrgId);
    } catch (err) {
      fail(err);
    }
  };

  const onShowAccess = async (m: OrgMember) => {
    if (accessFor === m.memberId) {
      setAccessFor(null);
      setAccess(null);
      return;
    }
    try {
      const ea = await getEffectiveAccess({ memberId: m.memberId });
      setAccess(ea);
      setAccessFor(m.memberId);
    } catch (err) {
      fail(err);
    }
  };

  // ── Group actions ──
  const toggleStr = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const onCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId || !groupName.trim()) return;
    try {
      await createGroup(selectedOrgId, { name: groupName.trim(), roles: [...groupRoles] });
      setGroupName('');
      setGroupRoles(new Set(['editor']));
      await loadOrgDetail(selectedOrgId);
    } catch (err) {
      fail(err);
    }
  };

  const onDeleteGroup = async (g: Group) => {
    if (!selectedOrgId) return;
    if (!window.confirm(`Delete group "${g.name}"? Members keep their direct roles.`)) return;
    try {
      await deleteGroup(selectedOrgId, g.groupId);
      await loadOrgDetail(selectedOrgId);
    } catch (err) {
      fail(err);
    }
  };

  const startEditGroup = (g: Group) => {
    setEditingGroupId(g.groupId);
    setDraftGroupMembers(new Set(g.memberIds));
  };

  const onSaveGroupMembers = async (g: Group) => {
    if (!selectedOrgId) return;
    try {
      await updateGroup(selectedOrgId, g.groupId, { memberIds: [...draftGroupMembers] });
      setEditingGroupId(null);
      await loadOrgDetail(selectedOrgId);
    } catch (err) {
      fail(err);
    }
  };

  const nameOfMember = (id: string): string => members.find((m) => m.memberId === id)?.displayName ?? id;

  // ── "View as member" enforcement lens ──
  const changeView = async (memberId: string | null) => {
    setViewAs(memberId);
    setActingMember(memberId);
    try {
      if (memberId === null) {
        setViewScopes(new Set());
      } else {
        const ea = await getEffectiveAccess({ memberId });
        setViewScopes(new Set(ea.scopes));
      }
      if (selectedOrgId) await loadOrgDetail(selectedOrgId);
    } catch (err) {
      fail(err);
    }
  };
  /** Is the current lens (owner, or the acted-as member) allowed this scope? */
  const can = (scope: string): boolean => viewAs === null || viewScopes.has(scope);

  // ── Role catalog helpers (built-in + custom) ──
  const isBuiltIn = (id: string): id is BuiltInRoleId => (ALL_ROLES as string[]).includes(id);
  const assignableRoleIds: string[] = [...ALL_ROLES, ...customRoles.map((r) => r.roleId)];
  const roleLabel = (id: string): string => (isBuiltIn(id) ? id : customRoles.find((r) => r.roleId === id)?.name ?? id);
  // Scopes assignable to a CUSTOM role: RFC 0049 protocol scopes only (the
  // `host:` management scopes are reserved to built-in admin/owner). Derived
  // from the owner role's scope set, filtered to the non-`host:` (protocol) ones.
  const assignableScopes: string[] = (roles.find((r) => r.id === 'owner')?.scopes ?? []).filter((s) => !s.startsWith('host:'));

  // ── Custom-role actions ──
  const onCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrgId || !roleName.trim() || roleScopes.size === 0) return;
    try {
      await createCustomRole(selectedOrgId, { name: roleName.trim(), scopes: [...roleScopes] });
      setRoleName('');
      setRoleScopes(new Set());
      await loadOrgDetail(selectedOrgId);
    } catch (err) {
      fail(err);
    }
  };

  const onDeleteRole = async (r: CustomRole) => {
    if (!selectedOrgId) return;
    if (!window.confirm(`Delete custom role "${r.name}"? It will be removed from any member or group that has it.`)) return;
    try {
      await deleteCustomRole(selectedOrgId, r.roleId);
      await loadOrgDetail(selectedOrgId);
    } catch (err) {
      fail(err);
    }
  };

  return (
    <section style={{ padding: '1rem', maxWidth: 1040 }}>
      <PageHeader
        eyebrow="Settings"
        title="Organizations & access"
        lede={<>Organizations, teams, and members with role-based access. Roles map to OpenWOP authorization scopes (RFC 0049); a member&rsquo;s authority comes from its assigned roles only — org-chart position confers none.</>}
      />
      {error ? <Notice variant="error">{error}</Notice> : null}

      <div style={{ display: 'flex', gap: 'var(--space-5)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* ── Left: orgs ── */}
        <div style={{ flex: '1 1 280px', minWidth: 260 }}>
          <h2 style={{ fontSize: '1rem' }}>Organizations</h2>
          <form onSubmit={onCreateOrg} className="action-bar" style={{ marginBottom: 'var(--space-3)' }}>
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="New organization name" aria-label="New organization name" />
            <button type="submit" className="primary" disabled={!orgName.trim() || !can('host:org:manage')} title={can('host:org:manage') ? undefined : 'Requires host:org:manage'}>Create</button>
          </form>
          {orgs.length === 0 ? (
            <StateCard icon={<BriefcaseIcon size={32} />} title="No organizations yet" body="Create one to add teams and members." />
          ) : (
            orgs.map((o) => (
              <div
                key={o.orgId}
                className="surface-card"
                style={{
                  marginBottom: 'var(--space-2)',
                  cursor: 'pointer',
                  borderColor: o.orgId === selectedOrgId ? 'var(--color-accent)' : undefined,
                }}
                onClick={() => setSelectedOrgId(o.orgId)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <BriefcaseIcon size={15} /> <strong>{o.name}</strong>
                  </span>
                  <button
                    type="button"
                    className="secondary"
                    aria-label={`Delete ${o.name}`}
                    disabled={!can('host:org:manage')}
                    onClick={(e) => {
                      e.stopPropagation();
                      void onDeleteOrg(o);
                    }}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
                <div style={muted}>{o.slug}</div>
              </div>
            ))
          )}
        </div>

        {/* ── Right: selected org detail ── */}
        <div style={{ flex: '2 1 520px', minWidth: 320 }}>
          {!selectedOrg ? (
            <StateCard title="Select an organization" body="Pick an organization on the left to manage its teams and members." />
          ) : (
            <>
              <h2 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <BriefcaseIcon size={16} /> {selectedOrg.name}
              </h2>

              {/* "View as" enforcement lens — exercise a member's role-derived scopes. */}
              <div className="action-bar" style={{ marginBottom: 'var(--space-2)' }}>
                <label style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  View as
                  <select value={viewAs ?? ''} onChange={(e) => void changeView(e.target.value || null)}>
                    <option value="">Owner (you) — full access</option>
                    {members.map((m) => (
                      <option key={m.memberId} value={m.memberId}>
                        {m.displayName} ({m.roles.join('/') || 'no roles'})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {viewAs ? (
                <Notice variant="info">
                  Enforcing as <strong>{nameOfMember(viewAs)}</strong> — {viewScopes.size} scope(s). Actions this
                  member can&rsquo;t perform are disabled below; attempting one server-side returns 403.
                </Notice>
              ) : null}

              {/* Teams */}
              <h3 style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <ColumnsIcon size={15} /> Teams
              </h3>
              <form onSubmit={onCreateTeam} className="action-bar" style={{ marginBottom: 'var(--space-2)' }}>
                <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="New team name" aria-label="New team name" />
                <button type="submit" className="primary" disabled={!teamName.trim() || !can('host:teams:manage')} title={can('host:teams:manage') ? undefined : 'Requires host:teams:manage'}>Add team</button>
              </form>
              {teams.length === 0 ? (
                <p style={muted}>No teams yet.</p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                  {teams.map((t) => (
                    <span key={t.teamId} className={NEUTRAL_CHIP} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      {t.name}
                      <button
                        type="button"
                        aria-label={`Delete team ${t.name}`}
                        disabled={!can('host:teams:manage')}
                        onClick={() => void onDeleteTeam(t)}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', display: 'inline-flex' }}
                      >
                        <TrashIcon size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Members */}
              <h3 style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <UserIcon size={15} /> Members
              </h3>
              <form onSubmit={onCreateMember} className="action-bar" style={{ flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
                <input value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="Name" aria-label="Member name" />
                <input value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} placeholder="Email (optional)" aria-label="Member email" />
                <span className="action-bar" style={{ gap: '6px' }}>
                  {assignableRoleIds.map((role) => (
                    <label key={role} className={NEUTRAL_CHIP} style={{ cursor: 'pointer', opacity: memberRoles.has(role) ? 1 : 0.6 }}>
                      <input
                        type="checkbox"
                        checked={memberRoles.has(role)}
                        onChange={() => setMemberRoles((s) => toggleStr(s, role))}
                        style={{ marginRight: 4 }}
                      />
                      {roleLabel(role)}
                    </label>
                  ))}
                </span>
                <button type="submit" className="primary" disabled={!memberName.trim() || !can('host:members:manage')} title={can('host:members:manage') ? undefined : 'Requires host:members:manage'}>Add member</button>
              </form>

              {members.length === 0 ? (
                <StateCard icon={<UserIcon size={28} />} title="No members yet" body="Add a member above and assign roles." />
              ) : (
                members.map((m) => (
                  <div key={m.memberId} className="surface-card" style={{ marginBottom: 'var(--space-2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                      <span>
                        <strong>{m.displayName}</strong>
                        {m.email ? <span style={muted}> · {m.email}</span> : null}
                      </span>
                      <span className="action-bar">
                        <button type="button" className="secondary" onClick={() => void onShowAccess(m)}>
                          <ShieldIcon size={13} /> Access
                        </button>
                        <button type="button" className="secondary" disabled={!can('host:members:manage')} onClick={() => startEdit(m)} aria-label={`Edit roles for ${m.displayName}`}>
                          <PencilIcon size={13} /> Roles
                        </button>
                        <button type="button" className="secondary" disabled={!can('host:members:manage')} onClick={() => void onDeleteMember(m)} aria-label={`Remove ${m.displayName}`}>
                          <TrashIcon size={13} />
                        </button>
                      </span>
                    </div>

                    {/* role chips */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                      {m.roles.length === 0 ? (
                        <span className="chip chip--muted">no roles</span>
                      ) : (
                        m.roles.map((r) => <span key={r} className={NEUTRAL_CHIP}>{roleLabel(r)}</span>)
                      )}
                    </div>

                    {/* inline role editor */}
                    {editingId === m.memberId ? (
                      <div className="action-bar" style={{ flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
                        {assignableRoleIds.map((role) => (
                          <label key={role} className={NEUTRAL_CHIP} style={{ cursor: 'pointer', opacity: draftRoles.has(role) ? 1 : 0.6 }}>
                            <input
                              type="checkbox"
                              checked={draftRoles.has(role)}
                              onChange={() => setDraftRoles((s) => toggleStr(s, role))}
                              style={{ marginRight: 4 }}
                            />
                            {roleLabel(role)}
                          </label>
                        ))}
                        <button type="button" className="primary" onClick={() => void onSaveRoles(m)}>Save</button>
                        <button type="button" className="secondary" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    ) : null}

                    {/* effective-access preview */}
                    {accessFor === m.memberId && access ? (
                      <div style={{ marginTop: 'var(--space-2)' }}>
                        <div style={muted}>
                          Effective scopes (basis: {access.basis}) — resolved from assigned roles only:
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                          {access.scopes.length === 0 ? (
                            <span className="chip chip--muted">no scopes (fail-closed)</span>
                          ) : (
                            access.scopes.map((s) => (
                              <span key={s} className={NEUTRAL_CHIP}>{s}</span>
                            ))
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))
              )}

              {/* Groups — cross-cutting role bundles */}
              <h3 style={{ fontSize: '0.9rem', marginTop: 'var(--space-5)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <LockIcon size={15} /> Groups <span style={muted}>· role bundles</span>
              </h3>
              <p style={muted}>
                A group bundles roles and grants them to its members — on top of each member&rsquo;s own
                roles. Use it for batch access management (e.g. &ldquo;Editors&rdquo;, &ldquo;Admins&rdquo;).
              </p>
              <form onSubmit={onCreateGroup} className="action-bar" style={{ flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
                <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="New group name" aria-label="New group name" />
                <span className="action-bar" style={{ gap: '6px' }}>
                  {assignableRoleIds.map((role) => (
                    <label key={role} className={NEUTRAL_CHIP} style={{ cursor: 'pointer', opacity: groupRoles.has(role) ? 1 : 0.6 }}>
                      <input type="checkbox" checked={groupRoles.has(role)} onChange={() => setGroupRoles((s) => toggleStr(s, role))} style={{ marginRight: 4 }} />
                      {roleLabel(role)}
                    </label>
                  ))}
                </span>
                <button type="submit" className="primary" disabled={!groupName.trim() || !can('host:groups:manage')} title={can('host:groups:manage') ? undefined : 'Requires host:groups:manage'}>Add group</button>
              </form>
              {groups.length === 0 ? (
                <p style={muted}>No groups yet.</p>
              ) : (
                groups.map((g) => (
                  <div key={g.groupId} className="surface-card" style={{ marginBottom: 'var(--space-2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <LockIcon size={14} /> <strong>{g.name}</strong>
                      </span>
                      <span className="action-bar">
                        <button type="button" className="secondary" disabled={!can('host:groups:manage')} onClick={() => startEditGroup(g)} aria-label={`Edit members of ${g.name}`}>
                          <PencilIcon size={13} /> Members
                        </button>
                        <button type="button" className="secondary" disabled={!can('host:groups:manage')} onClick={() => void onDeleteGroup(g)} aria-label={`Delete group ${g.name}`}>
                          <TrashIcon size={13} />
                        </button>
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                      {g.roles.length === 0 ? <span className="chip chip--muted">no roles</span> : g.roles.map((r) => <span key={r} className={NEUTRAL_CHIP}>{roleLabel(r)}</span>)}
                    </div>
                    <div style={{ ...muted, marginTop: '4px' }}>
                      {g.memberIds.length} member{g.memberIds.length === 1 ? '' : 's'}
                      {g.memberIds.length ? `: ${g.memberIds.map(nameOfMember).join(', ')}` : ''}
                    </div>
                    {editingGroupId === g.groupId ? (
                      <div className="action-bar" style={{ flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
                        {members.length === 0 ? (
                          <span style={muted}>Add members to the org first.</span>
                        ) : (
                          members.map((m) => (
                            <label key={m.memberId} className={NEUTRAL_CHIP} style={{ cursor: 'pointer', opacity: draftGroupMembers.has(m.memberId) ? 1 : 0.6 }}>
                              <input
                                type="checkbox"
                                checked={draftGroupMembers.has(m.memberId)}
                                onChange={() => setDraftGroupMembers((s) => toggleStr(s, m.memberId))}
                                style={{ marginRight: 4 }}
                              />
                              {m.displayName}
                            </label>
                          ))
                        )}
                        <button type="button" className="primary" onClick={() => void onSaveGroupMembers(g)}>Save</button>
                        <button type="button" className="secondary" onClick={() => setEditingGroupId(null)}>Cancel</button>
                      </div>
                    ) : null}
                  </div>
                ))
              )}

              {/* Role catalog reference */}
              <h3 style={{ fontSize: '0.9rem', marginTop: 'var(--space-5)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <ShieldIcon size={15} /> Role catalog
              </h3>
              <p style={muted}>Built-in roles and the scopes they grant. Bare scopes are RFC 0049 protocol scopes; <code>host:</code> scopes manage this org/team/member surface.</p>
              {roles.map((r) => (
                <div key={r.id} className="surface-card" style={{ marginBottom: 'var(--space-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span className={NEUTRAL_CHIP}>{r.id}</span>
                    <span style={muted}>{r.description}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                    {r.scopes.map((s) => (
                      <span key={s} className={NEUTRAL_CHIP} style={{ fontSize: '0.7rem' }}>{s}</span>
                    ))}
                  </div>
                </div>
              ))}

              {/* Custom roles — org-defined role bundles */}
              <h3 style={{ fontSize: '0.9rem', marginTop: 'var(--space-5)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <PencilIcon size={15} /> Custom roles <span style={muted}>· define your own</span>
              </h3>
              <p style={muted}>
                Bundle any scopes into a named role, then assign it to members and groups exactly like a
                built-in role.
              </p>
              <form onSubmit={onCreateRole} className="action-bar" style={{ flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
                <input value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="New role name" aria-label="New custom role name" />
                <button
                  type="submit"
                  className="primary"
                  disabled={!roleName.trim() || roleScopes.size === 0 || !can('host:roles:manage')}
                  title={can('host:roles:manage') ? undefined : 'Requires host:roles:manage'}
                >
                  Create role
                </button>
              </form>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: 'var(--space-3)' }}>
                {assignableScopes.map((s) => (
                  <label
                    key={s}
                    className={NEUTRAL_CHIP}
                    style={{ cursor: 'pointer', opacity: roleScopes.has(s) ? 1 : 0.65, fontSize: '0.7rem' }}
                  >
                    <input type="checkbox" checked={roleScopes.has(s)} onChange={() => setRoleScopes((x) => toggleStr(x, s))} style={{ marginRight: 4 }} />
                    {s}
                  </label>
                ))}
              </div>
              {customRoles.length === 0 ? (
                <p style={muted}>No custom roles yet.</p>
              ) : (
                customRoles.map((r) => (
                  <div key={r.roleId} className="surface-card" style={{ marginBottom: 'var(--space-2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                      <strong>{r.name}</strong>
                      <button type="button" className="secondary" disabled={!can('host:roles:manage')} onClick={() => void onDeleteRole(r)} aria-label={`Delete role ${r.name}`}>
                        <TrashIcon size={13} />
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                      {r.scopes.length === 0 ? (
                        <span className="chip chip--muted">no scopes</span>
                      ) : (
                        r.scopes.map((s) => (
                          <span key={s} className={NEUTRAL_CHIP} style={{ fontSize: '0.7rem' }}>{s}</span>
                        ))
                      )}
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
