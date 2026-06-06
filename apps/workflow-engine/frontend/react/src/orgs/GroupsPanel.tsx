/**
 * GroupsPanel — the cross-cutting role-bundle ("Groups") section of the Orgs
 * admin page, extracted from OrgsPage (GAP-ANALYSIS E11, same presentational
 * pattern as MembersPanel). State + handlers stay lifted in OrgsPage.
 */

import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { Group, OrgMember } from '../client/accessClient.js';
import { LockIcon, PencilIcon, TrashIcon } from '../ui/icons/index.js';
import { NEUTRAL_CHIP, muted } from './orgUi.js';

export interface GroupsPanelProps {
  groups: Group[];
  members: OrgMember[];
  groupName: string;
  setGroupName: (v: string) => void;
  groupRoles: Set<string>;
  setGroupRoles: Dispatch<SetStateAction<Set<string>>>;
  assignableRoleIds: string[];
  editingGroupId: string | null;
  setEditingGroupId: (v: string | null) => void;
  draftGroupMembers: Set<string>;
  setDraftGroupMembers: Dispatch<SetStateAction<Set<string>>>;
  onCreateGroup: (e: FormEvent) => void;
  startEditGroup: (g: Group) => void;
  onDeleteGroup: (g: Group) => void;
  onSaveGroupMembers: (g: Group) => void;
  nameOfMember: (id: string) => string;
  can: (scope: string) => boolean;
  roleLabel: (id: string) => string;
  toggleStr: (set: Set<string>, id: string) => Set<string>;
}

export function GroupsPanel({
  groups, members, groupName, setGroupName, groupRoles, setGroupRoles, assignableRoleIds,
  editingGroupId, setEditingGroupId, draftGroupMembers, setDraftGroupMembers,
  onCreateGroup, startEditGroup, onDeleteGroup, onSaveGroupMembers, nameOfMember, can, roleLabel, toggleStr,
}: GroupsPanelProps): JSX.Element {
  return (
    <>
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
    </>
  );
}
