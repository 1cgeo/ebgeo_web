// Path: src/index.js
import { createServer } from 'http';
import app from './app.js';
import config, { validateEnvVariables } from './config.js';
import logger from './utils/logger.js';
import { pgp } from './database/index.js';
import { attachWebSocket, closeAllSockets } from './modules/collab/index.js';
import { blobPool } from './utils/sqlite-blob-pool.js';

// Fail fast and loudly on misconfiguration before accepting any connection.
validateEnvVariables();

const server = createServer(app);

// Attach WebSocket upgrade handler to the same HTTP server
attachWebSocket(server);

server.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'EBGeo backend started');
});

// How long to wait for a graceful close before forcing the exit. Without this,
// a stuck connection keeps the process alive until the supervisor SIGKILLs it —
// which on Windows can leave SQLite handles open and break the next start.
const SHUTDOWN_TIMEOUT_MS = 10_000;

let shuttingDown = false;

/**
 * Graceful shutdown.
 *
 * P4 — the collab WebSockets are long-lived BY DESIGN, so `server.close()` (which
 * waits for every connection to end) never fired its callback while one was open:
 * `blobPool.closeAll()`, `pgp.end()` and `process.exit(0)` were all skipped. The
 * sockets are now closed first, and a force-exit timer bounds the whole thing.
 */
async function shutdown(signal) {
  if (shuttingDown) return; // a second SIGINT must not re-enter
  shuttingDown = true;
  logger.info(`${signal} received, shutting down gracefully`);

  const forceExit = setTimeout(() => {
    logger.warn({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref(); // the timer itself must not hold the process open

  try {
    // Close collab sockets FIRST, or server.close() below waits on them forever.
    await closeAllSockets();
    await new Promise((resolve) => server.close(resolve));
    await blobPool.closeAll().catch(() => {});
    pgp.end();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
