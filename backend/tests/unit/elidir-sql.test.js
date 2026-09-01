// Path: tests/unit/elidir-sql.test.js
// O elisor de valores de SQL (src/utils/elidir-sql.js).
//
// POR QUE ELE EXISTE. `pgFormatting` fica no default `false` do pg-promise, e nesse
// regime a própria biblioteca formata: `lib/query.js` reescreve o texto substituindo
// `$1`, `$2` pelos valores ANTES de emitir o evento e antes de mandar ao servidor. O
// texto que chega ao log, portanto, não é molde: é a instrução COM a credencial dentro.
// Este módulo tira os valores e deixa a forma, que é a metade com valor diagnóstico.
//
// O QUE CADA CASO PROVARIA SE O CÓDIGO ESTIVESSE ERRADO. Os casos de aspas escapadas,
// de literal com prefixo, de cifrão duplo e de comentário não são exotismo de dialeto:
// cada um é uma forma que faz um elisor ingênuo (um `replace(/'[^']*'/g, "'?'")`) PARAR
// no lugar errado e devolver o RESTO do valor como se fosse SQL. É o modo de falha que
// interessa aqui, porque ele vaza sem erro nenhum e com cara de texto redigido.
//
// CONTROLE NEGATIVO, medido em 2026-08-31, não estimado. Apagar o tratamento de `''`
// em `fimDoLiteral` (parar na primeira aspa) deixa VERMELHO exatamente um caso, o das
// aspas duplicadas, que devolve `… nome = '?'D''Agua SEGREDO_VAZADO'` em vez do
// esperado. Fazer `elidirSql` devolver a entrada intacta deixa 14 dos 16 casos
// vermelhos; os dois que sobrevivem são o de entrada não-string e o de idempotência,
// que não medem elisão nenhuma.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { elidirSql, MARCADOR_TEXTO, TETO_PADRAO, SUFIXO_TRUNCADO } from '../../src/utils/elidir-sql.js';

const API_KEY = 'ebgeo_live_7f3c9a1b2d4e5f60718293a4b5c6d7e8';
const SENHA_HASH = '$2b$12$KIXQ0kUu9m2QeQ9Xn0hqzuJ2m1Q7Rn3o4p5q6r7s8t9u0v1w2x3y4';

describe('elidirSql — os valores saem, a forma fica', () => {
  it('elide o literal e preserva tabela, coluna e comando', () => {
    const sql = `SELECT id, username FROM users WHERE api_key = '${API_KEY}' AND is_active = true`;
    const out = elidirSql(sql);
    assert.equal(out, "SELECT id, username FROM users WHERE api_key = '?' AND is_active = true");
    assert.ok(!out.includes(API_KEY), 'a chave de API não pode sobreviver à elisão');
  });

  it('elide o hash bcrypt, cujos cifrões parecem abertura de cifrão duplo', () => {
    // `$2b$12$…` tem a MESMA forma de um `$tag$`. Dentro do literal isso não pode ser
    // interpretado, senão o scanner sai do literal no meio do hash.
    const out = elidirSql(`UPDATE users SET password_hash = '${SENHA_HASH}' WHERE id = 42`);
    assert.equal(out, "UPDATE users SET password_hash = '?' WHERE id = ?");
    assert.ok(!out.includes('KIXQ0kUu'), 'nenhum pedaço do hash pode sobrar');
  });

  it('aspa simples DUPLICADA continua o mesmo literal (o erro clássico do elisor ingênuo)', () => {
    const out = elidirSql("SELECT * FROM t WHERE nome = 'D''Agua SEGREDO_VAZADO' AND x = 1");
    assert.equal(out, "SELECT * FROM t WHERE nome = '?' AND x = ?");
    assert.ok(!out.includes('SEGREDO_VAZADO'), 'o resto do valor vazou depois da aspa duplicada');
  });

  it('literal com quebra de linha é consumido inteiro', () => {
    const out = elidirSql("INSERT INTO t (obs) VALUES ('linha um\nSEGREDO_VAZADO linha dois')");
    assert.equal(out, "INSERT INTO t (obs) VALUES ('?')");
    assert.ok(!out.includes('SEGREDO_VAZADO'));
  });

  it("E'...' honra a barra invertida como escape", () => {
    // Sem a regra, a aspa escapada fecharia o literal e `SEGREDO_VAZADO` sairia cru.
    const out = elidirSql("SELECT E'abc\\'SEGREDO_VAZADO' , 1");
    assert.equal(out, "SELECT '?' , ?");
    assert.ok(!out.includes('SEGREDO_VAZADO'));
  });

  it('os demais prefixos de literal (B, X, N, U&) também são elididos', () => {
    assert.equal(elidirSql("VALUES (B'1010')"), "VALUES ('?')");
    assert.equal(elidirSql("VALUES (X'deadbeef')"), "VALUES ('?')");
    assert.equal(elidirSql("VALUES (N'texto')"), "VALUES ('?')");
    assert.equal(elidirSql("VALUES (U&'d\\0061t')"), "VALUES ('?')");
  });

  it('cifrão duplo é elidido com a tag junto', () => {
    const out = elidirSql("SELECT $corpo$ mi'olo SEGREDO_VAZADO $corpo$ FROM t");
    assert.equal(out, 'SELECT $?$ FROM t');
    assert.ok(!out.includes('SEGREDO_VAZADO'));
    assert.equal(elidirSql('SELECT $$x$$'), 'SELECT $?$');
  });

  it('o placeholder $1 NÃO é confundido com valor nem com cifrão duplo', () => {
    // Ele sobrevive à formatação só nos caminhos em que a formatação LANÇOU, e ali é a
    // coisa mais útil do texto.
    assert.equal(
      elidirSql('SELECT id FROM users WHERE api_key = $1 AND org = $22'),
      'SELECT id FROM users WHERE api_key = $1 AND org = $22'
    );
  });

  it('identificador com dígito não vira marcador, número solto vira', () => {
    assert.equal(
      elidirSql('SELECT md5(x), int4, column_2 FROM sv360.photos LIMIT 50 OFFSET 0'),
      'SELECT md5(x), int4, column_2 FROM sv360.photos LIMIT ? OFFSET ?'
    );
    assert.equal(elidirSql('SELECT 3.14, -2, 1e-9, .5'), 'SELECT ?, -?, ?, ?');
  });

  it('identificador entre aspas duplas é preservado, apóstrofo dentro incluído', () => {
    // A preservação é decisão declarada; consumir o token como unidade não é: uma aspa
    // simples solta ali abriria um literal e engoliria o resto da instrução.
    const out = elidirSql(`SELECT "d'agua" FROM t WHERE x = 'SEGREDO_VAZADO'`);
    assert.equal(out, `SELECT "d'agua" FROM t WHERE x = '?'`);
    assert.ok(!out.includes('SEGREDO_VAZADO'));
  });

  it('comentários são atravessados sem abrir literal (bloco aninhado inclusive)', () => {
    const linha = elidirSql("SELECT 1 -- don't stop\nFROM t WHERE x = 'SEGREDO_VAZADO'");
    assert.equal(linha, "SELECT ? -- don't stop\nFROM t WHERE x = '?'");
    assert.ok(!linha.includes('SEGREDO_VAZADO'), 'o apóstrofo do comentário desalinhou o scanner');

    assert.equal(
      elidirSql('SELECT * FROM t /* nota /* aninhada */ ainda */ WHERE x = 1'),
      'SELECT * FROM t /* nota /* aninhada */ ainda */ WHERE x = ?'
    );
  });

  it('literal SEM FECHAMENTO falha FECHADO: elide até o fim', () => {
    const out = elidirSql(`SELECT * FROM t WHERE k = '${API_KEY}`);
    assert.equal(out, "SELECT * FROM t WHERE k = '?'");
    assert.ok(!out.includes('ebgeo_live'), 'texto malformado não pode virar rota de fuga');
  });

  it('o teto corta DEPOIS da elisão, e anuncia o corte', () => {
    const longa = `SELECT ${'a'.repeat(TETO_PADRAO + 200)} FROM t`;
    const out = elidirSql(longa);
    assert.equal(out.length, TETO_PADRAO + SUFIXO_TRUNCADO.length);
    assert.ok(out.endsWith(SUFIXO_TRUNCADO), 'o leitor precisa saber que a cauda sumiu');

    // Teto explícito, e o corte não é o que redige: o valor já saiu antes.
    const curto = elidirSql(`SELECT * FROM users WHERE api_key = '${API_KEY}'`, { teto: 20 });
    assert.ok(!curto.includes('ebgeo'), 'o teto não é o mecanismo de redação');
    assert.equal(curto, 'SELECT * FROM users ' + SUFIXO_TRUNCADO);
  });

  it('teto inválido cai no padrão em vez de virar zero', () => {
    const sql = 'SELECT 1 FROM t';
    assert.equal(elidirSql(sql, { teto: Number.NaN }), 'SELECT ? FROM t');
    assert.equal(elidirSql(sql, { teto: -5 }), 'SELECT ? FROM t');
    assert.equal(elidirSql(sql, {}), 'SELECT ? FROM t');
  });

  it('entrada não-string não derruba o elisor (e.query pode ser um QueryFile)', () => {
    assert.equal(elidirSql(undefined), '');
    assert.equal(elidirSql(null), '');
    assert.equal(typeof elidirSql({ toString: () => "x = 'y'" }), 'string');
    assert.equal(elidirSql({ toString: () => "x = 'y'" }), `x = ${MARCADOR_TEXTO}`);
  });

  it('é idempotente: elidir o já elidido não desfaz nem revela nada', () => {
    const uma = elidirSql(`SELECT * FROM users WHERE api_key = '${API_KEY}' AND id = 7`);
    assert.equal(elidirSql(uma), uma);
  });
});
