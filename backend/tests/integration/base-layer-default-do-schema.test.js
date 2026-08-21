// Path: tests/integration/base-layer-default-do-schema.test.js
// O PADRÃO DE `maps.base_layer` é perguntado ao BANCO, e não lido do texto de uma migração.
//
// POR QUE ESTE ARQUIVO EXISTE. A poda de saída faz o basemap restrito VOLTAR AO PADRÃO em
// vez de sumir (a coluna é `NOT NULL` e um mapa sem camada de base não desenha), e o valor
// desse padrão está escrito em DUAS constantes de código — `DEFAULT_BASE_LAYER` nos dois
// registros de referência. A afirmação "e é o DEFAULT da coluna" morava num teste de
// vitest que lia o TEXTO de `003_atlas.sql` com `toContain`, e ela era verdadeira por
// acidente de história: um `ALTER TABLE maps ALTER COLUMN base_layer SET DEFAULT ...` num
// degrau posterior deixaria `003_atlas.sql` intacto e aquele verde mentindo sobre o
// schema vivo. É a forma canônica da verificação-fantasma desta casa: uma checagem que não checa
// o sujeito, e sim uma das fontes históricas dele.
//
// O SUJEITO CERTO é `information_schema.columns.column_default`, que responde pelo schema
// EFETIVO depois de toda migração aplicada.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { DEFAULT_BASE_LAYER } from '../../src/modules/atlas/resource-reference.registry.js';

describe('o padrão de maps.base_layer, perguntado ao schema vivo', () => {
  let db;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('a coluna é NOT NULL e seu DEFAULT é o que o registro de referências declara', async () => {
    const { rows } = await db.query(
      `SELECT column_default, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'maps' AND column_name = 'base_layer'`
    );

    // PISO: sem ele, uma coluna renomeada devolveria zero linhas e as asserções abaixo
    // nunca rodariam — o laço vazio que passa verde.
    assert.equal(rows.length, 1, 'a coluna maps.base_layer precisa existir');

    // `column_default` vem como a expressão SQL, com o cast: "'carta-topografica'::character varying".
    assert.ok(
      rows[0].column_default.startsWith(`'${DEFAULT_BASE_LAYER}'`),
      `esperava o DEFAULT '${DEFAULT_BASE_LAYER}', o schema diz ${rows[0].column_default}`
    );
    assert.equal(rows[0].is_nullable, 'NO', 'a coluna é NOT NULL: é por isso que a poda VOLTA AO PADRÃO em vez de remover');

    // DISCRIMINAÇÃO: a consulta sabe distinguir. Uma coluna vizinha da mesma tabela NÃO
    // carrega esse default — sem esta linha, um `column_default` que respondesse a mesma
    // string para tudo passaria acima.
    const { rows: vizinha } = await db.query(
      `SELECT column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'maps' AND column_name = 'name'`
    );
    assert.equal(vizinha.length, 1);
    assert.ok(
      !String(vizinha[0].column_default ?? '').includes(DEFAULT_BASE_LAYER),
      'o default do basemap não pode aparecer numa coluna que não é a camada de base'
    );
  });
});
