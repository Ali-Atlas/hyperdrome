'use client';

import { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from './DataTable.module.css';

/**
 * Responsive sortable data table.
 *
 * Columns can supply a `shortLabel` — when set, the full `label` renders
 * at desktop width and the `shortLabel` swaps in at ≤1024px so columns
 * still fit on tablet without horizontal scroll.
 *
 * Pass `rowClassName(row)` to tag specific rows (e.g., the user's own
 * row on a leaderboard) with an extra class for bespoke highlighting.
 *
 * @param {object} props
 * @param {Array<{ key: string, label: string, shortLabel?: string, sortable?: boolean, render?: (row: any) => React.ReactNode, align?: 'left'|'center'|'right' }>} props.columns
 * @param {Array<object>} props.data
 * @param {(row: any) => void} [props.onRowClick]
 * @param {(row: any) => string|null|undefined} [props.rowClassName]
 * @param {boolean} [props.sortable]
 * @param {boolean} [props.loading]
 * @param {string} [props.emptyMessage='No results']
 * @param {string} [props.className]
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
}) {
  const [sort, setSort] = useState({ key: null, order: 'desc' });

  const sorted = useMemo(() => {
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
  }, [data, sort]);

  const toggleSort = (key) => {
    if (!sortable) return;
    setSort((prev) => {
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
                    {isSortable && (
                      <span className={styles.sortIcon}>
                        {isActive && sort.order === 'asc' ? (
                          <ChevronUp size={12} />
                        ) : (
                          <ChevronDown
                            size={12}
                            className={cn(!isActive && styles.sortIconDim)}
                          />
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
