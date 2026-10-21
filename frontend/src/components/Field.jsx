import { useId } from 'react';
import { CircleAlert } from 'lucide-react';
import styles from './Field.module.css';

// Labelled form control with hint and error text wired up for screen readers.
// children is a render function receiving the props for the control:
//   <Field label="Title" error={errors.title}>{(p) => <Input {...p} />}</Field>
export function Field({ label, hint, error, required = false, optional = false, children }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {optional && <span className={styles.optional}> (optional)</span>}
      </label>
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {children({
        id,
        required,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {error && (
        <p id={errorId} className={styles.error}>
          <CircleAlert size={14} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className = '', ...props }) {
  return <input className={`${styles.control} ${className}`} {...props} />;
}

export function Textarea({ className = '', rows = 4, ...props }) {
  return <textarea className={`${styles.control} ${styles.textarea} ${className}`} rows={rows} {...props} />;
}

export function Select({ className = '', children, ...props }) {
  return (
    <select className={`${styles.control} ${styles.select} ${className}`} {...props}>
      {children}
    </select>
  );
}

// A checkbox is its own label, so it does not use Field.
export function Checkbox({ label, description, className = '', ...props }) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div className={`${styles.checkbox} ${className}`}>
      <input id={id} type="checkbox" aria-describedby={descriptionId} {...props} />
      <div>
        <label htmlFor={id} className={styles.checkboxLabel}>
          {label}
        </label>
        {description && (
          <p id={descriptionId} className={styles.hint}>
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
