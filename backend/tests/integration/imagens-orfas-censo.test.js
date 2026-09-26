// Path: tests/integration/imagens-orfas-censo.test.js
//
// O CENSO DAS FONTES DE REFERÊNCIA DE IMAGEM: toda tabela do banco está classificada, e toda
// tabela-fonte tem o gatilho que zera a marca.
//
// POR QUE ELE EXISTE. A coleta de imagem órfã (`src/modules/images/imagens-orfas.service.js`)
// apaga bytes, e o único jeito de ela apagar uma foto viva é existir um lugar que cita imagem e
// que ela não varre. Nas colunas de uma tabela-fonte isso não acontece (elas são lidas do esquema
// migrado na hora da rodada); numa TABELA nova, acontece, e é esse o buraco que este arquivo fecha:
// o inventário vem de `information_schema` do banco MIGRADO, nunca de uma lista escrita à mão, e
// toda tabela com coluna capaz de guardar um UUID em texto precisa estar em
// `FONTES_DE_REFERENCIA` ou em `TABELAS_QUE_NAO_CITAM`, com o motivo.
//
// A SEGUNDA METADE É O GATILHO. `zerar_marca_de_imagem_citada` é o que faz a carência ser de dias
// CONTÍNUOS; uma fonte sem ele varreria a citação na rodada e deixaria passar a que aparece e some
// entre duas rodadas. O censo exige o gatilho em toda fonte e em nenhuma outra tabela, e que o
// padrão de UUID dele seja o mesmo do coletor.
//
// A TERCEIRA METADE SÃO OS COLETORES QUE JÁ EXISTIAM. O pedido foi partir deles: `importImageIds`
// (o import do servidor) e `idsDeFotosPorReferencia` (o export do cliente, pelo módulo de zero
// imports de `frontend/src/js/user_data/photo-refs.js`). Para cada forma que eles reconhecem, a
// linha equivalente é gravada no banco e o coletor da coleta precisa enxergá-la. Um coletor que
// soubesse MENOS que o import apagaria o que o import considera referência.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap } from '../helpers/fixtures.js';
import { db as banco } from '../../src/database/index.js';
import {
  FONTES_DE_REFERENCIA, TABELAS_QUE_NAO_CITAM, ESQUEMAS_DO_CENSO, TIPOS_QUE_CITAM, PADRAO_DE_UUID,
} from '../../src/modules/images/imagens-orfas.fontes.js';
import { coletarImagensCitadas } from '../../src/modules/images/imagens-orfas.service.js';
import { importImageIds } from '../../src/modules/atlas/import-image-refs.js';
import { idsDeFotosPorReferencia } from '../../../frontend/src/js/user_data/photo-refs.js';
import { idsDeFigurasDoDocumento } from '../../../frontend/src/js/briefing/figura-de-slide.js';

const GATILHO = 'trg_zerar_marca_de_imagem_citada';

describe('censo das fontes de referência de imagem', () => {
  let db;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  async function tabelasComTexto() {
    const { rows } = await db.query(
      `SELECT (c.table_schema || '.' || c.table_name)::text AS tabela, array_agg(c.column_name::text ORDER BY c.column_name::text) AS colunas
         FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = ANY($1) AND c.data_type = ANY($2)
        GROUP BY 1 ORDER BY 1`,
      [ESQUEMAS_DO_CENSO, TIPOS_QUE_CITAM]
    );
    return rows;
  }

  it('toda tabela com coluna de texto está classificada (fonte ou fora, com motivo)', async () => {
    const tabelas = await tabelasComTexto();
    // ABSOLUTE, so an empty inventory cannot pass: the schema has dozens of such tables.
    assert.ok(tabelas.length >= 40, `inventário suspeito: ${tabelas.length} tabela(s)`);
    const fontes = new Set(FONTES_DE_REFERENCIA.map((f) => `public.${f.tabela}`));
    const semClasse = tabelas.map((t) => t.tabela).filter((t) => !fontes.has(t) && !Object.hasOwn(TABELAS_QUE_NAO_CITAM, t));
    assert.deepEqual(semClasse, [],
      'tabela nova sem classificação: ou ela cita imagem (entra em FONTES_DE_REFERENCIA e ganha o gatilho '
      + 'na migração), ou não cita (entra em TABELAS_QUE_NAO_CITAM, com o motivo)');
  });

  it('nenhuma entrada do censo aponta para tabela ou coluna que não existe', async () => {
    const existentes = new Map((await tabelasComTexto()).map((t) => [t.tabela, new Set(t.colunas)]));
    const mortas = [
      ...FONTES_DE_REFERENCIA.map((f) => `public.${f.tabela}`),
      ...Object.keys(TABELAS_QUE_NAO_CITAM),
    ].filter((t) => !existentes.has(t));
    assert.deepEqual(mortas, [], 'classificação que sobrevive à tabela é convenção apodrecendo');
    const ignoradas = FONTES_DE_REFERENCIA.flatMap((f) => Object.keys(f.colunasIgnoradas || {}).map((c) => [f.tabela, c]));
    // ABSOLUTE: `features.geometry` is ignored today, so the check below has at least one subject.
    assert.ok(ignoradas.length >= 1);
    const ignoradasInexistentes = ignoradas.filter(([t, c]) => !existentes.get(`public.${t}`)?.has(c));
    assert.deepEqual(ignoradasInexistentes, [], 'coluna ignorada que não existe (ou não é de texto)');
    const repetidas = FONTES_DE_REFERENCIA.map((f) => `public.${f.tabela}`).filter((t) => Object.hasOwn(TABELAS_QUE_NAO_CITAM, t));
    assert.deepEqual(repetidas, [], 'uma tabela não pode ser fonte e não-fonte');
  });

  it('toda fonte tem o gatilho que zera a marca, e nenhuma outra tabela o tem', async () => {
    const { rows } = await db.query(
      `SELECT c.relname AS tabela FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE t.tgname = $1 AND NOT t.tgisinternal ORDER BY 1`,
      [GATILHO]
    );
    assert.deepEqual(rows.map((r) => r.tabela), FONTES_DE_REFERENCIA.map((f) => f.tabela).sort());
  });

  it('o gatilho casa o MESMO padrão de UUID que o coletor', async () => {
    const { rows } = await db.query("SELECT pg_get_functiondef('zerar_marca_de_imagem_citada'::regproc) AS def");
    assert.ok(rows[0].def.includes(`'${PADRAO_DE_UUID}'`),
      'o padrão do gatilho divergiu de PADRAO_DE_UUID: um gatilho que casasse menos deixaria de zerar marcas');
  });

  // --------------------------------------------------------- os coletores que já existiam
  describe('o coletor enxerga tudo que os coletores existentes chamam de referência', () => {
    let atlas, mapa;

    before(async () => {
      const dono = await createUser(db, { username: `orfas_censo_${randomUUID().slice(0, 6)}` });
      atlas = await createAtlas(db, dono.id);
      mapa = await createMap(db, atlas.id);
    });

    async function imagem(id = randomUUID()) {
      await db.query(
        `INSERT INTO images (id, atlas_id, filename, mime_type, size_bytes, storage_path)
         VALUES ($1, $2, 'c.png', 'image/png', 1, $3)`,
        [id, atlas.id, `censo/${id}.png`]
      );
      return id;
    }

    async function citadas() {
      return banco.tx(async (t) => new Set((await coletarImagensCitadas(t)).ids));
    }

    it('`importImageIds` (o import do servidor)', async () => {
      const [feicaoDeImagem, iconeDePonto, foto3d, foto360, iconeDoAtlas] = await Promise.all(
        Array.from({ length: 5 }, () => imagem())
      );
      // The payload in the shape importImageIds reads, and the SAME facts written as rows.
      const payload = {
        maps: [{
          features: [
            { id: feicaoDeImagem, feature_type: 'image', properties: {} },
            { id: randomUUID(), feature_type: 'point', properties: { markerSymbol: `custom:${iconeDePonto}` } },
          ],
          cesium3dData: { markers: [{ images: [{ id: foto3d }] }] },
          streetview360Data: { markers: [{ images: [foto360] }] },
        }],
        atlas: { settings: { customIcons: [{ id: iconeDoAtlas }] } },
      };
      const esperadas = importImageIds(payload);
      // ABSOLUTE: the five forms, so an importImageIds that learned less cannot make this vacuous.
      assert.equal(esperadas.size, 5);

      await db.query(
        `INSERT INTO features (id, map_id, feature_type, geometry, properties) VALUES
           ($1, $3, 'image', '{}'::jsonb, '{}'::jsonb),
           (gen_random_uuid(), $3, 'point', '{}'::jsonb, $2::jsonb)`,
        [feicaoDeImagem, JSON.stringify({ markerSymbol: `custom:${iconeDePonto}` }), mapa.id]
      );
      await db.query(`INSERT INTO cesium3d_data (map_id, data_type, data) VALUES ($1, 'marker', $2::jsonb)`,
        [mapa.id, JSON.stringify({ images: [{ id: foto3d }] })]);
      await db.query(`INSERT INTO streetview360_data (map_id, data_type, data) VALUES ($1, 'marker', $2::jsonb)`,
        [mapa.id, JSON.stringify({ images: [foto360] })]);
      await db.query(`UPDATE atlas SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{customIcons}', $2::jsonb) WHERE id = $1`,
        [atlas.id, JSON.stringify([{ id: iconeDoAtlas }])]);

      const vistas = await citadas();
      assert.deepEqual([...esperadas].filter((id) => !vistas.has(id)), []);
    });

    it('`idsDeFotosPorReferencia` (o export do cliente, fotos de feição e de item 3D/360)', async () => {
      const [daFeicao, do3d, do360Legado] = await Promise.all(Array.from({ length: 3 }, () => imagem()));
      const documento = {
        maps: { M: { features: { points: [{ properties: { images: [{ id: daFeicao, thumbnail: 'data:x' }] } }] } } },
        cesium3d: { M: { measurements: [{ images: [{ id: do3d }] }] } },
        streetview360: { M: { markers: [{ images: [do360Legado] }] } },
      };
      const esperadas = idsDeFotosPorReferencia(documento);
      assert.equal(esperadas.length, 3);

      await db.query(`INSERT INTO features (map_id, feature_type, geometry, properties) VALUES ($1, 'point', '{}'::jsonb, $2::jsonb)`,
        [mapa.id, JSON.stringify({ images: [{ id: daFeicao, thumbnail: 'data:x' }] })]);
      await db.query(`INSERT INTO cesium3d_data (map_id, data_type, data) VALUES ($1, 'measurement', $2::jsonb)`,
        [mapa.id, JSON.stringify({ images: [{ id: do3d }] })]);
      await db.query(`INSERT INTO streetview360_data (map_id, data_type, data) VALUES ($1, 'marker', $2::jsonb)`,
        [mapa.id, JSON.stringify({ images: [do360Legado] })]);

      const vistas = await citadas();
      assert.deepEqual(esperadas.filter((id) => !vistas.has(id)), []);
    });

    it('a figura de slide por referência (o import do servidor e o export do cliente)', async () => {
      const [doSlide, dasNotas] = await Promise.all(Array.from({ length: 2 }, () => imagem()));
      const html = (id) => `<p>x</p><img src="https://figura.ebgeo/${id}">`;
      const doCliente = idsDeFigurasDoDocumento({
        briefings: [{ slides: [{ content: html(doSlide) }] }],
        mapNotes: { M: { title: 'Notas', description: html(dasNotas) } },
      });
      const doServidor = importImageIds({
        maps: [{ features: [], notes_description: html(dasNotas) }],
        briefings: [{ slides: [{ content: html(doSlide) }] }],
      });
      // ABSOLUTE: both forms, on both sides, so a collector that learned less cannot make this vacuous.
      assert.deepEqual([...doCliente].sort(), [doSlide, dasNotas].sort());
      assert.deepEqual([...doServidor].sort(), [doSlide, dasNotas].sort());

      const { rows: [briefing] } = await db.query(
        `INSERT INTO briefings (atlas_id, name) VALUES ($1, 'Censo') RETURNING id`, [atlas.id]);
      await db.query(`INSERT INTO slides (briefing_id, title, content, mode) VALUES ($1, 'S', $2, '2d')`,
        [briefing.id, html(doSlide)]);
      await db.query('UPDATE maps SET notes_description = $2 WHERE id = $1', [mapa.id, html(dasNotas)]);

      const vistas = await citadas();
      assert.deepEqual(doCliente.filter((id) => !vistas.has(id)), []);
    });
  });
});
