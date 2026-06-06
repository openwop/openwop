/**
 * CustomRolesPanel — the org-defined custom-role builder section of the Orgs
 * admin page, extracted from OrgsPage (GAP-ANALYSIS E11). Presentational;
 * state + handlers stay lifted.
 */

import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { CustomRole } from '../client/accessClient.js';
import { PencilIcon, TrashIcon } from '../ui/icons/index.js';
import { NEUTRAL_CHIP, muted } from './orgUi.js';

export interface CustomRolesPanelProps {
  customRoles: CustomRole[];
  roleName: string;
  setRoleName: (v: string) => void;
  roleScopes: Set<string>;
  setRoleScopes: Dispatch<SetStateAction<Set<string>>>;
  assignableScopes: string[];
  onCreateRole: (e: FormEvent) => void;
  onDeleteRole: (r: CustomRole) => void;
  can: (scope: string) => boolean;
  toggleStr: (set: Set<string>, id: string) => Set<string>;
}

export function CustomRolesPanel({
  customRoles, roleName, setRoleName, roleScopes, setRoleScopes, assignableScopes,
  onCreateRole, onDeleteRole, can, toggleStr,
}: CustomRolesPanelProps): JSX.Element {
  return (
    <>
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
  );
}
