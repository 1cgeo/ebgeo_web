// Path: tests/ws/collab-error-leak.repro.test.js
//
// Achado 107 — o canal WS de colaboração devolvia `err.message` cru ao cliente, sem o
// gate que o REST aplica. Os três catches (handleOperation, handleOperations,
// handleSyncRequest) montavam `{type:'error', code, message: err.message}`, e como
// `pushOperations`/`pullOperations` rodam SQL direto num `tx`, o texto do driver
// chegava inteiro ao socket: nome de tabela, de constraint, de coluna. A MESMA falha
// pelo REST volta mascarada por `error-handler.js` (PG_ERROR_MAP), então metade do
// sistema aplicava a política e a outra metade não.
//
// GATILHOS. Depois que `integrityRejectionReason` (sync.service.js) passou a absorver
// as classes SQLSTATE 22 e 23 POR OPERAÇÃO, a maioria dos erros de dado nem chega mais
// aos catches do collab — vira ack com `rejected: true`. Restava UM erro de dado
// levantado fora do savepoint, e ele era um DEFEITO, não um gatilho legítimo:
// `lockedMapDenialReason` consulta `SELECT locked FROM maps WHERE id = $1` com
// `op.mapId`, que o Joi aceita como `Joi.string()` (`sync.schemas.js`), e um mapId
// não-UUID estourava 22P02 ANTES do `try` por op — abortando o lote inteiro (400 em
// laço pelo REST, frame de erro aqui). Em 2026-08-30 as duas recusas que CONSULTAM o
// banco desceram para dentro do savepoint, então o mesmo gatilho virou recusa POR
// OPERAÇÃO nas duas portas; ver
// `tests/integration/sync-mapid-nao-uuid-poison.repro.test.js`.
//
// O QUE ISSO MUDA AQUI, e é preciso dizer em voz alta para a próxima leitura não
// procurar cobertura que saiu: os dois primeiros casos deixaram de exercitar o `catch`
// de `handleOperation`/`handleOperations` e passaram a prender a MESMA política na
// porta que a op de fato toma hoje — o ack de recusa, cujo `reason` não pode carregar
// texto de driver nem ecoar o valor ofensor. O mascaramento de `frameDeErro` continua
// prendido pelo terceiro caso (`handleSyncRequest`, que segue sem savepoint) e por
// `tests/unit/safe-error-message.test.js`.
//
// AS DUAS METADES. Asserir só que o corpo está limpo deixaria passar um "fix" que
// simplesmente engole o erro. Cada teste afirma (a) que o frame recebido NÃO contém
// texto do driver, e (b) que o erro CRU, com o texto inteiro, chegou ao logger (ao
// `logger.error` do handler no caso do `sync_request`; ao `logger.warn` da recusa por
// integridade, em sync.service.js, nos dois de operação).
//
// A ÂNCORA da metade (b) é o VALOR OFENSOR, não a prosa do driver. A primeira versão
// deste arquivo procurava 'invalid input syntax' no log e falhou em toda a suíte: o
// Postgres desta máquina responde em pt-BR ('sintaxe de entrada é inválida'), que é
// exatamente a terceira razão dada por `integrityRejectionReason` para nunca
// encaminhar esse texto (ele é traduzido conforme o locale do servidor). O valor
// ofensor é a parte independente de locale — e é a única coisa que precisa estar nos
// dois lados com sinais opostos: ausente do frame, presente no log.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import logger from '../../src/utils/logger.js';

const U = () => `leak_${randomUUID().slice(0, 8)}`;

// O mapId inválido é o gatilho E a evidência: se ele reaparecer no frame do cliente,
// é porque o texto do driver ("invalid input syntax for type uuid: ...") passou.
const BAD_MAP_ID = 'nao-e-uuid-de-mapa';

/** O motivo genérico de `PG_INTEGRITY_REASONS['22P02']` (sync.service.js). */
const RECUSA_POR_FORMATO = 'Alteração descartada: identificador ou valor com formato inválido.';

/** A mensagem do `logger.warn` que carrega o erro CRU da recusa por integridade. */
const MSG_RECUSA_INTEGRIDADE = 'sync: operação recusada por violação de integridade';

/**
 * Tokens que só existem em texto de driver / de sistema de arquivos. Um único acerto
 * no frame significa vazamento.
 */
const DRIVER_TEXT = /constraint|pkey|sqlstate|violates|column|relation|invalid input syntax|out of range for type|\bmaps\b|\boperations\b/i;

/**
 * Espia a MESMA instância ESM de `logger` que collab.handlers.js importa — único
 * caminho alcançável, já que o pino sai em `level: 'silent'` sob teste (mesmo padrão
 * de tests/unit/middleware-access-logs.test.js).
 */
function spyLogger() {
  const records = [];
  const saved = [];
  for (const level of ['warn', 'error']) {
    saved.push([level, Object.getOwnPropertyDescriptor(logger, level)]);
    Object.defineProperty(logger, level, {
      configurable: true, writable: true, enumerable: false,
      value: (obj, msg) => { records.push({ level, obj, msg }); },
    });
  }
  return {
    records,
    restore() {
      for (const [level, d] of saved) {
        if (d) Object.defineProperty(logger, level, d);
        else delete logger[level];
      }
    },
  };
}

/** Envelope mínimo aceito por pushSchema, com o mapId venenoso. */
function opWithBadMap() {
  return {
    id: randomUUID(),
    entityType: 'feature',
    operationType: 'create',
    entityId: randomUUID(),
    mapId: BAD_MAP_ID,
    data: { feature_type: 'point', geometry: { coordinates: [0, 0] }, properties: { nome: 'x' } },
    timestamp: Date.now(),
    clientId: 'leak-test',
  };
}

describe('Collab WS — mensagem de erro sanitizada nos três catches (107)', () => {
  let app, db, server, owner, ownerToken, atlas, spy;
  const abertos = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const gw = await import('../../src/modules/collab/collab.gateway.js');
    gw.attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: U() });
    ownerToken = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: `Leak ${U()}` });
    await createMap(db, atlas.id);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  beforeEach(() => { spy = spyLogger(); });
  afterEach(async () => {
    spy.restore();
    // Fecha o que o teste abriu mesmo quando ele falha no meio: um socket vivo
    // segura o `after` e a suíte estoura por timeout em vez de acusar a asserção.
    for (const c of abertos.splice(0)) c.close();
  });

  /** Abre um cliente e o registra para fechamento garantido no afterEach. */
  async function openClient() {
    const c = await createWsClient(server, atlas.id, ownerToken, `c-${randomUUID().slice(0, 6)}`);
    abertos.push(c);
    return c;
  }

  /**
   * Metade (b): o erro cru precisa ter chegado ao logger. Sem esta asserção, um fix
   * que apenas engolisse o erro passaria verde.
   */
  function assertRawErrorLogged(records, msgDoHandler, valorOfensor, esperado = 1) {
    // O filtro é pela mensagem DESTE handler, não por "algum log com um Error": a
    // camada de banco já emite um 'DB Error' carregando o mesmo erro, e um filtro
    // frouxo passaria verde provando o log de outra pessoa (foi o que o controle
    // negativo pegou na suíte irmã de imagens).
    //
    // `esperado` existe porque a recusa por integridade é POR OPERAÇÃO: um lote com duas
    // ops venenosas loga duas vezes, e travar em 1 mediria o lote errado.
    const meus = records.filter((r) => r.msg === msgDoHandler);
    assert.equal(meus.length, esperado, `o log esperado tem de sair ${esperado}x: ${JSON.stringify(records.map((r) => r.msg))}`);
    for (const m of meus) {
      assert.ok(m.obj.err instanceof Error, 'o log tem de carregar o objeto de erro, não uma string');
      assert.ok(
        m.obj.err.message.includes(valorOfensor),
        `o erro CRU (com o valor ofensor "${valorOfensor}") tem de chegar ao log; capturado: ${m.obj.err.message}`
      );
    }
  }

  it('handleOperation: um mapId não-UUID vira recusa POR OPERAÇÃO, sem texto do driver', async () => {
    const client = await openClient();
    await client.waitForType('connected');
    client.clearMessages();

    const op = opWithBadMap();
    client.send({ type: 'operation', op });
    // `ack`, e não `error`: a op é recusada individualmente, que é o desfecho que o
    // cliente sabe descartar. Um frame de erro aqui significaria o lote envenenado de volta.
    const frame = await client.waitForType('ack');

    // (a) o cliente não recebe nada do driver.
    assert.equal(frame.opId, op.id);
    assert.equal(frame.result.success, false);
    assert.equal(frame.result.rejected, true);
    assert.equal(frame.result.reason, RECUSA_POR_FORMATO);
    const bruto = JSON.stringify(frame);
    assert.doesNotMatch(bruto, DRIVER_TEXT, `texto de driver no frame: ${bruto}`);
    assert.doesNotMatch(bruto, /[/\\]/, `separador de caminho no frame: ${bruto}`);
    assert.ok(!bruto.includes(BAD_MAP_ID), `o valor ofensor foi ecoado de volta: ${bruto}`);

    // (b) e o erro cru chegou ao log.
    assertRawErrorLogged(spy.records, MSG_RECUSA_INTEGRIDADE, BAD_MAP_ID);
  });

  it('handleOperations (lote): mesmo gatilho, recusa op a op, e o lote não cai', async () => {
    const client = await openClient();
    await client.waitForType('connected');
    client.clearMessages();

    const ops = [opWithBadMap(), opWithBadMap()];
    client.send({ type: 'operations', ops });
    const frame = await client.waitForType('ack_batch');

    assert.equal(frame.results.length, 2);
    for (const r of frame.results) {
      assert.equal(r.success, false);
      assert.equal(r.rejected, true);
      assert.equal(r.reason, RECUSA_POR_FORMATO);
    }
    const bruto = JSON.stringify(frame);
    assert.doesNotMatch(bruto, DRIVER_TEXT, `texto de driver no frame: ${bruto}`);
    assert.ok(!bruto.includes(BAD_MAP_ID), `o valor ofensor foi ecoado de volta: ${bruto}`);

    assertRawErrorLogged(spy.records, MSG_RECUSA_INTEGRIDADE, BAD_MAP_ID, 2);
  });

  it('handleSyncRequest: um lastVersion não numérico responde texto genérico', async () => {
    const client = await openClient();
    await client.waitForType('connected');
    client.clearMessages();

    // `pullOperations` não valida lastVersion; 'nao-e-numero' desce até o
    // `WHERE server_version > $1` de uma coluna BIGINT.
    client.send({ type: 'sync_request', lastVersion: 'nao-e-numero' });
    const frame = await client.waitForType('error');

    assert.equal(frame.code, 'SYNC_FAILED');
    assert.equal(frame.message, 'Valor mal formado (identificador ou tipo inválido).');
    const bruto = JSON.stringify(frame);
    assert.doesNotMatch(bruto, DRIVER_TEXT, `texto de driver no frame: ${bruto}`);
    assert.ok(!bruto.includes('nao-e-numero'), `o valor ofensor foi ecoado de volta: ${bruto}`);

    assertRawErrorLogged(spy.records, 'Failed to process sync request', 'nao-e-numero');

  });

  // O outro lado do gate — a mensagem de um AppError (403 de política, 503 de push
  // ocupado) tem de continuar atravessando, porque mascarar TUDO é a outra forma de
  // errar — está prendido em tests/unit/safe-error-message.test.js. Aqui prende-se o
  // caso adjacente que vive neste canal: o erro de validação.

  it('erro de validação Joi continua detalhado (não é texto do servidor, é o payload do cliente)', async () => {
    const client = await openClient();
    await client.waitForType('connected');
    client.clearMessages();

    // Sem `clientId`, que o pushSchema exige.
    client.send({ type: 'operation', op: { id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: randomUUID(), timestamp: Date.now() } });
    const frame = await client.waitForType('error');

    assert.equal(frame.code, 'VALIDATION_ERROR');
    // O caminho REST devolve os mesmos `details` do Joi (error-handler.js:44-56), e o
    // texto descreve o payload do PRÓPRIO cliente contra um schema público. Mascará-lo
    // apagaria o único sinal que o cliente tem sobre o próprio frame, sem esconder nada
    // do servidor — por isso `validateOps`/`normalizePresence` ficaram fora do gate.
    assert.match(frame.message, /clientId/, 'o Joi tem de continuar nomeando o campo faltante');

  });
});
