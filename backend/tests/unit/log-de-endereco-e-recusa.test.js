// Path: tests/unit/log-de-endereco-e-recusa.test.js
// A FORMA das duas linhas de log que respondem "quem esta tentando entrar", asserida sobre
// o OBJETO construido e nunca sobre a saida do pino.
//
// A distincao e o ponto do arquivo: sob `NODE_ENV=test` o logger sai em `level: 'silent'`
// (`src/utils/logger.js`), entao um teste que espiasse a saida do pino ficaria verde com o
// campo `ip` apagado, com a linha de 429 inteira apagada, e com o defeito intacto. Por isso
// `request-logger.js` e `rate-limit.js` expoem as funcoes que MONTAM o payload, no mesmo
// desenho de `queryLogPayload`/`dbErrorLogPayload` em `src/database/index.js`, e e sobre
// elas que se assere.
//
// O que este arquivo NAO prova: que os middlewares chamem essas funcoes. Apagar a chamada
// deixa tudo aqui verde. Essa metade e o par em
// `tests/integration/endereco-e-recusa-no-log.test.js`, que dirige requisicao real.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clientAddress,
  requestLogPayload,
  UNKNOWN_ADDRESS,
} from '../../src/middleware/request-logger.js';
import {
  limiterDenialPayload,
  shouldLogDenial,
  usernameForLog,
} from '../../src/middleware/rate-limit.js';

const fakeReq = (over = {}) => ({
  id: 'req-1',
  ip: '203.0.113.9',
  method: 'POST',
  originalUrl: '/api/v1/auth/login',
  ...over,
});

const fakeRes = (statusCode = 200) => ({ statusCode });

describe('clientAddress', () => {
  it('devolve o endereco quando ha um', () => {
    assert.equal(clientAddress({ ip: '203.0.113.9' }), '203.0.113.9');
    assert.equal(clientAddress({ ip: '::ffff:127.0.0.1' }), '::ffff:127.0.0.1');
  });

  it('NAO devolve string vazia nem undefined quando o endereco nao e determinavel', () => {
    // Os modos reais: socket ja derrubado (undefined), cabecalho vazio no hop confiavel
    // (string vazia ou so espacos), e uma forma que nao e string. Nenhum deles pode virar
    // um valor que se leia como resposta.
    const casos = [undefined, null, '', '   ', 42, {}, ['203.0.113.9']];
    assert.ok(casos.length > 0);
    for (const ip of casos) {
      const saida = clientAddress({ ip });
      assert.equal(saida, UNKNOWN_ADDRESS, `ip=${JSON.stringify(ip)}`);
      assert.equal(typeof saida, 'string');
      assert.ok(saida.length > 0);
    }
    assert.equal(clientAddress(undefined), UNKNOWN_ADDRESS);
    assert.equal(clientAddress({}), UNKNOWN_ADDRESS);
  });

  it('o sentinela e distinguivel de um endereco: nao e vazio e nao e undefined', () => {
    // Controle da assercao acima. Sem ele, trocar o sentinela por '' deixaria o laco de
    // cima verde, porque ele compara com a propria constante exportada.
    assert.notEqual(UNKNOWN_ADDRESS, '');
    assert.notEqual(UNKNOWN_ADDRESS, undefined);
    assert.equal(typeof UNKNOWN_ADDRESS, 'string');
    assert.ok(UNKNOWN_ADDRESS.trim().length > 0);
  });
});

describe('requestLogPayload', () => {
  it('carrega o endereco do cliente', () => {
    const p = requestLogPayload(fakeReq(), fakeRes(401), 12);
    assert.equal(p.ip, '203.0.113.9');
  });

  it('carrega o endereco em TODA requisicao, nao so nas de credencial', () => {
    // A decisao "em toda requisicao" vive aqui: e ela que responde "o que MAIS esse
    // endereco tocou", e e ela que enxerga a varredura que nunca estoura balde nenhum
    // (mil contas tentadas uma vez cada nao produzem UM 429).
    const rotas = ['/api/v1/auth/login', '/api/v1/config', '/api/v1/atlas', '/api/v1/health'];
    assert.ok(rotas.length > 0);
    for (const url of rotas) {
      const p = requestLogPayload(fakeReq({ originalUrl: url }), fakeRes(200), 3);
      assert.equal(p.ip, '203.0.113.9', url);
    }
  });

  it('degrada para o sentinela sem endereco, e nao para vazio', () => {
    const p = requestLogPayload(fakeReq({ ip: undefined }), fakeRes(200), 1);
    assert.equal(p.ip, UNKNOWN_ADDRESS);
    assert.ok('ip' in p, 'a chave nao pode sumir: ausente e indistinguivel de build antigo');
  });

  it('nao perde os campos que ja existiam', () => {
    const p = requestLogPayload(fakeReq(), fakeRes(404), 7);
    assert.equal(p.reqId, 'req-1');
    assert.equal(p.method, 'POST');
    assert.equal(p.url, '/api/v1/auth/login');
    assert.equal(p.statusCode, 404);
    assert.equal(p.duration, 7);
  });

  it('continua redigindo a URL, agora ao lado do endereco', () => {
    const p = requestLogPayload(
      fakeReq({ originalUrl: '/api/v1/config?api_key=segredo-vivo' }),
      fakeRes(200),
      1
    );
    assert.ok(!p.url.includes('segredo-vivo'), p.url);
    assert.ok(p.url.includes('REDACTED'), p.url);
  });
});

describe('shouldLogDenial', () => {
  it('fala UMA vez por janela: so na primeira recusa', () => {
    // A recusa e `used > limit`. So a PRIMEIRA (limit + 1) carrega fato novo; as seguintes
    // sao a mesma frase, e loga-las devolveria a rajada que o limitador contem para dentro
    // do arquivo de log.
    assert.equal(shouldLogDenial({ limit: 10, used: 11 }), true);
    const repetidas = [12, 13, 100, 10000];
    assert.ok(repetidas.length > 0);
    for (const used of repetidas) {
      assert.equal(shouldLogDenial({ limit: 10, used }), false, `used=${used}`);
    }
  });

  it('cala abaixo do teto, onde nao houve recusa nenhuma', () => {
    const dentro = [1, 5, 9, 10];
    assert.ok(dentro.length > 0);
    for (const used of dentro) {
      assert.equal(shouldLogDenial({ limit: 10, used }), false, `used=${used}`);
    }
  });

  it('degrada FALANDO quando a informacao do limitador nao e legivel', () => {
    // Limitador mudo e o defeito que este trabalho conserta; uma linha a mais e barata
    // perto de uma recusa silenciosa. Cobre a forma inesperada apos upgrade da lib.
    const ilegiveis = [
      undefined,
      null,
      {},
      { limit: 10 },
      { used: 11 },
      { limit: NaN, used: 11 },
      { limit: '10', used: '11' },
      { limit: Infinity, used: 11 },
    ];
    assert.ok(ilegiveis.length > 0);
    for (const info of ilegiveis) {
      assert.equal(shouldLogDenial(info), true, JSON.stringify(info));
    }
  });
});

describe('usernameForLog', () => {
  it('normaliza como a chave do authLimiter normaliza', () => {
    // A chave faz `toLowerCase()`; o campo tem de nomear o balde que de fato recusou.
    assert.equal(usernameForLog({ body: { username: 'Joao.Silva' } }), 'joao.silva');
  });

  it('devolve vazio quando nao ha username, ou quando ele nao e string', () => {
    const naoStrings = [undefined, null, 42, {}, ['a']];
    assert.ok(naoStrings.length > 0);
    for (const username of naoStrings) {
      assert.equal(usernameForLog({ body: { username } }), '');
    }
    assert.equal(usernameForLog({}), '');
    assert.equal(usernameForLog(undefined), '');
  });

  it('remove caracteres de controle: o valor e texto escolhido por anonimo', () => {
    // `npm run diag -- linhas` imprime o registro num terminal. Uma quebra de linha ou uma
    // sequencia ANSI dentro do username forjaria linhas de log naquela tela.
    //
    // O valor sujo e MONTADO por codigo: byte de controle escrito como literal dentro do
    // arquivo de teste quebra todo visualizador que o abrir, e o proprio caso vira ilegivel.
    const ESC = String.fromCharCode(0x1b);
    const LF = String.fromCharCode(0x0a);
    const CR = String.fromCharCode(0x0d);
    const NUL = String.fromCharCode(0x00);
    const DEL = String.fromCharCode(0x7f);
    const sujo = `ad${ESC}[2Kmin${LF}falso${CR}${NUL}${DEL}`;

    const saida = usernameForLog({ body: { username: sujo } });
    assert.equal(saida, 'ad[2kminfalso');
    assert.ok(saida.length > 0, 'laco sobre string vazia nao asseriria nada');
    for (const ch of saida) {
      const code = ch.codePointAt(0);
      assert.ok(code > 0x1f && code !== 0x7f, `sobrou controle U+${code.toString(16)}`);
    }
  });

  it('preserva o espaco, que nao forja linha nem escapa terminal', () => {
    // Controle negativo do caso acima: uma filtragem larga demais (tudo abaixo de 0x21)
    // mudaria o valor em relacao a chave que o limitador de fato usou.
    assert.equal(usernameForLog({ body: { username: 'com espaco' } }), 'com espaco');
  });

  it('trunca: campo sem teto num registro por recusa e vetor de enchimento de disco', () => {
    const saida = usernameForLog({ body: { username: 'a'.repeat(5000) } });
    assert.ok(saida.length <= 103, `tamanho ${saida.length}`);
    assert.ok(saida.endsWith('...'), saida.slice(-10));
    assert.equal(saida.slice(0, 100), 'a'.repeat(100));
  });

  it('nao marca truncagem no nome que cabe no teto do schema', () => {
    // Joi declara max(100) no login e no register: um nome legitimo nunca e cortado.
    const saida = usernameForLog({ body: { username: 'b'.repeat(100) } });
    assert.equal(saida, 'b'.repeat(100));
    assert.ok(!saida.endsWith('...'));
  });
});

describe('limiterDenialPayload', () => {
  const req = fakeReq({ rateLimit: { limit: 10, used: 11 }, body: { username: 'Vitima' } });

  it('produz o registro esperado de uma recusa', () => {
    const p = limiterDenialPayload('auth', req, { keyedByUsername: true });
    assert.deepEqual(p, {
      reqId: 'req-1',
      limiter: 'auth',
      ip: '203.0.113.9',
      method: 'POST',
      url: '/api/v1/auth/login',
      limit: 10,
      used: 11,
      username: 'vitima',
    });
  });

  it('nomeia QUAL limitador disparou: a rota sozinha nao basta', () => {
    // `/auth/register` monta DOIS limitadores, medindo coisas diferentes.
    assert.equal(limiterDenialPayload('register', req).limiter, 'register');
    assert.equal(limiterDenialPayload('gazetteer', req).limiter, 'gazetteer');
  });

  it('omite o username onde o balde e so por endereco', () => {
    // Presenca condicional: onde o campo aparece, ele nomeia parte da chave que recusou.
    // Num balde por endereco ele sugeriria uma segmentacao por conta que nao existe.
    const p = limiterDenialPayload('register', req);
    assert.ok(!('username' in p), 'username nao pode aparecer num balde por endereco');
    assert.equal(p.ip, '203.0.113.9');
  });

  it('carrega o endereco tambem quando ele nao e determinavel, como sentinela', () => {
    const p = limiterDenialPayload('public-link', fakeReq({ ip: undefined }));
    assert.equal(p.ip, UNKNOWN_ADDRESS);
  });

  it('leva o reqId, que e o que junta esta linha a do request-logger', () => {
    assert.equal(limiterDenialPayload('auth', req).reqId, req.id);
  });

  it('redige a URL, e nao explode com contadores ausentes', () => {
    const p = limiterDenialPayload(
      'config',
      fakeReq({ originalUrl: '/api/v1/config?token=segredo-vivo', rateLimit: undefined })
    );
    assert.ok(!p.url.includes('segredo-vivo'), p.url);
    assert.equal(p.limit, null);
    assert.equal(p.used, null);
  });
});
