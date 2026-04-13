import { cn } from '@/lib/utils';
import styles from './Button.module.css';

/**
 * Shared button. Applies variant + size + loading/disabled state.
 * @param {object} props
 * @param {'primary'|'secondary'|'danger'|'ghost'} [props.variant='primary']
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.loading]
 * @param {string} [props.className]
 * @param {React.ReactNode} props.children
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  className,
  children,
  ...rest
}) {
  return (
    <button
      className={cn(
        styles.button,
        styles[variant],
        styles[size],
        loading && styles.loading,
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      <span className={cn(loading && styles.hiddenLabel)}>{children}</span>
    </button>
  );
}
