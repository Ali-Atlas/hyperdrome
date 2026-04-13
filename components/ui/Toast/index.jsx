'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { CheckCircle2, XCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import styles from './Toast.module.css';

/**
 * @typedef {{ id: number, message: string, type: 'success'|'error'|'info' }} ToastItem
 */

const ToastContext = createContext(null);

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

/**
 * Wrap the app with this to enable toast notifications.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState(/** @type {ToastItem[]} */ ([]));
  const nextId = useRef(1);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (message, type = 'info') => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, type }]);
      const timer = setTimeout(() => dismiss(id), 3000);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      timers.current.forEach((t) => clearTimeout(t));
      timers.current.clear();
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ showToast, dismiss }}>
      {children}
      <div className={styles.stack} role="region" aria-live="polite">
        {toasts.map(({ id, message, type }) => {
          const Icon = ICONS[type] ?? Info;
          return (
            <div
              key={id}
              className={cn(styles.toast, styles[type])}
              onClick={() => dismiss(id)}
            >
              <Icon size={18} className={styles.icon} aria-hidden="true" />
              <span className={styles.message}>{message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Access the toast API. Must be called from a component wrapped in ToastProvider.
 * @returns {{ showToast: (message: string, type?: 'success'|'error'|'info') => void, dismiss: (id: number) => void }}
 */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside a ToastProvider');
  }
  return ctx;
}
