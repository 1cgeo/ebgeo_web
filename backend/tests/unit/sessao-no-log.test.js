// Path: tests/unit/sessao-no-log.test.js
// A SESSÃO DO NAVEGADOR (`X-EBGeo-Sessao`) nas DUAS linhas que uma requisição escreve: a do
// `request-logger` e a do `errorHandler`. Ela é a costura que faltava entre o erro que o
// navegador relatou e as linhas que o servidor escreveu no mesmo instante — o `reqId` liga
// as duas linhas de UMA requisição, e este campo liga TODAS as requisições de uma aba.
//
// A ASSERÇÃO É SOBRE O OBJETO CONSTRUÍDO, nunca sobre a saída do pino, pelo mesmo motivo de
// `tests/unit/log-de-endereco-e-recusa.test.js`: sob `NODE_ENV=test` o logger sai em
// `silent`, então um teste que espiasse a saída ficaria verde com o campo apagado. O que
// aqui se espia é o `logger` real só para provar a FIAÇÃO do middleware (que ele chama a
// função e publica `req.sessaoId`), que é o que aquele arquivo declara não cobrir.
//
// CONTROLE NEGATIVO (o que fica vermelho ao reverter cada peça):
//  - aceitar o cabeçalho sem validar: os casos de lixo passam a escrever no log o que o
//    chamador anônimo mandou, quebra de linha inclusive;
//  - escrever `sessaoId: null` em vez de omitir a chave: os casos que contam as chaves do
//    payload ficam vermelhos, e o registro em disco passa a discordar do objeto;
//  - tirar o eco do `errorHandler`: o caso da linha de erro fica sem sessão, e como é ela
//    que `fundirPorRequisicao` mantém, o campo sumiria de todo grupo de erro de rota;
//  - não publicar `req.sessaoId` no middleware: o `errorHandler` não tem de onde ecoar.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import logger from '../../src/utils/logger.js';
import {
  CABECALHO_DE_SESSAO,
  sessaoDaRequisicao,
  requestLogPayload,
  requestLogger,
} from '../../src/middleware/request-logger.js';
import { requestErrorLogPayload } from '../../src/middleware/error-handler.js';

const SESSAO = '3f2a1b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5c';

const reqCom = (over = {}) => ({
  id: 'req-1',
  ip: '203.0.113.9',
  method: 'GET',
  originalUrl: '/api/v1/config',
  headers: {},
  ...over,
});

/** Replaces the level methods with collectors, restoring the ORIGINAL descriptors. */
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
      for (const [level, desc] of saved) Object.defineProperty(logger, level, desc);
    },
  };
}

describe('sessaoDaRequisicao — o cabeçalho é validado, não copiado', () => {
  it('aceita o UUID, em qualquer caixa', () => {
    assert.equal(sessaoDaRequisicao(reqCom({ headers: { [CABECALHO_DE_SESSAO]: SESSAO } })), SESSAO);
    const maiusculo = SESSAO.toUpperCase();
    assert.equal(
      sessaoDaRequisicao(reqCom({ headers: { [CABECALHO_DE_SESSAO]: maiusculo } })),
      maiusculo,
      'a comparação é case-insensitive e o valor sai como veio'
    );
  });

  it('recusa TUDO que não é um UUID, e devolve null (nunca uma sentinela)', () => {
    // Cada entrada é um jeito real de o campo virar escrita arbitrária num arquivo que
    // dura `LOG_RETENTION_DAYS` dias: prefixo/sufixo colado (o que uma regex sem âncora
    // aceitaria), quebra de linha para forjar um segundo registro, texto gigante, e a
    // forma de array que o Node produz para cabeçalho repetido.
    const lixo = [
      undefined,
      null,
      '',
      '   ',
      'Principal',
      `x${SESSAO}`,
      `${SESSAO}x`,
      `${SESSAO}\n{"level":50,"msg":"forjado"}`,
      ` ${SESSAO} `,
      '3f2a1b4c5d6e4f7a8b9c0d1e2f3a4b5c',
      '3f2a1b4c-5d6e-4f7a-8b9c-0d1e2f3a4b5',
      'zzzzzzzz-5d6e-4f7a-8b9c-0d1e2f3a4b5c',
      'x'.repeat(5000),
      42,
      [SESSAO],
      { toString: () => SESSAO },
    ];
    assert.equal(lixo.length, 16);
    for (const valor of lixo) {
      assert.equal(
        sessaoDaRequisicao(reqCom({ headers: { [CABECALHO_DE_SESSAO]: valor } })),
        null,
        `entrada ${JSON.stringify(valor)}`
      );
    }
  });

  it('requisição sem cabeçalhos nenhum não estoura', () => {
    assert.equal(sessaoDaRequisicao(undefined), null);
    assert.equal(sessaoDaRequisicao({}), null);
    assert.equal(sessaoDaRequisicao({ headers: undefined }), null);
    assert.equal(sessaoDaRequisicao(reqCom()), null);
  });

  it('o cabeçalho é lido em minúsculas, que é como o Node entrega', () => {
    // A leitura é direta em `req.headers` (e não por `req.get`), o que a mantém exercível
    // com um objeto simples; o preço é que a chave precisa ser a normalizada.
    assert.equal(CABECALHO_DE_SESSAO, 'x-ebgeo-sessao');
    assert.equal(
      sessaoDaRequisicao(reqCom({ headers: { 'X-EBGeo-Sessao': SESSAO } })),
      null,
      'a chave crua do cliente não é a que o Node entrega'
    );
  });
});

describe('requestLogPayload — a chave só nasce quando há valor', () => {
  it('com sessão válida, o campo entra na linha de requisição', () => {
    const payload = requestLogPayload(
      reqCom({ headers: { [CABECALHO_DE_SESSAO]: SESSAO } }),
      { statusCode: 200 },
      12
    );
    assert.equal(payload.sessaoId, SESSAO);
    assert.equal(payload.reqId, 'req-1', 'o resto da linha continua inteiro');
    assert.equal(payload.statusCode, 200);
  });

  it('sem sessão, a CHAVE não existe: `undefined` sumiria do JSON e sobreviveria no objeto', () => {
    const semNada = requestLogPayload(reqCom(), { statusCode: 200 }, 3);
    assert.equal(Object.hasOwn(semNada, 'sessaoId'), false);

    const comLixo = requestLogPayload(
      reqCom({ headers: { [CABECALHO_DE_SESSAO]: 'nao-e-uuid' } }),
      { statusCode: 400 },
      3
    );
    assert.equal(Object.hasOwn(comLixo, 'sessaoId'), false, 'inválido é igual a ausente');
    // Controle: o objeto continua sendo o mesmo de antes desta mudança.
    assert.deepEqual(
      Object.keys(comLixo).sort(),
      ['duration', 'ip', 'method', 'reqId', 'statusCode', 'url', 'userId']
    );
  });
});

describe('requestErrorLogPayload — a linha de erro ECOA a sessão', () => {
  it('ecoa `req.sessaoId` quando ele existe', () => {
    const linha = requestErrorLogPayload(
      Object.assign(new Error('boom'), { statusCode: 500 }),
      reqCom({ sessaoId: SESSAO })
    );
    assert.equal(linha.campos.sessaoId, SESSAO);
    assert.equal(linha.campos.reqId, 'req-1');
    assert.equal(linha.nivel, 'error');
  });

  it('sem sessão publicada, a chave não existe (e a falha ANTERIOR ao logger é esse caso)', () => {
    const linha = requestErrorLogPayload(
      Object.assign(new Error('corpo malformado'), { statusCode: 400 }),
      reqCom({ sessaoId: null })
    );
    assert.equal(Object.hasOwn(linha.campos, 'sessaoId'), false);
    assert.equal(linha.nivel, 'warn');

    const semReq = requestErrorLogPayload(new Error('sem req'), undefined);
    assert.equal(Object.hasOwn(semReq.campos, 'sessaoId'), false);
  });

  it('não relê o cabeçalho: quem valida é `request-logger`, e aqui só se ecoa', () => {
    // Duas gramáticas para o mesmo campo é como as duas linhas da MESMA requisição passam
    // a discordar sobre quem a fez. Um `req` com cabeçalho e sem `sessaoId` publicado é
    // exatamente o estado de uma falha anterior ao logger: nada foi validado ainda.
    const linha = requestErrorLogPayload(
      new Error('boom'),
      reqCom({ headers: { [CABECALHO_DE_SESSAO]: SESSAO } })
    );
    assert.equal(Object.hasOwn(linha.campos, 'sessaoId'), false);
  });
});

describe('requestLogger — a fiação: publica em `req` e escreve na linha', () => {
  let spy;

  beforeEach(() => { spy = spyLogger(); });
  afterEach(() => { spy.restore(); });

  /** Drives the middleware over a fake request/response pair and finishes the response. */
  function rodar(headers, statusCode = 200) {
    const req = { headers, method: 'GET', originalUrl: '/api/v1/config' };
    const res = new EventEmitter();
    res.statusCode = statusCode;
    let chamou = 0;
    requestLogger(req, res, () => { chamou += 1; });
    res.emit('finish');
    return { req, chamou };
  }

  it('publica `req.sessaoId` e o campo aparece na linha escrita', () => {
    const { req, chamou } = rodar({ [CABECALHO_DE_SESSAO]: SESSAO });
    assert.equal(chamou, 1);
    assert.equal(req.sessaoId, SESSAO, 'o errorHandler lê daqui');
    assert.equal(typeof req.id, 'string');
    assert.equal(spy.records.length, 1);
    assert.equal(spy.records[0].obj.sessaoId, SESSAO);
  });

  it('cabeçalho inválido vira `null` em `req.sessaoId` e nada na linha', () => {
    const { req } = rodar({ [CABECALHO_DE_SESSAO]: 'nao-e-uuid' }, 500);
    assert.equal(req.sessaoId, null);
    assert.equal(spy.records.length, 1);
    assert.equal(Object.hasOwn(spy.records[0].obj, 'sessaoId'), false);
  });

  it('requisição sem o cabeçalho continua logando o resto', () => {
    const { req } = rodar({});
    assert.equal(req.sessaoId, null);
    assert.equal(spy.records.length, 1);
    assert.equal(spy.records[0].obj.method, 'GET');
    assert.equal(spy.records[0].msg, 'request');
  });

  it('a sessão é a MESMA em duas requisições da mesma aba, e o reqId não', () => {
    // É esta a propriedade que o campo existe para dar: `reqId` liga as duas linhas de uma
    // requisição; `sessaoId` liga as requisições de uma aba.
    const a = rodar({ [CABECALHO_DE_SESSAO]: SESSAO });
    const b = rodar({ [CABECALHO_DE_SESSAO]: SESSAO });
    assert.equal(a.req.sessaoId, b.req.sessaoId);
    assert.notEqual(a.req.id, b.req.id);
    const outra = rodar({ [CABECALHO_DE_SESSAO]: randomUUID() });
    assert.notEqual(outra.req.sessaoId, a.req.sessaoId);
  });
});
