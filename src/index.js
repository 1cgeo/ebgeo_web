// Path: src/index.js
import { createServer } from 'http';
import app from './app.js';
import config, { validateEnvVariables } from './config.js';
import logger from './utils/logger.js';
import { pgp } from './database/index.js';
import { attachWebSocket } from './modules/collab/index.js';
import { blobPool } from './utils/sqlite-blob-pool.js';

// Fail fast and loudly on misconfiguration before accepting any connection.
validateEnvVariables();

const server = createServer(app);

// Attach WebSocket upgrade handler to the same HTTP server
attachWebSocket(server);

server.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'EBGeo backend started');
});

// Graceful shutdown
function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    await blobPool.closeAll().catch(() => {});
    pgp.end();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
