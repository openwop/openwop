/**
 * NotFoundPage — catch-all for unmatched routes. The app host rewrites every
 * path to index.html (SPA), so without a `<Route path="*">` any unknown URL
 * — a typo, a stale bookmark, or a feature not in this deployment yet —
 * renders a blank <main>. This gives the visitor orientation instead.
 */
import { Link, useLocation } from 'react-router-dom';

export function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <section>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Page not found</h2>
        <p className="muted">
          Nothing is mapped to <code>{pathname}</code>. It may have moved, or the feature isn&rsquo;t part of this deployment yet.
        </p>
        <nav aria-label="Go to" style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <Link to="/builder">Workflows</Link>
          <Link to="/">Chat</Link>
          <Link to="/runs">Runs</Link>
        </nav>
      </div>
    </section>
  );
}
