import styles from './Badge.module.css';

// tone: neutral | success | warning | danger | info. The text carries the meaning;
// colour only reinforces it.
export function Badge({ tone = 'neutral', icon: Icon, children }) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`}>
      {Icon && <Icon size={12} aria-hidden="true" />}
      {children}
    </span>
  );
}
