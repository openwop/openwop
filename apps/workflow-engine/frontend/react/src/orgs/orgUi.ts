/**
 * Shared orgs-admin UI constants (GAP-ANALYSIS E9/E11). `muted` + `NEUTRAL_CHIP`
 * are used by OrgsPage and every panel extracted from it (MembersPanel, …);
 * kept here so the decomposition doesn't re-duplicate them.
 */

export const NEUTRAL_CHIP = 'chip chip--muted';
export const muted: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: '0.85rem' };
