import { Link } from 'react-router-dom';
import { ADMIN_NAV_GROUPS } from '../chrome/features.js';
import { PageHeader } from '../ui/PageHeader.js';

/**
 * Admin home (`/admin`) — the landing surface behind the workspace rail's
 * single "Admin" entry. The card grid derives from the feature manifest's
 * admin tier, so a newly-declared admin feature appears here (and in the
 * embedded rail) with zero edits to this file.
 */
export function AdminOverviewPage(): JSX.Element {
  const groups = ADMIN_NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((item) => item.to !== '/admin') }))
    .filter((g) => g.items.length > 0);
  return (
    <section className="admin-overview">
      <PageHeader
        eyebrow="Admin"
        title="Overview"
        lede="Platform configuration and console surfaces. Day-to-day work lives in the workspace rail; everything that configures the deployment lives here."
      />
      {groups.map((group) => (
        <div key={group.label}>
          <h3 className="admin-overview-group">{group.label}</h3>
          <div className="admin-overview-grid">
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.to} to={item.to} className="surface-card admin-overview-card">
                  <span className="admin-overview-icon" aria-hidden><Icon size={20} /></span>
                  <span className="admin-overview-meta">
                    <span className="admin-overview-label">{item.label}</span>
                    <span className="admin-overview-hint">{item.hint}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
