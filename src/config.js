// Path: src/config.js

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key, fallback) {
  return process.env[key] || fallback;
}

const config = Object.freeze({
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
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
  }),

  cors: Object.freeze({
    origin: optional('CORS_ORIGIN', 'http://localhost:8080'),
  }),

  images: Object.freeze({
    dir: optional('IMAGES_DIR', './data/images'),
    maxSizeMb: parseInt(optional('MAX_IMAGE_SIZE_MB', '10'), 10),
  }),

  ws: Object.freeze({
    heartbeatIntervalMs: parseInt(optional('WS_HEARTBEAT_INTERVAL_MS', '30000'), 10),
    heartbeatTimeoutMs: parseInt(optional('WS_HEARTBEAT_TIMEOUT_MS', '5000'), 10),
  }),

  get isDev() { return this.nodeEnv === 'development'; },
  get isProd() { return this.nodeEnv === 'production'; },
  get isTest() { return this.nodeEnv === 'test'; },
});

export default config;
