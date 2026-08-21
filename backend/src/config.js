// Path: src/config.js

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key, fallback) {
  return process.env[key] || fallback;
}

/** Inteiro opcional: ausente/ilegível → undefined (o consumidor decide o default). */
function optionalInt(key) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
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

  health: Object.freeze({
    // Deadline the readiness probe (`GET /api/v1/health`) applies to its own DB
    // round-trip. Nothing else in the stack has a timeout (see the note in
    // app.js), so this is what turns "the DB is unreachable" into a 503 instead of
    // a hung request. Short by design: a readiness answer that arrives late is
    // already useless to an orchestrator.
    dbTimeoutMs: parseInt(optional('HEALTH_DB_TIMEOUT_MS', '2000'), 10),
  }),

  cors: Object.freeze({
    // O default é a origem do FRONTEND (Vite em :3000), não a do backend. Estava
    // `:8080` — a porta do próprio backend —, o que liberava uma origem que nunca
    // faz requisição cross-origin e bloqueava a que faz. Em dev o browser fala com
    // o Vite, que faz proxy de /api, então na prática é same-origin; isso só
    // aparece quando o front é servido de outra origem (o caso do E2E, que já
    // passa CORS_ORIGIN explícito).
    origin: optional('CORS_ORIGIN', 'http://localhost:3000'),
  }),

  images: Object.freeze({
    dir: optional('IMAGES_DIR', './data/images'),
    maxSizeMb: parseInt(optional('MAX_IMAGE_SIZE_MB', '10'), 10),
    // Bounded body limit for POST /images/bulk (base64 batch, up to 50 images).
    // Larger than the global JSON limit so the per-image limit is actually
    // reachable in a batch; still capped to bound the authenticated memory blast.
    // "Authenticated" is now enforced rather than assumed: app.js only selects this
    // parser for the anchored bulk route AND when flexibleAuth has already attached
    // a verified `req.user` — before that, any anonymous POST to a path merely
    // ENDING in /images/bulk got the enlarged limit.
    maxBulkUploadMb: parseInt(optional('MAX_BULK_UPLOAD_MB', '50'), 10),
  }),

  assets3d: Object.freeze({
    dir: optional('ASSETS_3D_DIR', './data/assets3d'),
    baseUrl: optional('ASSETS_3D_BASE_URL', '/api/v1/assets3d'),
    // SQLite BLOB store (served first; filesystem `dir` is the fallback).
    sqlitePath: optional('ASSETS_3D_SQLITE', './data/assets3d.sqlite'),
    maxInflight: parseInt(optional('ASSETS_3D_MAX_INFLIGHT', '8'), 10),
  }),

  sv360: Object.freeze({
    // Directory holding the per-project {slug}.db SQLite stores (WebP BLOBs).
    dbDir: optional('SV360_DB_DIR', './data/sv360'),
    // Caps in-heap BLOB buffers served concurrently (mirrors assets3d).
    maxInflight: parseInt(optional('SV360_MAX_INFLIGHT', '8'), 10),
    // Multer streams the uploaded images.db (multi-GB) here BEFORE the atomic swap.
    // MUST be on the same volume as dbDir so the .tmp→dest rename stays atomic.
    tmpDir: optional('SV360_TMP_DIR', './data/sv360-tmp'),
    // Hard cap for the multipart upload (the images.db can be large). Default 2
    // GiB (the original 360 bodyLimit); configurable via SV360_MAX_UPLOAD_BYTES.
    // FIX-4: a tighter default bounds the authenticated disk-fill blast radius.
    maxUploadBytes: parseInt(optional('SV360_MAX_UPLOAD_BYTES', String(2 * 1024 * 1024 * 1024)), 10),
  }),

  ws: Object.freeze({
    heartbeatIntervalMs: parseInt(optional('WS_HEARTBEAT_INTERVAL_MS', '30000'), 10),
    heartbeatTimeoutMs: parseInt(optional('WS_HEARTBEAT_TIMEOUT_MS', '5000'), 10),
    // Fase 8 (Tarefa 2): on an abnormal close (network drop / heartbeat
    // terminate) the user is marked `away` for this grace window instead of
    // being removed; a reconnect with the same clientId cancels removal.
    awayGraceMs: parseInt(optional('WS_AWAY_GRACE_MS', '120000'), 10),
  }),

  // How many reverse proxies sit in front of the app, for Express `trust proxy`.
  //
  // This is NOT cosmetic: with it unset, `req.ip` is the proxy's address for every
  // request, so every IP-keyed rate limiter collapses into a single global bucket.
  // The documented deployment puts nginx in front (docs/wiki/deploy-backend.md,
  // "NGINX: quatro itens nao negociaveis"), hence the default of 1 hop.
  //
  // Set it to 0 when the app is exposed directly. Trusting a hop that does not
  // exist is the opposite failure: X-Forwarded-For becomes client-controlled, and
  // an attacker can then forge a fresh key per request and skip the limits
  // entirely. One hop trusted must mean one hop present.
  trustProxy: parseInt(optional('TRUST_PROXY_HOPS', '1'), 10),

  rateLimit: Object.freeze({
    // Credential routes (login/refresh/register): strict.
    authWindowMs: parseInt(optional('RATE_LIMIT_AUTH_WINDOW_MS', '900000'), 10), // 15 min
    authMax: parseInt(optional('RATE_LIMIT_AUTH_MAX', '10'), 10),
    // Public link route: looser, by IP only.
    publicWindowMs: parseInt(optional('RATE_LIMIT_PUBLIC_WINDOW_MS', '60000'), 10), // 1 min
    publicMax: parseInt(optional('RATE_LIMIT_PUBLIC_MAX', '30'), 10),
    // Busca do gazetteer: ANÔNIMA de propósito (é a busca do caminho sem login),
    // então o custo por requisição é o que decide se ela vira vetor de DoS. O teto
    // é folgado por escolha: o cliente faz debounce de 300 ms
    // (`frontend/src/js/search/feature-search.control.js:71`), então um humano
    // digitando não passa de alguns por segundo em rajada, e um escritório inteiro
    // atrás de um egress compartilhado ainda cabe. O que ele corta é a varredura
    // sequencial do gazetteer, que precisa de milhares.
    gazetteerWindowMs: parseInt(optional('RATE_LIMIT_GAZETTEER_WINDOW_MS', '60000'), 10), // 1 min
    gazetteerMax: parseInt(optional('RATE_LIMIT_GAZETTEER_MAX', '300'), 10),
    // GET /api/config: anônima, e a única cuja indisponibilidade IMPEDE o boot do app
    // (fail-fast, sem fallback estático). O teto é o mais folgado do conjunto de
    // propósito, porque errar para baixo aqui não degrada uma funcionalidade, apaga o
    // produto: o cliente legítimo chama isto UMA vez por boot, mas em falha ele
    // retenta 3 vezes com 1 s de intervalo (frontend/src/js/index.js), então o mesmo
    // incidente que justifica o limitador é o que TRIPLICA a demanda legítima; e uma
    // OM inteira atrás de um egress NAT compartilha um endereço. 600/min = 10 rps por
    // endereço, ordens de grandeza acima de qualquer sala de aula abrindo o app junto
    // e ainda assim um teto, que é o que faltava. O que segura o custo por requisição
    // é a memoização (config.cache.js), não este número.
    configWindowMs: parseInt(optional('RATE_LIMIT_CONFIG_WINDOW_MS', '60000'), 10), // 1 min
    configMax: parseInt(optional('RATE_LIMIT_CONFIG_MAX', '600'), 10),
    // POST /auth/register, keyed by ADDRESS. Separate from the auth knobs above on
    // purpose: `authLimiter` keys by `${ip}:${username}`, and on a registration route
    // the username is chosen by the caller and never exists yet, so every request buys
    // a fresh bucket. This is the only ceiling that actually bounds mass account
    // creation (and the e-mail amplification that comes with it).
    //
    // Reusing authWindowMs/authMax (10 per 15 min) would be wrong in the OTHER
    // direction: the documented deployment is a whole OM behind an egress NAT, so a
    // rollout day with a class signing up together would hit the ceiling and the
    // symptom would read as "EBGeo won't let anyone register". One hour and 20 cuts
    // bulk creation without reaching human use. The knob exists because 20 is a
    // calibrated guess, not a measurement.
    registerWindowMs: parseInt(optional('RATE_LIMIT_REGISTER_WINDOW_MS', '3600000'), 10), // 1 h
    registerMax: parseInt(optional('RATE_LIMIT_REGISTER_MAX', '20'), 10),
  }),

  // Memoização em processo do payload de GET /api/config (src/modules/config/config.cache.js).
  // A invalidação é feita NA ESCRITA (catálogo, ranks, organizações e overrides de admin), que
  // é o que preserva a propagação imediata prometida pelo `Cache-Control: no-cache` da rota;
  // este TTL é só a rede de segurança para uma escrita que ninguém ligou ao invalidador (um
  // UPDATE manual no banco). 0 desliga a memoização inteira.
  configCache: Object.freeze({
    ttlMs: parseInt(optional('CONFIG_CACHE_TTL_MS', '30000'), 10), // 30 s
  }),

  security: Object.freeze({
    allowSelfRegistration: resolveAllowSelfRegistration(nodeEnv, process.env.ALLOW_SELF_REGISTRATION),
    // There is no "verification mode" knob. There used to be one, read at its own
    // definition and nowhere else in src/ — a name promising to choose the account
    // activation regime while choosing nothing. It was removed when e-mail became
    // mandatory on self-registration: a no-op switch is worse than an absent one,
    // because it invites the next reader to set it and expect an approval flow that
    // does not exist. Self-registration confirms by e-mail link, period.
    verificationTtlHours: parseInt(optional('AUTH_VERIFICATION_TTL_HOURS', '48'), 10),
  }),

  // Outbound e-mail (verification links). When SMTP is not configured (no host) the mailer
  // is a no-op that LOGS the link — the default in dev/test and in closed networks without
  // a relay. appBaseUrl builds the `?verify=<token>` link. It does NOT "fall back to the
  // request origin", which is what this comment said until 2026-07-25: `resolveVerificationBase`
  // (utils/mailer.js:50-60) honours a client-supplied origin ONLY when it equals cors.origin,
  // and otherwise returns '' — an unset appBaseUrl yields a RELATIVE link, not an attacker's
  // host. Proof lives in tests/unit/mailer-verification-link.test.js:64-96.
  mail: Object.freeze({
    host: optional('SMTP_HOST', ''),
    port: parseInt(optional('SMTP_PORT', '587'), 10),
    user: optional('SMTP_USER', ''),
    pass: optional('SMTP_PASS', ''),
    from: optional('MAIL_FROM', 'no-reply@ebgeo.local'),
    appBaseUrl: optional('APP_BASE_URL', ''),
  }),

  // Runtime app config (served by GET /api/v1/config). Service URLs and tile
  // sources are injected by deployment env so the frontend never needs a rebuild
  // to point at internal DGEO servers. Defaults are public DEV-only placeholders.
  appConfig: Object.freeze({
    tileServerUrl: optional('TILE_SERVER_URL', ''),
    terrainUrl: optional('TERRAIN_URL', 'https://demotiles.maplibre.org/terrain-tiles/tiles.json'),
    hillshadeUrl: optional('HILLSHADE_URL', 'https://demotiles.maplibre.org/terrain-tiles/tiles.json'),
    // Só se aplicam quando a URL é um TEMPLATE `{z}/{x}/{y}` (fonte por tiles);
    // numa URL TileJSON o próprio manifesto declara os zooms.
    terrainMinzoom: optionalInt('TERRAIN_MINZOOM'),
    terrainMaxzoom: optionalInt('TERRAIN_MAXZOOM'),
    hillshadeMinzoom: optionalInt('HILLSHADE_MINZOOM'),
    hillshadeMaxzoom: optionalInt('HILLSHADE_MAXZOOM'),
    map3dImageryUrl: optional('MAP3D_IMAGERY_URL', 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'),
    // Sem default: o terreno do Cesium é um serviço de DEPLOY (em produção,
    // relativo — ex.: `/cms/terrain-cesium/`). O default anterior era
    // `http://localhost/terrain/tilesets/terrain` — absoluto, sem porta e
    // inexistente —, e como `terrain.enabled` era fixo em true, toda instalação
    // sem essa env pedia ao Cesium um CesiumTerrainProvider inalcançável. Vazio
    // faz o config.service publicar `enabled: false` (elipsoide plano), que é o
    // comportamento correto de quem não tem terreno.
    map3dTerrainUrl: optional('MAP3D_TERRAIN_URL', ''),
    // Fase 9: the 360 is ABSORBED into this backend (no external :8081 upstream).
    // serviceUrl is the in-backend mount; previewThumbnail (relative) concatenates
    // with it. The frontend now consumes a server-rendered VECTOR source: the MVT
    // tiles at `${serviceUrl}/tiles/{z}/{x}/{y}.pbf` (PostGIS ST_AsMVT), carrying
    // the 'fotos' (points) and 'fotos_linha' (per-project trajectory lines) layers.
    // GeoJSON-as-source and PMTiles are DISCONTINUED. The {z}/{x}/{y} are MapLibre
    // placeholders (literals), NOT env. Only the service base is deploy-configured.
    // Default RELATIVO (mesmo padrão de ASSETS_3D_BASE_URL): o sv360 é um módulo
    // DESTE backend, montado em /api/v1/sv360 — não um serviço externo. O default
    // anterior era absoluto (`http://localhost:3000/api/v1/sv360`) e só funcionava
    // por acidente, porque :3000 é o Vite e ele faz proxy de /api para cá; num
    // deploy real, ou era configurado à mão ou o browser chamava o próprio host.
    // A env var permanece para o caso de o 360 ser servido de outra origem.
    sv360ServiceUrl: optional('SV360_SERVICE_URL', '/api/v1/sv360'),
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

// Integer env vars that are `parseInt`-ed into config, with the range each must
// fall in. Bounds are sanity limits, not policy: they exist to catch typos and
// pathological values (0 workers, a 1ms heartbeat) before the server accepts a
// connection. See the loop in validateEnvVariables for why silent NaN is unsafe.
// Exported so a test can cross-check it against the integer call sites in this
// same file: the table is maintained BY HAND, and a knob that enters config.js
// without an entry brings the silent-NaN trap back whole. That drift is not
// hypothetical — TRUST_PROXY_HOPS and the two gazetteer limiter knobs below were
// read here and absent from this table. See tests/unit/config-env-rules.test.js.
export const NUMERIC_ENV_RULES = Object.freeze({
  DATABASE_POOL_MIN: { min: 0, max: 1000 },
  DATABASE_POOL_MAX: { min: 1, max: 1000 },
  MAX_IMAGE_SIZE_MB: { min: 1, max: 1024 },
  MAX_BULK_UPLOAD_MB: { min: 1, max: 4096 },
  ASSETS_3D_MAX_INFLIGHT: { min: 1, max: 1024 },
  SV360_MAX_INFLIGHT: { min: 1, max: 1024 },
  SV360_MAX_UPLOAD_BYTES: { min: 1 },
  SQLITE_BLOB_WORKERS: { min: 1, max: 64 },
  WS_HEARTBEAT_INTERVAL_MS: { min: 1000, max: 3600000 },
  WS_HEARTBEAT_TIMEOUT_MS: { min: 100, max: 3600000 },
  WS_AWAY_GRACE_MS: { min: 0, max: 86400000 },
  RATE_LIMIT_AUTH_WINDOW_MS: { min: 1000 },
  RATE_LIMIT_AUTH_MAX: { min: 1 },
  RATE_LIMIT_PUBLIC_WINDOW_MS: { min: 1000 },
  RATE_LIMIT_PUBLIC_MAX: { min: 1 },
  RATE_LIMIT_GAZETTEER_WINDOW_MS: { min: 1000 },
  RATE_LIMIT_GAZETTEER_MAX: { min: 1 },
  RATE_LIMIT_CONFIG_WINDOW_MS: { min: 1000 },
  RATE_LIMIT_CONFIG_MAX: { min: 1 },
  RATE_LIMIT_REGISTER_WINDOW_MS: { min: 1000 },
  RATE_LIMIT_REGISTER_MAX: { min: 1 },
  // 0 é VÁLIDO e significa "sem memoização" (o desligamento explícito do cache do
  // /config). É a única entrada desta tabela cujo piso é zero, e é o que permite
  // desligar a memoização por env sem editar código.
  CONFIG_CACHE_TTL_MS: { min: 0 },
  // Hop count for Express `trust proxy`. NaN here is the worst of the set: a
  // numeric `trust proxy` is compared as `i < val`, and `i < NaN` is always
  // false, so the app silently trusts NO hop — req.ip becomes the proxy's
  // address for every request and every IP-keyed rate limiter collapses into one
  // global bucket (the failure the comment on `trustProxy` above describes). The
  // ceiling is a sanity bound: more than ten reverse proxies is a typo.
  TRUST_PROXY_HOPS: { min: 0, max: 10 },
  AUTH_VERIFICATION_TTL_HOURS: { min: 1, max: 8760 },
  HEALTH_DB_TIMEOUT_MS: { min: 100, max: 60000 },
  SMTP_PORT: { min: 1, max: 65535 },
});

/**
 * Fail-fast validation of environment variables at boot, grouped by context.
 * Accumulates the errors it reaches (does not stop at the first) and throws once
 * with a readable summary. Call this in `src/index.js` BEFORE starting the server.
 * NOT called from `app.js` (imported by the test suite via supertest).
 *
 * This JSDoc said "Accumulates ALL errors" until 2026-07-25 and that was FALSE for
 * the two variables that matter most. `DATABASE_URL` and `JWT_SECRET` are read by
 * `required()` at MODULE EVALUATION (see `config.db.connectionString` and
 * `config.jwt.secret` above), and `index.js` imports `app.js`, which imports this
 * module, before it can call this function. So a missing one throws
 * `Missing required env var: X` on its own, in English, and the accumulator never
 * runs: whoever forgets three variables discovers them one restart at a time. The
 * two branches below for those names are therefore unreachable from a real boot and
 * only fire when the function is called directly (tests).
 *
 * What the accumulator really governs is everything read with `optional()`: PORT,
 * CORS_ORIGIN, the `NUMERIC_ENV_RULES` table, the token-lifetime grammar, and the
 * production-only conditionals (the 32-char minimum for the secret, which is
 * checked only once the secret exists). Rationale and consequences in
 * `docs/wiki/hardening-borda-api.md`.
 * @throws {Error} if any rule fails.
 */
export function validateEnvVariables() {
  const errors = [];
  // Read NODE_ENV at call time (not the import-time const) so boot-time env
  // overrides and tests exercise the production branch deterministically.
  const isProd = (process.env.NODE_ENV || 'development') === 'production';

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
  if (isProd && !process.env.CORS_ORIGIN) {
    // In production CORS_ORIGIN MUST be set explicitly — the localhost default is
    // a dev-only placeholder and must never be relied on for a deployed origin.
    errors.push('CORS_ORIGIN é obrigatório em produção');
  }
  if (process.env.CORS_ORIGIN) {
    // Parseability is NOT the property that matters — being a canonical ORIGIN is.
    // `new URL()` happily accepts a trailing slash ('https://host/'), a path, an
    // explicit default port ('https://host:443') and even a comma-separated list
    // ('https://a,https://b' parses as the single hostname 'a,https'). None of
    // those is what a browser sends in the `Origin` header, and app.js passes the
    // raw value to `cors()` as a STRING — a mode in which the package compares
    // nothing and echoes the configured value verbatim into
    // Access-Control-Allow-Origin. The browser then finds it different from its own
    // origin and blocks the response: the backend answers 200 and looks perfectly
    // healthy while the frontend, whose boot is fail-fast on GET /api/config, dies
    // on "EBGeo indisponível". Comparing against `.origin` rejects all of those
    // shapes at boot, which is the only place the mistake is cheap.
    const raw = process.env.CORS_ORIGIN;
    let parsed = null;
    try {
      parsed = new URL(raw);
    } catch {
      errors.push('CORS_ORIGIN deve ser uma URL válida');
    }
    if (parsed && raw !== parsed.origin) {
      errors.push(
        'CORS_ORIGIN deve ser uma ORIGEM canônica (esquema://host[:porta]), sem caminho, '
        + `sem barra final, sem espaços e sem lista — recebido: "${raw}", esperado: "${parsed.origin}"`
      );
    }
  }

  // Self-registration needs a delivery channel, and only in production.
  //
  // With e-mail mandatory on `POST /auth/register`, an account is born pending and is
  // activated ONLY by the `?verify=` link. If there is no relay, `deliver()` degrades to
  // a `logger.error` — so the door keeps creating accounts nobody can ever activate, and
  // it does it quietly. That is the "check that does not check" class, so the boot
  // refuses instead. APP_BASE_URL rides along because `resolveVerificationBase`
  // (utils/mailer.js) only honours a client-supplied origin when it equals cors.origin;
  // unset, the link comes out RELATIVE, which is useless inside an e-mail (and
  // `resend-verification` has no client origin at all).
  //
  // Conditional on self-registration being ON, so a closed installation that never
  // needed a relay still boots. Read at call time, exactly like `isProd` above.
  const selfRegistration = resolveAllowSelfRegistration(
    process.env.NODE_ENV || 'development',
    process.env.ALLOW_SELF_REGISTRATION
  );
  if (isProd && selfRegistration) {
    if (!process.env.SMTP_HOST) {
      errors.push(
        'SMTP_HOST é obrigatório em produção com auto-cadastro ligado: sem relay nenhuma conta '
        + 'nova pode ser confirmada'
      );
    }
    if (!process.env.APP_BASE_URL) {
      errors.push(
        'APP_BASE_URL é obrigatório em produção com auto-cadastro ligado: sem ele o link de '
        + 'confirmação sai relativo'
      );
    }
  }

  // Numeric knobs (P7).
  //
  // Every one of these is read with `parseInt`, which fails SILENTLY: a typo
  // yields NaN and the value flows on to produce badly-broken behaviour rather
  // than an error. The observed cases:
  //   MAX_BULK_UPLOAD_MB=abc      → express.json({ limit: 'NaNmb' }) → NO body limit
  //   WS_HEARTBEAT_INTERVAL_MS=abc → setInterval(NaN) ≈ every 1ms → query storm
  //   DATABASE_POOL_MAX=abc        → invalid pool size
  // Only SET variables are checked — the built-in defaults are known-good.
  for (const [name, { min, max }] of Object.entries(NUMERIC_ENV_RULES)) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') continue;
    // parseInt('12abc') === 12, so the raw string must be fully numeric.
    if (!/^\d+$/.test(raw.trim())) {
      errors.push(`${name} deve ser um inteiro (recebido: "${raw}")`);
      continue;
    }
    const value = parseInt(raw, 10);
    if (value < min || (max !== undefined && value > max)) {
      const range = max !== undefined ? `entre ${min} e ${max}` : `>= ${min}`;
      errors.push(`${name} deve ser ${range} (recebido: ${value})`);
    }
  }

  // Token lifetimes. `parseDuration` (auth.service) returns 0 for anything it
  // cannot parse — and a 0ms refresh expiry means EVERY refresh token is already
  // expired when written, i.e. nobody can stay logged in. '1w' is the classic
  // trap: a natural-looking value that the `[smhd]` grammar does not accept.
  for (const name of ['JWT_ACCESS_EXPIRY', 'JWT_REFRESH_EXPIRY']) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') continue;
    if (!/^\d+[smhd]$/.test(raw.trim())) {
      errors.push(`${name} deve ser um número seguido de s|m|h|d (ex.: 15m, 7d) — recebido: "${raw}"`);
    } else if (parseInt(raw, 10) <= 0) {
      errors.push(`${name} deve ser maior que zero (recebido: "${raw}")`);
    }
  }

  if (errors.length > 0) {
    throw new Error('Configuração inválida:\n  - ' + errors.join('\n  - '));
  }
}

export default config;
