// Small shared building blocks: notices, loading and empty states, pagination, stars, chips.

import { useId, useState, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { errorMessage } from '../lib/errors';
import type { FacilityStatus, PaginationMeta } from '../api/types';
import { FACILITY_LABEL } from '../lib/format';

export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'warning' | 'error' | 'success';
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div>
        {title && <p className="notice__title">{title}</p>}
        {children && <div className="notice__body">{children}</div>}
      </div>
      {action && <div className="notice__action">{action}</div>}
    </div>
  );
}

/** Shows an API error the way a traveller can act on it, plus the request ID for bug reports. */
export function ErrorNotice({ error, title, action }: { error: unknown; title?: string; action?: ReactNode }) {
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <Notice tone="error" title={title ?? errorMessage(error)} action={action}>
      {title && <p>{errorMessage(error)}</p>}
      {requestId && <p className="fine">Reference for support: {requestId}</p>}
    </Notice>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="loading__dot" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {children && <div className="empty__body">{children}</div>}
    </div>
  );
}

export function Pagination({ meta, onPage }: { meta: PaginationMeta; onPage: (page: number) => void }) {
  if (meta.totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pages">
      <button className="btn btn--ghost" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
        Previous
      </button>
      <span className="muted">
        Page {meta.page} of {meta.totalPages}
      </span>
      <button className="btn btn--ghost" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>
        Next
      </button>
    </nav>
  );
}

export function Stars({ value, size = 'sm' }: { value: number | null; size?: 'sm' | 'lg' }) {
  const rounded = value === null ? 0 : Math.round(value * 2) / 2;
  return (
    <span className={`stars stars--${size}`} aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={rounded >= n ? 'on' : rounded >= n - 0.5 ? 'half' : ''}>
          ★
        </span>
      ))}
    </span>
  );
}

export function StarInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const name = useId();
  const [hover, setHover] = useState(0);
  return (
    <fieldset className="star-input" onMouseLeave={() => setHover(0)}>
      <legend className="sr-only">Rating</legend>
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className={(hover || value) >= n ? 'on' : ''} onMouseEnter={() => setHover(n)}>
          <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} />
          <span aria-hidden>★</span>
          <span className="sr-only">
            {n} star{n > 1 ? 's' : ''}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Yes / No / Unknown. Unknown is drawn hatched so it never reads as "yes". */
export function FacilityBadge({ label, status }: { label: string; status: FacilityStatus }) {
  return (
    <span className={`facility facility--${status.toLowerCase()}`} title={`${label}: ${FACILITY_LABEL[status]}`}>
      <span className="facility__label">{label}</span>
      <span className="facility__value">{FACILITY_LABEL[status]}</span>
    </span>
  );
}

export function ChipGroup<T extends string>({
  options,
  selected,
  onToggle,
  label,
}: {
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (value: T) => void;
  label: string;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            type="button"
            key={o.value}
            className={`chip ${on ? 'chip--on' : ''}`}
            aria-pressed={on}
            onClick={() => onToggle(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className={`field ${error ? 'field--error' : ''}`}>
      <span className="field__label">{label}</span>
      {children}
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__track" aria-hidden />
      <span>
        <span className="toggle__label">{label}</span>
        {hint && <span className="field__hint">{hint}</span>}
      </span>
    </label>
  );
}
