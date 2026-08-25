// Path: tests/integration/import-id-ja-usado.repro.test.js
//
// O DEFEITO: "Resource already exists" (hoje pt-BR) ao reenviar um atlas local ao servidor.
//
// `features.id`, `layers.id`, `groups.id`, `briefings.id` e `slides.id` sao CHAVE PRIMARIA
// GLOBAL, sem escopo de atlas. O empacotador do cliente
// (`frontend/src/js/import_export/local-atlas-to-server.js`, `makeIdMapper`) PRESERVA o id
// local quando ele ja e um UUID valido. Logo o segundo envio do mesmo atlas local repete os
// mesmos ids, o Postgres recusa por unicidade (23505) e o tradutor de erro imprime
// "Ja existe um registro com esses dados." (era "Resource already exists").
//
// A LIXEIRA NAO E A CAUSA, e so onde o chefe encontrou o defeito. Medido por API antes deste
// arquivo: id de feicao vindo de atlas na lixeira recusa, id vindo de atlas VIVO recusa
// igual, e id inedito passa. Purgar a lixeira adiaria o caso do atlas vivo e quebraria a
// clausula 7.4 da CONSTITUICAO, que exige a lixeira restauravel COM conteudo.
//
// O CONSERTO MEDIDO AQUI e "preserva quando livre, cunha na colisao", no SERVIDOR: so o
// servidor sabe o que esta ocupado. O caso `o id inedito continua PRESERVADO` e o controle
// positivo, e ele prende a premissa de que
// `frontend/tests/e2e-ui/browser-save-local-to-server.spec.js` depende: quem nao colide
// chega ao servidor com o proprio id.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';

describe('import: id de entidade ja usado no banco', () => {
  let app, db, user, token, outro, outroToken;

  const importar = (payload, tk) => supertest(app)
    .post('/api/v1/atlas/import')
    .set('Authorization', `Bearer ${tk || token}`)
    .send(payload);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const tag = randomUUID().slice(0, 8);
    user = await createUser(db, { username: `imp_dup_${tag}` });
    token = await loginUser(app, user.username, user.password);
    outro = await createUser(db, { username: `imp_dup2_${tag}` });
    outroToken = await loginUser(app, outro.username, outro.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /**
   * Monta o payload de um atlas local pequeno, com ids FIXOS: e o mesmo arquivo `.ebgeo`
   * enviado duas vezes, entao os ids se repetem entre os dois envios de proposito.
   * @param {string} nome
   * @param {Object} ids
   * @returns {Object}
   */
  function payloadLocal(nome, ids) {
    return {
      atlas: { name: nome, description: 'atlas local reenviado' },
      maps: [{
        id: randomUUID(), // o mapa ja ganha id novo a cada envio, pelo cliente
        name: 'Principal',
        features: [{
          id: ids.feature,
          feature_type: 'point',
          geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
          properties: { id: ids.feature, layerId: ids.layer, nome: 'ponto' },
          layer_id: ids.layer,
        }],
        layers: [{ id: ids.layer, name: 'Camada', sort_order: 0 }],
        groups: [{ id: ids.group, name: 'Grupo' }],
        groupFeatures: [{ group_id: ids.group, feature_id: ids.feature }],
      }],
      briefings: [{
        id: ids.briefing,
        name: 'Briefing',
        slides: [{ id: ids.slide, title: 'Slide' }],
      }],
    };
  }

  /** Ids de um atlas local qualquer. @returns {Object} */
  const novosIds = () => ({
    feature: randomUUID(), layer: randomUUID(), group: randomUUID(),
    briefing: randomUUID(), slide: randomUUID(),
  });

  it('o mesmo atlas local enviado DUAS VEZES entra as duas vezes', async () => {
    const ids = novosIds();

    const primeiro = await importar(payloadLocal('Reenvio 1', ids)).expect(201);
    const segundo = await importar(payloadLocal('Reenvio 2', ids));

    assert.equal(
      segundo.status, 201,
      `o segundo envio foi recusado: ${JSON.stringify(segundo.body)}`
    );
    assert.notEqual(segundo.body.data.id, primeiro.body.data.id, 'nasceram dois atlas distintos');

    // A EXTENSAO DA CONFERENCIA E A DA ESCRITA: os dois atlas guardam a feicao, a camada,
    // o grupo, o par grupo-feicao, o briefing e o slide, cada um com linha propria.
    for (const atlasId of [primeiro.body.data.id, segundo.body.data.id]) {
      const { rows } = await db.query(
        `SELECT (SELECT count(*) FROM features f JOIN maps m ON m.id = f.map_id
                  WHERE m.atlas_id = $1) AS feicoes,
                (SELECT count(*) FROM layers l JOIN maps m ON m.id = l.map_id
                  WHERE m.atlas_id = $1) AS camadas,
                (SELECT count(*) FROM groups g JOIN maps m ON m.id = g.map_id
                  WHERE m.atlas_id = $1) AS grupos,
                (SELECT count(*) FROM group_features gf
                   JOIN groups g ON g.id = gf.group_id
                   JOIN maps m ON m.id = g.map_id WHERE m.atlas_id = $1) AS pares,
                (SELECT count(*) FROM briefings WHERE atlas_id = $1) AS briefings,
                (SELECT count(*) FROM slides s JOIN briefings b ON b.id = s.briefing_id
                  WHERE b.atlas_id = $1) AS slides`,
        [atlasId]
      );
      const c = rows[0];
      assert.equal(Number(c.feicoes), 1, `feicoes em ${atlasId}`);
      assert.equal(Number(c.camadas), 1, `camadas em ${atlasId}`);
      assert.equal(Number(c.grupos), 1, `grupos em ${atlasId}`);
      assert.equal(Number(c.pares), 1, `pares grupo-feicao em ${atlasId}`);
      assert.equal(Number(c.briefings), 1, `briefings em ${atlasId}`);
      assert.equal(Number(c.slides), 1, `slides em ${atlasId}`);
    }
  });

  it('a feicao recunhada continua ligada a SUA camada e ao SEU grupo', async () => {
    const ids = novosIds();
    await importar(payloadLocal('Fiacao 1', ids)).expect(201);
    const segundo = await importar(payloadLocal('Fiacao 2', ids)).expect(201);

    const { rows } = await db.query(
      `SELECT f.id, f.layer_id, f.properties->>'id' AS prop_id,
              f.properties->>'layerId' AS prop_layer, l.map_id AS camada_do_mapa,
              m.atlas_id, gf.group_id, g.map_id AS grupo_do_mapa
         FROM features f
         JOIN maps m ON m.id = f.map_id
         LEFT JOIN layers l ON l.id = f.layer_id
         LEFT JOIN group_features gf ON gf.feature_id = f.id
         LEFT JOIN groups g ON g.id = gf.group_id
        WHERE m.atlas_id = $1`,
      [segundo.body.data.id]
    );
    assert.equal(rows.length, 1, 'uma feicao no atlas novo');
    const f = rows[0];
    assert.ok(f.layer_id, 'a feicao guardou a referencia de camada');
    assert.equal(f.camada_do_mapa, f.grupo_do_mapa, 'camada e grupo sao do mesmo mapa');
    // `properties.id` ESPELHA a coluna: a tela le a feicao pelos dois caminhos, e o
    // e2e do navegador le justamente por `properties.id`.
    assert.equal(f.prop_id, f.id, 'properties.id acompanhou a coluna id');
    assert.equal(f.prop_layer, f.layer_id, 'properties.layerId acompanhou layer_id');
    assert.ok(f.group_id, 'o par grupo-feicao sobreviveu');
  });

  it('id inedito continua PRESERVADO (controle positivo do guarda de navegador)', async () => {
    const ids = novosIds();
    const criado = await importar(payloadLocal('Inedito', ids)).expect(201);

    const { rows } = await db.query(
      `SELECT f.id, f.properties->>'id' AS prop_id FROM features f
         JOIN maps m ON m.id = f.map_id WHERE m.atlas_id = $1`,
      [criado.body.data.id]
    );
    assert.equal(rows[0].id, ids.feature, 'sem colisao o id do cliente e o id do servidor');
    assert.equal(rows[0].prop_id, ids.feature, 'e properties.id tambem');

    const { rows: camadas } = await db.query(
      `SELECT l.id FROM layers l JOIN maps m ON m.id = l.map_id WHERE m.atlas_id = $1`,
      [criado.body.data.id]
    );
    assert.equal(camadas[0].id, ids.layer, 'a camada tambem chega com o id do cliente');
  });

  it('id preso por atlas NA LIXEIRA nao impede o envio, e a lixeira fica intacta', async () => {
    const ids = novosIds();
    const primeiro = await importar(payloadLocal('Lixeira origem', ids)).expect(201);

    await supertest(app)
      .delete(`/api/v1/atlas/${primeiro.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const segundo = await importar(payloadLocal('Depois da lixeira', ids));
    assert.equal(
      segundo.status, 201,
      `o envio apos apagar foi recusado: ${JSON.stringify(segundo.body)}`
    );

    // CLAUSULA 7.4: a lixeira continua restauravel COM conteudo.
    await supertest(app)
      .post(`/api/v1/atlas/${primeiro.body.data.id}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const { rows } = await db.query(
      `SELECT f.id FROM features f JOIN maps m ON m.id = f.map_id WHERE m.atlas_id = $1`,
      [primeiro.body.data.id]
    );
    assert.equal(rows.length, 1, 'o atlas restaurado voltou com a feicao');
    assert.equal(rows[0].id, ids.feature, 'e ela manteve o id original');
  });

  it('dois usuarios enviando o MESMO atlas local nao colidem entre si', async () => {
    const ids = novosIds();
    await importar(payloadLocal('Copia do A', ids), token).expect(201);
    const deB = await importar(payloadLocal('Copia do B', ids), outroToken);
    assert.equal(
      deB.status, 201,
      `o envio do segundo usuario foi recusado: ${JSON.stringify(deB.body)}`
    );

    const { rows } = await db.query(
      `SELECT a.owner_id FROM features f
         JOIN maps m ON m.id = f.map_id JOIN atlas a ON a.id = m.atlas_id
        WHERE f.id = $1`,
      [ids.feature]
    );
    assert.equal(rows.length, 1, 'o id original segue de UM dono so');
    assert.equal(rows[0].owner_id, user.id, 'quem chegou primeiro ficou com o id');
  });

  it('briefing, slide e item 3D tambem sobrevivem ao reenvio', async () => {
    const ids = novosIds();
    const item3d = randomUUID();
    /** @returns {Object} */
    const comBriefing = (nome) => {
      const p = payloadLocal(nome, ids);
      p.maps[0].cesium3dData = [{ id: item3d, data_type: 'marker', data: { nome: 'm' } }];
      p.briefings[0].slides[0].map_id = p.maps[0].id;
      return p;
    };

    await importar(comBriefing('Com briefing 1')).expect(201);
    const segundo = await importar(comBriefing('Com briefing 2')).expect(201);

    const { rows } = await db.query(
      `SELECT (SELECT count(*) FROM briefings WHERE atlas_id = $1) AS briefings,
              (SELECT count(*) FROM slides s JOIN briefings b ON b.id = s.briefing_id
                WHERE b.atlas_id = $1 AND s.map_id IS NOT NULL) AS slides_com_mapa,
              (SELECT count(*) FROM cesium3d_data c JOIN maps m ON m.id = c.map_id
                WHERE m.atlas_id = $1) AS itens3d,
              (SELECT array_length(map_order, 1) FROM atlas WHERE id = $1) AS mapas_na_ordem`,
      [segundo.body.data.id]
    );
    assert.equal(Number(rows[0].briefings), 1, 'o briefing entrou');
    assert.equal(Number(rows[0].slides_com_mapa), 1, 'o slide ainda aponta para o mapa novo');
    assert.equal(Number(rows[0].itens3d), 1, 'o item 3D entrou');
    assert.equal(Number(rows[0].mapas_na_ordem), 1, 'map_order nomeia o mapa gravado');

    // `map_order` tem de nomear o mapa QUE EXISTE. Sem isto o atlas abriria sem mapa.
    const { rows: ordem } = await db.query(
      `SELECT a.map_order[1] = m.id AS bate FROM atlas a
         JOIN maps m ON m.atlas_id = a.id WHERE a.id = $1`,
      [segundo.body.data.id]
    );
    assert.equal(ordem[0].bate, true, 'map_order aponta para a linha gravada');
  });

  it('id repetido DENTRO do arquivo e recusa, e a frase e em portugues', async () => {
    const ids = novosIds();
    const payload = payloadLocal('Arquivo inconsistente', ids);
    // Duas feicoes disputando a mesma identidade: nenhuma escolha do servidor seria a certa.
    payload.maps[0].features.push({
      ...payload.maps[0].features[0],
      geometry: { type: 'Point', coordinates: [-44, -23] },
    });

    const recusa = await importar(payload).expect(400);
    assert.equal(recusa.body.error.code, 'BAD_REQUEST');
    assert.match(recusa.body.error.message, /repete o id de uma feição/);
    assert.match(recusa.body.error.message, /Exporte o atlas de novo/);
    // A FRASE EM INGLES DO TRADUTOR DE 23505 NAO PODE MAIS APARECER AQUI.
    assert.doesNotMatch(recusa.body.error.message, /Já existe um registro com esses dados/);
  });
});
