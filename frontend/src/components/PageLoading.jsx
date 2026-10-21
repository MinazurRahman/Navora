import { LoaderCircle } from 'lucide-react';
import styles from './PageLoading.module.css';

export function PageLoading({ label = 'Loading' }) {
  return (
    <div className={styles.loading} role="status">
      <LoaderCircle className="spin" size={24} aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </div>
  );
}
