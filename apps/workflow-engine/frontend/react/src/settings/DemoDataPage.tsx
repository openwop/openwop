/**
 * `/demo-data` (Settings → Demo data) — re-seed the built-in demo roster.
 *
 * Seeding is per-tenant and idempotent: it (re)creates the five demo agents
 * (Sally, Marcus, Priya, Devon, Nora) — each with a board, sample cards, and
 * schedules — only where they're MISSING, so it restores deleted demo agents
 * and never duplicates. Mirrors the dashboard's "Load demo agents" action, but
 * lives in Settings so it's findable regardless of dashboard state.
 *
 * @see ../agents/rosterClient.ts (seedDemoAgents → POST /v1/host/sample/demo/seed)
 */
import { useState } from 'react';
import { Notice } from '../ui/Notice.js';
import { PageHeader } from '../ui/PageHeader.js';
import { RotateCwIcon } from '../ui/icons/index.js';
import { seedDemoAgents } from '../agents/rosterClient.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: '0.85rem' };

export function DemoDataPage(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onReseed = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { seeded, agents } = await seedDemoAgents();
      setResult(
        seeded
          ? `Re-seeded the demo roster — ${agents} demo agents present.`
          : `Demo roster already complete — ${agents} agents, nothing to add.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ padding: '1rem', maxWidth: 720 }}>
      <PageHeader
        eyebrow="Settings"
        title="Demo data"
        lede="Re-create the built-in demo roster — five named agents (Sally, Marcus, Priya, Devon, Nora), each with a task board, sample cards, and schedules."
      />

      {error ? <Notice variant="error">{error}</Notice> : null}
      {result ? <Notice variant="success">{result}</Notice> : null}

      <div className="surface-card" style={{ marginTop: 'var(--space-3)' }}>
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Re-seed demo data</h2>
        <p style={muted}>
          Idempotent and non-destructive: each demo agent is created only if it&rsquo;s missing, so
          this restores deleted demo agents and never duplicates. It does not touch agents you
          created yourself. Scoped to your tenant.
        </p>
        <div className="action-bar" style={{ marginTop: 'var(--space-2)' }}>
          <button type="button" className="primary" onClick={() => void onReseed()} disabled={busy}>
            <RotateCwIcon size={14} /> {busy ? 'Re-seeding…' : 'Re-seed demo data'}
          </button>
        </div>
      </div>
    </section>
  );
}
