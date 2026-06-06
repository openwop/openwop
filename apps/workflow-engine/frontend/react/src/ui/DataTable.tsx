import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDownIcon } from './icons/index.js';

/**
 * <DataTable> — the one tabular-data primitive for the operate surfaces
 * (Runs, Memory, Orgs, …). Sticky header, click-to-sort columns, a
 * comfortable/compact density axis, optional row-click navigation, optional
 * bulk-select + bulk-action bar, and a built-in empty slot. Token-only styling
 * lives under `.data-table` in global.css. A surface MUST NOT hand-roll a
 * second sortable table.
 *
 * Sorting is opt-in per column (provide `sortValue`); the table owns the sort
 * state. Selection is opt-in (`selectable`) and **controlled** — the parent
 * owns the `Set` of selected row keys so it can clear it after a bulk op. Rows
 * are sorted client-side — fine for the page-sized lists these screens render.
 */

export interface DataColumn<T> {
  /** Stable column id (also the sort key). */
  key: string;
  header: ReactNode;
  /** Cell renderer. */
  render: (row: T) => ReactNode;
  /** Provide to make the column sortable; returns the comparable value. */
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right' | 'center';
  /** CSS width for the column (e.g. '1fr', '120px'). */
  width?: string;
  /** Cell class (e.g. 'muted' for low-emphasis columns). */
  cellClassName?: string;
  /** Native title on the header cell. */
  headerTitle?: string;
}

interface SortState { key: string; dir: 'asc' | 'desc' }

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

interface BaseProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Row click (e.g. navigate to detail). Rows render as clickable when set. */
  onRowClick?: (row: T) => void;
  density?: 'comfortable' | 'compact';
  /** Accessible table caption (visually hidden). */
  caption?: string;
  /** Default sort applied on mount. */
  initialSort?: SortState;
  /** Rendered in place of the table body when `rows` is empty. */
  empty?: ReactNode;
  /** Optional per-row class (e.g. a highlight for the caller's own rows).
   *  Appended to the built-in clickable/selected classes. */
  rowClassName?: (row: T) => string | undefined;
}

/**
 * Selection is all-or-nothing at the type level: opting into `selectable`
 * REQUIRES the controlled `selected` set + `onSelectionChange` (otherwise the
 * checkboxes would render inert). Omitting `selectable` forbids the selection
 * props entirely, so a non-selectable table can't accidentally carry stale
 * selection wiring.
 */
type SelectionProps<T> =
  | { selectable?: false; selected?: undefined; onSelectionChange?: undefined; bulkActions?: undefined }
  | {
      selectable: true;
      /** Controlled set of selected row keys (parent-owned so it can clear it). */
      selected: ReadonlySet<string>;
      onSelectionChange: (next: Set<string>) => void;
      /** Rendered in the bar above the table when ≥1 row is selected. */
      bulkActions?: (selectedRows: T[]) => ReactNode;
    };

type Props<T> = BaseProps<T> & SelectionProps<T>;

export function DataTable<T>({
  columns, rows, rowKey, onRowClick, density = 'comfortable', caption, initialSort, empty, rowClassName,
  selectable, selected = EMPTY_SELECTION, onSelectionChange, bulkActions,
}: Props<T>): JSX.Element {
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    const factor = sort.dir === 'asc' ? 1 : -1;
    // Stable sort over a copy; never mutate the caller's array.
    return [...rows].sort((a, b) => {
      const av = sv(a); const bv = sv(b);
      if (av < bv) return -1 * factor;
      if (av > bv) return 1 * factor;
      return 0;
    });
  }, [rows, sort, columns]);

  function toggleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
    });
  }

  const allKeys = useMemo(() => rows.map(rowKey), [rows, rowKey]);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const someSelected = allKeys.some((k) => selected.has(k));
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(rowKey(r))), [rows, selected, rowKey]);

  function toggleAll() {
    const next = new Set(selected);
    if (allSelected) allKeys.forEach((k) => next.delete(k));
    else allKeys.forEach((k) => next.add(k));
    onSelectionChange?.(next);
  }
  function toggleRow(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    onSelectionChange?.(next);
  }

  return (
    <>
      {selectable && bulkActions && selected.size > 0 && (
        <div className="data-bulkbar" role="region" aria-label="Bulk actions">
          <span className="data-bulkbar-count">{selected.size} selected</span>
          <div className="data-bulkbar-actions">{bulkActions(selectedRows)}</div>
          <button type="button" className="data-bulkbar-clear" onClick={() => onSelectionChange?.(new Set())}>Clear</button>
        </div>
      )}
      {rows.length === 0 && empty !== undefined ? (
        empty
      ) : (
        <div className="table-scroll">
          <table className={`data-table${density === 'compact' ? ' data-table--compact' : ''}`}>
            {caption ? <caption className="data-table-caption">{caption}</caption> : null}
            <thead>
              <tr>
                {selectable && (
                  <th className="data-col--check" aria-label="Select">
                    <input
                      type="checkbox"
                      aria-label={allSelected ? 'Deselect all' : 'Select all'}
                      checked={allSelected}
                      ref={(cb) => { if (cb) cb.indeterminate = someSelected && !allSelected; }}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                {columns.map((col) => {
                  const active = sort?.key === col.key;
                  const alignClass = col.align ? ` data-col--${col.align}` : '';
                  if (!col.sortValue) {
                    return (
                      <th key={col.key} className={alignClass.trim()} style={col.width ? { width: col.width } : undefined} title={col.headerTitle}>
                        {col.header}
                      </th>
                    );
                  }
                  return (
                    <th
                      key={col.key}
                      className={`data-th--sortable${active ? ' is-sorted' : ''}${alignClass}`}
                      style={col.width ? { width: col.width } : undefined}
                      aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" className="data-sort-btn" onClick={() => toggleSort(col.key)} title={col.headerTitle ?? `Sort by ${typeof col.header === 'string' ? col.header : col.key}`}>
                        <span>{col.header}</span>
                        <span className={`data-sort-caret${active ? ` is-${sort?.dir}` : ''}`} aria-hidden>
                          <ChevronDownIcon size={12} />
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const key = rowKey(row);
                const isSel = selectable && selected.has(key);
                return (
                  <tr
                    key={key}
                    className={`${onRowClick ? 'data-row--clickable' : ''}${isSel ? ' is-selected' : ''} ${rowClassName?.(row) ?? ''}`.trim() || undefined}
                    {...(onRowClick ? { onClick: () => onRowClick(row) } : {})}
                  >
                    {selectable && (
                      <td className="data-col--check" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          checked={selected.has(key)}
                          onChange={() => toggleRow(key)}
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} className={`${col.align ? `data-col--${col.align} ` : ''}${col.cellClassName ?? ''}`.trim() || undefined}>
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Comfortable/compact segmented toggle — pairs with <DataTable density>. */
export function DensityToggle({ value, onChange }: { value: 'comfortable' | 'compact'; onChange: (v: 'comfortable' | 'compact') => void }): JSX.Element {
  return (
    <div className="segmented" role="group" aria-label="Row density">
      <button type="button" aria-pressed={value === 'comfortable'} onClick={() => onChange('comfortable')}>Comfortable</button>
      <button type="button" aria-pressed={value === 'compact'} onClick={() => onChange('compact')}>Compact</button>
    </div>
  );
}
