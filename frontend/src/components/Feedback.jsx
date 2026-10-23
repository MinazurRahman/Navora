import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import styles from './Feedback.module.css';

const ALERT_ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert };

// Inline message. Errors are announced (role="alert"); other tones are static page content
// unless the caller passes a role.
export function Alert({ tone = 'info', title, children, action, role }) {
  const Icon = ALERT_ICONS[tone];
  return (
    <div className={`${styles.alert} ${styles[tone]}`} role={role ?? (tone === 'danger' ? 'alert' : undefined)}>
      <Icon className={styles.alertIcon} size={18} aria-hidden="true" />
      <div className={styles.alertBody}>
        {title && <p className={styles.alertTitle}>{title}</p>}
        {children && <div>{children}</div>}
        {action && <div className={styles.alertAction}>{action}</div>}
      </div>
    </div>
  );
}

// headingLevel: 1 when the empty state is the whole page (not found, no access), otherwise
// one below the section it sits in.
export function EmptyState({ icon: Icon, title, description, action, headingLevel = 2 }) {
  const Heading = `h${headingLevel}`;
  return (
    <div className={styles.empty}>
      {Icon && (
        <span className={styles.emptyIcon}>
          <Icon size={24} aria-hidden="true" />
        </span>
      )}
      <Heading className={styles.emptyTitle}>{title}</Heading>
      {description && <p className={styles.emptyDescription}>{description}</p>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  );
}

// Placeholder that keeps the layout stable while data loads. Hidden from screen readers;
// the loading region should carry aria-busy instead.
export function Skeleton({ width = '100%', height = '1rem', className = '' }) {
  return <span className={`${styles.skeleton} ${className}`} style={{ width, height }} aria-hidden="true" />;
}
