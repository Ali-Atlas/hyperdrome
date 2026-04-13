import { cn } from '@/lib/utils';
import styles from './Skeleton.module.css';

/**
 * Visual placeholder with shimmer animation.
 * @param {object} props
 * @param {'card'|'table-row'|'text'|'stat-bar'|'circle'} [props.variant='text']
 * @param {number|string} [props.width]
 * @param {number|string} [props.height]
 * @param {number} [props.count=1]
 * @param {string} [props.className]
 */
export default function Skeleton({
  variant = 'text',
  width,
  height,
  count = 1,
  className,
}) {
  const style = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={cn(
            styles.skeleton,
            styles[variant.replace('-', '')],
            className,
          )}
          style={style}
          aria-hidden="true"
        />
      ))}
    </>
  );
}
