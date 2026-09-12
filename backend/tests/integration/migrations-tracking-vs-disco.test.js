// Path: tests/integration/migrations-tracking-vs-disco.test.js
// Item 102 — `_migrations` versus os arquivos em disco.
//
// O runner casa arquivo com linha de `_migrations` pelo NOME (migrate.js:67).
// Renomear uma migração já aplicada faz o runner tratá-la como nova e re-executar
// o DDL (`CREATE TABLE sv360.projects` → erro, deploy quebrado); REMOVER o arquivo
// deixa a linha órfã sem ninguém notar.
//
// REFUTAÇÃO PARCIAL: o relatório pedia trocar o `assert.ok(n > 0)` de
// low-impact-fixes.test.js:264 — esse teste JÁ FOI REMOVIDO (a própria suíte
// registra a remoção em comentário) e a idempotência já é asserida contra ESTADO em
// config-infra-gaps.test.js ('re-running migrations … changes nothing'). O que
// continua sem cobertura, e é o que este arquivo prende, são os dois sentidos da
// comparação BANCO × DISCO e a estabilidade dos dados semeados PELAS migrações.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { runMigrations } from '../../src/database/migrate.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/database/migrations');
const ARQUIVOS = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

describe('_migrations × arquivos em disco (item 102)', () => {
  let db;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const nomesNoBanco = async () => {
    const { rows } = await db.query('SELECT name FROM _migrations ORDER BY name');
    return rows.map((r) => r.name);
  };

  it('o conjunto do banco é EXATAMENTE o conjunto do disco, nos dois sentidos', async () => {
    assert.ok(ARQUIVOS.length >= 5, `guarda: esperava >= 5 migrações em disco, achei ${ARQUIVOS.length}`);

    const banco = await nomesNoBanco();
    assert.ok(banco.length >= 5, `guarda: esperava >= 5 linhas em _migrations, achei ${banco.length}`);

    const porAplicar = ARQUIVOS.filter((f) => !banco.includes(f));
    assert.deepEqual(porAplicar, [], 'arquivo em disco que nunca foi aplicado');

    const orfas = banco.filter((n) => !ARQUIVOS.includes(n));
    assert.deepEqual(orfas, [], 'linha em _migrations sem arquivo correspondente (renomeada ou removida)');

    // Igualdade de LISTA (e não só de conjuntos): pega também duplicata de nome.
    assert.deepEqual(banco, ARQUIVOS);
  });

  it('controle negativo: um nome fantasma em _migrations quebra a comparação', async () => {
    // Dentro de uma transação revertida — o assert precisa saber discriminar, e o
    // banco não pode ficar sujo para as outras suítes.
    await db.query('BEGIN');
    try {
      await db.query("INSERT INTO _migrations (name) VALUES ('999_fantasma.sql')");
      const banco = await nomesNoBanco();
      const orfas = banco.filter((n) => !ARQUIVOS.includes(n));
      assert.deepEqual(orfas, ['999_fantasma.sql'], 'a comparação precisa VER a linha órfã');
      assert.notDeepEqual(banco, ARQUIVOS, 'e a igualdade de lista precisa falhar');
    } finally {
      await db.query('ROLLBACK');
    }

    // E depois do rollback o estado volta a ser o correto (prova que o controle
    // negativo não deixou resíduo).
    const depois = await nomesNoBanco();
    assert.deepEqual(depois, ARQUIVOS);
  });

  it('re-executar runMigrations não duplica o dado semeado pelas migrações', async () => {
    // `INSERT INTO ranks` (001_identidade_e_credenciais.sql) NÃO tem ON CONFLICT e a tabela não tem
    // UNIQUE em code/nome: se o tracking falhar, duplica em silêncio e o dropdown
    // de posto passa a mostrar 38 itens em vez de 19.
    const contar = async (tabela) => {
      const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM ${tabela}`);
      assert.equal(rows.length, 1);
      return rows[0].n;
    };

    const ranksAntes = await contar('ranks');
    const basemapsAntes = await contar('basemaps');
    // Guarda de não-vacuidade: prova que o seed rodou, sem prender o valor EXATO.
    // Prendia `=== 19` e isso quebrava na suíte completa, porque `ranks.test.js` cria postos
    // na mesma base compartilhada: o teste passava isolado e reprovava em conjunto, dizendo
    // "ranks duplicou" quando o que houve foi outra suíte inserindo. Contagem absoluta de
    // tabela que outra suíte escreve é acoplamento disfarçado de asserção.
    assert.ok(ranksAntes >= 19, `guarda: esperava >= 19 postos semeados, achei ${ranksAntes}`);
    assert.ok(basemapsAntes >= 5, `guarda: esperava >= 5 basemaps semeados, achei ${basemapsAntes}`);

    await runMigrations(process.env.DATABASE_URL);

    assert.equal(await contar('ranks'), ranksAntes, 'ranks duplicou: o tracking por nome falhou');
    assert.equal(await contar('basemaps'), basemapsAntes, 'basemaps duplicou');
    assert.deepEqual(await nomesNoBanco(), ARQUIVOS, 'e nenhuma linha nova em _migrations');
  });

  it('recusa histórico anterior à consolidação sem alterar tracking ou dados', async () => {
    const original = ARQUIVOS[0];
    const antigo = '001_' + 'identidade.sql';
    const antes = (await db.query('SELECT id, code, nome FROM ranks ORDER BY id')).rows;
    await db.query('UPDATE _migrations SET name = $1 WHERE name = $2', [antigo, original]);
    try {
      const historico = await nomesNoBanco();
      await assert.rejects(runMigrations(process.env.DATABASE_URL), /Histórico de migrações incompatível/);
      assert.deepEqual(await nomesNoBanco(), historico, 'não pode marcar a nova baseline como aplicada');
      assert.deepEqual((await db.query('SELECT id, code, nome FROM ranks ORDER BY id')).rows, antes);
    } finally {
      await db.query('UPDATE _migrations SET name = $1 WHERE name = $2', [original, antigo]);
    }
    // Refusal must release the advisory lock so a corrected history can run again.
    await runMigrations(process.env.DATABASE_URL);
    assert.deepEqual(await nomesNoBanco(), ARQUIVOS);
  });
});
