import { LoaderCircle } from 'lucide-react';
import styles from './Button.module.css';

function classes(...names) {
  return names.filter(Boolean).join(' ');
}

// variant: primary | secondary | ghost | danger. `loading` disables the button so a slow
// request cannot be submitted twice. Pass `as={Link}` (or 'a') to render a link styled as a button.
export function Button({
  as: Component = 'button',
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  disabled,
  className,
  children,
  ...props
}) {
  const isButton = Component === 'button';
  return (
    <Component
      className={classes(styles.button, styles[variant], styles[size], className)}
      {...(isButton ? { type: props.type ?? 'button', disabled: disabled || loading } : {})}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <LoaderCircle className={styles.spinner} size={16} aria-hidden="true" />
      ) : (
        Icon && <Icon size={16} aria-hidden="true" />
      )}
      {children}
    </Component>
  );
}

// Icon-only buttons must have an accessible name; `label` is also shown as a tooltip.
export function IconButton({ icon: Icon, label, variant = 'ghost', size = 'md', className, ...props }) {
  return (
    <button
      type="button"
      className={classes(styles.button, styles.iconOnly, styles[variant], styles[size], className)}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}
