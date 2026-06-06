/**
 * Workforces gallery (EP0 §1 / WF-3). Lists the governed agent workforces a
 * fresh deploy can stand up. Read-only in EP0; the "stand up your first
 * workforce" wizard is a later slice.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../ui/PageHeader.js';
import { StateCard } from '../ui/StateCard.js';
import { Skeleton } from '../ui/Skeleton.js';
import { Notice } from '../ui/Notice.js';
import { BuildingIcon } from '../ui/icons/index.js';
import { listWorkforces, type Workforce } from '../client/workforcesClient.js';

function statusTone(status: Workforce['status']): string {
  switch (status) {
    case 'production': return 'chip chip--success';
    case 'piloting': return 'chip chip--accent';
    default: return 'chip chip--muted'; // shadow
  }
}

export function WorkforcesGalleryPage(): JSX.Element {
  const [items, setItems] = useState<Workforce[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listWorkforces()
      .then((wf) => { if (!cancelled) { setItems(wf); setError(null); } })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <PageHeader
        eyebrow="WORKFORCES"
        title="Governed agent workforces"
        lede="Each workforce is a business function rebuilt as a supervised agent cluster — workflows, approvals, telemetry, and policy in one governed unit."
      />

      {error ? <Notice variant="error">Couldn't load workforces: {error}</Notice> : null}

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(20rem, 1fr))', gap: '1rem' }}>
          <Skeleton height={160} />
          <Skeleton height={160} />
        </div>
      ) : !error && items.length === 0 ? (
        <StateCard
          icon={<BuildingIcon />}
          title="No workforces yet"
          body="Load the demo data to seed the invoice-exception workforce with weeks of run history."
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(20rem, 1fr))', gap: '1rem' }}>
          {items.map((wf) => (
            <Link
              key={wf.workforceId}
              to={`/workforces/${encodeURIComponent(wf.workforceId)}`}
              className="surface-card"
              style={{ display: 'block', textDecoration: 'none' }}
            >
              <div className="action-bar" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <h3 style={{ margin: 0 }}>{wf.name}</h3>
                <span className={statusTone(wf.status)}>{wf.status}</span>
              </div>
              <p style={{ color: 'var(--color-text-muted)', margin: '0.5rem 0' }}>{wf.purpose.statement}</p>
              <div className="action-bar" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                <span className="chip">{wf.businessFunction}</span>
                <span className="chip">autonomy: {wf.autonomyLevel}</span>
                <span className="chip">{wf.agents.length} agents</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
