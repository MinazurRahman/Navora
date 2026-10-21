import styles from './Card.module.css';

// A white surface with a thin border. `padded={false}` for content that runs edge to edge (images, maps).
export function Card({ as: Component = 'div', padded = true, className = '', children, ...props }) {
  return (
    <Component className={`${styles.card} ${padded ? styles.padded : ''} ${className}`} {...props}>
      {children}
    </Component>
  );
}
