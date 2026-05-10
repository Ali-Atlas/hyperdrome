'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './ConfirmModal.module.css';

/**
 * On-brand confirm dialog. Mount it conditionally from the parent — when
 * rendered, the overlay covers the screen and the parent should call
 * onCancel/onConfirm to unmount it.
 *
 * Rendered through a portal into document.body so it sits outside every
 * ancestor's stacking / overflow / transform context — matches the
 * pattern used by the wallet dropdown so neither the mobile top-bar's
 * `overflow: hidden` ancestor nor the desktop sidebar's containing
 * block can clip the dialog.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {string} props.message
 * @param {string} [props.confirmLabel='Confirm']
 * @param {string} [props.cancelLabel='Cancel']
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onCancel
 */
export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  const panelRef = useRef(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onCancel]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={styles.overlay}
      onClick={onCancel}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={styles.confirmBtn}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
