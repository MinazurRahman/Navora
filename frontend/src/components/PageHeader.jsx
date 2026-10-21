import styles from './PageHeader.module.css';

export function PageHeader({ title, description, actions }) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        <h1>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
