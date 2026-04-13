import { cn } from '@/lib/utils';
import styles from './Card.module.css';

/**
 * Generic card surface used across the app.
 * Becomes a button element when an `onClick` handler is provided.
 * @param {object} props
 * @param {string} [props.className]
 * @param {React.ReactNode} props.children
 * @param {boolean} [props.hover] - add teal glow + scale on hover
 * @param {Function} [props.onClick]
 */
export default function Card({
  className,
  children,
  hover = false,
  onClick,
  ...rest
}) {
  const isInteractive = typeof onClick === 'function';
  const Tag = isInteractive ? 'button' : 'div';
  return (
    <Tag
      className={cn(
        styles.card,
        hover && styles.hover,
        isInteractive && styles.interactive,
        className,
      )}
      onClick={onClick}
      type={isInteractive ? 'button' : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
