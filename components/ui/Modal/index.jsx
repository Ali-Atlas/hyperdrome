'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from './Modal.module.css';

/**
 * Centred modal dialog with overlay click-to-close and Escape support.
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {() => void} props.onClose
 * @param {string} [props.title]
 * @param {React.ReactNode} props.children
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {string} [props.className]
 * @param {string} [props.overlayClassName] - extra class for the overlay
 *   (lets a caller, e.g. the marketplace cinematic purchase modal,
 *   nullify the overlay's gutter on mobile for a fullscreen takeover).
 * @param {boolean} [props.chromeless=false] - when true, skip the
 *   default header bar (title + X close). The caller is responsible
 *   for placing its own close affordance inside `children`. The
 *   primitive still owns Escape, click-outside, focus, and the
 *   body-overflow lock.
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  className,
  overlayClassName,
  chromeless = false,
}) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus the panel so keyboard users land inside the modal
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={cn(styles.overlay, overlayClassName)}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(styles.panel, styles[size], className)}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'Dialog'}
      >
        {!chromeless && (
          <div className={styles.header}>
            {title && <h2 className={styles.title}>{title}</h2>}
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="Close dialog"
            >
              <X size={20} />
            </button>
          </div>
        )}
        <div className={chromeless ? undefined : styles.body}>{children}</div>
      </div>
    </div>
  );
}
