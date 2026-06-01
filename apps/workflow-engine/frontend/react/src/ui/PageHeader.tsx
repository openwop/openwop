/**
 * PageHeader — the one editorial page-title primitive (DESIGN.app.md §5).
 *
 * Gives every top-level page the same hierarchy and lifts the app's
 * editorial voice out of the chrome and into the content:
 *   - eyebrow: a mono uppercase kicker (the "FIG. 01" register, --ink-3)
 *   - title:   Instrument Serif, out-ranking the cards below it
 *   - lede:    a one-line sans intro (--ink-3, ≤ 64ch)
 *   - actions: a right-aligned button cluster (uses .action-bar)
 *
 * Sits above a hairline rule. Reach for this instead of a bare <h1>/<h2> so
 * "Runs", "Workflows", "AI coworkers" all read as one publication.
 */

import type { ReactNode } from 'react';

interface Props {
  /** Short mono kicker above the title, e.g. "RUNS". Rendered uppercase. */
  eyebrow?: string;
  /** The page title — Instrument Serif. String or node (e.g. with a count). */
  title: ReactNode;
  /** One-line intro under the title. */
  lede?: ReactNode;
  /** Right-aligned action cluster (buttons/links). */
  actions?: ReactNode;
}

export function PageHeader({ eyebrow, title, lede, actions }: Props): JSX.Element {
  return (
    <header className="page-header">
      <div className="page-header__lead">
        {eyebrow ? <p className="page-header__eyebrow">{eyebrow}</p> : null}
        <h1 className="page-header__title">{title}</h1>
        {lede ? <p className="page-header__lede">{lede}</p> : null}
      </div>
      {actions ? <div className="page-header__actions action-bar">{actions}</div> : null}
    </header>
  );
}
