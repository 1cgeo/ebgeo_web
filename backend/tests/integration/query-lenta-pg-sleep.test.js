// Path: tests/integration/query-lenta-pg-sleep.test.js
//
// O HOOK `receive` CONTRA O POSTGRES DE VERDADE: `pg_sleep` acima e abaixo do limite.
//
// POR QUE INTEGRAÇÃO E NÃO UNIDADE. A metade pura já está presa em
// `tests/unit/query-lenta-decisao.test.js`. O que só o banco prova é a premissa em que ela
// se apoia: que `result.duration` EXISTE no evento `receive` da pg-promise instalada, e que
// ele mede o que se supõe. Conferi no `node_modules/pg-promise/lib/query.js` da 12.5.0 (a
// linha `result.duration = Date.now() - start`, uma antes de `Events.receive`), mas leitura
// de fonte de dependência é premissa até alguém exercê-la: um upgrade que mova aquela linha
// para dentro de outro ramo deixaria a metade pura verde e o aviso mudo para sempre.
//
// COMO A LINHA É OBSERVADA. Sob `NODE_ENV=test` o pino está em `silent`, então não há saída
// para ler: o teste TROCA `logger.warn` por um espião, roda a query e devolve o original. É
// o caminho independente que a constituição pede, porque ele não passa por nenhuma peça que
// o código de produção também usaria para se autoafirmar.
//
// COMO O LIMITE É BAIXADO. `SLOW_QUERY_MS` é escrito no `process.env` ANTES de `config.js`
// ser avaliado, e é por isso que os módulos que o alcançam entram por `import()` no corpo do
// arquivo em vez de por `import` no topo: o ESM avalia todo import estático antes da
// primeira linha do módulo, e um `config` já congelado ignoraria a variável. O runner
// (`scripts/run-tests.js`) monta o env do processo filho com `...process.env` mais uma lista
// fixa, e `SLOW_QUERY_MS` não está nessa lista, então ele NÃO é sobrescrito. O `node --test`
// roda um processo por arquivo, então este env não vaza para as outras suítes.
//
// CONTROLE NEGATIVO (conferido revertendo cada um):
//  - tirar `receive: receberResultado` do `initOptions` e o caso da query lenta fica
//    vermelho por espião nunca chamado;
//  - trocar `>` por `>=` na decisão e o caso da query rápida passa a acusar;
//  - ler `e.ctx.params` no payload e o caso do segredo fica vermelho.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// O LIMITE VAI PARA O ENV ANTES DE QUALQUER COISA QUE LEIA CONFIG. 40 ms é bem acima do
// custo de uma ida ao banco local (que mede uns poucos ms) e bem abaixo do `pg_sleep` de
// 250 ms adiante, de modo que os dois lados do limite ficam separados por uma folga que
// nenhuma variação de máquina fecha.
const LIMITE_MS = 40;
process.env.SLOW_QUERY_MS = String(LIMITE_MS);

const { default: config } = await import('../../src/config.js');
const bd = await import('../../src/database/index.js');
const { default: logger } = await import('../../src/utils/logger.js');
const { MARCADOR_QUERY_LENTA } = await import('../../src/utils/query-lenta.js');

/**
 * Roda `fn` com `logger.warn` espionado e devolve as chamadas.
 *
 * A TROCA É DE PROPRIEDADE PRÓPRIA sobre a instância do pino, e o hook chama
 * `logger.warn(...)` no objeto importado a cada linha, então a substituição vale sem que o
 * código de produção precise de um ponto de injeção só para teste. O `finally` restaura,
 * senão um caso que falhe no meio deixaria o espião para os seguintes.
 */
async function comEspiaoDeWarn(fn) {
  const chamadas = [];
  const original = logger.warn;
  logger.warn = (...args) => { chamadas.push(args); };
  try {
    await fn();
  } finally {
    logger.warn = original;
  }
  return chamadas;
}

/** Só as chamadas que são desta linha; a suíte compartilha o logger com o resto do módulo. */
const lentas = (chamadas) => chamadas.filter((c) => c[1] === MARCADOR_QUERY_LENTA);

describe('query lenta: o hook `receive` contra o Postgres', () => {
  before(() => {
    // A PREMISSA DO ARQUIVO INTEIRO, asserida antes de qualquer caso: sem ela, um `config`
    // já avaliado por outro import deixaria o limite em 500 ms e TODOS os casos abaixo
    // passariam verdes pelo motivo errado (nenhuma query cruzaria o limite, e o caso da
    // query rápida confirmaria isso com prazer).
    assert.equal(
      config.db.slowQueryMs, LIMITE_MS,
      'o env foi lido depois de config.js ser avaliado: os imports dinâmicos do topo deste arquivo são o que evita isso'
    );
  });

  after(async () => {
    await bd.pgp.end();
  });

  it('uma query ACIMA do limite escreve UMA linha, com forma, duração e linhas', async () => {
    const chamadas = await comEspiaoDeWarn(async () => {
      await bd.one("SELECT pg_sleep(0.25), 'marca-lenta' AS marca");
    });

    const nossas = lentas(chamadas);
    assert.equal(nossas.length, 1, 'uma linha por query lenta, nem zero nem duas');

    const [payload, mensagem] = nossas[0];
    assert.equal(mensagem, MARCADOR_QUERY_LENTA);
    assert.ok(
      payload.duration > LIMITE_MS,
      `a duração medida (${payload.duration}) tem de passar do limite; se vier null, o driver deixou de carimbar result.duration`
    );
    // 250 ms de sono, com folga generosa para máquina carregada: o número não pode ser
    // qualquer um, senão a asserção acima passaria com um `duration` que medisse outra coisa.
    assert.ok(payload.duration >= 200 && payload.duration < 30_000, `duração implausível: ${payload.duration}`);
    assert.equal(payload.rows, 1, '`rowCount` do resultado, não `data.length`');
    assert.ok(payload.query.includes('pg_sleep'), 'a FORMA da query é o valor diagnóstico');
  });

  it('uma query ABAIXO do limite não escreve nada', async () => {
    const chamadas = await comEspiaoDeWarn(async () => {
      // Guarda de não-vacuidade: a query PRECISA ter rodado, senão "nenhuma linha" é
      // verdade por não ter havido consulta nenhuma.
      const r = await bd.one('SELECT 1 AS um');
      assert.equal(r.um, 1);
    });
    assert.deepEqual(lentas(chamadas), [], 'query rápida não pode virar linha de log');
  });

  it('o valor NÃO viaja: o texto sai elidido mesmo com literal na query', async () => {
    // `pgFormatting` está no default `false`, então a pg-promise interpola o valor no TEXTO
    // antes de emitir o evento. Sem `elidirSql`, este segredo estaria no `.jsonl`.
    const segredo = 'ebgeo_live_naodeveaparecer_1234';
    const chamadas = await comEspiaoDeWarn(async () => {
      await bd.one('SELECT pg_sleep(0.25), $1::text AS chave', [segredo]);
    });

    const nossas = lentas(chamadas);
    assert.equal(nossas.length, 1);
    const texto = JSON.stringify(nossas[0][0]);
    assert.ok(texto.includes('pg_sleep'), 'não-vacuidade: o payload precisa ter a query dentro');
    assert.ok(!texto.includes(segredo), 'o literal interpolado pela pg-promise NÃO pode chegar ao log');
  });

  it('o hook não derruba a query quando algo dentro dele falha', async () => {
    // `Events.receive` (`node_modules/pg-promise/lib/events.js`) transforma exceção do
    // handler em REJEIÇÃO da query. Este caso prova a envoltura: com o `logger.warn`
    // lançando, a query lenta ainda precisa RESPONDER. Sem o try/catch do hook, o
    // instrumento derrubaria o caminho mais quente do produto.
    const original = logger.warn;
    logger.warn = () => { throw new Error('log quebrado de propósito'); };
    try {
      const r = await bd.one("SELECT pg_sleep(0.25), 'ok' AS estado");
      assert.equal(r.estado, 'ok', 'a query tem de responder mesmo com o log quebrado');
    } finally {
      logger.warn = original;
    }
  });
});
