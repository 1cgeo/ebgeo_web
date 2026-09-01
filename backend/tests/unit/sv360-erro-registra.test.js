// Path: tests/unit/sv360-erro-registra.test.js
//
// O `sv360ErrorHandler` intercepta ANTES do `errorHandler` global, e ate 2026-09-01
// ele nao logava NADA. O envelope plano do 360 e contrato congelado com o
// `ebgeo_360`, entao o handler proprio precisa existir; o que ele nao podia fazer era
// levar o REGISTRO junto com o envelope. O sintoma media-se no relatorio: todo erro do
// modulo chegava ao `npm run diag -- erros` como uma linha do logger de requisicao,
// sem `err`, ou seja, sem tipo, sem mensagem e sem pilha, colapsada numa assinatura
// generica. Visualizador 360 quebrado na tela era silencio do lado do servidor.
//
// O QUE ESTE ARQUIVO PRENDE, e por que cada assercao existe:
//
//   1. A GRAMATICA. `sv360ErrorLogPayload` monta os MESMOS cinco campos de
//      `src/middleware/error-handler.js` (`err`, `reqId`, `method`, `url`, `userId`).
//      Nao e simetria estetica: `fundirPorRequisicao` funde as duas linhas de uma
//      requisicao falha pelo `reqId`, e `assinaturaDeErro` agrupa por rota mais tipo
//      mais mensagem (`src/utils/diag-consulta.js`). Um campo com outro nome, ou a URL
//      relativa ao mount em vez de `originalUrl`, produz assinatura propria e conta o
//      mesmo erro duas vezes. Contar errado e pior que o silencio de ontem.
//
//   2. O NIVEL. 4xx em `warn`, 5xx em `error`. O 4xx continua no relatorio porque
//      `ehErro` tem TRES termos em OU e o segundo e a PRESENCA de `err`, que esta linha
//      sempre carrega; entao o nivel decide apenas se o erro do cliente polui ou nao o
//      fluxo de erro do servidor. Escolher `error` para tudo seria perder essa
//      distincao sem ganhar visibilidade nenhuma.
//
//   3. O ERRO INTEIRO NO CAMPO `err`. `errSerializer` (`src/utils/logger.js`) so e
//      aplicado a chave `err`, e e ele quem elide `query`/`params`/`detail`/`where` que
//      o driver do Postgres pendura no erro. O ramo `23505` deste handler trata
//      exatamente um erro desses: logar `err.message` ja formatado contornaria o
//      serializer e reabriria o vazamento pela porta de tras.
//
//   4. O CORPO CONTINUA PLANO. A regressao que mais doi aqui e alguem "uniformizar" o
//      envelope junto com o log. Cada caso que assere log tambem assere
//      `{ error: <string> }`.
//
// A ASSERCAO E SOBRE O OBJETO CONSTRUIDO, nunca sobre a saida do pino: sob
// `NODE_ENV=test` o logger fica em nivel `silent`, entao um teste que espiasse o stream
// passaria verde com o defeito intacto. O espiao abaixo troca as PROPRIEDADES da mesma
// instancia ESM que o handler importa, que e o mesmo caminho de
// `tests/unit/middleware-access-logs.test.js`.
//
// CONTROLE NEGATIVO (2026-09-01), revertendo uma peca de cada vez, com a restauracao
// conferida por grep no arquivo e nao pela suite. As SEIS reversoes derrubam conjuntos
// DIFERENTES, que e o que confirma serem seis propriedades e nao uma:
//   - `registrar(...)` fora do handler (o estado de ontem): 4 vermelhos, o primeiro em
//     «o handler registra exatamente uma linha» (actual 0, expected 1).
//   - nivel fixo em `logger.error`: 3 vermelhos ('error' contra 'warn').
//   - `err` trocado por `mensagem: err?.message`: 5 vermelhos, o primeiro acusando
//     `['mensagem', 'method', 'reqId', 'url', 'userId']` contra a gramatica esperada.
//   - `url` de volta a `redactUrl(req?.url)`: 3 vermelhos ('/photos/x' contra
//     '/api/v1/sv360/photos/x'), inclusive o da credencial na query.
//   - o `registrar` movido para ANTES da guarda `headersSent`: 1 vermelho, «logar aqui
//     daria DUAS linhas para a mesma falha» (actual 1, expected 0).
//   - o envelope uniformizado para `{ error: { code, message } }`: 2 vermelhos
//     ('object' contra 'string'), que e a regressao que mais doi neste arquivo.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import logger from '../../src/utils/logger.js';
import {
  sv360ErrorHandler, sv360ErrorLogPayload, sv360StatusDoErro,
} from '../../src/modules/streetview360/sv360-error.js';
import { NotFoundError, ForbiddenError } from '../../src/utils/errors.js';

/**
 * Substitui logger.warn/error por coletores, restaurando os descritores ORIGINAIS: o
 * pino define os metodos de nivel no prototipo, entao uma reatribuicao simples deixaria
 * uma propriedade propria como sombra.
 */
function spyLogger() {
  const records = [];
  const saved = [];
  for (const level of ['info', 'warn', 'error']) {
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

function mockReq(over = {}) {
  return {
    id: 'req-42',
    method: 'GET',
    originalUrl: '/api/v1/sv360/photos/x',
    url: '/photos/x',
    user: { id: 'u-1' },
    ...over,
  };
}

function mockRes(over = {}) {
  let _status = null;
  let _json = null;
  return {
    headersSent: false,
    status(code) { _status = code; return this; },
    json(body) { _json = body; return this; },
    get statusCode() { return _status; },
    get body() { return _json; },
    ...over,
  };
}

describe('sv360StatusDoErro: o status que o handler responde', () => {
  it('Joi vira 422', () => {
    assert.equal(sv360StatusDoErro({ isJoi: true, details: [{ message: 'x' }] }), 422);
  });

  it('as duas violacoes de integridade do Postgres viram 409', () => {
    assert.equal(sv360StatusDoErro({ code: '23505' }), 409);
    assert.equal(sv360StatusDoErro({ code: '23503' }), 409);
  });

  it('AppError preserva o proprio status', () => {
    assert.equal(sv360StatusDoErro(new NotFoundError('Photo')), 404);
    assert.equal(sv360StatusDoErro(new ForbiddenError('nope')), 403);
  });

  it('erro sem status e 500', () => {
    assert.equal(sv360StatusDoErro(new Error('boom')), 500);
  });
});

describe('sv360ErrorLogPayload: a mesma gramatica do handler global', () => {
  it('carrega os cinco campos com os mesmos nomes', () => {
    const err = new Error('boom');
    const payload = sv360ErrorLogPayload(err, mockReq());

    assert.deepEqual(Object.keys(payload).sort(), ['err', 'method', 'reqId', 'url', 'userId']);
    assert.equal(payload.reqId, 'req-42');
    assert.equal(payload.method, 'GET');
    assert.equal(payload.userId, 'u-1');
  });

  it('o erro chega ELIDIDO, nunca como texto ja formatado nem com o campo cru do driver', () => {
    // ESTE CASO MEDIA O MECANISMO E PASSOU A MEDIR A PROPRIEDADE, em 2026-09-01. Ele exigia
    // que `payload.err` fosse o MESMO objeto, para garantir que a elisao do `errSerializer`
    // acontecesse. Desde que a pilha passou a sair das linhas 4xx, o payload serializa aqui
    // (apagar a pilha e agir sobre a forma ja serializada), e a identidade de referencia
    // deixou de valer sem que a propriedade mudasse: quem serializa e o MESMO
    // `errSerializer`, entao a elisao continua acontecendo, um passo antes.
    //
    // Asserir a propriedade e mais forte que asserir a referencia: a versao antiga passaria
    // verde se alguem trocasse o serializer por um que nao elide, contanto que o objeto
    // fosse o mesmo.
    const err = new Error('boom');
    err.code = '23505';
    err.detail = 'Failing row contains (..., $2b$12$hash)';
    const payload = sv360ErrorLogPayload(err, mockReq());

    assert.ok(payload.err, 'o payload precisa carregar o campo err');
    assert.notEqual(typeof payload.err, 'string', 'nunca texto ja formatado por quem loga');

    // NAO-VACUIDADE: o erro CRU carrega o hash, senao o resto passaria verde sobre um erro
    // que nunca teve o campo perigoso.
    assert.match(err.detail, /2b\$12\$hash/, 'o erro cru precisa carregar o hash');

    assert.equal(payload.err.detail, '[REDACTED]', 'o detail do driver nao pode chegar ao log');
    assert.equal(payload.err.type, 'Error', 'o tipo sobrevive a serializacao (a assinatura o usa)');
    assert.equal(payload.err.message, 'boom');
    assert.equal(payload.err.code, '23505', 'o SQLSTATE nomeia a regra e fica');
  });

  it('a pilha so vai no 5xx, e o 4xx fica pequeno', () => {
    // MEDIDO nos .jsonl reais: 80% dos bytes de uma linha de erro eram pilha, e a do 4xx
    // descreve o caminho do HANDLER e nao o caso (o mesmo quadro para toda URL). Este modulo
    // e o que serve as rotas SEM limitador de taxa, ou seja onde um laco de 404 amplifica
    // mais: era a ultima superficie 4xx que ainda escrevia pilha.
    const doCliente = new Error("nao encontrado");
    doCliente.statusCode = 404;
    const doServidor = new Error("estourou");
    doServidor.statusCode = 500;

    // NAO-VACUIDADE: os dois erros CRUS tem pilha, senao a ausencia abaixo nao provaria nada.
    assert.ok(doCliente.stack, "o erro cru de cliente tem pilha");
    assert.ok(doServidor.stack, "o erro cru de servidor tem pilha");

    const p4xx = sv360ErrorLogPayload(doCliente, mockReq());
    const p5xx = sv360ErrorLogPayload(doServidor, mockReq());

    assert.equal(p4xx.err.stack, undefined, "o 4xx nao carrega pilha");
    assert.ok(p5xx.err.stack, "o 5xx carrega pilha: e nela que mora o sitio do defeito");

    // O QUE SOBRA no 4xx precisa bastar para diagnosticar: tipo, mensagem e status. Sem esta
    // parte, tirar a pilha poderia ter levado junto o que se usa para achar o defeito.
    assert.equal(p4xx.err.type, "Error");
    assert.equal(p4xx.err.message, "nao encontrado");
    assert.equal(p4xx.err.statusCode, 404);

    // DISCRIMINACAO por tamanho: a linha 4xx precisa ser pequena de verdade, senao a
    // propriedade acima poderia valer com a pilha migrada para outro campo.
    assert.ok(
      JSON.stringify(p4xx).length < JSON.stringify(p5xx).length / 2,
      "a linha 4xx tem de ser bem menor que a 5xx"
    );
  });

  it('a URL e a originalUrl, redigida', () => {
    // Dentro do router `req.url` e relativo ao mount, entao as duas linhas da MESMA
    // requisicao sairiam com URLs diferentes, que e o oposto do que o `reqId` permite.
    const payload = sv360ErrorLogPayload(new Error('x'), mockReq());
    assert.equal(payload.url, '/api/v1/sv360/photos/x');
  });

  it('credencial na query string nunca chega ao log', () => {
    const req = mockReq({ originalUrl: '/api/v1/sv360/projects?api_key=ebgeo_live_7f3c9a1b&atlasId=1' });
    const payload = sv360ErrorLogPayload(new Error('x'), req);

    assert.ok(!payload.url.includes('ebgeo_live_7f3c9a1b'), `a chave vazou: ${payload.url}`);
    assert.ok(payload.url.includes('REDACTED'));
    assert.ok(payload.url.includes('atlasId=1'), 'o resto da query precisa sobreviver');
  });

  it('requisicao anonima e sem reqId nao estoura', () => {
    const payload = sv360ErrorLogPayload(new Error('x'), { method: 'GET', url: '/photos/x' });
    assert.equal(payload.userId, undefined);
    assert.equal(payload.reqId, undefined);
    assert.equal(payload.url, '/photos/x');
  });
});

describe('sv360ErrorHandler: registra, e o corpo continua PLANO', () => {
  let spy;
  beforeEach(() => { spy = spyLogger(); });
  afterEach(() => { spy.restore(); });

  it('5xx sai em error, com o payload da gramatica comum', () => {
    const err = new Error('boom');
    const res = mockRes();
    sv360ErrorHandler(err, mockReq(), res, () => {});

    assert.equal(spy.records.length, 1, 'o handler registra exatamente uma linha');
    const [rec] = spy.records;
    assert.equal(rec.level, 'error');
    assert.equal(rec.msg, 'Request error', 'a mensagem e a mesma do handler global');
    assert.equal(rec.obj.err.message, err.message, "a linha carrega o erro daquela falha");
    assert.equal(rec.obj.reqId, 'req-42');
    assert.equal(rec.obj.method, 'GET');
    assert.equal(rec.obj.url, '/api/v1/sv360/photos/x');
    assert.equal(rec.obj.userId, 'u-1');

    // Envelope PLANO: uma string em `error`, nunca `{ code, message }`.
    assert.equal(res.statusCode, 500);
    assert.equal(typeof res.body.error, 'string');
    assert.equal(res.body.error, 'Erro interno do servidor.');
  });

  it('4xx sai em warn (erro do cliente nao e falha do servidor)', () => {
    const err = new NotFoundError('Photo');
    const res = mockRes();
    sv360ErrorHandler(err, mockReq(), res, () => {});

    assert.equal(spy.records.length, 1);
    assert.equal(spy.records[0].level, 'warn');
    assert.equal(spy.records[0].obj.err.message, err.message, "a linha carrega o erro daquela falha");

    assert.equal(res.statusCode, 404);
    assert.equal(typeof res.body.error, 'string');
    assert.equal(res.body.error, 'Photo not found');
  });

  it('o 422 de Joi registra em warn e responde plano', () => {
    const err = { isJoi: true, details: [{ message: '"slug" is required' }] };
    const res = mockRes();
    sv360ErrorHandler(err, mockReq(), res, () => {});

    assert.equal(spy.records.length, 1);
    assert.equal(spy.records[0].level, 'warn');
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.error, '"slug" is required');
    assert.equal(typeof res.body.error, 'string');
  });

  it('a violacao de unicidade registra em warn e o corpo nao repete a mensagem do driver', () => {
    const err = new Error('duplicate key value violates unique constraint "projects_slug_key"');
    err.code = '23505';
    const res = mockRes();
    sv360ErrorHandler(err, mockReq(), res, () => {});

    assert.equal(spy.records.length, 1);
    assert.equal(spy.records[0].level, 'warn', '409 e 4xx');
    // O diagnostico fica no log (dentro de `err`, que o serializer limpa) e nao no corpo.
    assert.equal(spy.records[0].obj.err.message, err.message, "a linha carrega o erro daquela falha");
    assert.equal(res.statusCode, 409);
    assert.equal(typeof res.body.error, 'string');
    assert.ok(!res.body.error.includes('projects_slug_key'));
  });

  it('headersSent delega sem logar: quem registra ali e o handler global', () => {
    const err = new Error('mid-stream');
    const res = mockRes({ headersSent: true });
    const delegados = [];
    sv360ErrorHandler(err, mockReq(), res, (e) => delegados.push(e));

    assert.equal(spy.records.length, 0, 'logar aqui daria DUAS linhas para a mesma falha');
    assert.deepEqual(delegados, [err]);
    assert.equal(res.statusCode, null, 'nada e escrito na resposta ja iniciada');
  });
});
