// Path: tests/integration/db-erro-real-nao-vaza-credencial.test.js
//
// O IRMÃO COM BANCO de tests/unit/db-query-log-params.test.js, e a razão de ele existir
// é o defeito daquele: por anos o guarda do vazamento montou À MÃO um evento de
// pg-promise com `$1` ainda no texto e um array `params` populado. O pg-promise NUNCA
// produz essa forma neste servidor (`pgFormatting` fica no default `false`, e
// `lib/query.js` reescreve o texto com os literais antes de emitir qualquer evento),
// então a suíte media uma forma inexistente e passava verde com a credencial viva indo
// para o `.jsonl` a cada erro de query.
//
// Fixture escrita à mão não pode provar que a fixture está certa. Este arquivo fecha
// exatamente esse buraco: ele PROVOCA um erro de verdade, no banco de teste, passando um
// valor com cara de credencial, e confere o que o código MONTA para o log. Se um dia o
// pg-promise mudar de regime ou de forma de evento, é aqui que o vermelho aparece.
//
// A leitura é do OBJETO montado, e não do stream do pino: sob NODE_ENV=test o logger
// está em level 'silent', então espiar a saída passaria verde com o vazamento intacto.
// O `errSerializer` é aplicado à chave `err` porque é isso que o pino faz com ela, e é
// pela metade dentro de `err` que a segunda porta se abre (`err.query`, `err.params`,
// `detail`, `where`, `internalQuery`).
//
// CONTROLE NEGATIVO (2026-08-31), medido. Com `dbErrorLogPayload` de volta a
// `{ err, query: e.query }`, ou com `elidirCamposDoPg` fora do `errSerializer`, os dois
// últimos casos ficam vermelhos e a mensagem traz o log inteiro com o segredo dentro,
// nomeando o campo por onde ele saiu. O PRIMEIRO caso continua verde nas duas
// reversões, e isso é o desenho: ele não mede o conserto, ele mede o REGIME do
// pg-promise, que é a premissa que a fixture antiga contradizia. Se um dia ele ficar
// vermelho, o que mudou foi a biblioteca, e é aí que os outros dois precisam ser
// relidos em vez de ajustados.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import logger, { errSerializer } from '../../src/utils/logger.js';
import dbFacade from '../../src/database/index.js';

// Uma "credencial" reconhecível e improvável de aparecer por acaso em qualquer campo.
const SEGREDO = `ebgeo_live_${randomUUID().replace(/-/g, '')}`;
const SENHA_HASH = `$2b$12$KIXQ0kUu9m2QeQ9Xn0hqzu${randomUUID().slice(0, 8)}`;

/**
 * Dirige o pg-promise REAL até uma falha e devolve o que o hook `error` de
 * src/database/index.js entregou ao logger, já passado pelo serializer, que é o texto
 * que o pino gravaria.
 *
 * @param {() => Promise<unknown>} acao - a chamada que deve falhar.
 * @returns {Promise<{err: Error, payload: object, texto: string}>}
 */
async function capturarLogDeErro(acao) {
  const original = logger.error;
  const capturado = [];
  let err = null;
  try {
    logger.error = (obj, msg) => { capturado.push([obj, msg]); };
    try {
      await acao();
    } catch (e) {
      err = e;
    }
  } finally {
    logger.error = original;
  }
  assert.ok(err, 'a ação precisava falhar de verdade, senão o hook nem roda');
  assert.equal(capturado.length, 1, 'o hook `error` do pg-promise rodou exatamente uma vez');
  assert.equal(capturado[0][1], 'DB Error');
  const payload = capturado[0][0];
  const texto = JSON.stringify({ ...payload, err: errSerializer(payload.err) });
  return { err, payload, texto };
}

describe('Erro de query REAL do pg-promise não leva credencial ao log', () => {
  let db;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('o evento do pg-promise chega com a SQL JÁ FORMATADA e sem `params` (a premissa antiga era falsa)', async () => {
    // Este caso é o alicerce dos outros: ele mede o REGIME, e é a asserção que a
    // fixture escrita à mão contradizia.
    const { err } = await capturarLogDeErro(
      () => dbFacade.oneOrNone('SELECT coluna_que_nao_existe FROM users WHERE username = $1', [SEGREDO])
    );
    assert.equal(err.code, '42703', 'undefined_column, o erro que pedimos');
    assert.equal(typeof err.query, 'string');
    assert.ok(
      err.query.includes(SEGREDO),
      `fixture: o pg-promise de fato carimba o VALOR dentro de err.query — recebido: ${err.query}`
    );
    assert.ok(!err.query.includes('$1'), 'e o placeholder não sobrevive à formatação');
    assert.equal(err.params, undefined, '`params` é sempre undefined neste regime');
  });

  it('a credencial não aparece em nada do que o hook monta para o log', async () => {
    const { payload, texto } = await capturarLogDeErro(
      () => dbFacade.oneOrNone('SELECT coluna_que_nao_existe FROM users WHERE username = $1', [SEGREDO])
    );
    assert.ok(!texto.includes(SEGREDO), `a credencial chegou ao log: ${texto}`);
    assert.ok(!texto.includes('ebgeo_live'), 'nem o prefixo dela');

    // E o que sobra ainda diagnostica: a forma da instrução e o SQLSTATE.
    assert.equal(payload.query, "SELECT coluna_que_nao_existe FROM users WHERE username = '?'");
    assert.ok(texto.includes('42703'), 'o SQLSTATE precisa continuar no log');
  });

  it('o DETAIL de uma violação de CHECK despeja a linha inteira, e ela é elidida', async () => {
    // `users_producer_scope_check` é bicondicional (`role = 'producer'` ⇔
    // `producer_org_id IS NOT NULL`), então esta linha viola sem depender de FK nenhuma.
    // O DETAIL do Postgres é `Failing row contains (…)` com a TUPLA, `password_hash`
    // incluído: é a segunda porta, e ela não passa por `err.query`.
    const nome = `leak_${randomUUID().slice(0, 8)}`;
    const { err, texto } = await capturarLogDeErro(
      () => dbFacade.none(
        `INSERT INTO users (username, password_hash, nome, role, producer_org_id)
         VALUES ($1, $2, $3, 'producer', NULL)`,
        [nome, SENHA_HASH, nome]
      )
    );
    assert.equal(err.code, '23514', 'check_violation, o erro que pedimos');
    assert.equal(err.constraint, 'users_producer_scope_check');
    assert.ok(
      typeof err.detail === 'string' && err.detail.includes(SENHA_HASH),
      `fixture: o DETAIL cru de fato carrega o hash de senha — recebido: ${err.detail}`
    );

    assert.ok(!texto.includes(SENHA_HASH), `o hash de senha chegou ao log: ${texto}`);
    assert.ok(!texto.includes('KIXQ0kUu'), 'nem um pedaço dele');
    assert.ok(!texto.includes('Failing row contains'), 'o DETAIL inteiro precisa sair');
    assert.ok(texto.includes('users_producer_scope_check'), 'a constraint fica: é o diagnóstico');
  });
});
