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
import { BriefcaseIcon, ColumnsIcon, LockIcon, PencilIcon, ShieldIcon, TrashIcon, UserIcon } from '../ui/icons/index.js';
import {
  type AccessRole,
  type BuiltInRoleId,
  type EffectiveAccess,
  type Group,
  type Organization,
  type OrgMember,
  type Team,
  createGroup,
  createMember,
  createOrg,
  createTeam,
  deleteGroup,
  deleteMember,
  deleteOrg,
  deleteTeam,
  getEffectiveAccess,
  listGroups,
  listMembers,
  listOrgs,
  listRoles,
  listTeams,
  updateGroup,
  updateMember,
} from '../client/accessClient.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: '0.85rem' };

/** A role badge. Distinct chip tints so the hierarchy reads at a glance. */
const ROLE_CHIP: Record<BuiltInRoleId, string> = {
  viewer: 'chip chip--muted',
  editor: 'chip chip--accent',
  admin: 'chip chip--warning',
  owner: 'chip chip--ai',
};
const ALL_ROLES: BuiltInRoleId[] = ['viewer', 'editor', 'admin', 'owner'];

export function OrgsPage(): JSX.Element {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Create-org form.
  const [orgName, setOrgName] = useState('');
  // Create-team form.
  const [teamName, setTeamName] = useState('');
  // Create-member form.
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRoles, setMemberRoles] = useState<Set<BuiltInRoleId>>(new Set(['viewer']));

  // Inline per-member editor + access preview.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftRoles, setDraftRoles] = useState<Set<BuiltInRoleId>>(new Set());
  const [accessFor, setAccessFor] = useState<string | null>(null);
  const [access, setAccess] = useState<EffectiveAccess | null>(null);

  // Create-group form + inline group-membership editor.
  const [groupName, setGroupName] = useState('');
  const [groupRoles, setGroupRoles] = useState<Set<BuiltInRoleId>>(new Set(['editor']));
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [draftGroupMembers, setDraftGroupMembers] = useState<Set<string>>(new Set());

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
      const [t, m, g] = await Promise.all([listTeams(orgId), listMembers(orgId), listGroups(orgId)]);
      setTeams(t);
      setMembers(m);
      setGroups(g);
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
  const toggle = (set: Set<BuiltInRoleId>, role: BuiltInRoleId): Set<BuiltInRoleId> => {
    const next = new Set(set);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    return next;
  };

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

  return (
    <section style={{ padding: '1rem', maxWidth: 1040 }}>
      <h1 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <ShieldIcon size={22} /> Organizations &amp; access
      </h1>
      <p style={{ ...muted, marginTop: '-0.4rem' }}>
        Organizations, teams, and members with role-based access. Roles map to OpenWOP authorization
        scopes (RFC 0049); a member&rsquo;s authority comes from its assigned roles only — org-chart
        position confers none.
      </p>
      {error ? <Notice variant="error">{error}</Notice> : null}

      <div style={{ display: 'flex', gap: 'var(--space-5)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* ── Left: orgs ── */}
        <div style={{ flex: '1 1 280px', minWidth: 260 }}>
          <h2 style={{ fontSize: '1rem' }}>Organizations</h2>
          <form onSubmit={onCreateOrg} className="action-bar" style={{ marginBottom: 'var(--space-3)' }}>
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="New organization name" aria-label="New organization name" />
            <button type="submit" className="primary" disabled={!orgName.trim()}>Create</button>
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

              {/* Teams */}
              <h3 style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <ColumnsIcon size={15} /> Teams
              </h3>
              <form onSubmit={onCreateTeam} className="action-bar" style={{ marginBottom: 'var(--space-2)' }}>
                <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="New team name" aria-label="New team name" />
                <button type="submit" className="primary" disabled={!teamName.trim()}>Add team</button>
              </form>
              {teams.length === 0 ? (
                <p style={muted}>No teams yet.</p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                  {teams.map((t) => (
                    <span key={t.teamId} className="chip chip--accent" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      {t.name}
                      <button
                        type="button"
                        aria-label={`Delete team ${t.name}`}
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
                  {ALL_ROLES.map((role) => (
                    <label key={role} className={memberRoles.has(role) ? ROLE_CHIP[role] : 'chip chip--muted'} style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={memberRoles.has(role)}
                        onChange={() => setMemberRoles((s) => toggle(s, role))}
                        style={{ marginRight: 4 }}
                      />
                      {role}
                    </label>
                  ))}
                </span>
                <button type="submit" className="primary" disabled={!memberName.trim()}>Add member</button>
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
                        <button type="button" className="secondary" onClick={() => startEdit(m)} aria-label={`Edit roles for ${m.displayName}`}>
                          <PencilIcon size={13} /> Roles
                        </button>
                        <button type="button" className="secondary" onClick={() => void onDeleteMember(m)} aria-label={`Remove ${m.displayName}`}>
                          <TrashIcon size={13} />
                        </button>
                      </span>
                    </div>

                    {/* role chips */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                      {m.roles.length === 0 ? (
                        <span className="chip chip--muted">no roles</span>
                      ) : (
                        m.roles.map((r) => <span key={r} className={ROLE_CHIP[r]}>{r}</span>)
                      )}
                    </div>

                    {/* inline role editor */}
                    {editingId === m.memberId ? (
                      <div className="action-bar" style={{ flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
                        {ALL_ROLES.map((role) => (
                          <label key={role} className={draftRoles.has(role) ? ROLE_CHIP[role] : 'chip chip--muted'} style={{ cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={draftRoles.has(role)}
                              onChange={() => setDraftRoles((s) => toggle(s, role))}
                              style={{ marginRight: 4 }}
                            />
                            {role}
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
                              <span key={s} className={s.startsWith('host:') ? 'chip chip--muted' : 'chip chip--accent'}>{s}</span>
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
                  {ALL_ROLES.map((role) => (
                    <label key={role} className={groupRoles.has(role) ? ROLE_CHIP[role] : 'chip chip--muted'} style={{ cursor: 'pointer' }}>
                      <input type="checkbox" checked={groupRoles.has(role)} onChange={() => setGroupRoles((s) => toggle(s, role))} style={{ marginRight: 4 }} />
                      {role}
                    </label>
                  ))}
                </span>
                <button type="submit" className="primary" disabled={!groupName.trim()}>Add group</button>
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
                        <button type="button" className="secondary" onClick={() => startEditGroup(g)} aria-label={`Edit members of ${g.name}`}>
                          <PencilIcon size={13} /> Members
                        </button>
                        <button type="button" className="secondary" onClick={() => void onDeleteGroup(g)} aria-label={`Delete group ${g.name}`}>
                          <TrashIcon size={13} />
                        </button>
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                      {g.roles.length === 0 ? <span className="chip chip--muted">no roles</span> : g.roles.map((r) => <span key={r} className={ROLE_CHIP[r]}>{r}</span>)}
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
                            <label key={m.memberId} className={draftGroupMembers.has(m.memberId) ? 'chip chip--accent' : 'chip chip--muted'} style={{ cursor: 'pointer' }}>
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
                    <span className={ROLE_CHIP[r.id]}>{r.id}</span>
                    <span style={muted}>{r.description}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                    {r.scopes.map((s) => (
                      <span key={s} className={s.startsWith('host:') ? 'chip chip--muted' : 'chip chip--accent'} style={{ fontSize: '0.7rem' }}>{s}</span>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
