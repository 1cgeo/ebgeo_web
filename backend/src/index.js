// Path: src/index.js
import { createServer } from 'http';
import app from './app.js';
import config, { validateEnvVariables } from './config.js';
import logger from './utils/logger.js';
import { pgp, one, db } from './database/index.js';
import { attachWebSocket, closeAllSockets } from './modules/collab/index.js';
import { blobPool } from './utils/sqlite-blob-pool.js';
import {
  criarAmostradorDeSaude,
  deveAmostrar,
  sondarBancoComPrazo,
} from './utils/amostra-de-saude.js';

// Fail fast and loudly on misconfiguration before accepting any connection.
validateEnvVariables();

const server = createServer(app);

// Attach WebSocket upgrade handler to the same HTTP server.
//
// O retorno é o `WebSocketServer`, e é ele que dá a contagem de sockets vivos à amostra de
// saúde abaixo (`wss.clients.size`). A alternativa seria um contador exportado por
// `modules/collab/`, ou seja, mais uma superfície pública num módulo de domínio para servir
// à observabilidade; aqui o boot já tem o objeto em mãos e ninguém precisa saber disso.
const wss = attachWebSocket(server);

server.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'EBGeo backend started');
});

// A amostra periódica de saúde. Ela mora AQUI, e não em `app.js`, pelo mesmo motivo que
// `validateEnvVariables()`: `app.js` é importado pela suíte via supertest, e um timer que
// nascesse de lá subiria em toda rodada de teste. O gate de ambiente de `deveAmostrar` é a
// segunda amarra dessa mesma decisão, não a única.
const decisaoDaAmostra = deveAmostrar({
  ativa: config.health.amostra.ativa,
  isTest: config.isTest,
  intervaloMs: config.health.amostra.intervaloMs,
});

let amostrador = null;
if (decisaoDaAmostra.ligar) {
  amostrador = criarAmostradorDeSaude({
    intervaloMs: config.health.amostra.intervaloMs,
    sondarBanco: () => sondarBancoComPrazo({
      consultar: () => one('SELECT 1 AS ok'),
      prazoMs: config.health.amostra.dbTimeoutMs,
    }),
    // `$pool` é o `pg-pool` por baixo do pg-promise: totalCount / idleCount / waitingCount.
    // `descreverPool` é defensivo quanto à forma, então uma atualização da biblioteca omite
    // o campo em vez de publicar NaN na série.
    lerPool: () => db.$pool,
    contarSockets: () => wss.clients.size,
    registrar: logger,
  });
  logger.info(
    { intervaloMs: config.health.amostra.intervaloMs },
    'Amostra periódica de saúde ligada'
  );
} else {
  // Dizer POR QUE não ligou, senão "não há amostra no log" é indistinguível de "o
  // amostrador quebrou", que é a classe de silêncio que esta camada existe para fechar.
  logger.info({ motivo: decisaoDaAmostra.motivo }, 'Amostra periódica de saúde desligada');
}

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
  // Parar a amostra ANTES de fechar o pool: uma sonda que caísse depois do `pgp.end()`
  // escreveria uma linha de banco fora no desligamento, e um incidente falso no fim de todo
  // deploy é como uma série de saúde perde o valor.
  amostrador?.parar();
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
