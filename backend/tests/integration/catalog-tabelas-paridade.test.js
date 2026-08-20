// Path: tests/integration/catalog-tabelas-paridade.test.js
// Item 106 — paridade de shape das 4 tabelas de catálogo.
//
// `data_layers` / `analysis_layers` / `tilesets` são clones estruturais de
// `basemaps`, que até a consolidação nasciam de um `LIKE ... INCLUDING ALL` e hoje são quatro `CREATE TABLE` escritos por extenso (005_catalogo.sql), e
// `catalog.service.js` roda a MESMA string `COLS` e os mesmos INSERT/UPDATE contra
// as quatro. Só o router de `basemaps` recebe request HTTP nos testes, então uma
// migração aditiva que acrescente coluna a `basemaps` e esqueça as outras três
// falha apenas em produção — e falha no endpoint de contrato congelado
// GET /api/config.
//
// Eram CINCO enquanto existiu `streetview_markers`. Aquela tabela
// nasceu do mesmo `LIKE` e nunca teve consumidor nenhum: não alimentava o
// /api/config, nenhum código de frontend chamava a rota dela e nenhum seed a
// populava. A paridade que este arquivo cobra passa a ser entre quatro.
//
// Este é o primeiro teste de INTROSPECÇÃO do backend (não havia nenhum hit de
// information_schema / pg_constraint em tests/).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  CATALOG_TABLES, PRODUCTION_TYPE_BY_TABLE, assertTable,
} from '../../src/modules/catalog/catalog.tables.js';
import { TYPE_BY_TABLE } from '../../src/modules/resource-access/resource-access.types.js';

// A mesma lista de colunas que catalog.service.js interpola em todo SELECT.
const COLS = 'id, name, description, config, active, sort_order, created_at, updated_at';
const REFERENCIA = 'basemaps';

describe('Paridade de shape das 4 tabelas de catálogo (item 106)', () => {
  let db;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const colunasDe = async (tabela) => {
    const { rows } = await db.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY column_name`,
      [tabela]
    );
    return rows;
  };

  it('guarda: são 4 tabelas e a referência tem colunas suficientes', async () => {
    assert.equal(CATALOG_TABLES.length, 4, 'a whitelist precisa ter as quatro tabelas');
    const ref = await colunasDe(REFERENCIA);
    assert.ok(ref.length >= 8, `esperava >= 8 colunas em ${REFERENCIA}, achei ${ref.length}`);
  });

  it('as 4 tabelas têm conjuntos IDÊNTICOS de (nome, tipo, nullable, default)', async () => {
    const ref = await colunasDe(REFERENCIA);
    assert.ok(ref.length >= 8);

    // `column_default` de uma tabela criada por LIKE é textualmente igual à da
    // referência para estes tipos (literais e NOW()), então a comparação é direta.
    const divergentes = [];
    const outras = CATALOG_TABLES.filter((t) => t !== REFERENCIA);
    assert.equal(outras.length, 3, 'guarda: três clones a comparar');

    const shapes = await Promise.all(outras.map(async (t) => ({ tabela: t, cols: await colunasDe(t) })));
    assert.equal(shapes.length, 3);

    for (const { tabela, cols } of shapes) {
      try {
        assert.deepEqual(cols, ref);
      } catch {
        divergentes.push({ tabela, ref, cols });
      }
    }
    assert.deepEqual(
      divergentes.map((d) => d.tabela),
      [],
      `shape divergente: ${JSON.stringify(divergentes.map((d) => ({ t: d.tabela, cols: d.cols })))}`
    );
  });

  it('cada uma das 4 tem PRIMARY KEY na coluna id', async () => {
    const { rows } = await db.query(
      `SELECT c.conrelid::regclass::text AS tabela,
              (SELECT string_agg(a.attname, ',' ORDER BY a.attname)
                 FROM unnest(c.conkey) k
                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k) AS colunas
         FROM pg_constraint c
        WHERE c.contype = 'p' AND c.conrelid::regclass::text = ANY($1::text[])`,
      [[...CATALOG_TABLES]]
    );
    assert.equal(rows.length, 4, `esperava 4 PKs, achei ${rows.length}: ${JSON.stringify(rows)}`);
    const erradas = rows.filter((r) => r.colunas !== 'id').map((r) => `${r.tabela}(${r.colunas})`);
    assert.deepEqual(erradas, [], 'toda tabela de catálogo tem PK simples em id');
  });

  it('todo nome de COLS existe nas 4 tabelas (amarra a string hardcoded ao schema real)', async () => {
    const nomes = COLS.split(',').map((c) => c.trim());
    assert.equal(nomes.length, 8, `guarda: COLS precisa listar 8 colunas, listou ${nomes.length}`);

    const { rows } = await db.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [[...CATALOG_TABLES]]
    );
    assert.ok(rows.length >= 32, `esperava >= 32 linhas (4 tabelas × 8 colunas), achei ${rows.length}`);

    const porTabela = new Map(CATALOG_TABLES.map((t) => [t, new Set()]));
    rows.forEach((r) => porTabela.get(r.table_name)?.add(r.column_name));

    const faltando = CATALOG_TABLES.flatMap((t) =>
      nomes.filter((c) => !porTabela.get(t).has(c)).map((c) => `${t}.${c}`)
    );
    assert.deepEqual(faltando, [], 'COLS referencia coluna inexistente em alguma tabela');
  });

  it('controle negativo: uma coluna a mais em basemaps faz a comparação falhar', async () => {
    // Dentro de transação revertida: o assert precisa DISCRIMINAR, e o banco é
    // compartilhado entre arquivos de teste.
    await db.query('BEGIN');
    try {
      await db.query('ALTER TABLE basemaps ADD COLUMN _probe INT');
      const ref = await colunasDe(REFERENCIA);
      const clone = await colunasDe('data_layers');
      assert.notDeepEqual(clone, ref, 'a comparação de shape precisa VER a coluna nova');
      assert.ok(ref.some((c) => c.column_name === '_probe'));
      assert.ok(!clone.some((c) => c.column_name === '_probe'));
    } finally {
      await db.query('ROLLBACK');
    }

    const ref = await colunasDe(REFERENCIA);
    const clone = await colunasDe('data_layers');
    assert.deepEqual(clone, ref, 'após o rollback a paridade volta');
  });

  // A COINCIDÊNCIA DOS DOIS VOCABULÁRIOS É CONTRATO, e ela é o que permite a
  // `listVisiblePrivate` passar `$3` aos DOIS predicados (`fn_can_produce_resource` e
  // `fn_granted_resource_ids`) com um parâmetro só. São dois mapas, em arquivos
  // diferentes e por eixos diferentes (produção e concessão): nada além deste caso os
  // obriga a concordar, e o comentário daquela query aponta para cá.
  it('produção e concessão nomeiam cada tabela de catálogo com a MESMA palavra', () => {
    assert.equal(CATALOG_TABLES.length, 4);
    const producao = CATALOG_TABLES.map((t) => PRODUCTION_TYPE_BY_TABLE[t]);
    const concessao = CATALOG_TABLES.map((t) => TYPE_BY_TABLE[t]);
    assert.deepEqual(producao, ['basemap', 'data_layer', 'analysis_layer', 'tileset']);
    assert.deepEqual(concessao, producao, 'os dois eixos divergiram: `$3` precisa se partir em dois');
  });

  it('assertTable rejeita nome fora da whitelist (o nome vai interpolado no SQL)', () => {
    assert.throws(() => assertTable('users'), /Unknown catalog table/);
    assert.throws(() => assertTable('basemaps; DROP TABLE users'), /Unknown catalog table/);
    assert.equal(assertTable('basemaps'), 'basemaps');
  });
});
