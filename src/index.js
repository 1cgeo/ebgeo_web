// Path: src/index.js
import { createServer } from 'http';
import app from './app.js';
import config from './config.js';
import logger from './utils/logger.js';
import { attachWebSocket } from './modules/collab/index.js';

const server = createServer(app);

// Attach WebSocket upgrade handler to the same HTTP server
attachWebSocket(server);

server.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'EBGeo backend started');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => process.exit(0));
});
