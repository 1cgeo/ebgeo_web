// Path: tests/unit/db-query-log-params.test.js
// Os hooks `query` e `error` de src/database/index.js logavam a SQL COM OS VALORES.
//
// A HISTÓRIA ANTERIOR, que este arquivo contava, e por que ela estava incompleta.
// A versão de 2026 do item 101 dizia que o defeito era logar `e.params`, um ARRAY
// POSICIONAL que nenhum `redact.paths` nem o scrub por nome de campo alcança, e o
// conserto foi dropar `params` e truncar `e.query` em 80 caracteres. A premissa era
// que a SQL fosse um MOLDE (`… WHERE api_key = $1`) e os valores viajassem ao lado.
//
// A PREMISSA ERA FALSA, E A FIXTURE ANTIGA NÃO PODIA FALHAR. `pgFormatting` fica no
// default `false` (`node_modules/pg-promise/lib/main.js`), e nesse regime
// `lib/query.js` faz DUAS coisas antes de emitir o evento: define
// `params = pgFormatting ? values : undefined` e REESCREVE o texto por `formatQuery`,
// substituindo `$1`, `$2` pelos literais. Ou seja, no evento `query` deste servidor
// `e.params` é SEMPRE `undefined` e `e.query` é a instrução COM a credencial dentro.
// A fixture antiga montava à mão o oposto exato disso — `$1` ainda no texto e um array
// `params` populado — de modo que ela media uma forma que o pg-promise nunca produz.
// Ela passava verde não por o código estar certo, mas por o sujeito não existir. É
// cobertura vazia, a classe que a constituição desta casa persegue por escrito, e o
// `paramCount` que o payload publicava é o rastro dela: `0` para toda query desde
// sempre, porque `Array.isArray(undefined)` é falso.
//
// TRUNCAR NÃO É REDIGIR, e era o que sobrava de proteção:
// `SELECT id, username FROM users WHERE api_key = 'ebgeo_live_…` gasta 46 dos 80
// caracteres antes de chegar à chave. Pior, o hook de ERRO não truncava nada e roda em
// nível `error`, que está sempre ligado: ele não precisava de ninguém subir
// LOG_LEVEL=debug para escrever a chave viva no `.jsonl` de 30 dias de retenção.
//
// A CORREÇÃO É `elidirSql` (src/utils/elidir-sql.js), que tira os VALORES e deixa a
// FORMA, mais a poda dos campos que o driver do pg pendura no erro (`query`, `params`,
// `detail`, `where`, `internalQuery`) dentro do `errSerializer` de utils/logger.js.
//
// A asserção é sobre o OBJETO QUE O CÓDIGO MONTA, não sobre a saída do logger: sob
// NODE_ENV=test o pino está em level 'silent', então um teste que espiasse o stream
// passaria verde com o vazamento intacto. O irmão que dirige o pg-promise DE VERDADE,
// contra o banco, é tests/integration/db-erro-real-nao-vaza-credencial.test.js, e ele
// existe porque foi justamente a divergência entre fixture e realidade que custou caro
// aqui.
//
// CONTROLE NEGATIVO (2026-08-31), medido revertendo peça por peça, uma de cada vez:
//   - `queryLogPayload` de volta a `query.substring(0, 80)`: 5 dos 11 casos vermelhos,
//     e o primeiro deles falha em «nem um prefixo dela», ou seja, a truncagem em 80
//     entrega literalmente `… api_key = 'ebgeo_live_7f3c9a1b2d4e5f60718293a4` ao log.
//   - `dbErrorLogPayload` de volta a `{ err, query: e.query }`: 3 casos vermelhos aqui
//     («o hook de erro elide a SQL», «a MESMA string viaja de novo dentro de `err`» e
//     «o hook entrega ESSE payload ao logger.error»), mais 2 no irmão de integração.
//   - `elidirCamposDoPg` fora do `errSerializer`: 3 casos vermelhos aqui (a segunda
//     porta, o que sobra para diagnosticar e o erro aninhado), mais 2 no irmão. As duas
//     reversões acima derrubam conjuntos DIFERENTES, que é o que confirma serem duas
//     portas e não uma.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import logger, { errSerializer } from '../../src/utils/logger.js';
import {
  queryLogPayload,
  logQueryEvent,
  dbErrorLogPayload,
  logQueryError,
} from '../../src/database/index.js';

const API_KEY = 'ebgeo_live_7f3c9a1b2d4e5f60718293a4b5c6d7e8';
const TOKEN_HASH = '9c56cc51b374c3ba189210d5b6d4bf57790d351c96c47c02190ecf1e430635ab';
const SENHA_HASH = '$2b$12$KIXQ0kUu9m2QeQ9Xn0hqzuJ2m1Q7Rn3o4p5q6r7s8t9u0v1w2x3y4';

/**
 * A SQL como o pg-promise a entrega neste regime: já formatada, valor dentro.
 * Nenhum `$1` sobrevive a `formatQuery`, e é isso que a fixture antiga errava.
 */
function jaFormatada(sql) {
  return { query: sql };
}

/**
 * O que o pino REALMENTE grava a partir do payload: os serializers se aplicam à chave
 * sob a qual foram registrados, então só `err` passa pelo `errSerializer`. Reproduzir
 * essa metade aqui é o que impede o teste de asserir sobre um objeto que ninguém grava.
 */
function comoOLoggerVeria(payload) {
  return JSON.stringify({ ...payload, err: payload.err ? errSerializer(payload.err) : undefined });
}

/** Um erro com a forma que o driver do pg entrega, sem precisar do banco. */
function erroDoPgFalso(campos) {
  return Object.assign(new Error('erro de banco'), campos);
}

describe('Hook de query: a SQL formatada não leva a credencial ao log', () => {
  it('a api_key de FIND_USER_BY_API_KEY não sobrevive ao hook de debug', () => {
    const sql = `SELECT id, username FROM users WHERE api_key = '${API_KEY}' AND is_active = true`;
    // Guarda de não-vacuidade: a entrada realmente carrega a chave (é ISTO que o
    // pg-promise entrega, e é o que a fixture antiga não representava).
    assert.ok(sql.includes(API_KEY), 'fixture: a SQL formatada de fato carrega a chave');

    const payload = queryLogPayload(jaFormatada(sql));
    const serializado = JSON.stringify(payload);
    assert.ok(!serializado.includes(API_KEY), `a chave de API foi para o log: ${serializado}`);
    assert.ok(!serializado.includes('ebgeo_live'), 'nem um prefixo dela');
  });

  it('o hash de refresh token e o password_hash também não sobrevivem', () => {
    const refresh = JSON.stringify(
      queryLogPayload(jaFormatada(`SELECT * FROM refresh_tokens WHERE token_hash = '${TOKEN_HASH}'`))
    );
    assert.ok(!refresh.includes(TOKEN_HASH), `o hash do refresh token foi para o log: ${refresh}`);

    const insert = JSON.stringify(
      queryLogPayload(jaFormatada(
        `INSERT INTO users (username, password_hash) VALUES ('fulano', '${SENHA_HASH}') RETURNING *`
      ))
    );
    assert.ok(!insert.includes(SENHA_HASH), `o hash de senha foi para o log: ${insert}`);
    assert.ok(!insert.includes('KIXQ0kUu'), 'nem um pedaço dele');
    assert.ok(!insert.includes('fulano'), 'nenhum valor, nem os inócuos');
  });

  it('a FORMA da query continua logada — o conserto não é apagar o log', () => {
    // Sem isto, "remover o logger.debug inteiro" satisfaria os casos acima e o valor de
    // diagnóstico se perderia junto com o vazamento.
    const payload = queryLogPayload(jaFormatada(`SELECT id FROM users WHERE api_key = '${API_KEY}'`));
    assert.equal(payload.query, "SELECT id FROM users WHERE api_key = '?'");
  });

  it('NÃO existe mais `paramCount`, porque ele respondia 0 a tudo', () => {
    // Ele lia `Array.isArray(e.params)`, e `e.params` é estruturalmente `undefined`
    // neste regime. Campo que publica 0 para toda query parece medição e não é; a
    // aridade também não é recuperável aqui, já que os placeholders somem do texto.
    const payload = queryLogPayload(jaFormatada("SELECT 1 FROM t WHERE a = 'x' AND b = 'y'"));
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'paramCount'), 'campo falso removido');
    assert.deepEqual(Object.keys(payload), ['query']);
  });

  it('a linha de debug continua com teto de 80, e o teto não é o que redige', () => {
    const longa = `SELECT ${'a'.repeat(200)} FROM users`;
    assert.equal(queryLogPayload(jaFormatada(longa)).query.length, 80 + '...[truncado]'.length);

    // O valor sai ANTES do corte: mesmo cabendo nos 80, a chave não aparece.
    const curta = queryLogPayload(jaFormatada(`SELECT 1 FROM users WHERE k = '${API_KEY}'`));
    assert.ok(!curta.query.includes('ebgeo_live'), 'o corte não pode ser a proteção');
  });

  it('o hook entrega ESSE payload ao logger.debug (e não outro objeto)', () => {
    // Amarra o hook ao construtor: alguém poderia "consertar" a função pura e continuar
    // logando `e.query` cru na chamada.
    const original = logger.debug;
    const capturado = [];
    try {
      logger.debug = (obj, msg) => { capturado.push([obj, msg]); };
      logQueryEvent(jaFormatada(`SELECT id FROM users WHERE api_key = '${API_KEY}'`));
    } finally {
      logger.debug = original;
    }
    assert.equal(capturado.length, 1, 'o hook chama logger.debug exatamente uma vez');
    const [obj, msg] = capturado[0];
    assert.equal(msg, 'DB Query');
    assert.deepEqual(obj, { query: "SELECT id FROM users WHERE api_key = '?'" });
  });
});

describe('Hook de erro: nível `error` está sempre ligado, e ele vazava duas vezes', () => {
  it('o hook de erro elide a SQL do evento', () => {
    const sql = `SELECT id FROM users WHERE api_key = '${API_KEY}'`;
    const payload = dbErrorLogPayload(erroDoPgFalso({ code: '42703' }), { query: sql });
    assert.equal(payload.query, "SELECT id FROM users WHERE api_key = '?'");
    assert.ok(!comoOLoggerVeria(payload).includes(API_KEY), 'a chave chegou ao log pelo campo `query`');
  });

  it('a MESMA string viaja de novo dentro de `err`, e essa é a segunda porta', () => {
    // `lib/query.js` carimba `err.query = err.query || query` e `err.params` antes de
    // rejeitar; o serializer padrão do pino copia toda propriedade enumerável. O campo
    // se chama `query`, então nenhum `redact.paths` jamais o veria.
    const err = erroDoPgFalso({
      code: '23514',
      query: `INSERT INTO users (password_hash) VALUES ('${SENHA_HASH}')`,
      params: [SENHA_HASH],
      detail: `Failing row contains (7, fulano, ${SENHA_HASH}, producer, null).`,
      where: `PL/pgSQL function fn_x('${API_KEY}') line 3`,
      internalQuery: `SELECT 1 FROM users WHERE api_key = '${API_KEY}'`,
    });
    const bruto = JSON.stringify({ q: err.query, p: err.params, d: err.detail, w: err.where });
    assert.ok(bruto.includes(SENHA_HASH), 'fixture: o erro cru de fato carrega o hash');
    assert.ok(bruto.includes(API_KEY), 'fixture: e a chave de API');

    const saida = comoOLoggerVeria(dbErrorLogPayload(err, { query: err.query }));
    assert.ok(!saida.includes(SENHA_HASH), `o hash de senha chegou ao log: ${saida}`);
    assert.ok(!saida.includes('KIXQ0kUu'), 'nem um pedaço dele');
    assert.ok(!saida.includes(API_KEY), `a chave de API chegou ao log: ${saida}`);
    assert.ok(!saida.includes('Failing row contains'), 'o DETAIL despeja a linha inteira');
  });

  it('o que sobra do erro ainda serve para diagnosticar', () => {
    // Um conserto que apagasse `err` inteiro passaria nos casos acima e deixaria o log
    // sem SQLSTATE, sem constraint e sem mensagem.
    const serializado = errSerializer(erroDoPgFalso({
      code: '23514',
      constraint: 'users_producer_scope_check',
      table: 'users',
      schema: 'public',
      query: "INSERT INTO users (password_hash) VALUES ('x')",
      detail: 'Failing row contains (…).',
    }));
    assert.equal(serializado.code, '23514');
    assert.equal(serializado.constraint, 'users_producer_scope_check');
    assert.equal(serializado.table, 'users');
    assert.equal(serializado.schema, 'public');
    assert.equal(serializado.message, 'erro de banco');
    assert.equal(serializado.query, "INSERT INTO users (password_hash) VALUES ('?')");
    assert.equal(serializado.detail, '[REDACTED]', 'a presença do DETAIL é dita, o conteúdo não');
    assert.ok(!Object.prototype.hasOwnProperty.call(serializado, 'params'), '`params` é dropado');
  });

  it('o serializer alcança o erro ANINHADO, que é como uma transação rejeita', () => {
    const interno = erroDoPgFalso({
      code: '23505',
      query: `SELECT 1 FROM users WHERE api_key = '${API_KEY}'`,
      detail: `Key (api_key)=(${API_KEY}) already exists.`,
    });
    const externo = Object.assign(new Error('batch falhou'), { first: interno });
    assert.ok(JSON.stringify({ q: interno.query }).includes(API_KEY), 'fixture: o interno carrega a chave');

    const saida = JSON.stringify(errSerializer(externo));
    assert.ok(!saida.includes(API_KEY), `a chave veio pelo erro aninhado: ${saida}`);
  });

  it('o hook entrega ESSE payload ao logger.error (e não outro objeto)', () => {
    const original = logger.error;
    const capturado = [];
    const err = erroDoPgFalso({ code: '42703' });
    try {
      logger.error = (obj, msg) => { capturado.push([obj, msg]); };
      logQueryError(err, { query: `SELECT nada FROM users WHERE api_key = '${API_KEY}'` });
    } finally {
      logger.error = original;
    }
    assert.equal(capturado.length, 1, 'o hook chama logger.error exatamente uma vez');
    const [obj, msg] = capturado[0];
    assert.equal(msg, 'DB Error');
    assert.equal(obj.query, "SELECT nada FROM users WHERE api_key = '?'");
    assert.equal(obj.err, err, 'o erro segue inteiro para o serializer, que é quem o limpa');
  });
});
