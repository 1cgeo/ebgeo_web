// Path: src/app.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import config from './config.js';
import { one } from './database/index.js';
import { NotFoundError } from './utils/errors.js';
import { requestLogger } from './middleware/request-logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { flexibleAuth } from './middleware/flexible-auth.js';

// Module routes
import { authRoutes } from './modules/auth/index.js';
import { usersRoutes } from './modules/users/index.js';
import { atlasRoutes } from './modules/atlas/index.js';
import { makeCatalogRouter } from './modules/catalog/index.js';
import { configRoutes } from './modules/config/index.js';
import { nomesRoutes, assets3dRoutes } from './modules/nomes/index.js';
import { organizationsRoutes } from './modules/organizations/index.js';
import { ranksRoutes } from './modules/ranks/index.js';
import { auditRoutes } from './modules/audit/index.js';
import { zonesRoutes } from './modules/zones/index.js';
import { sv360Routes } from './modules/streetview360/index.js';
import { debugRoutes } from './modules/debug/debug.routes.js';
import { isTraceEnabled } from './utils/sync-trace.js';

/**
 * Creates and configures the Express application.
 * @returns {express.Application}
 */
export function createApp() {
  const app = express();

  // Global middleware (order matters)
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: config.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));
  app.use(cors({ origin: config.cors.origin, credentials: true }));
  app.use(cookieParser());
  app.use(compression());

  // Body parsing. The bulk image endpoint carries a base64 batch (up to 50
  // images) that can exceed the default 10mb; give it a dedicated, bounded limit
  // so the documented per-image limit is actually reachable. Every other route
  // keeps the conservative 10mb cap. The bulk parser must win for that path, so
  // it is selected before the global parser runs (a second express.json would
  // no-op once req.body is set).
  const jsonParser = express.json({ limit: '10mb' });
  const bulkJsonParser = express.json({ limit: `${config.images.maxBulkUploadMb}mb` });
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.path.endsWith('/images/bulk')) {
      return bulkJsonParser(req, res, next);
    }
    return jsonParser(req, res, next);
  });

  // Non-blocking global auth: populates req.user when a credential is present
  // (api key / cookie / Bearer); the anonymous path is preserved.
  app.use(flexibleAuth);

  // Request logging (skip in test to reduce noise)
  if (!config.isTest) {
    app.use(requestLogger);
  }

  // Health check (no auth) — readiness: touches the DB, 503 if it is down.
  app.get('/api/v1/health', async (req, res) => {
    try {
      await one('SELECT 1 AS ok');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable' },
      });
    }
  });

  // Public runtime config (no auth) — mounted before authenticated routes.
  app.use('/api/v1/config', configRoutes);
  app.use('/api/config', configRoutes); // compatibility alias

  // Public 3D asset serving (immutable, Range/ETag). Discovery is gated by the
  // authenticated catalog (GET /api/v1/nomes/catalogo3d).
  app.use('/api/v1/assets3d', assets3dRoutes);

  // Route mounting
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/users', usersRoutes);
  app.use('/api/v1/atlas', atlasRoutes);
  // Catálogo — uma rota por tipo de recurso (cada uma é sua própria tabela).
  app.use('/api/v1/basemaps', makeCatalogRouter('basemaps'));
  app.use('/api/v1/data-layers', makeCatalogRouter('data_layers'));
  app.use('/api/v1/analysis-layers', makeCatalogRouter('analysis_layers'));
  app.use('/api/v1/tilesets', makeCatalogRouter('tilesets'));
  app.use('/api/v1/streetview-markers', makeCatalogRouter('streetview_markers'));
  app.use('/api/v1/nomes', nomesRoutes);
  app.use('/api/v1/organizations', organizationsRoutes);
  app.use('/api/v1/ranks', ranksRoutes);
  app.use('/api/v1/audit', auditRoutes);
  app.use('/api/v1/zones', zonesRoutes);
  app.use('/api/v1/sv360', sv360Routes);

  // SyncLedger debug-trace endpoint — env-gated (test/dev only), never in production.
  // The `!config.isProd` clause is a hard production cross-check: even if EBGEO_TRACE=1
  // leaks into a prod env (making isTraceEnabled() true), the routes are NOT mounted.
  if (isTraceEnabled() && !config.isProd) {
    app.use('/api/v1/debug', debugRoutes);
  }

  // 404 for unmatched routes (before the error handler)
  app.use((req, res, next) => {
    next(new NotFoundError('Route'));
  });

  // Centralized error handler (must be last)
  app.use(errorHandler);

  return app;
}

export default createApp();
