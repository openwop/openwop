/**
 * Shared agents-tab UI bits (GAP-ANALYSIS E9). `EmptyBlock` and `slugify` were
 * byte-for-byte triplicated across AgentsPage / AgentInstallPage /
 * AgentDetailPage; extracted here so the empty-state styling and the
 * persona-slug rule have one home.
 */

/** Dashed (or danger-toned) empty/placeholder block used across the agents tab. */
export function EmptyBlock({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'error';
}): JSX.Element {
  return (
    <div
      style={{
        padding: 'var(--space-5)',
        border: `1px ${tone === 'error' ? 'solid' : 'dashed'} ${
          tone === 'error' ? 'var(--color-danger)' : 'var(--rule)'
        }`,
        borderRadius: 8,
        textAlign: 'center',
        color: tone === 'error' ? 'var(--color-danger)' : 'var(--ink-3)',
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

/** Slug helper — keeps the list view's row chip aligned with the chat picker's
 *  `@persona-slug` rendering. Kept out of `chat/lib/agentMentions.ts` so the
 *  agents tab graph doesn't pull in the chat module. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  );
}
