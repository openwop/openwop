import type { CSSProperties } from 'react';

/**
 * Skeleton — content-shaped loading placeholders (gap #9), replacing bare
 * "Loading…" text on list/detail loads. A faint shimmering block in `--rule`
 * tones; the shimmer honours `prefers-reduced-motion` (falls back to a static
 * tint). Token-only `.skeleton*` styling in global.css.
 */

export function Skeleton({ width, height = 14, radius, style }: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <span
      className="skeleton"
      aria-hidden
      style={{
        width: width ?? '100%',
        height,
        ...(radius !== undefined ? { borderRadius: radius } : {}),
        ...style,
      }}
    />
  );
}

/** Skeleton rows for a <DataTable> loading state — N rows × the given widths. */
export function SkeletonRows({ rows = 4, columns }: { rows?: number; columns: (number | string)[] }): JSX.Element {
  return (
    <div className="skeleton-rows" role="status" aria-label="Loading…">
      {Array.from({ length: rows }, (_, r) => (
        <div className="skeleton-row" key={r}>
          {columns.map((w, c) => <Skeleton key={c} width={w} />)}
        </div>
      ))}
    </div>
  );
}
