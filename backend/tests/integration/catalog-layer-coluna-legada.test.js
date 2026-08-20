// Path: tests/integration/catalog-layer-coluna-legada.test.js
//
// F12 — a coluna legada `maps.catalog_layers` SAI, e este arquivo prende as duas metades da
// saída: que ela não existe mais, e que nada se perdeu no caminho.
//
// POR QUE ESTRUTURAL E NÃO FILTRO. A F11 tirou a desnormalização da camada de catálogo: a linha
// guarda referência e estado por atlas, e a definição (`name`, `config`, `config.source.url`) é
// reidratada na leitura pelo predicado de quem lê. Só que a reidratação mora dentro de
// `getAtlasSnapshot`, e a coluna legada tinha TRÊS saídas que não passam por lá — `GET /maps`,
// `GET /maps/:id` (as duas `SELECT *`, gateadas em `read`, nível que o visitante de link público
// tem) e `POST /maps/:id/duplicate`, que devolve a linha inteira. Filtrar as três protegeria as
// rotas que alguém lembrou; a coluna seguiria servida pela próxima consulta que alguém
// escrevesse sobre `maps`. Sem leitor, o dado não precisa de filtro: precisa não existir.
//
// O QUE SAIU DAQUI NA CONSOLIDAÇÃO (F15), e por quê. Este arquivo tinha um terceiro caso, que
// executava o INSERT DE MATERIALIZAÇÃO lido do arquivo da migração (recriava a coluna, plantava
// o array legado e conferia que a linha viva vencia e que o tombstone não ressuscitava). Aquele
// statement deixou de existir: no schema esmagado a coluna nunca é criada, então não há
// materialização a fazer nem migração de onde lê-la. Reescrevê-lo com uma CÓPIA do SQL aqui
// verificaria a cópia, que é a família de verde que não verifica, e foi exatamente o que aquele
// caso existia para evitar.
//
// O QUE FICA, e continua sendo o que importa: a coluna NÃO EXISTE, e as três rotas de mapa não
// servem definição de recurso NEM SE ELA VOLTAR — esse segundo caso é o guarda durável, porque
// quem reabre o buraco é um `SELECT *` sobre `maps`, e um `SELECT *` não fica vermelho enquanto
// a tabela não tiver nada a esconder.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('F12 — a coluna legada `maps.catalog_layers` sai, e nada se perde', () => {
  let app, db, dono, token;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    dono = await createUser(db, { username: `f12col_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, dono.username, dono.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('a coluna não existe no schema', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'maps' ORDER BY column_name`,
    );
    const colunas = rows.map((r) => r.column_name);
    // Positivo do par: a varredura enxerga MESMO as colunas de `maps` (sem isto, uma consulta
    // que devolvesse vazio por erro de nome passaria verde afirmando nada).
    assert.ok(colunas.includes('analysis_layers'), 'a varredura vê as colunas de `maps`');
    assert.ok(colunas.includes('grid_style'));
    assert.ok(!colunas.includes('catalog_layers'), '`maps.catalog_layers` não existe: a definição mora só na tabela dedicada');
  });

  it('as TRÊS rotas de mapa não servem definição de recurso, nem se a coluna voltar', async () => {
    // AS TRÊS, e a terceira é a que ninguém tinha listado: `POST /duplicate` devolve a linha do
    // mapa novo como corpo, e o censo de superfícies nem a enxerga (a varredura dele lê só
    // `router.get(`). Uma correção que filtrasse as respostas teria protegido as duas primeiras.
    const atlas = await createAtlas(db, dono.id, { name: `F12 rotas ${randomUUID().slice(0, 6)}` });
    const mapa = await createMap(db, atlas.id, { name: 'Mapa de rota' });
    const SEGREDO = '/segredo/{z}/{x}/{y}.pbf';
    await db.query(`INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)`, [
      'data-privada-f12', mapa.id, JSON.stringify({
        id: 'data-privada-f12',
        type: 'data_layer',
        visible: true,
        config: { source: { url: SEGREDO } },
      }),
    ]);

    const pedirAsTres = async () => {
      const lista = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/maps`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const um = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/maps/${mapa.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const copia = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/maps/${mapa.id}/duplicate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      return [
        ['GET /maps', lista.body.data.find((m) => m.id === mapa.id)],
        ['GET /maps/:id', um.body.data],
        ['POST /duplicate', copia.body.data],
      ];
    };

    const conferir = (respostas, quando) => {
      assert.equal(respostas.length, 3, `as três rotas responderam (${quando})`);
      for (const [nome, corpo] of respostas) {
        // Positivo do par: a resposta É o mapa (sem isto, uma rota que respondesse `{}` passaria).
        assert.ok(corpo, `${nome} responde (${quando})`);
        assert.ok(corpo.id, `${nome} devolve o mapa (${quando})`);
        assert.ok('grid_style' in corpo, `${nome} continua entregando o estado do mapa (${quando})`);
        // Negativo: nem a chave, nem a URL que ela carregava.
        assert.ok(!('catalog_layers' in corpo), `${nome} não carrega a coluna legada (${quando})`);
        assert.ok(
          !JSON.stringify(corpo).includes('/segredo/'),
          `${nome} não serve definição de recurso (${quando})`,
        );
      }
    };

    // 1. No schema como ele é hoje.
    conferir(await pedirAsTres(), 'coluna ausente');

    // 2. E COM A COLUNA DE VOLTA, carregada com a cópia. Este é o guarda DURÁVEL: a migração
    //    fecha o buraco de hoje, mas quem o reabre é um `SELECT *` sobre `maps` — e um `SELECT *`
    //    não fica vermelho enquanto a tabela não tiver nada a esconder. Aqui a tabela tem.
    await db.query(`ALTER TABLE maps ADD COLUMN catalog_layers JSONB NOT NULL DEFAULT '[]'`);
    try {
      await db.query(`UPDATE maps SET catalog_layers = $1::jsonb WHERE id = $2`, [
        JSON.stringify([{ id: 'data-privada-f12', type: 'data_layer', config: { source: { url: SEGREDO } } }]),
        mapa.id,
      ]);
      conferir(await pedirAsTres(), 'coluna reintroduzida');
    } finally {
      await db.query(`ALTER TABLE maps DROP COLUMN catalog_layers`);
    }
  });
});
