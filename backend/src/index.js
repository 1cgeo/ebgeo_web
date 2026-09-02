// Path: src/index.js
import { createServer } from 'http';
import app from './app.js';
import config, { validateEnvVariables } from './config.js';
import logger, {
  descarregarLog,
  payloadDeQueda,
  prazoRestante,
  CODIGO_DE_SAIDA_NA_QUEDA,
  TIPO_DE_QUEDA,
} from './utils/logger.js';
import { pgp, one, db } from './database/index.js';
import { attachWebSocket, closeAllSockets } from './modules/collab/index.js';
import { promises as fsp } from 'fs';
import { blobPool } from './utils/sqlite-blob-pool.js';
import {
  criarAmostradorDeSaude,
  criarMedidorDeDisco,
  deveAmostrar,
  sondarBancoComPrazo,
} from './utils/amostra-de-saude.js';
import {
  anotarDefeitoDeServidor,
  defeitoDaQueda,
  descarregarDefeitosDeServidor,
  INTERVALO_DE_DESCARGA_MS,
} from './modules/diag/defeitos-de-servidor.js';

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
    // O DISCO DO LOG_DIR, e ele existe para desfazer uma AMBIGUIDADE, nao para completar
    // um painel. Quando o disco enche, log-diario.js desliga o destino de arquivo e avisa
    // uma vez num stderr que num container nao sobrevive: a serie de amostras para. So que
    // o buraco na serie e, por decisao registrada, o sinal de que o PROCESSO morreu, e as
    // duas coisas passam a ter a mesma assinatura. A testemunha possivel e a amostra
    // ANTERIOR ao buraco, e e por isso que o campo precisa estar em toda linha e nao num
    // aviso na hora de encher: na hora de encher ja nao ha onde escrever.
    //
    // statfs e INJETADO, pela mesma razao do relogio e do fs: o modulo e puro onde da, e o
    // teste nao pode depender do volume desta maquina.
    medirDisco: criarMedidorDeDisco({ caminho: config.log.dir, statfs: fsp.statfs }),
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

/**
 * A DESCARGA PERIÓDICA DO AGREGADOR DE DEFEITOS DE SERVIDOR.
 *
 * ELA MORA AQUI PELA MESMA RAZÃO QUE A AMOSTRA DE SAÚDE LOGO ACIMA, e a razão é o supertest:
 * `app.js` é importado por todo arquivo de teste, então um timer que nascesse de lá subiria
 * em cada rodada e escreveria no banco de teste no meio das asserções de outro arquivo. O
 * gate `config.isTest` é a segunda amarra da mesma decisão, não a única, e o teste que
 * QUISER descarregar chama `descarregarDefeitosDeServidor()` de propósito, que é o caminho
 * explícito.
 *
 * `unref()` NÃO É DETALHE: sem ele este intervalo sozinho segura o event loop e o processo
 * nunca termina por conta própria, o que num container transforma todo desligamento num
 * `SIGKILL` do orquestrador. Com ele, o timer só existe enquanto houver outra razão para o
 * processo viver.
 *
 * O `catch` VAZIO É REDUNDANTE POR DESENHO: `descarregarDefeitosDeServidor` não lança por
 * contrato. Ele está aqui porque uma promessa sem dono que rejeitasse viraria
 * `unhandledRejection`, e no Node 22 isso derruba o processo, ou seja, a telemetria mataria
 * o servidor. Uma linha de defesa contra um contrato que alguém pode quebrar depois.
 */
let descargaDeDefeitos = null;
if (!config.isTest) {
  descargaDeDefeitos = setInterval(() => {
    descarregarDefeitosDeServidor().catch(() => {});
  }, INTERVALO_DE_DESCARGA_MS);
  descargaDeDefeitos.unref();
}

// How long to wait for a graceful close before forcing the exit. Without this,
// a stuck connection keeps the process alive until the supervisor SIGKILLs it —
// which on Windows can leave SQLite handles open and break the next start.
const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * O ORÇAMENTO INTEIRO da saída, não o prazo de UMA descarga.
 *
 * Curto por desenho, e é a metade que quase nunca se escreve: descarregar antes de sair é o
 * ponto, mas espera SEM teto transforma disco cheio ou cano entupido num processo que nunca
 * termina, e aí quem encerra é o orquestrador, no prazo dele, perdendo o log E o
 * desligamento limpo. Dois segundos é muito para uma fila de algumas linhas e pouco para
 * qualquer prazo de supervisor.
 *
 * ELE É COMPARTILHADO POR TODAS AS DESCARGAS DE UM MESMO CAMINHO DE SAÍDA, e é isso que o
 * nome diz. O caminho de queda tem DUAS (os defeitos agregados e o log), e dar a cada uma
 * este teto somaria os dois: o pior caso de morrer viraria quatro segundos com o servidor
 * HTTP ainda escutando. O instante-limite é calculado UMA vez em `registrarQuedaESair` e o
 * resto é repassado por `prazoRestante` (`utils/logger.js`).
 */
const ORCAMENTO_DE_SAIDA_MS = 2_000;

let shuttingDown = false;
let encerrando = false;

/**
 * A ÚNICA saída do processo: descarrega o log e então morre com o código pedido.
 *
 * POR QUE UMA SÓ, e não uma descarga por caminho de saída. São quatro caminhos que acabam
 * em `process.exit` (desligamento limpo, erro no desligamento, prazo do desligamento,
 * queda), e quem esquecesse a descarga em um deles perderia exatamente as linhas daquele
 * caminho, que são as que explicam o que aconteceu. Concentrar aqui também mantém UM
 * mecanismo de prazo por camada, em vez de dois concorrentes.
 *
 * A RE-ENTRADA É SAÍDA DURA, e é assim que ela se integra ao `forceExit` do `shutdown`:
 * aquele temporizador continua ARMADO durante a descarga, de propósito, porque ele é o teto
 * de fora. Se ele disparar enquanto a descarga está em voo, este segundo chamador não
 * espera nada e mata o processo na hora. Quem chega segundo é sempre um prazo estourado.
 *
 * O PRAZO É PARÂMETRO, com o orçamento inteiro por padrão. Quem já gastou parte do
 * orçamento antes de chegar aqui (o caminho de queda, que descarrega os defeitos primeiro)
 * passa o RESTO; os outros três caminhos não gastaram nada e ficam com o default. Sem isso a
 * última etapa reabriria um teto cheio e o orçamento deixaria de ser um.
 *
 * @param {number} codigo
 * @param {number} [prazoMs] - o que sobrou do orçamento de saída
 */
function encerrar(codigo, prazoMs = ORCAMENTO_DE_SAIDA_MS) {
  if (encerrando) {
    process.exit(codigo);
    return;
  }
  encerrando = true;
  descarregarLog({ prazoMs })
    .catch(() => {})
    .finally(() => process.exit(codigo));
}

/**
 * Graceful shutdown.
 *
 * P4 — the collab WebSockets are long-lived BY DESIGN, so `server.close()` (which
 * waits for every connection to end) never fired its callback while one was open:
 * `blobPool.closeAll()`, `pgp.end()` and `process.exit(0)` were all skipped. The
 * sockets are now closed first, and a force-exit timer bounds the whole thing.
 *
 * A ORDEM TEM UM ÚLTIMO DEGRAU, desde 2026-09-01: o LOG fecha depois de todo o resto
 * (`encerrar`), porque tudo o que os outros disserem ao morrer ainda precisa caber no
 * arquivo. Antes disso o `process.exit(0)` daqui era dado com a fila do `fs.WriteStream`
 * pendente, e `fechar()` não tinha um só chamador em `src/`: perdiam-se justamente as
 * linhas do desligamento, que são as que explicam um deploy.
 */
async function shutdown(signal) {
  if (shuttingDown) return; // a second SIGINT must not re-enter
  shuttingDown = true;
  // Parar a amostra ANTES de fechar o pool: uma sonda que caísse depois do `pgp.end()`
  // escreveria uma linha de banco fora no desligamento, e um incidente falso no fim de todo
  // deploy é como uma série de saúde perde o valor.
  amostrador?.parar();
  // O timer para ANTES do `pgp.end()` pela mesma razão que a amostra: uma descarga que caísse
  // depois do pool fechado escreveria uma linha de falha no desligamento, e um incidente
  // falso no fim de todo deploy é como uma série de saúde perde o valor. O que estava na
  // janela sai na descarga logo abaixo, com o pool ainda de pé.
  if (descargaDeDefeitos) clearInterval(descargaDeDefeitos);
  logger.info(`${signal} received, shutting down gracefully`);

  const forceExit = setTimeout(() => {
    logger.warn({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Graceful shutdown timed out, forcing exit');
    encerrar(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref(); // the timer itself must not hold the process open

  try {
    // Close collab sockets FIRST, or server.close() below waits on them forever.
    await closeAllSockets();
    await new Promise((resolve) => server.close(resolve));
    // A ÚLTIMA DESCARGA, com o pool ainda aberto: sem ela, todo desligamento perderia até
    // dez segundos de defeitos agregados, e o desligamento é justamente o fim de um deploy
    // ruim, que é quando eles importam. Ela não lança e é barata quando a janela está vazia.
    await descarregarDefeitosDeServidor().catch(() => {});
    await blobPool.closeAll().catch(() => {});
    pgp.end();
    logger.info({ signal }, 'Desligamento concluído');
    encerrar(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    encerrar(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/**
 * A MORTE DO PROCESSO PRECISA DEIXAR LINHA NO ARQUIVO.
 *
 * O BURACO QUE ISTO FECHA. Sem handler, o node imprime a pilha no STDERR e sai, e o stderr
 * não é destino do pino nesta casa: o log estruturado vai para o stdout e para o `.jsonl`
 * diário. O processo morria e o arquivo, que é a única evidência que sobrevive ao
 * fechamento do terminal, não registrava nada. A metade complementar é a série de saúde,
 * cujo sinal de queda é o BURACO (`npm run diag -- saude`): um amostrador dentro do
 * processo não testemunha a própria morte. Desde 2026-09-01 o buraco tem leitor e a queda
 * tem causa, e a linha entra em `npm run diag -- erros` de graça, porque `fatal` satisfaz
 * o `level >= 50` de `ehErro`.
 *
 * LOGA E MORRE, nunca só loga. Um processo que segue vivo depois de exceção não tratada
 * está em estado desconhecido, e trocar uma queda barulhenta por um zumbi silencioso é o
 * oposto do objetivo. Vale em dobro para `unhandledRejection`: registrar o handler já tira
 * o default do node (que é derrubar o processo), então NÃO sair aqui seria engolir a
 * rejeição, que é como um teste quebrado passa verde.
 *
 * O HANDLER NÃO PODE SER A SEGUNDA CAUSA DA QUEDA. Tudo o que monta a linha está dentro de
 * um `try`, e a saída acontece nos dois ramos: se o próprio registro falhar, sobra o
 * stderr com o erro original, e sair continua sendo obrigatório.
 *
 * ELES SÃO REGISTRADOS AQUI, NO BOOT, e não na avaliação de `utils/logger.js`. A suíte
 * importa `app.js` e os utilitários em todo arquivo de teste; um handler global que
 * nascesse de um módulo importado ficaria pendurado no processo do runner, engolindo a
 * rejeição não tratada de um caso e mascarando a falha de outro. `src/index.js` só é
 * avaliado no boot de verdade e em subprocessos de teste que o exercitam de propósito.
 */
function avisarNoStderr(texto) {
  try {
    process.stderr.write(`${texto}\n`);
  } catch {
    // Nem o stderr aceita mais escrita. Não sobra canal nenhum, e sair com o código certo
    // passa a ser a única informação que este processo ainda consegue dar.
  }
}

function registrarQuedaESair(tipo, causa, origem) {
  // O STDERR CONTINUA FALANDO, e isso não é redundância. É o que o node fazia sozinho antes
  // deste handler existir, e é o único canal que NENHUMA configuração desliga: o log
  // estruturado fica `silent` sob NODE_ENV=test, pode estar acima do nível, e o destino de
  // arquivo se auto-desliga ao degradar (disco cheio, permissão). Tirar o stderr para "não
  // duplicar" reintroduziria o mesmo buraco pelo outro lado, numa configuração em que a
  // queda não deixaria rastro nenhum. Vem PRIMEIRO porque nada abaixo é garantido.
  avisarNoStderr(
    `[queda] ${tipo}\n${causa && causa.stack ? causa.stack : String(causa)}`
  );

  let codigo = CODIGO_DE_SAIDA_NA_QUEDA;
  try {
    const { nivel, mensagem, campos, codigoDeSaida } = payloadDeQueda(tipo, causa, origem);
    codigo = codigoDeSaida;
    logger[nivel](campos, mensagem);
  } catch (err) {
    avisarNoStderr(`[queda] ${tipo} sem linha no log: ${err && err.message ? err.message : err}`);
  }

  // A QUEDA TAMBÉM É UM DEFEITO, e é o mais grave que este servidor produz: ela não tem
  // requisição, não tem status e não passa pelo `errorHandler`, então sem esta anotação ela
  // seria a única classe de falha do produto que nunca vira linha em `defeitos`.
  //
  // ANOTAR E DESCARREGAR NA MESMA RESPIRAÇÃO, porque não há próxima janela: o processo está
  // saindo. Isso é o oposto do caminho normal, em que anotar é síncrono e a escrita espera
  // dez segundos.
  //
  // AS DUAS DESCARGAS DIVIDEM UM ORÇAMENTO SÓ, e este é o único ponto do processo em que há
  // duas. `morteAte` é o instante-limite, calculado UMA vez: a descarga dos defeitos corre
  // contra ele e `encerrar` recebe o que sobrar. Dar `ORCAMENTO_DE_SAIDA_MS` a cada uma
  // somaria os dois e dobraria o pior caso de morrer, com o servidor HTTP ainda escutando
  // num processo que já está em estado desconhecido.
  //
  // O PRAZO EXISTE porque um banco que não responde é uma causa PLAUSÍVEL da própria queda,
  // e sem teto ele transformaria "morrer com registro" em "não morrer": quem encerraria
  // seria o orquestrador, no prazo dele, perdendo o log E o desligamento. `Promise.race` com
  // um timer `unref`ado, e não `setTimeout` nu, senão o timer segura o processo que ele
  // existe para não segurar.
  const morteAte = Date.now() + ORCAMENTO_DE_SAIDA_MS;
  try {
    anotarDefeitoDeServidor(defeitoDaQueda(tipo, causa, origem));
  } catch (err) {
    avisarNoStderr(`[queda] ${tipo} sem defeito anotado: ${err && err.message ? err.message : err}`);
  }
  const prazoDaDescarga = new Promise((resolve) => {
    setTimeout(resolve, prazoRestante(morteAte)).unref();
  });
  Promise.race([descarregarDefeitosDeServidor().catch(() => {}), prazoDaDescarga])
    .catch(() => {})
    .finally(() => encerrar(codigo, prazoRestante(morteAte)));
}

process.on(TIPO_DE_QUEDA.EXCECAO, (err, origem) => {
  registrarQuedaESair(TIPO_DE_QUEDA.EXCECAO, err, origem);
});
process.on(TIPO_DE_QUEDA.REJEICAO, (motivo) => {
  registrarQuedaESair(TIPO_DE_QUEDA.REJEICAO, motivo);
});
