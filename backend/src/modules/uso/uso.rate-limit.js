// Path: src/modules/uso/uso.rate-limit.js
/**
 * @fileoverview Independent rate limits for usage and presence. Defaults allow 600 requests per minute per address to accommodate shared NAT; deployment can tune RATE_LIMIT_USO_EVENTOS_MAX and RATE_LIMIT_USO_PRESENCA_MAX. Validation and verified identity remain separate responsibilities.
 */

import rateLimit from 'express-rate-limit';
import { makeLimiterHandler } from '../../middleware/rate-limit.js';
import config from '../../config.js';
import { tetoDeEnv } from '../../utils/teto-de-env.js';

export const usoEventosLimiter = rateLimit({
  windowMs: tetoDeEnv('RATE_LIMIT_USO_EVENTOS_WINDOW_MS', 60_000),
  max: tetoDeEnv('RATE_LIMIT_USO_EVENTOS_MAX', 600),
  standardHeaders: true,
  legacyHeaders: false,
  // Mesmos dois desligamentos de `src/middleware/rate-limit.js`, e pelo mesmo motivo: a
  // suíte dirige o limitador por supertest num endereço de loopback, e estas duas checagens
  // avisariam a cada rodada sem indicar problema real. As demais ficam LIGADAS.
  validate: { trustProxy: !config.isTest, xForwardedForHeader: !config.isTest },
  handler: makeLimiterHandler('uso-eventos'),
  // O store em memória acumularia pela rodada inteira (o app é importado uma vez), então o
  // default em teste é pular; `RATE_LIMIT_FORCE=1` religa para o caso dedicado.
  skip: () => config.isTest && process.env.RATE_LIMIT_FORCE !== '1',
});

// Independent bucket: heartbeats must not consume the usage delivery budget.
export const usoPresencaLimiter = rateLimit({
  windowMs: 60000,
  max: tetoDeEnv('RATE_LIMIT_USO_PRESENCA_MAX', 600),
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: !config.isTest, xForwardedForHeader: !config.isTest },
  handler: makeLimiterHandler('uso-presenca'),
  skip: () => config.isTest && process.env.RATE_LIMIT_FORCE !== '1',
});
