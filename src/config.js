// Path: src/config.js

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key, fallback) {
  return process.env[key] || fallback;
}

const nodeEnv = optional('NODE_ENV', 'development');

/**
 * Resolves whether self-registration (`POST /auth/register`) is enabled.
 * Pure helper (testable in isolation). Default: disabled in production,
 * enabled in development/test so the existing suite and local dev keep working.
 * @param {string} env - NODE_ENV value
 * @param {string|undefined} override - ALLOW_SELF_REGISTRATION env value
 * @returns {boolean}
 */
export function resolveAllowSelfRegistration(env, override) {
  if (override === 'true') return true;
  if (override === 'false') return false;
  return env !== 'production';
}

const config = Object.freeze({
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv,
  logLevel: optional('LOG_LEVEL', 'info'),

  db: Object.freeze({
    connectionString: required('DATABASE_URL'),
    poolMin: parseInt(optional('DATABASE_POOL_MIN', '2'), 10),
    poolMax: parseInt(optional('DATABASE_POOL_MAX', '10'), 10),
  }),

  jwt: Object.freeze({
    secret: required('JWT_SECRET'),
    accessExpiry: optional('JWT_ACCESS_EXPIRY', '15m'),
    refreshExpiry: optional('JWT_REFRESH_EXPIRY', '7d'),
    // Algorithm allowlist for jwt.verify — never accept `none`/asymmetric forgery.
    algorithms: ['HS256'],
  }),

  cors: Object.freeze({
    origin: optional('CORS_ORIGIN', 'http://localhost:8080'),
  }),

  images: Object.freeze({
    dir: optional('IMAGES_DIR', './data/images'),
    maxSizeMb: parseInt(optional('MAX_IMAGE_SIZE_MB', '10'), 10),
  }),

  assets3d: Object.freeze({
    dir: optional('ASSETS_3D_DIR', './data/assets3d'),
    baseUrl: optional('ASSETS_3D_BASE_URL', '/api/v1/assets3d'),
    // SQLite BLOB store (served first; filesystem `dir` is the fallback).
    sqlitePath: optional('ASSETS_3D_SQLITE', './data/assets3d.sqlite'),
    maxInflight: parseInt(optional('ASSETS_3D_MAX_INFLIGHT', '8'), 10),
  }),

  ws: Object.freeze({
    heartbeatIntervalMs: parseInt(optional('WS_HEARTBEAT_INTERVAL_MS', '30000'), 10),
    heartbeatTimeoutMs: parseInt(optional('WS_HEARTBEAT_TIMEOUT_MS', '5000'), 10),
  }),

  rateLimit: Object.freeze({
    // Credential routes (login/refresh/register): strict.
    authWindowMs: parseInt(optional('RATE_LIMIT_AUTH_WINDOW_MS', '900000'), 10), // 15 min
    authMax: parseInt(optional('RATE_LIMIT_AUTH_MAX', '10'), 10),
    // Public link route: looser, by IP only.
    publicWindowMs: parseInt(optional('RATE_LIMIT_PUBLIC_WINDOW_MS', '60000'), 10), // 1 min
    publicMax: parseInt(optional('RATE_LIMIT_PUBLIC_MAX', '30'), 10),
  }),

  security: Object.freeze({
    allowSelfRegistration: resolveAllowSelfRegistration(nodeEnv, process.env.ALLOW_SELF_REGISTRATION),
  }),

  // Runtime app config (served by GET /api/v1/config). Service URLs and tile
  // sources are injected by deployment env so the frontend never needs a rebuild
  // to point at internal DGEO servers. Defaults are public DEV-only placeholders.
  appConfig: Object.freeze({
    tileServerUrl: optional('TILE_SERVER_URL', ''),
    searchApiUrl: optional('SEARCH_API_URL', 'http://localhost:3001/busca'),
    terrainUrl: optional('TERRAIN_URL', 'https://demotiles.maplibre.org/terrain-tiles/tiles.json'),
    hillshadeUrl: optional('HILLSHADE_URL', 'https://demotiles.maplibre.org/terrain-tiles/tiles.json'),
    map3dImageryUrl: optional('MAP3D_IMAGERY_URL', 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'),
    map3dTerrainUrl: optional('MAP3D_TERRAIN_URL', 'http://localhost/terrain/tilesets/terrain'),
    sv360ServiceUrl: optional('SV360_SERVICE_URL', 'http://localhost:8081/api/v1'),
    sv360PointsUrl: optional('SV360_POINTS_URL', 'http://localhost:3000/fotos'),
    sv360LinesUrl: optional('SV360_LINES_URL', 'http://localhost:3000/fotos_linha'),
    // Basemap tile/style URLs (substitutable by internal servers in production):
    osmTileUrl: optional('OSM_TILE_URL', 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'),
    glyphsUrl: optional('MAPLIBRE_GLYPHS_URL', 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'),
    imagensTileUrl: optional('IMAGENS_TILE_URL', 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'),
    ortoimagemTileUrl: optional('ORTOIMAGEM_TILE_URL', 'https://bdgex.eb.mil.br/mapcache?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=ortoimagem_mercator&TILED=true&WIDTH=256&HEIGHT=256&SRS=EPSG%3A3857&STYLES=&BBOX={bbox-epsg-3857}'),
    bdgexWmsUrl: optional('BDGEX_WMS_URL', 'https://bdgex.eb.mil.br/mapcache?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng&TRANSPARENT=true&LAYERS=ctmmultiescalas_mercator&TILED=true&WIDTH=256&HEIGHT=256&SRS=EPSG%3A3857&STYLES=&BBOX={bbox-epsg-3857}'),
  }),

  get isDev() { return this.nodeEnv === 'development'; },
  get isProd() { return this.nodeEnv === 'production'; },
  get isTest() { return this.nodeEnv === 'test'; },
});

/**
 * Fail-fast validation of environment variables at boot, grouped by context.
 * Accumulates ALL errors (does not stop at the first) and throws once with a
 * readable summary. Call this in `src/index.js` BEFORE starting the server.
 * NOT called from `app.js` (imported by the test suite via supertest).
 * @throws {Error} if any rule fails.
 */
export function validateEnvVariables() {
  const errors = [];
  const isProd = nodeEnv === 'production';

  // Database
  if (!process.env.DATABASE_URL) errors.push('DATABASE_URL é obrigatório');

  // Authentication / Security
  const secret = process.env.JWT_SECRET || '';
  if (!secret) errors.push('JWT_SECRET é obrigatório');
  else if (isProd && secret.length < 32) {
    errors.push('JWT_SECRET deve ter >= 32 caracteres em produção');
  }

  // Server
  const port = parseInt(process.env.PORT || '3000', 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    errors.push('PORT deve estar entre 1 e 65535');
  }

  // CORS
  if (process.env.CORS_ORIGIN) {
    try {
      new URL(process.env.CORS_ORIGIN);
    } catch {
      errors.push('CORS_ORIGIN deve ser uma URL válida');
    }
  }

  if (errors.length > 0) {
    throw new Error('Configuração inválida:\n  - ' + errors.join('\n  - '));
  }
}

export default config;
