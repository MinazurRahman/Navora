import { describe, expect, it, vi } from 'vitest';
import { createShutdownHandler } from '../../src/shutdown.js';
import { createLifecycle } from '../../src/shared/lifecycle.js';

const silentLogger = { info() {}, error() {} };

function setup({ closeError, destroyError } = {}) {
  const calls = [];
  const server = {
    close: vi.fn((callback) => {
      calls.push('server.close');
      callback(closeError);
    }),
    closeAllConnections: vi.fn(),
  };
  const db = {
    destroy: vi.fn(async () => {
      calls.push('db.destroy');
      if (destroyError) throw destroyError;
    }),
  };
  const lifecycle = createLifecycle();
  const exit = vi.fn((code) => calls.push(`exit:${code}`));
  const shutdown = createShutdownHandler({ server, db, lifecycle, logger: silentLogger, drainMs: 0, timeoutMs: 5_000, exit });
  return { shutdown, server, db, lifecycle, exit, calls };
}

describe('graceful shutdown', () => {
  it('marks the instance not-ready, closes the server, then the database, then exits 0', async () => {
    const { shutdown, lifecycle, calls } = setup();

    const done = shutdown('SIGTERM');
    expect(lifecycle.isShuttingDown()).toBe(true);
    await done;

    expect(calls).toEqual(['server.close', 'db.destroy', 'exit:0']);
  });

  it('runs only once when signalled repeatedly', async () => {
    const { shutdown, server, exit } = setup();

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('exits with the requested code after a fatal error', async () => {
    const { shutdown, exit } = setup();
    await shutdown('uncaughtException', 1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 if a step fails', async () => {
    const { shutdown, exit } = setup({ destroyError: new Error('pool error') });
    await shutdown('SIGTERM');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
