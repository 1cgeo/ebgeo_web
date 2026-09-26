// Path: tests/integration/catalogo-sem-exemplos.repro.test.js
//
// AS QUATRO CAMADAS DE EXEMPLO DO CATÁLOGO SAEM DA INSTALAÇÃO (decisão do dono de 2026-09-26).
//
// A base do catálogo semeava declividade, hipsometria, rodovias-federais e limites-municipais com
// endereço http://localhost/tiles/...: em produção elas apareciam no catálogo e nunca carregavam,
// e sob https viravam conteúdo misto. A migração incremental as desativa (`active = false`, a
// forma de apagar do próprio catálogo), e só onde a URL ainda é o exemplo.
//
// O banco de teste as RECEBE DE VOLTA depois das migrações (`src/database/catalogo-de-exemplo.js`,
// chamado por `scripts/run-tests.js`), porque os testes do catálogo as usam. Então este caso roda o
// SQL da migração de novo, numa transação desfeita no fim, sobre as linhas semeadas: é a mesma
// situação de uma instalação que tinha a base aplicada antes da migração existir.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { CATALOGO_DE_EXEMPLO } from '../../src/database/catalogo-de-exemplo.js';

const MIGRACAO = readFileSync(
  new URL('../../src/database/migrations/018_catalogo_sem_exemplos.sql', import.meta.url), 'utf8');

const ativas = async (db, tabela, ids) => (await db.query(
  `SELECT id FROM ${tabela} WHERE id = ANY($1) AND active ORDER BY id`, [ids])).rows.map((r) => r.id);

describe('a migração tira do catálogo as camadas de exemplo', () => {
  let db;

  before(async () => {
    ({ db } = await setupTestEnv());
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('REPRO: as quatro de URL de exemplo saem, e uma com URL real trocada pelo administrador fica', async () => {
    const analise = CATALOGO_DE_EXEMPLO.analysis_layers.map((l) => l.id);
    const dados = CATALOGO_DE_EXEMPLO.data_layers.map((l) => l.id);
    // O ponto de partida é o de uma instalação antiga: as quatro ativas, com a URL de exemplo.
    assert.deepEqual(await ativas(db, 'analysis_layers', analise), [...analise].sort());
    assert.deepEqual(await ativas(db, 'data_layers', dados), [...dados].sort());

    await db.query('BEGIN');
    try {
      // Uma instalação onde o administrador já pôs a URL real numa delas.
      await db.query(
        `UPDATE data_layers SET config = jsonb_set(config, '{source,url}', '"https://tiles.exemplo.mil.br/rodovias"')
          WHERE id = 'rodovias-federais'`);
      await db.query(MIGRACAO);

      assert.deepEqual(await ativas(db, 'analysis_layers', analise), [], 'uma camada de análise de exemplo ficou ativa');
      assert.deepEqual(await ativas(db, 'data_layers', dados), ['rodovias-federais'],
        'a migração tocou a camada com URL real, ou deixou a de exemplo');
      // O resto do catálogo semeado não é tocado.
      assert.deepEqual(await ativas(db, 'analysis_layers', ['hillshade']), ['hillshade']);
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
