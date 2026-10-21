import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import styles from './Toast.module.css';
import { ToastContext } from './useToast.js';

const ICONS = { info: Info, success: CircleCheck, danger: CircleAlert };
const DISMISS_AFTER_MS = 6000;

// Short confirmations after an action ("Place saved"). Anything the user must act on
// belongs in an inline Alert instead, because toasts disappear.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    ({ tone = 'info', message }) => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, tone, message }]);
      timers.current.set(id, setTimeout(() => dismiss(id), DISMISS_AFTER_MS));
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {toasts.map(({ id, tone, message }) => {
          const Icon = ICONS[tone];
          return (
            <div key={id} className={`${styles.toast} ${styles[tone]}`}>
              <Icon className={styles.icon} size={18} aria-hidden="true" />
              <p className={styles.message}>{message}</p>
              <button type="button" className={styles.close} onClick={() => dismiss(id)} aria-label="Dismiss">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

