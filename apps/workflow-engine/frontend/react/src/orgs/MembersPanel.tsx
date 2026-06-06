/**
 * MembersPanel — the members management section of the Orgs admin page,
 * extracted from the 728-line OrgsPage god-component (GAP-ANALYSIS E11).
 * Presentational: all state + handlers stay lifted in OrgsPage and arrive as
 * props, so behavior is unchanged; this just gives the section its own file +
 * a named, typed surface. The remaining sections (Groups, Teams, Custom roles)
 * extract the same way.
 */

import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { OrgMember, EffectiveAccess } from '../client/accessClient.js';
import { StateCard } from '../ui/StateCard.js';
import { UserIcon, ShieldIcon, PencilIcon, TrashIcon } from '../ui/icons/index.js';
import { NEUTRAL_CHIP, muted } from './orgUi.js';

export interface MembersPanelProps {
  members: OrgMember[];
  memberName: string;
  setMemberName: (v: string) => void;
  memberEmail: string;
  setMemberEmail: (v: string) => void;
  memberRoles: Set<string>;
  setMemberRoles: Dispatch<SetStateAction<Set<string>>>;
  assignableRoleIds: string[];
  editingId: string | null;
  setEditingId: (v: string | null) => void;
  draftRoles: Set<string>;
  setDraftRoles: Dispatch<SetStateAction<Set<string>>>;
  accessFor: string | null;
  access: EffectiveAccess | null;
  onCreateMember: (e: FormEvent) => void;
  onShowAccess: (m: OrgMember) => void;
  startEdit: (m: OrgMember) => void;
  onDeleteMember: (m: OrgMember) => void;
  onSaveRoles: (m: OrgMember) => void;
  can: (scope: string) => boolean;
  roleLabel: (id: string) => string;
  toggleStr: (set: Set<string>, id: string) => Set<string>;
}

export function MembersPanel({
  members, memberName, setMemberName, memberEmail, setMemberEmail, memberRoles, setMemberRoles,
  assignableRoleIds, editingId, setEditingId, draftRoles, setDraftRoles, accessFor, access,
  onCreateMember, onShowAccess, startEdit, onDeleteMember, onSaveRoles, can, roleLabel, toggleStr,
}: MembersPanelProps): JSX.Element {
  return (
    <>
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
    </>
  );
}
