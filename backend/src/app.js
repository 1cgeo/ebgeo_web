// Path: src/app.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import config from './config.js';
import { one } from './database/index.js';
import { NotFoundError, ServiceUnavailableError } from './utils/errors.js';
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

  // Must be set before any IP-keyed middleware reads `req.ip`. Without it Express
  // reports the nginx address for every request, which silently turns each rate
  // limiter into ONE global bucket: 30 public-link requests a minute for the whole
  // internet, and — worse — an auth bucket keyed by username alone, so anyone who
  // knows a username can hold that account locked out indefinitely from any IP.
  // See config.trustProxy for the hop count and the danger of over-trusting.
  app.set('trust proxy', config.trustProxy);

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

  // Non-blocking global auth: populates req.user when a credential is present
  // (api key / cookie / Bearer); the anonymous path is preserved. It reads only
  // headers/cookies/query, never the body, so it MUST run before body parsing —
  // that ordering is what lets the enlarged bulk limit below require a principal.
  app.use(flexibleAuth);

  // Body parsing. The bulk image endpoint carries a base64 batch (up to 50
  // images) that can exceed the default 10mb; give it a dedicated, bounded limit
  // so the documented per-image limit is actually reachable. Every other route
  // keeps the conservative 10mb cap. The bulk parser must win for that path, so
  // it is selected before the global parser runs (a second express.json would
  // no-op once req.body is set).
  //
  // Two conditions guard the enlarged parser, and both are load-bearing:
  //
  //  - the path must be the REAL route, anchored. It used to be any path whose
  //    suffix was `/images/bulk`, so `POST /qualquer/coisa/images/bulk` — a route
  //    that does not exist — bought 5x the global body limit; the 50mb were
  //    buffered and JSON.parse'd before Express even discovered the 404.
  //  - a VERIFIED principal must already be attached. The gate on the route
  //    itself (images.routes.js: `auth` + `requireAtlasPermission('write')`) ran
  //    only after the parse, so the memory blast that config.js calls
  //    "authenticated" was reachable by anyone, anonymously. `req.user` (not the
  //    mere presence of an Authorization header, which anybody can forge) is what
  //    flexibleAuth sets only after jwt.verify / a valid api key.
  //
  // Cost, stated plainly: a caller whose access token has EXPIRED falls back to
  // the 10mb parser, so a >10mb batch answers 413 instead of 401. That is the same
  // ordering the finding's preferred fix (a route-local parser mounted after
  // `auth`) produces, and it errs on the safe side — an anonymous caller can never
  // spend more memory than any other unauthenticated POST.
  const BULK_IMAGES_PATH =
    /^\/api\/v1\/atlas\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/images\/bulk\/?$/i;
  const jsonParser = express.json({ limit: '10mb' });
  const bulkJsonParser = express.json({ limit: `${config.images.maxBulkUploadMb}mb` });
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.user && BULK_IMAGES_PATH.test(req.path)) {
      return bulkJsonParser(req, res, next);
    }
    return jsonParser(req, res, next);
  });

  // Request logging. Montado em TODO ambiente, teste inclusive. O gate
  // `if (!config.isTest)` que morava aqui dizia "skip in test to reduce noise" e
  // não reduzia ruído nenhum: o logger já sai em `level: 'silent'` sob teste
  // (`src/utils/logger.js:75`). O que ele fazia era impedir que `res.on('finish')`
  // rodasse na suíte inteira, o que deixava `request-logger.js` em 27,6% de
  // cobertura, justamente o arquivo onde mora o risco de vazar token para o log.
  // Gate que não faz o que promete e apaga a cobertura do caminho que ele protege
  // custa mais do que rende. Removido em 2026-07-25.
  app.use(requestLogger);

  // Health check (no auth) — readiness: touches the DB, 503 if it is down.
  //
  // The probe carries its OWN deadline because nothing below it has one. The pool
  // is built with connectionString/max/min only (database/index.js), so `pg` keeps
  // its default `connectionTimeoutMillis: 0` — wait forever for a slot — and no
  // statement_timeout is set either. Without the race, `one()` neither resolved
  // nor rejected while the pool was saturated (the C5 advisory-lock incident did
  // exactly that with a single client) or while the DB host was dropping packets
  // instead of refusing: the handler never reached `res`, the probe timed out on
  // the caller's side, and the orchestrator read "no answer" instead of the
  // unavailability signal this endpoint exists to produce — with every probe
  // enqueuing one more waiter on the exhausted pool. Only the "Postgres stopped on
  // the same host" case (fast ECONNREFUSED) honoured the contract.
  //
  // A pool-level `connectionTimeoutMillis` / `statement_timeout` would bound this
  // for the whole backend, not just here; that is a database/index.js change, left
  // out of this fix's scope on purpose.
  app.get('/api/v1/health', async (req, res) => {
    let timer;
    try {
      await Promise.race([
        one('SELECT 1 AS ok'),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new ServiceUnavailableError('Database probe timed out')),
            config.health.dbTimeoutMs
          );
          // Never let the readiness deadline hold the event loop open.
          timer.unref?.();
        }),
      ]);
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable' },
      });
    } finally {
      clearTimeout(timer);
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
