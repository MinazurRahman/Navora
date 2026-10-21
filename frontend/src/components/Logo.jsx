import { useId } from 'react';
import styles from './Logo.module.css';

// The N-trail compass symbol, path data copied unchanged from assets/navora-logo.svg.
export function NavoraMark({ className }) {
  // Several logos can be on one page; each needs its own gradient id.
  const gradientId = useId();
  return (
    <svg className={className} viewBox="-62 -47 124 89" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="50%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
      </defs>
      <path
        d="M -60,0 C -60,40 -20,40 0,0 C 20,-40 60,-40 60,0 L 60,40 L 40,40 L 40,10 C 40,-20 10,-20 0,-10 C -10,0 -40,10 -40,-10 Z"
        fill={`url(#${gradientId})`}
      />
      <path d="M 0,-45 L 7,-30 L 0,-15 L -7,-30 Z" fill="#1E3A8A" />
    </svg>
  );
}

// The wordmark is HTML text so it uses the page's Inter font; an <img> SVG cannot load web fonts.
// layout="inline" for headers, "stacked" reproduces the original square composition.
export function Logo({ layout = 'inline', className = '' }) {
  return (
    <span className={`${styles.logo} ${styles[layout]} ${className}`}>
      <NavoraMark className={styles.mark} />
      <span className={styles.wordmark} aria-hidden="true">
        NAVOR<span className={styles.accent}>A</span>
      </span>
      <span className="visually-hidden">NAVORA</span>
    </span>
  );
}
