import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import Button from '../Button';
import styles from './EmptyState.module.css';

/**
 * Centred empty-state block used when a list/feed has no data.
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.description]
 * @param {string} [props.actionLabel]
 * @param {() => void} [props.onAction]
 * @param {React.ComponentType<any>} [props.icon] - lucide-react icon component
 * @param {string} [props.className]
 */
export default function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon: Icon = Inbox,
  className,
}) {
  return (
    <div className={cn(styles.wrapper, className)}>
      <Icon size={40} className={styles.icon} aria-hidden="true" />
      <h3 className={styles.title}>{title}</h3>
      {description && <p className={styles.description}>{description}</p>}
      {actionLabel && onAction && (
        <Button variant="primary" size="md" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
