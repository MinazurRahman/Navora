// Tracks whether *this* instance is shutting down, so /ready can tell the load balancer
// to stop routing here. Instance-local by design: it describes this process only.
export function createLifecycle() {
  let shuttingDown = false;
  return {
    isShuttingDown: () => shuttingDown,
    markShuttingDown() {
      shuttingDown = true;
    },
  };
}
