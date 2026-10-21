import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './Button.jsx';
import styles from './Dialog.module.css';

// Modal built on the native <dialog>: the browser traps focus, makes the page inert,
// closes on Escape and returns focus to the opener. Controlled through `open` / `onClose`.
export function Dialog({ open, onClose, title, description, children, footer }) {
  const ref = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      // A click on the dialog element itself (not its content) is a click on the backdrop.
      onClick={(event) => event.target === ref.current && onClose()}
    >
      <div className={styles.content}>
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
        </div>
        {description && (
          <p id={descriptionId} className={styles.description}>
            {description}
          </p>
        )}
        {children && <div className={styles.body}>{children}</div>}
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </dialog>
  );
}
