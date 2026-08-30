// Path: tests/unit/diag-consulta.test.js
//
// `src/utils/diag-consulta.js` é a agregação do relatório de `scripts/diag.js`. Ela é pura
// justamente para ser medida aqui: relatório conferido "no olho" é a forma clássica de
// verificação fantasma, porque uma contagem errada tem exatamente a mesma cara de uma certa.
//
// O caso que dá nome ao arquivo é o da FUSÃO: uma requisição que falha produz DUAS linhas de
// log (a do errorHandler, com a pilha, e a do request-logger, com status e duração). A
// primeira versão desta ferramenta contava as duas, e o relatório dizia "4 ocorrências"
// para 2 erros reais, em 4 assinaturas. Foi medido contra o backend de verdade, e é o
// motivo de `req.id` existir.
//
// Controle negativo: tire a chamada a `fundirPorRequisicao` de dentro de `agruparErros` e o
// bloco "fusão" inteiro cai.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJanela, diasDaJanela, normalizarRota, ehErro,
  agruparErros, percentil, resumirLatencia, resumirStatus, parseLinha,
  fundirPorRequisicao,
} from '../../src/utils/diag-consulta.js';

describe('diag — janela e arquivos', () => {
  it('parseJanela entende minuto, hora e dia', () => {
    assert.equal(parseJanela('30m'), 1_800_000);
    assert.equal(parseJanela('24h'), 86_400_000);
    assert.equal(parseJanela('7d'), 604_800_000);
  });

  it('parseJanela devolve null no que não entende, em vez de um default silencioso', () => {
    // O ponto: `24hs` tem de RECLAMAR. Cair na última hora calado responderia outra
    // pergunta e quem lê a saída não teria como saber.
    for (const ruim of ['24hs', '', null, undefined, 'ontem', '0h', '-3d', '1w', '10']) {
      assert.equal(parseJanela(ruim), null, `deveria recusar: ${JSON.stringify(ruim)}`);
    }
  });

  it('diasDaJanela inclui as DUAS pontas', () => {
    const dias = diasDaJanela(new Date(2026, 7, 28, 22, 0), new Date(2026, 7, 30, 1, 0));
    assert.deepEqual(dias, ['2026-08-28', '2026-08-29', '2026-08-30']);
  });

  it('diasDaJanela: uma hora que atravessa a meia-noite pede DOIS arquivos', () => {
    // 00h30 com --desde 1h. Se devolvesse só hoje, a investigação perderia o minuto
    // anterior, que é onde o incidente costuma começar.
    const dias = diasDaJanela(new Date(2026, 7, 29, 23, 30), new Date(2026, 7, 30, 0, 30));
    assert.deepEqual(dias, ['2026-08-29', '2026-08-30']);
  });

  it('diasDaJanela dentro do mesmo dia devolve um só', () => {
    assert.deepEqual(diasDaJanela(new Date(2026, 7, 30, 1, 0), new Date(2026, 7, 30, 23, 0)), ['2026-08-30']);
  });
});

describe('diag — normalização de rota', () => {
  it('troca UUID por :id, que é o que faz o agrupamento agrupar', () => {
    assert.equal(
      normalizarRota('/api/v1/atlas/0720562f-9054-4de8-9bd1-49543c203c9e/sync'),
      '/api/v1/atlas/:id/sync'
    );
  });

  it('troca número longo por :n e descarta a query string', () => {
    assert.equal(normalizarRota('/api/v1/atlas/123456/sync?token=abc'), '/api/v1/atlas/:n/sync');
  });

  it('não mutila segmento curto legítimo', () => {
    assert.equal(normalizarRota('/api/v1/sv360/p1/tiles/3/2/1.jpg'), '/api/v1/sv360/p1/tiles/3/2/1.jpg');
  });

  it('aguenta url ausente', () => {
    assert.equal(normalizarRota(undefined), '');
    assert.equal(normalizarRota(null), '');
  });
});

describe('diag — o que conta como erro', () => {
  it('level >= 50 é erro', () => {
    assert.equal(ehErro({ level: 50, msg: 'x' }), true);
    assert.equal(ehErro({ level: 60, msg: 'x' }), true);
  });

  it('4xx logado em WARN também é erro, e é a metade que se esquece', () => {
    // O errorHandler desta casa loga 4xx em `warn` de propósito. Sem este ramo, todo 400,
    // 401, 403 e 404 sumiria do relatório, inclusive o 400 em laço que motivou a ferramenta.
    assert.equal(ehErro({ level: 40, statusCode: 400, msg: 'request error' }), true);
    assert.equal(ehErro({ level: 40, err: { message: 'x' }, msg: 'Request error' }), true);
  });

  it('requisição bem-sucedida não é erro', () => {
    assert.equal(ehErro({ level: 30, statusCode: 200, duration: 12 }), false);
    assert.equal(ehErro({ level: 30, msg: 'request' }), false);
  });

  it('lixo não é erro', () => {
    assert.equal(ehErro(null), false);
    assert.equal(ehErro(undefined), false);
    assert.equal(ehErro('texto'), false);
  });
});

describe('diag — fusão das duas linhas de uma requisição falha', () => {
  const doErrorHandler = {
    level: 40, time: 100, reqId: 'r1', method: 'POST', url: '/api/v1/atlas/x/sync',
    err: { type: 'BadRequestError', message: 'Valor mal formado', stack: 'Error: ...' },
    msg: 'Request error',
  };
  const doRequestLogger = {
    level: 40, time: 101, reqId: 'r1', method: 'POST', url: '/api/v1/atlas/x/sync',
    statusCode: 400, duration: 12, msg: 'request error',
  };

  it('as duas linhas viram UMA, e a que fica é a que tem a pilha', () => {
    const fundidos = fundirPorRequisicao([doErrorHandler, doRequestLogger]);
    assert.equal(fundidos.length, 1);
    assert.equal(fundidos[0].err.type, 'BadRequestError');
  });

  it('e o statusCode, que só a outra linha tinha, é preservado', () => {
    const [f] = fundirPorRequisicao([doErrorHandler, doRequestLogger]);
    assert.equal(f.statusCode, 400, 'sem isto a assinatura perde o [400]');
  });

  it('a ordem das duas linhas não importa', () => {
    const a = fundirPorRequisicao([doErrorHandler, doRequestLogger]);
    const b = fundirPorRequisicao([doRequestLogger, doErrorHandler]);
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.equal(b[0].err.type, 'BadRequestError');
    assert.equal(b[0].statusCode, 400);
  });

  it('linha sozinha (falha antes do logger de requisição) passa intacta', () => {
    const sozinha = { level: 50, time: 1, err: { message: 'corpo malformado' }, msg: 'Request error' };
    assert.deepEqual(fundirPorRequisicao([sozinha]), [sozinha]);
  });

  it('requisição de SUCESSO não é fundida com nada', () => {
    const ok = { level: 30, time: 1, reqId: 'r9', statusCode: 200, duration: 5, url: '/a', method: 'GET' };
    assert.deepEqual(fundirPorRequisicao([ok]), [ok]);
  });

  it('requisições diferentes não se misturam', () => {
    const outra = { ...doRequestLogger, reqId: 'r2', statusCode: 404 };
    const fundidos = fundirPorRequisicao([doErrorHandler, doRequestLogger, outra]);
    assert.equal(fundidos.length, 2);
  });
});

describe('diag — agrupamento de erros', () => {
  const erro = (t, url, msg, reqId) => ({
    level: 50, time: t, reqId, method: 'POST', url,
    err: { type: 'Error', message: msg }, msg: 'Request error',
  });

  it('mil ocorrências do mesmo defeito viram UMA linha com contagem', () => {
    const registros = [];
    for (let i = 0; i < 1000; i += 1) {
      registros.push(erro(1000 + i, `/api/v1/atlas/0720562f-9054-4de8-9bd1-49543c203c9e/sync`, 'falhou', `r${i}`));
    }
    const grupos = agruparErros(registros);
    assert.equal(grupos.length, 1);
    assert.equal(grupos[0].total, 1000);
    assert.equal(grupos[0].primeira, 1000);
    assert.equal(grupos[0].ultima, 1999);
    assert.match(grupos[0].assinatura, /:id/, 'a rota entra normalizada, senão não haveria grupo');
  });

  it('ordena por frequência, e desempata pela ocorrência mais RECENTE', () => {
    const registros = [
      erro(10, '/a', 'raro', 'r1'),
      erro(20, '/b', 'comum', 'r2'),
      erro(30, '/b', 'comum', 'r3'),
      erro(40, '/c', 'tambem-raro', 'r4'),
    ];
    const grupos = agruparErros(registros);
    assert.equal(grupos[0].total, 2, 'o mais frequente primeiro');
    assert.match(grupos[1].assinatura, /tambem-raro/, 'entre os empatados, o mais recente primeiro');
  });

  it('o exemplo guardado é a ocorrência mais recente', () => {
    const grupos = agruparErros([erro(10, '/a', 'x', 'r1'), erro(99, '/a', 'x', 'r2')]);
    assert.equal(grupos[0].exemplo.reqId, 'r2');
  });

  it('não inventa grupo quando não há erro nenhum', () => {
    assert.deepEqual(agruparErros([{ level: 30, statusCode: 200, time: 1 }]), []);
    assert.deepEqual(agruparErros([]), []);
  });

  it('erro sem url (fora do ciclo HTTP) ainda é agrupado', () => {
    const grupos = agruparErros([
      { level: 50, time: 1, err: { type: 'Error', message: 'sweep falhou' }, msg: 'ws sweep' },
    ]);
    assert.equal(grupos.length, 1);
    assert.match(grupos[0].assinatura, /sweep falhou/);
  });
});

describe('diag — latência', () => {
  it('percentil por posto devolve um valor que EXISTE na amostra', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(percentil(v, 50), 5);
    assert.equal(percentil(v, 95), 10);
    assert.equal(percentil(v, 100), 10);
  });

  it('percentil de amostra de um elemento', () => {
    assert.equal(percentil([42], 50), 42);
    assert.equal(percentil([42], 95), 42);
  });

  it('percentil de lista vazia é null, e não zero', () => {
    // Zero seria uma medição inventada, e ela apareceria no relatório com a mesma cara de
    // uma rota realmente instantânea.
    assert.equal(percentil([], 50), null);
  });

  it('resumirLatencia agrupa por rota normalizada e ordena por p95', () => {
    const req = (url, duration) => ({ level: 30, method: 'GET', url, duration, statusCode: 200 });
    const linhas = resumirLatencia([
      req('/api/v1/atlas/0720562f-9054-4de8-9bd1-49543c203c9e/sync', 10),
      req('/api/v1/atlas/aaaaaaaa-9054-4de8-9bd1-49543c203c9e/sync', 20),
      req('/api/v1/config', 900),
    ]);
    assert.equal(linhas.length, 2, 'os dois atlas são a mesma rota');
    assert.equal(linhas[0].rota, 'GET /api/v1/config', 'o mais lento primeiro');
    assert.equal(linhas[1].n, 2);
    assert.equal(linhas[1].max, 20);
  });

  it('resumirLatencia ignora registro sem duração', () => {
    assert.deepEqual(resumirLatencia([{ level: 50, url: '/a', err: {} }]), []);
  });
});

describe('diag — status e parsing', () => {
  it('resumirStatus conta por faixa', () => {
    const r = resumirStatus([
      { statusCode: 200 }, { statusCode: 204 }, { statusCode: 404 }, { statusCode: 500 },
    ]);
    assert.equal(r.total, 4);
    assert.deepEqual(r.porFaixa, { '2xx': 2, '4xx': 1, '5xx': 1 });
  });

  it('resumirStatus ignora linha sem status (o log do errorHandler não tem)', () => {
    const r = resumirStatus([{ err: {} }, { statusCode: 200 }]);
    assert.equal(r.total, 1);
  });

  it('parseLinha devolve null para linha pela metade, em vez de morrer', () => {
    // Acontece de verdade: o arquivo está sendo escrito enquanto o diag lê. Uma ferramenta
    // de diagnóstico que morre por isso falha exatamente durante o incidente.
    assert.equal(parseLinha('{"level":30,"ms'), null);
    assert.equal(parseLinha(''), null);
    assert.equal(parseLinha('   '), null);
    assert.equal(parseLinha('texto solto'), null);
    assert.deepEqual(parseLinha('{"a":1}'), { a: 1 });
  });
});
