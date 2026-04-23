'use client';

import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from './FilterBar.module.css';

/**
 * Horizontal filter strip - selects, range inputs, and a search box.
 * @param {object} props
 * @param {Array<{ key: string, label: string, type: 'select'|'range', options?: Array<{ value: string, label: string }> }>} props.filters
 * @param {Record<string, any>} props.values
 * @param {(key: string, value: any) => void} props.onChange
 * @param {(term: string) => void} [props.onSearch]
 * @param {string} [props.searchPlaceholder='Search...']
 * @param {string} [props.className]
 */
export default function FilterBar({
  filters = [],
  values = {},
  onChange,
  onSearch,
  searchPlaceholder = 'Search...',
  className,
}) {
  return (
    <div className={cn(styles.bar, className)}>
      {filters.map((filter) => {
        if (filter.type === 'select') {
          return (
            <label key={filter.key} className={styles.field}>
              <span className={styles.fieldLabel}>{filter.label}</span>
              <select
                className={styles.select}
                value={values[filter.key] ?? ''}
                onChange={(e) => onChange?.(filter.key, e.target.value)}
              >
                <option value="">All</option>
                {filter.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        if (filter.type === 'range') {
          const range = values[filter.key] ?? { min: '', max: '' };
          return (
            <div key={filter.key} className={styles.field}>
              <span className={styles.fieldLabel}>{filter.label}</span>
              <div className={styles.rangeGroup}>
                <input
                  className={styles.rangeInput}
                  type="number"
                  placeholder="Min"
                  value={range.min ?? ''}
                  onChange={(e) =>
                    onChange?.(filter.key, { ...range, min: e.target.value })
                  }
                />
                <span className={styles.rangeDash}>-</span>
                <input
                  className={styles.rangeInput}
                  type="number"
                  placeholder="Max"
                  value={range.max ?? ''}
                  onChange={(e) =>
                    onChange?.(filter.key, { ...range, max: e.target.value })
                  }
                />
              </div>
            </div>
          );
        }
        return null;
      })}

      {onSearch && (
        <label className={cn(styles.field, styles.searchField)}>
          <span className={styles.fieldLabel}>Search</span>
          <div className={styles.searchWrap}>
            <Search size={14} className={styles.searchIcon} aria-hidden="true" />
            <input
              className={styles.searchInput}
              type="search"
              placeholder={searchPlaceholder}
              onChange={(e) => onSearch(e.target.value)}
            />
          </div>
        </label>
      )}
    </div>
  );
}
