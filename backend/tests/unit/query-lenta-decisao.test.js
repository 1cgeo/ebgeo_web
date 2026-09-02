// Path: tests/unit/query-lenta-decisao.test.js
//
// A METADE PURA DO AVISO DE QUERY LENTA: a leitura da variável, o piso, a decisão de
// acusar, e o payload que o hook do banco monta.
//
// POR QUE ESTAS ASSERÇÕES E NÃO OUTRAS. A parte que quebra caro aqui é a que ninguém vê
// falhar: um limite lido como `NaN` faria `duracaoMs > NaN` ser SEMPRE falso, e o aviso
// simplesmente nunca sairia, sem erro em lugar nenhum e com a configuração parecendo
// aplicada. Por isso todo caminho de leitura é asserido pelo NÚMERO que produz, e não pela
// ausência de exceção.
//
// O PAYLOAD É EXERCITADO CONTRA O OBJETO CONSTRUÍDO, e não contra a saída do logger, pela
// razão que o `fileoverview` de `queryLogPayload` já registra: sob `NODE_ENV=test` o pino
// está em `silent`, então um teste que medisse a linha impressa passaria verde mesmo com o
// vazamento de volta. É o mesmo motivo pelo qual `queryLentaPayload` é exportado.
//
// CONTROLE NEGATIVO (conferido revertendo cada um):
//  - trocar `Math.max(PISO, ...)` por `n` e o caso do zero passa a devolver 0, com o qual
//    toda query do sistema vira linha de log;
//  - trocar `>` por `>=` em `deveAcusarQueryLenta` e o caso da igualdade fica vermelho;
//  - devolver `0` no lugar de `null` em `duracaoDeQuery` e o caso do resultado sem duração
//    passa a acusar toda query multi-resultado como instantânea;
//  - tirar `elidirSql` de `queryLentaPayload` e o caso do segredo fica vermelho nomeando a
//    chave que vazou.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MARCADOR_QUERY_LENTA, PADRAO_DE_QUERY_LENTA_MS, PISO_DE_QUERY_LENTA_MS,
  parseLimiteDeQueryLenta, duracaoDeQuery, deveAcusarQueryLenta,
} from '../../src/utils/query-lenta.js';
import { queryLentaPayload } from '../../src/database/index.js';

describe('query lenta: leitura do limite', () => {
  it('ausente, vazio e ilegível caem no default, sem lançar', () => {
    // A LISTA É EXAUSTIVA DE PROPÓSITO. O env chega sempre como string ou `undefined`, e
    // as três formas abaixo são as que um `.env` produz de fato: a variável não escrita, a
    // escrita vazia, e a escrita por extenso. Nenhuma pode derrubar o boot, e nenhuma pode
    // produzir `NaN`, que é o valor que desligaria o aviso em silêncio.
    for (const bruto of [undefined, null, '', '   ', 'quinhentos', 'abc', {}, []]) {
      assert.equal(
        parseLimiteDeQueryLenta(bruto), PADRAO_DE_QUERY_LENTA_MS,
        `"${String(bruto)}" precisava cair no default`
      );
    }
  });

  it('valor legível vence o default, e o fracionário é truncado', () => {
    assert.equal(parseLimiteDeQueryLenta('800'), 800);
    assert.equal(parseLimiteDeQueryLenta(' 80 '), 80);
    assert.equal(parseLimiteDeQueryLenta('250.9'), 250);
  });

  it('o piso apara em vez de recusar, e ele alcança zero e negativo', () => {
    // ZERO É O VALOR QUE ALGUÉM ESCREVE QUERENDO "acuse tudo", e é o que o `optional()` do
    // config trataria como ausente (`'' || fallback` também engole `'0'`). Aparado para o
    // piso ele continua significando "praticamente tudo", por um caminho que não degenera.
    assert.equal(parseLimiteDeQueryLenta('0'), PISO_DE_QUERY_LENTA_MS);
    assert.equal(parseLimiteDeQueryLenta('-1'), PISO_DE_QUERY_LENTA_MS);
    assert.equal(parseLimiteDeQueryLenta('-99999'), PISO_DE_QUERY_LENTA_MS);
    assert.equal(PISO_DE_QUERY_LENTA_MS, 1, 'o piso é 1 ms; ver o cabeçalho de query-lenta.js');
  });
});

describe('query lenta: a duração vem do driver, e a ausência dela não é zero', () => {
  it('lê `result.duration` quando ele existe', () => {
    assert.equal(duracaoDeQuery({ duration: 1234, rowCount: 3 }), 1234);
    assert.equal(duracaoDeQuery({ duration: 0 }), 0);
  });

  it('ausente, não-numérico e resultado inexistente devolvem null, NUNCA zero', () => {
    // ESTE É O ESTADO REAL DA VERSÃO INSTALADA, e não uma defesa teórica: na pg-promise
    // 12.5.0 o `duration` é carimbado só no ramo de resultado ÚNICO (`lib/query.js`), e o
    // ramo `multiResult` emite `receive` sem duração nenhuma. Zero ali declararia toda
    // query multi-instrução como instantânea.
    for (const r of [undefined, null, {}, { duration: undefined }, { duration: 'x' },
      { duration: NaN }, { duration: Infinity }, 'nada', 7]) {
      assert.equal(duracaoDeQuery(r), null, `${JSON.stringify(r)} devia dar null`);
    }
  });
});

describe('query lenta: a decisão', () => {
  it('acusa acima do limite e cala abaixo dele', () => {
    assert.equal(deveAcusarQueryLenta({ duracaoMs: 501, limiteMs: 500 }), true);
    assert.equal(deveAcusarQueryLenta({ duracaoMs: 4000, limiteMs: 500 }), true);
    assert.equal(deveAcusarQueryLenta({ duracaoMs: 499, limiteMs: 500 }), false);
    assert.equal(deveAcusarQueryLenta({ duracaoMs: 0, limiteMs: 500 }), false);
  });

  it('IGUAL ao limite não acusa: o limite significa "passou de"', () => {
    // Com `>=` e o piso em 1 ms, toda query curta (que mede exatamente 1 ms) viraria linha.
    assert.equal(deveAcusarQueryLenta({ duracaoMs: 500, limiteMs: 500 }), false);
    assert.equal(deveAcusarQueryLenta({ duracaoMs: 1, limiteMs: 1 }), false);
    assert.equal(deveAcusarQueryLenta({ duracaoMs: 2, limiteMs: 1 }), true);
  });

  it('duração ausente NÃO acusa, e limite inválido também não', () => {
    // A direção do erro é escolhida: sem duração medida não há afirmação a fazer, e um
    // limite quebrado tem de produzir SILÊNCIO e não uma linha por query.
    assert.equal(deveAcusarQueryLenta({ duracaoMs: null, limiteMs: 500 }), false);
    assert.equal(deveAcusarQueryLenta({ duracaoMs: undefined, limiteMs: 500 }), false);
    assert.equal(deveAcusarQueryLenta({ duracaoMs: NaN, limiteMs: 500 }), false);
    assert.equal(deveAcusarQueryLenta({ duracaoMs: 9e9, limiteMs: NaN }), false);
    assert.equal(deveAcusarQueryLenta({ duracaoMs: 9e9, limiteMs: 0 }), false);
    assert.equal(deveAcusarQueryLenta({ duracaoMs: 9e9, limiteMs: -5 }), false);
  });
});

describe('query lenta: o payload', () => {
  it('carrega forma, duração e linhas, e NADA de valor', () => {
    const p = queryLentaPayload({
      ctx: { query: "SELECT id FROM users WHERE api_key = 'ebgeo_live_segredo_do_diabo'" },
      result: { duration: 812, rowCount: 1 },
    });
    assert.equal(p.duration, 812);
    assert.equal(p.rows, 1);
    assert.ok(p.query.includes('SELECT id FROM users WHERE api_key ='), 'a FORMA é o valor diagnóstico');
    assert.ok(!p.query.includes('ebgeo_live_segredo_do_diabo'), 'o valor NÃO pode viajar');
    // Guarda de não-vacuidade: sem ela, `!includes(segredo)` passaria verde sobre uma
    // função que devolvesse string vazia, que é o verde-que-não-verifica de sempre.
    assert.ok(p.query.length > 20, 'a elisão não pode ter engolido a query inteira');
  });

  it('nunca publica parâmetro nem valor, mesmo quando o evento os traz', () => {
    // O evento `receive` carrega `ctx.params` e `ctx.values`, e ler qualquer um dos dois
    // reintroduziria à mão o vazamento que a elisão fecha. A asserção é sobre o CONJUNTO
    // de chaves, e não sobre a ausência de uma delas: chave nova entra por decisão.
    const p = queryLentaPayload({
      ctx: {
        query: 'UPDATE users SET password_hash = $1',
        params: ['$2b$12$hash_de_senha'],
        values: ['$2b$12$hash_de_senha'],
      },
      result: { duration: 999, rowCount: 0 },
    });
    assert.deepEqual(Object.keys(p).sort(), ['duration', 'query', 'rows']);
    assert.ok(!JSON.stringify(p).includes('hash_de_senha'));
  });

  it('evento degradado não lança, e a ausência sai como null', () => {
    // O hook roda no caminho mais quente do produto e o `Events.receive` transforma exceção
    // dele em REJEIÇÃO DA QUERY. Um payload que lance sobre um evento incompleto seria o
    // instrumento quebrando o que mede.
    for (const e of [undefined, null, {}, { result: {} }, { ctx: {} }]) {
      const p = queryLentaPayload(e);
      assert.equal(p.duration, null);
      assert.equal(p.rows, null);
      assert.equal(typeof p.query, 'string');
    }
  });

  it('o marcador é a MENSAGEM, sem acento, para casar o filtro do terminal', () => {
    // `diag -- linhas --filtro` casa a linha COMO ELA ESTÁ NO DISCO, e ali um acento viaja
    // escapado (`ê`), de modo que uma mensagem acentuada exigiria que quem procura
    // acertasse o escape. Ver o cabeçalho de `query-lenta.js`.
    assert.equal(MARCADOR_QUERY_LENTA, 'db: query lenta');
    assert.equal(MARCADOR_QUERY_LENTA, MARCADOR_QUERY_LENTA.normalize('NFD').replace(/[̀-ͯ]/g, ''));
  });
});
