// Path: src/app.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import config from './config.js';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler } from './middleware/error-handler.js';

// Module routes
import { authRoutes } from './modules/auth/index.js';
import { usersRoutes } from './modules/users/index.js';
import { atlasRoutes } from './modules/atlas/index.js';
import { resourcesRoutes } from './modules/resources/index.js';

/**
 * Creates and configures the Express application.
 * @returns {express.Application}
 */
export function createApp() {
  const app = express();

  // Global middleware (order matters)
  app.use(helmet());
  app.use(cors({ origin: config.cors.origin, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));

  // Request logging (skip in test to reduce noise)
  if (!config.isTest) {
    app.use(requestLogger);
  }

  // Health check (no auth)
  app.get('/api/v1/health', (req, res) => res.json({ status: 'ok' }));

  // Route mounting
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/users', usersRoutes);
  app.use('/api/v1/atlas', atlasRoutes);
  app.use('/api/v1/resources', resourcesRoutes);

  // Centralized error handler (must be last)
  app.use(errorHandler);

  return app;
}

export default createApp();
