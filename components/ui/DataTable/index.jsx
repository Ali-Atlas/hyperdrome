'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from './DataTable.module.css';

/**
 * Responsive sortable data table.
 *
 * Two sort modes:
 *
 * 1. Uncontrolled (default). Pass `defaultSortKey` / `defaultSortOrder`;
 *    DataTable owns the sort state and re-sorts `data` client-side. Used
 *    by the races / drone-detail pages where the data set fits on the
 *    client.
 *
 * 2. Controlled. Pass `sortKey`, `sortOrder`, AND `onSortChange`. The
 *    parent owns the sort state, the table renders rows in the order
 *    received (no client-side re-sort), and a header click fires
 *    `onSortChange(key, order)` so the parent can refetch from the
 *    server. Used by the leaderboard so a click flips the global
 *    ranking, not just the visible page.
 *
 * Columns can supply a `shortLabel` - when set, the full `label` renders
 * at desktop width and the `shortLabel` swaps in at ≤1024px so columns
 * still fit on tablet without horizontal scroll.
 *
 * Pass `rowClassName(row)` to tag specific rows (e.g., the user's own
 * row on a leaderboard) with an extra class for bespoke highlighting.
 *
 * @param {object} props
 * @param {Array<{ key: string, label: string, shortLabel?: string, sortable?: boolean, render?: (row: any) => React.ReactNode, align?: 'left'|'center'|'right', width?: string }>} props.columns
 * @param {Array<object>} props.data
 * @param {(row: any) => void} [props.onRowClick]
 * @param {(row: any) => string|null|undefined} [props.rowClassName]
 * @param {boolean} [props.sortable]
 * @param {boolean} [props.loading]
 * @param {string} [props.emptyMessage='No results']
 * @param {string} [props.className]
 * @param {string|null} [props.defaultSortKey=null]
 * @param {'asc'|'desc'} [props.defaultSortOrder='desc']
 * @param {string|null} [props.sortKey]                // controlled
 * @param {'asc'|'desc'} [props.sortOrder]             // controlled
 * @param {(key: string, order: 'asc'|'desc') => void} [props.onSortChange]
 */
export default function DataTable({
  columns,
  data,
  onRowClick,
  rowClassName,
  sortable = false,
  loading = false,
  emptyMessage = 'No results',
  className,
  defaultSortKey = null,
  defaultSortOrder = 'desc',
  sortKey,
  sortOrder,
  onSortChange,
}) {
  const isControlled = typeof onSortChange === 'function';

  const [internalSort, setInternalSort] = useState({
    key: defaultSortKey,
    order: defaultSortOrder,
  });

  // Reset uncontrolled sort to the new default when the parent flips
  // it. Bail when values are unchanged so a fresh default-prop render
  // doesn't clobber the user's manual sort.
  useEffect(() => {
    if (isControlled) return;
    setInternalSort((prev) =>
      prev.key === defaultSortKey && prev.order === defaultSortOrder
        ? prev
        : { key: defaultSortKey, order: defaultSortOrder },
    );
  }, [defaultSortKey, defaultSortOrder, isControlled]);

  const sort = isControlled
    ? { key: sortKey ?? null, order: sortOrder ?? 'desc' }
    : internalSort;

  // Controlled mode: server already returned rows in the right order;
  // don't re-sort client-side. Uncontrolled: keep the in-memory sort.
  const sorted = useMemo(() => {
    if (isControlled) return data;
    if (!sort.key) return data;
    const copy = [...data];
    copy.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sort.order === 'asc' ? -1 : 1;
      if (av > bv) return sort.order === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [data, sort, isControlled]);

  const toggleSort = (key) => {
    if (!sortable) return;
    if (isControlled) {
      // Server-driven: cycle desc ↔ asc on the same key, or land on
      // desc when switching to a new key. No null state - the parent
      // always wants some sort applied.
      const nextOrder =
        sort.key === key && sort.order === 'desc' ? 'asc' : 'desc';
      const nextKey = sort.key === key ? key : key;
      onSortChange(nextKey, nextOrder);
      return;
    }
    setInternalSort((prev) => {
      if (prev.key !== key) return { key, order: 'desc' };
      if (prev.order === 'desc') return { key, order: 'asc' };
      return { key: null, order: 'desc' };
    });
  };

  return (
    <div className={cn(styles.wrapper, className)}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((col) => {
              const isSortable = sortable && col.sortable;
              const isActive = sort.key === col.key;
              return (
                <th
                  key={col.key}
                  className={cn(
                    styles.th,
                    col.align && styles[`align-${col.align}`],
                    isSortable && styles.sortable,
                  )}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={isSortable ? () => toggleSort(col.key) : undefined}
                >
                  <span className={styles.thContent}>
                    {col.shortLabel ? (
                      <>
                        <span className={styles.labelFull}>{col.label}</span>
                        <span className={styles.labelShort}>
                          {col.shortLabel}
                        </span>
                      </>
                    ) : (
                      col.label
                    )}
                    {isSortable && isActive && (
                      <span className={styles.sortIcon}>
                        {sort.order === 'asc' ? (
                          <ChevronUp size={12} />
                        ) : (
                          <ChevronDown size={12} />
                        )}
                      </span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={`sk-${i}`} className={styles.skeletonRow}>
                  {columns.map((col) => (
                    <td key={col.key} className={styles.td}>
                      <span className={styles.skeletonCell} />
                    </td>
                  ))}
                </tr>
              ))
            : sorted.length === 0
              ? (
                <tr>
                  <td className={styles.empty} colSpan={columns.length}>
                    {emptyMessage}
                  </td>
                </tr>
              )
              : sorted.map((row, i) => (
                  <tr
                    key={row.id ?? i}
                    className={cn(
                      styles.row,
                      onRowClick && styles.rowInteractive,
                      rowClassName && rowClassName(row),
                    )}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          styles.td,
                          col.align && styles[`align-${col.align}`],
                        )}
                        style={col.width ? { width: col.width } : undefined}
                      >
                        {col.render ? col.render(row) : row[col.key]}
                      </td>
                    ))}
                  </tr>
                ))}
        </tbody>
      </table>
    </div>
  );
}
