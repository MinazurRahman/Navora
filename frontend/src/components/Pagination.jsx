import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button.jsx';
import styles from './Pagination.module.css';

// Previous / Next with "Page x of y". Renders nothing for a single page.
export function Pagination({ page, totalPages, onPage }) {
  if (!totalPages || totalPages <= 1) return null;
  return (
    <nav className={styles.pagination} aria-label="Pages">
      <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className={styles.status}>
        Page {page} of {totalPages}
      </span>
      <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
        <ChevronRight size={16} aria-hidden="true" />
      </Button>
    </nav>
  );
}
