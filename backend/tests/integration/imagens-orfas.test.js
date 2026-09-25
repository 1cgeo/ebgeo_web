// Path: tests/integration/imagens-orfas.test.js
//
// A COLETA DE IMAGEM ÓRFÃ, contra o banco de verdade e o disco de verdade.
//
// A REGRA DE OURO É "NA DÚVIDA, NÃO APAGA", e cada bloco daqui prende uma metade dela:
//
//   - FONTES: toda imagem CITADA sobrevive a uma rodada de `apagar`, qualquer que seja o lugar da
//     citação. Cada caso traz o seu CONTROLE NEGATIVO embutido: a mesma imagem, na simulação com a
//     fonte daquele caso RETIRADA do coletor, aparece como elegível. Sem isso, "sobreviveu" poderia
//     ser só a carência trabalhando, e o teste da fonte provaria nada sobre a fonte.
//   - CARÊNCIA: 29 dias não apaga, 31 apaga, imagem jovem não apaga, e uma referência que volta zera
//     a marca (pelo gatilho `zerar_marca_de_imagem_citada`, e não só pela rodada).
//   - SIMULAÇÃO: lista o que apagaria, com contagem e bytes, e não escreve NADA (nem a marca).
//   - TRILHA: apagar deixa linha `IMAGE_ORPHAN_PURGE` com ator, atlas e os ids.
//
// COMO SE FABRICA O TEMPO. As regras leem `NOW()` do Postgres contra `created_at` e contra a marca
// `images.sem_referencia_desde`, então os casos escrevem os DOIS carimbos no passado por SQL. A
// ORDEM é parte do método: a citação nasce ANTES de a marca ser escrita, porque escrever uma citação
// depois de a marca existir dispara o gatilho, que a zera, e o caso provaria o gatilho em vez da
// fonte. O gatilho tem casos próprios, no bloco da carência.
//
// ESCOPO. Cada caso usa um atlas PRÓPRIO e chama a coleta com `atlasId`, porque o banco de teste é
// compartilhado pela rodada inteira e uma coleta global apagaria o que outro arquivo semeou. A
// checagem de citação continua GLOBAL mesmo com o recorte (é o que o caso entre atlas prova).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import config from '../../src/config.js';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, createAtlas, createMap, createBriefing, createSlide, createOperation } from '../helpers/fixtures.js';
import {
  simularColetaDeOrfas, marcarOrfas, apagarOrfas, ACAO_DE_REMOCAO, MotivoDeCarencia,
} from '../../src/modules/images/imagens-orfas.service.js';
import { FONTES_DE_REFERENCIA } from '../../src/modules/images/imagens-orfas.fontes.js';
import { db as banco } from '../../src/database/index.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
);

describe('coleta de imagem órfã', () => {
  let db, admin;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
    admin = await createAdminUser(db, { username: `orfas_adm_${randomUUID().slice(0, 6)}` });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** A fresh atlas with one map. */
  async function atlasComMapa() {
    const atlas = await createAtlas(db, admin.id, { name: `Órfãs ${randomUUID().slice(0, 6)}` });
    const mapa = await createMap(db, atlas.id);
    return { atlas, mapa };
  }

  /**
   * An image row WITH its file on disk, created `idade` days ago. No mark: the cases write it
   * afterwards (see the header for why the order matters).
   */
  async function imagem(atlasId, { idade = 40 } = {}) {
    const id = randomUUID();
    const dir = join(config.images.dir, atlasId);
    mkdirSync(dir, { recursive: true });
    const caminho = join(dir, `${id}.png`);
    writeFileSync(caminho, PNG);
    await db.query(
      `INSERT INTO images (id, atlas_id, filename, mime_type, size_bytes, storage_path, created_at)
       VALUES ($1, $2, $3, 'image/png', $4, $5, NOW() - make_interval(days => $6))`,
      [id, atlasId, `foto-${id.slice(0, 6)}.png`, PNG.length, caminho, idade]
    );
    return { id, caminho };
  }

  /** Writes the mark `dias` days in the past (or NULL). The trigger is not on `images`. */
  async function marcar(id, dias) {
    await db.query(
      `UPDATE images SET sem_referencia_desde = CASE WHEN $2::int IS NULL THEN NULL
         ELSE NOW() - make_interval(days => $2::int) END WHERE id = $1`,
      [id, dias]
    );
  }

  async function linha(id) {
    const { rows } = await db.query('SELECT id, sem_referencia_desde FROM images WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  async function feicao(mapaId, { id = randomUUID(), tipo = 'point', properties = {}, apagadaHa = null } = {}) {
    await db.query(
      `INSERT INTO features (id, map_id, feature_type, geometry, properties, deleted_at)
       VALUES ($1, $2, $3, '{"type":"Point","coordinates":[-43.2,-22.9]}'::jsonb, $4::jsonb,
               CASE WHEN $5::int IS NULL THEN NULL ELSE NOW() - make_interval(days => $5::int) END)`,
      [id, mapaId, tipo, JSON.stringify(properties), apagadaHa]
    );
    return id;
  }

  const idsElegiveis = (relatorio) => relatorio.elegiveis.porAtlas.flatMap((g) => g.imagens.map((i) => i.id));
  const semFonte = (tabela) => FONTES_DE_REFERENCIA.filter((f) => f.tabela !== tabela);

  // ------------------------------------------------------------------ FONTES
  /**
   * One case per place an image can be cited. `citar` writes the citation of image `id` into the
   * atlas `ctx` and returns nothing; `fonte` is the table the citation lives in, which the negative
   * control removes from the collector.
   */
  const CASOS_DE_FONTE = [
    {
      nome: 'feição de imagem (o id da feição É o do blob)',
      fonte: 'features',
      citar: (ctx, id) => feicao(ctx.mapa.id, { id, tipo: 'image', properties: { id, nome: 'Figura' } }),
    },
    {
      nome: 'foto POR REFERÊNCIA de uma feição (`properties.images[].id`)',
      fonte: 'features',
      citar: (ctx, id) => feicao(ctx.mapa.id, { properties: { nome: 'Posto', images: [{ id, name: 'foto.jpg', thumbnail: 'data:image/jpeg;base64,AAAA' }] } }),
    },
    {
      nome: 'foto INLINE de uma feição: o id conta mesmo com os bytes dentro',
      fonte: 'features',
      citar: (ctx, id) => feicao(ctx.mapa.id, { properties: { images: [{ id, name: 'f.png', data: `data:image/png;base64,${PNG.toString('base64')}` }] } }),
    },
    {
      nome: 'ícone personalizado de ponto (`markerSymbol = custom:<id>`)',
      fonte: 'features',
      citar: (ctx, id) => feicao(ctx.mapa.id, { properties: { markerSymbol: `custom:${id}` } }),
    },
    {
      nome: 'foto de marcador 3D, em qualquer profundidade',
      fonte: 'cesium3d_data',
      citar: (ctx, id) => db.query(
        `INSERT INTO cesium3d_data (map_id, data_type, tileset_id, data) VALUES ($1, 'marker', 'PCL', $2::jsonb)`,
        [ctx.mapa.id, JSON.stringify({ properties: { nome: 'M', medidas: [{ images: [{ id }] }] } })]
      ),
    },
    {
      nome: 'foto de marcador 3D na forma legada (id solto no array)',
      fonte: 'cesium3d_data',
      citar: (ctx, id) => db.query(
        `INSERT INTO cesium3d_data (map_id, data_type, tileset_id, data) VALUES ($1, 'marker', 'PCL', $2::jsonb)`,
        [ctx.mapa.id, JSON.stringify({ images: [id] })]
      ),
    },
    {
      nome: 'foto de marcador 360',
      fonte: 'streetview360_data',
      citar: (ctx, id) => db.query(
        `INSERT INTO streetview360_data (map_id, data_type, photo_name, data) VALUES ($1, 'marker', 'foto-001', $2::jsonb)`,
        [ctx.mapa.id, JSON.stringify({ images: [{ id, name: 'x.jpg' }] })]
      ),
    },
    {
      nome: 'ícone personalizado nas configurações do atlas',
      fonte: 'atlas',
      citar: (ctx, id) => db.query(
        `UPDATE atlas SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{customIcons}', $2::jsonb) WHERE id = $1`,
        [ctx.atlas.id, JSON.stringify([{ id, name: 'Ícone', mimeType: 'image/png' }])]
      ),
    },
    {
      nome: 'figura no HTML de um slide',
      fonte: 'slides',
      citar: async (ctx, id) => {
        const briefing = await createBriefing(db, ctx.atlas.id);
        await createSlide(db, briefing.id, { content: `<p>Veja</p><img src="/api/v1/atlas/${ctx.atlas.id}/images/${id}">` });
      },
    },
    {
      nome: 'figura nas configurações de um briefing',
      fonte: 'briefings',
      citar: (ctx, id) => createBriefing(db, ctx.atlas.id, { settings: { panelPosition: 'left', fundo: { imagem: id } } }),
    },
    {
      nome: 'figura no HTML das notas do mapa',
      fonte: 'maps',
      citar: (ctx, id) => db.query(
        'UPDATE maps SET notes_description = $2 WHERE id = $1',
        [ctx.mapa.id, `<p>Ordem</p><img src="/api/v1/atlas/${ctx.atlas.id}/images/${id.toUpperCase()}">`]
      ),
    },
    {
      nome: 'anexo de comentário espacial',
      fonte: 'comments',
      citar: (ctx, id) => db.query(
        `INSERT INTO comments (atlas_id, map_id, lng, lat, data) VALUES ($1, $2, -43.2, -22.9, $3::jsonb)`,
        [ctx.atlas.id, ctx.mapa.id, JSON.stringify({ text: 'olhe', anexos: [{ id }] })]
      ),
    },
    {
      nome: 'ícone no estilo de uma camada',
      fonte: 'layers',
      citar: (ctx, id) => db.query(
        `INSERT INTO layers (map_id, name, style) VALUES ($1, 'Camada', $2::jsonb)`,
        [ctx.mapa.id, JSON.stringify({ icone: id })]
      ),
    },
    {
      nome: 'ícone no estilo de um grupo',
      fonte: 'groups',
      citar: (ctx, id) => db.query(
        `INSERT INTO groups (map_id, name, style) VALUES ($1, 'Grupo', $2::jsonb)`,
        [ctx.mapa.id, JSON.stringify({ icone: id })]
      ),
    },
    {
      nome: 'documento de camada de catálogo do mapa',
      fonte: 'catalog_layers',
      citar: (ctx, id) => db.query(
        `INSERT INTO catalog_layers (id, map_id, data) VALUES ('base-x', $1, $2::jsonb)`,
        [ctx.mapa.id, JSON.stringify({ legenda: id })]
      ),
    },
    {
      nome: 'operação aplicada dentro da janela (o cinto sob o gatilho)',
      fonte: 'operations',
      citar: (ctx, id) => createOperation(db, ctx.atlas.id, {
        op_type: 'update', entity_type: 'feature', map_id: ctx.mapa.id,
        data: { properties: { images: [{ id }] } },
      }),
    },
  ];

  describe('toda imagem citada sobrevive a `apagar`, e a fonte é o que a protege', () => {
    for (const caso of CASOS_DE_FONTE) {
      it(`${caso.fonte}: ${caso.nome}`, async () => {
        const ctx = await atlasComMapa();
        const citada = await imagem(ctx.atlas.id);
        const controle = await imagem(ctx.atlas.id);
        await caso.citar(ctx, citada.id);
        await marcar(citada.id, 31);
        await marcar(controle.id, 31);

        // CONTROLE NEGATIVO EMBUTIDO: sem ESTA fonte, a citada seria apagada.
        const semAFonte = await simularColetaDeOrfas({ atlasId: ctx.atlas.id, fontes: semFonte(caso.fonte) });
        assert.ok(idsElegiveis(semAFonte).includes(citada.id),
          `sem a fonte ${caso.fonte}, a imagem citada deveria sair como elegível (senão o caso não mede a fonte)`);

        const r = await apagarOrfas({ atorId: admin.id, atlasId: ctx.atlas.id });
        // ABSOLUTO: a rodada APAGOU alguma coisa (o controle), então ela estava armada.
        assert.deepEqual(r.apagadas.porAtlas.flatMap((g) => g.imagens.map((i) => i.id)), [controle.id]);
        assert.ok(await linha(citada.id), 'a imagem citada continua na tabela');
        assert.ok(existsSync(citada.caminho), 'e no disco');
        assert.equal(await linha(controle.id), null);
        assert.equal(existsSync(controle.caminho), false, 'o controle saiu do disco');
      });
    }

    it('a citação vale ENTRE atlas: a feição de outro atlas protege a imagem deste', async () => {
      const a = await atlasComMapa();
      const b = await atlasComMapa();
      const img = await imagem(a.atlas.id);
      await feicao(b.mapa.id, { properties: { images: [{ id: img.id }] } });
      await marcar(img.id, 31);
      const r = await apagarOrfas({ atorId: admin.id, atlasId: a.atlas.id });
      assert.equal(r.apagadas.quantidade, 0);
      assert.ok(await linha(img.id));
    });

    it('linha EXCLUÍDA há 10 dias ainda cita; excluída há 40 já não cita', async () => {
      const ctx = await atlasComMapa();
      const recente = await imagem(ctx.atlas.id);
      const antiga = await imagem(ctx.atlas.id);
      await feicao(ctx.mapa.id, { id: recente.id, tipo: 'image', apagadaHa: 10 });
      await feicao(ctx.mapa.id, { id: antiga.id, tipo: 'image', apagadaHa: 40 });
      await marcar(recente.id, 31);
      await marcar(antiga.id, 31);
      const r = await apagarOrfas({ atorId: admin.id, atlasId: ctx.atlas.id });
      assert.deepEqual(r.apagadas.porAtlas.flatMap((g) => g.imagens.map((i) => i.id)), [antiga.id]);
      assert.ok(await linha(recente.id));
    });

    it('operação de FORA da janela não cita', async () => {
      const ctx = await atlasComMapa();
      const img = await imagem(ctx.atlas.id);
      const op = await createOperation(db, ctx.atlas.id, { data: { properties: { images: [{ id: img.id }] } } });
      await db.query("UPDATE operations SET created_at = NOW() - INTERVAL '40 days' WHERE id = $1", [op.id]);
      await marcar(img.id, 31);
      const r = await apagarOrfas({ atorId: admin.id, atlasId: ctx.atlas.id });
      assert.equal(r.apagadas.quantidade, 1);
    });

    it('atlas NA LIXEIRA: nada dele sai, e a rodada zera a marca que a imagem tinha', async () => {
      const ctx = await atlasComMapa();
      const img = await imagem(ctx.atlas.id);
      await marcar(img.id, 31);
      await db.query('UPDATE atlas SET deleted_at = NOW() - INTERVAL \'90 days\' WHERE id = $1', [ctx.atlas.id]);
      // The trigger on `atlas` zeroes marks of what the atlas row CITES; this image is not cited,
      // so the mark survives the UPDATE and only the trash rule protects it.
      assert.ok((await linha(img.id)).sem_referencia_desde, 'premissa: a marca sobreviveu ao UPDATE do atlas');

      const simulado = await simularColetaDeOrfas({ atlasId: ctx.atlas.id });
      assert.equal(simulado.elegiveis.quantidade, 0);
      assert.equal(simulado.imagens.naLixeira, 1);

      const r = await apagarOrfas({ atorId: admin.id, atlasId: ctx.atlas.id });
      assert.equal(r.apagadas.quantidade, 0);
      assert.ok(existsSync(img.caminho));
      assert.equal((await linha(img.id)).sem_referencia_desde, null, 'a lixeira zera a marca');
    });
  });

  // ------------------------------------------------------------------ CARÊNCIA
  describe('carência: 30 dias CONTÍNUOS sem referência, e criada há mais de 30', () => {
    it('marca de 29 dias NÃO apaga (falta 1 dia); de 31 apaga', async () => {
      const ctx = await atlasComMapa();
      const vinteENove = await imagem(ctx.atlas.id);
      const trintaEUm = await imagem(ctx.atlas.id);
      await marcar(vinteENove.id, 29);
      await marcar(trintaEUm.id, 31);

      const simulado = await simularColetaDeOrfas({ atlasId: ctx.atlas.id });
      const espera = simulado.emCarencia.itens.find((i) => i.id === vinteENove.id);
      assert.equal(espera.motivo, MotivoDeCarencia.MARCA_RECENTE);
      assert.equal(espera.faltamDias, 1);

      const r = await apagarOrfas({ atorId: admin.id, atlasId: ctx.atlas.id });
      assert.deepEqual(r.apagadas.porAtlas.flatMap((g) => g.imagens.map((i) => i.id)), [trintaEUm.id]);
      assert.ok(await linha(vinteENove.id));
    });

    it('imagem JOVEM (29 dias de vida) não sai, mesmo com marca antiga', async () => {
      const ctx = await atlasComMapa();
      const jovem = await imagem(ctx.atlas.id, { idade: 29 });
      await marcar(jovem.id, 31);
      const simulado = await simularColetaDeOrfas({ atlasId: ctx.atlas.id });
      assert.equal(simulado.emCarencia.itens.find((i) => i.id === jovem.id).motivo, MotivoDeCarencia.JOVEM);
      const r = await apagarOrfas({ atorId: admin.id, atlasId: ctx.atlas.id });
      assert.equal(r.apagadas.quantidade, 0);
    });

    it('sem marca: `marcar` põe a marca de agora e não apaga; a contagem começa ali', async () => {
      const ctx = await atlasComMapa();
      const img = await imagem(ctx.atlas.id, { idade: 400 });
      const r = await marcarOrfas({ atlasId: ctx.atlas.id });
      assert.ok(r.marcas.postas >= 1);
      const marca = (await linha(img.id)).sem_referencia_desde;
      assert.ok(marca instanceof Date);
      assert.ok(Date.now() - marca.getTime() < 60_000, 'a marca é de agora');
      assert.equal(r.emCarencia.itens.find((i) => i.id === img.id).faltamDias, 30);
      // A imagem de 400 dias NÃO sai no `apagar` seguinte: a marca é de agora.
      const apagado = await apagarOrfas({ atorId: admin.id, atlasId: ctx.atlas.id });
      assert.equal(apagado.apagadas.quantidade, 0);
    });

    it('uma referência que VOLTA zera a marca na hora, pelo gatilho, e a contagem recomeça', async () => {
      const ctx = await atlasComMapa();
      const img = await imagem(ctx.atlas.id);
      await marcar(img.id, 31);
      const f = await feicao(ctx.mapa.id, { properties: { images: [{ id: img.id }] } });
      assert.equal((await linha(img.id)).sem_referencia_desde, null, 'o INSERT que cita zerou a marca');

      // A referência SOME antes da rodada seguinte: a imagem passou a estar sem citação AGORA, e
      // não há 31 dias. Uma rodada que só olhasse o presente a apagaria.
      await db.query("UPDATE features SET properties = '{}'::jsonb WHERE id = $1", [f]);
      const r = await apagarOrfas({ atorId: admin.id, atlasId: ctx.atlas.id });
      assert.equal(r.apagadas.quantidade, 0);
      const marca = (await linha(img.id)).sem_referencia_desde;
      assert.ok(Date.now() - marca.getTime() < 60_000, 'a rodada marcou de novo, a partir de agora');
    });

    it('o lado ANTIGO do gatilho: remover a citação zera uma marca escrita enquanto ela existia', async () => {
      // A corrida que o lado ANTIGO fecha: a rodada escreve a marca a partir de um retrato que ainda
      // não via a citação. A marca fica velha enquanto a imagem está CITADA; quando a citação é
      // removida, a contagem precisa recomeçar dali, e não da marca velha.
      const ctx = await atlasComMapa();
      const img = await imagem(ctx.atlas.id);
      const f = await feicao(ctx.mapa.id, { properties: { images: [{ id: img.id }] } });
      await marcar(img.id, 31);
      await db.query("UPDATE features SET properties = '{}'::jsonb WHERE id = $1", [f]);
      assert.equal((await linha(img.id)).sem_referencia_desde, null, 'o texto ANTIGO citava: marca zerada');
      const r = await apagarOrfas({ atorId: admin.id, atlasId: ctx.atlas.id });
      assert.equal(r.apagadas.quantidade, 0);
    });

    it('a rodada zera a marca de uma imagem que voltou a ser citada', async () => {
      const ctx = await atlasComMapa();
      const img = await imagem(ctx.atlas.id);
      await feicao(ctx.mapa.id, { id: img.id, tipo: 'image' });
      await marcar(img.id, 5);
      const r = await marcarOrfas({ atlasId: ctx.atlas.id });
      assert.ok(r.marcas.zeradas >= 1);
      assert.equal((await linha(img.id)).sem_referencia_desde, null);
    });
  });

  // ------------------------------------------------------------------ SIMULAÇÃO
  describe('simulação', () => {
    it('lista o que apagaria, com contagem e bytes, e não escreve nada', async () => {
      const ctx = await atlasComMapa();
      const elegivel = await imagem(ctx.atlas.id);
      const semMarca = await imagem(ctx.atlas.id);
      await marcar(elegivel.id, 31);
      const antes = await db.query('SELECT id, sem_referencia_desde FROM images WHERE atlas_id = $1 ORDER BY id', [ctx.atlas.id]);
      const trilhaAntes = await db.query('SELECT COUNT(*)::int AS n FROM audit_trail WHERE target_id = $1', [ctx.atlas.id]);

      const r = await simularColetaDeOrfas({ atlasId: ctx.atlas.id });
      assert.equal(r.modo, 'simulacao');
      assert.deepEqual(idsElegiveis(r), [elegivel.id]);
      assert.equal(r.elegiveis.quantidade, 1);
      assert.equal(r.elegiveis.bytes, PNG.length);
      assert.equal(r.marcas, null, 'a simulação não escreve marca');
      const pendente = r.emCarencia.itens.find((i) => i.id === semMarca.id);
      assert.equal(pendente.motivo, MotivoDeCarencia.SEM_MARCA);
      assert.equal(pendente.faltamDias, 30);

      const depois = await db.query('SELECT id, sem_referencia_desde FROM images WHERE atlas_id = $1 ORDER BY id', [ctx.atlas.id]);
      assert.deepEqual(depois.rows, antes.rows, 'nenhuma linha nem marca mudou');
      assert.ok(existsSync(elegivel.caminho) && existsSync(semMarca.caminho), 'nenhum arquivo saiu');
      const trilhaDepois = await db.query('SELECT COUNT(*)::int AS n FROM audit_trail WHERE target_id = $1', [ctx.atlas.id]);
      assert.equal(trilhaDepois.rows[0].n, trilhaAntes.rows[0].n, 'nenhuma linha de trilha');
    });

    // "THE SIMULATION WRITES NOTHING" IS A PROPERTY OF POSTGRES, and this case is what holds that
    // claim: the case above proves only that THIS code writes nothing today. A probe wraps `db.tx`
    // of the SAME module instance the service uses, asks the server whether the transaction the
    // simulation got is read-only, and tries a write inside it (a no-op UPDATE, in a savepoint, so
    // the refusal does not abort the run). Postgres answers 25006 (read_only_sql_transaction). The
    // SAME probe in the transaction of `marcar` writes, which is the control that the refusal comes
    // from the transaction mode and not from the probe.
    it('roda numa transação READ ONLY: o Postgres recusa uma escrita DENTRO dela, e a de `marcar` aceita', async () => {
      const ctx = await atlasComMapa();
      const img = await imagem(ctx.atlas.id);
      await marcar(img.id, 31);

      async function sondar(rodada) {
        const original = banco.tx;
        const sondas = [];
        banco.tx = function sondado(...args) {
          const trabalho = args[args.length - 1];
          args[args.length - 1] = async (t) => {
            const { transaction_read_only: somenteLeitura } = await t.one('SHOW transaction_read_only');
            let recusa = null;
            try {
              await t.tx((sp) => sp.none(
                'UPDATE images SET sem_referencia_desde = sem_referencia_desde WHERE id = $1', [img.id]
              ));
            } catch (err) {
              recusa = err.code ?? String(err);
            }
            sondas.push({ somenteLeitura, recusa });
            return trabalho(t);
          };
          return original.apply(this, args);
        };
        try {
          await rodada();
        } finally {
          banco.tx = original;
        }
        return sondas;
      }

      const naSimulacao = await sondar(() => simularColetaDeOrfas({ atlasId: ctx.atlas.id }));
      assert.deepEqual(naSimulacao, [{ somenteLeitura: 'on', recusa: '25006' }],
        'a simulação abre UMA transação, somente leitura, e o banco recusa escrita nela');

      const noMarcar = await sondar(() => marcarOrfas({ atlasId: ctx.atlas.id }));
      assert.deepEqual(noMarcar, [{ somenteLeitura: 'off', recusa: null }],
        'CONTROLE: a mesma sonda escreve na transação de `marcar`');
    });
  });

  // ------------------------------------------------------------------ TRILHA
  describe('trilha de auditoria', () => {
    it('apagar deixa UMA linha por atlas, com ator, alvo e os ids; marcar não deixa nenhuma', async () => {
      const ctx = await atlasComMapa();
      const um = await imagem(ctx.atlas.id);
      const dois = await imagem(ctx.atlas.id);
      await marcar(um.id, 40);
      await marcar(dois.id, 35);

      await marcarOrfas({ atlasId: ctx.atlas.id });
      const semLinha = await db.query('SELECT COUNT(*)::int AS n FROM audit_trail WHERE action = $1 AND target_id = $2', [ACAO_DE_REMOCAO, ctx.atlas.id]);
      assert.equal(semLinha.rows[0].n, 0);

      const r = await apagarOrfas({ atorId: admin.id, atlasId: ctx.atlas.id });
      assert.equal(r.apagadas.quantidade, 2);
      assert.equal(r.apagadas.bytes, 2 * PNG.length);
      assert.deepEqual(r.apagadas.arquivosNaoRemovidos, []);

      const { rows } = await db.query(
        'SELECT actor_id, target_type, target_id, target_name, details FROM audit_trail WHERE action = $1 AND target_id = $2',
        [ACAO_DE_REMOCAO, ctx.atlas.id]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].actor_id, admin.id);
      assert.equal(rows[0].target_type, 'ATLAS');
      assert.equal(rows[0].target_name, ctx.atlas.name);
      assert.equal(rows[0].details.quantidade, 2);
      assert.deepEqual(rows[0].details.imagens.map((i) => i.id).sort(), [um.id, dois.id].sort());
    });

    it('apagar sem ator recusa antes de tocar em qualquer coisa', async () => {
      await assert.rejects(() => apagarOrfas({ atorId: null }), /atorId/);
    });
  });
});
