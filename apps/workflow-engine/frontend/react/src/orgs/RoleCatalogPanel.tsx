/**
 * RoleCatalogPanel — read-only reference of built-in roles + their scopes,
 * extracted from OrgsPage (GAP-ANALYSIS E11). Purely presentational.
 */

import type { AccessRole } from '../client/accessClient.js';
import { ShieldIcon } from '../ui/icons/index.js';
import { NEUTRAL_CHIP, muted } from './orgUi.js';

export function RoleCatalogPanel({ roles }: { roles: AccessRole[] }): JSX.Element {
  return (
    <>
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
    </>
  );
}
