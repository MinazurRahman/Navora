// The user's "reduce motion" setting, for animations CSS cannot reach (Leaflet, scrollIntoView).
export function prefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
}
