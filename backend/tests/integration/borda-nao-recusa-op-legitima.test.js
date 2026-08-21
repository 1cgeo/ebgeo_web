// Path: tests/integration/borda-nao-recusa-op-legitima.test.js
//
// F14 — A METADE POSITIVA DA BORDA DE ESCRITA, que é a que se esquece.
//
// A fase apertou o que o servidor ACEITA ARMAZENAR nos campos JSONB livres. O risco simétrico do
// aperto não é vazar, é PODAR DEMAIS, e essa regressão é mais silenciosa que a que a fase fecha:
// um campo que deixa de persistir não dá erro em lugar nenhum, o usuário só descobre quando o
// mapa reabre sem o que ele ajustou. Este arquivo é o contrapeso, e ele mede duas coisas
// distintas que só juntas dizem "não quebrou o cliente":
//
//   (1) NENHUMA OP LEGÍTIMA PASSOU A SER RECUSADA. Um lote com uma op de CADA tipo de entidade
//       que o servidor sabe aplicar sobe pela rota real e volta INTEIRO acked, sem uma recusa. O
//       ack importa mais que o 200: a recusa desta casa é POR OPERAÇÃO (`rejected`/`reason`), e o
//       cliente não faz dequeue de op recusada, então uma recusa nova aqui não apareceria como
//       erro — apareceria como uma fila de saída que reenvia o mesmo lote a cada 1,5 s para
//       sempre. É por isso que a borda DESCARTA em vez de rejeitar, e é isso que se mede.
//
//   (2) O HILLSHADE CONTINUA CHEGANDO PARA TODO MUNDO, o visitante anônimo de link público
//       incluído. Ele é o caso que amarra as duas bordas ao mesmo tempo: a entrada dele é
//       literalmente `{name, config:{source:{url}}}`, ou seja a MESMA forma que a borda de
//       escrita existe para barrar e que a poda de saída existe para não tocar. Alargar qualquer
//       um dos dois lados tira o relevo sombreado do mapa de todos os usuários, e essa é a
//       regressão que fica quieta no teste e barulhenta na tela.
//
// A DISCRIMINAÇÃO, sem a qual (2) passaria num servidor que devolve tudo: no MESMO snapshot, ao
// lado do relevo, vive uma entrada que reclama um recurso PRIVADO e carrega a cópia velha que um
// cliente pré-F11 guardou. O relevo sai com a definição; a cópia velha não sai para ninguém, e a
// URL viva do recurso privado não sai para quem não o alcança.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createShare, createLayer, createGroup,
  createBriefing, createSlide, loginUser, makeAtlasPublic, getPublicToken,
  seedCatalogRefs, dropCatalogRefs, seedPublic360Photos, drop360Fixture,
} from '../helpers/fixtures.js';

const sufixo = randomUUID().slice(0, 8);

const PRIVADO = `f14-legit-priv-${sufixo}`;
const ID_ENTRADA_PRIVADA = `analysis-${PRIVADO}`;
const URL_PRIVADA_VIVA = `/tiles/${sufixo}/privada-viva/{z}/{x}/{y}.pbf`;
const URL_COPIA_VELHA = `/tiles/${sufixo}/copia-velha/{z}/{x}/{y}.pbf`;
// O 3D e o 360 do lote legítimo apontam para recurso PÚBLICO e existente: ver o `before`.
const TILESET_PUBLICO = 'PCL';
const FOTO_PUBLICA = `foto-${sufixo}.jpg`;
const URL_HILLSHADE = `/tiles/${sufixo}/relevo/{z}/{x}/{y}.png`;

/**
 * A entrada do relevo sombreado, na forma exata em que ela existe: `type: 'hillshade'` não é
 * recurso de catálogo (não tem linha em tabela nenhuma), e a definição dele é estática.
 * @returns {Object}
 */
const entradaDoRelevo = () => ({
  id: 'hillshade',
  type: 'hillshade',
  name: 'Sombreamento do Relevo',
  visible: true,
  opacity: 1,
  config: { source: { type: 'raster-dem', url: URL_HILLSHADE, tileSize: 256 } },
});

describe('F14 — a borda aperta sem recusar op legítima, e o relevo continua chegando', () => {
  let app, db;
  let dono, membro;
  let tokenDono, tokenMembro, tokenVisitante;
  let atlas, mapa, camada, grupo, briefing, slide;
  let idDaFeicao, idDoComentario, idDoMarcador3d, idDaOrientacao360;
  let acksDoLote, resultadosDoLote, versaoDoLote;
  let fixture360;

  const push = async (token, operations, esperado = 200) => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations })
      .expect(esperado);
    return res.body.data;
  };

  const snapshot = async (token) => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data.snapshot;
  };

  const camadasDeCatalogo = (snap) => snap.maps.find((m) => m.id === mapa.id).catalogLayers;

  const op = (extra) => ({
    id: randomUUID(),
    timestamp: Date.now(),
    clientId: `c-legit-${sufixo}`,
    ...extra,
  });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db, { username: `f14_legit_dono_${sufixo}` });
    membro = await createUser(db, { username: `f14_legit_membro_${sufixo}` });
    tokenDono = await loginUser(app, dono.username, dono.password);
    tokenMembro = await loginUser(app, membro.username, membro.password);

    atlas = await createAtlas(db, dono.id, { name: `F14 legítimo ${sufixo}` });
    mapa = await createMap(db, atlas.id, { name: `Mapa legítimo ${sufixo}` });
    camada = await createLayer(db, mapa.id, { name: 'Camada inicial' });
    grupo = await createGroup(db, mapa.id, { name: 'Grupo inicial' });
    briefing = await createBriefing(db, atlas.id, { name: `Briefing legítimo ${sufixo}` });
    slide = await createSlide(db, briefing.id, { title: 'Slide inicial' });
    await createShare(db, atlas.id, membro.id, 'read', dono.id);

    // O recurso PRIVADO da discriminação, e a entrada HISTÓRICA dele: gravada por SQL de
    // propósito, porque a borda da F14 recusaria hoje a cópia que ela carrega. O que ela
    // representa aqui é a linha que já estava no banco.
    await db.query(
      `INSERT INTO analysis_layers (id, name, config, sort_order, access_level)
       VALUES ($1, $2, $3::jsonb, 0, 'private')`,
      [PRIVADO, `Camada ${PRIVADO} (nome vivo)`, JSON.stringify({
        source: { type: 'vector', url: URL_PRIVADA_VIVA },
      })],
    );
    await db.query(
      'INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)',
      [ID_ENTRADA_PRIVADA, mapa.id, JSON.stringify({
        id: ID_ENTRADA_PRIVADA,
        type: 'analysis_layer',
        visible: true,
        name: 'Cópia velha do nome',
        config: { id: PRIVADO, source: { type: 'vector', url: URL_COPIA_VELHA } },
      })],
    );

    // O 3D e o 360 do lote LEGÍTIMO precisam apontar para recurso que EXISTE e que o autor
    // enxerga: desde que o gate de referência privada cobre as cinco superfícies (e não só a
    // camada de catálogo), um `tilesetId` ou um `photoName` que não resolve é recusado, pela
    // convenção de que "não existe" e "não posso ver" são indistinguíveis. Este arquivo mede
    // que a borda NÃO recusa o legítimo, então o legítimo tem de ser legítimo também aqui.
    await seedCatalogRefs(db, { tilesets: [TILESET_PUBLICO] });
    fixture360 = await seedPublic360Photos(db, [FOTO_PUBLICA]);

    tokenVisitante = await getPublicToken(app, await makeAtlasPublic(db, atlas.id));

    idDaFeicao = randomUUID();
    idDoComentario = randomUUID();
    idDoMarcador3d = randomUUID();
    idDaOrientacao360 = randomUUID();
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [PRIVADO]);
    await db.query('DELETE FROM atlas_resources WHERE resource_id = $1', [PRIVADO]);
    await db.query('DELETE FROM analysis_layers WHERE id = $1', [PRIVADO]);
    await dropCatalogRefs(db, { tilesets: [TILESET_PUBLICO] });
    await drop360Fixture(db, fixture360);
    await teardownTestEnv(db);
  });

  // ============================================================================================
  // PISO — sem ele o resto seria verde sobre um banco sem o segredo e sem o relevo
  // ============================================================================================

  it('piso: o recurso privado existe, e a entrada histórica dele carrega a cópia velha', async () => {
    const { rows } = await db.query(
      'SELECT access_level, active, config FROM analysis_layers WHERE id = $1', [PRIVADO],
    );
    assert.equal(rows.length, 1, 'o recurso privado precisa existir');
    assert.equal(rows[0].access_level, 'private');
    assert.equal(rows[0].active, true, 'e ativo, senão a ausência dele não diz nada');
    assert.equal(rows[0].config.source.url, URL_PRIVADA_VIVA);

    const guardada = await db.query(
      'SELECT data FROM catalog_layers WHERE map_id = $1 AND id = $2', [mapa.id, ID_ENTRADA_PRIVADA],
    );
    assert.equal(guardada.rows.length, 1, 'a entrada histórica está gravada');
    assert.equal(guardada.rows[0].data.config.source.url, URL_COPIA_VELHA, 'com a cópia velha dentro');
    assert.ok(tokenVisitante, 'e o visitante de link público existe');
  });

  // ============================================================================================
  // (1) NENHUMA OP LEGÍTIMA É RECUSADA
  // ============================================================================================

  it('um lote com uma op de CADA tipo de entidade volta inteiro acked, sem uma recusa', async () => {
    const operacoes = [
      op({
        entityType: 'feature', operationType: 'create', entityId: idDaFeicao, mapId: mapa.id,
        data: {
          id: idDaFeicao,
          feature_type: 'point',
          geometry: { type: 'Point', coordinates: [-45, -20] },
          properties: { nome: 'Ponto legítimo', descricao: 'texto livre', visivel: true },
        },
      }),
      op({
        entityType: 'layer', operationType: 'update', entityId: camada.id, mapId: mapa.id,
        changes: { name: 'Camada renomeada', visible: false, opacity: 0.4, order: 3 },
      }),
      op({
        entityType: 'group', operationType: 'update', entityId: grupo.id, mapId: mapa.id,
        changes: { name: 'Grupo renomeado', visible: false, locked: true },
      }),
      op({
        entityType: 'map', operationType: 'update', entityId: mapa.id, mapId: mapa.id,
        changes: { name: `Mapa renomeado ${sufixo}` },
      }),
      op({
        entityType: 'mapPosition', operationType: 'update', entityId: mapa.id, mapId: mapa.id,
        data: { center_lat: -15.8, center_long: -47.9, zoom: 14, bearing: 45, pitch: 30 },
      }),
      op({
        entityType: 'baseLayer', operationType: 'update', entityId: mapa.id, mapId: mapa.id,
        data: { base_layer: 'carta-topografica' },
      }),
      op({
        entityType: 'mapNotes', operationType: 'update', entityId: mapa.id, mapId: mapa.id,
        data: { title: 'Notas do mapa', description: 'Descrição livre da operação' },
      }),
      op({
        entityType: 'gridStyle', operationType: 'update', entityId: mapa.id, mapId: mapa.id,
        data: { format: 'utm', visible: true },
      }),
      op({
        entityType: 'mapTemporal', operationType: 'update', entityId: mapa.id, mapId: mapa.id,
        data: {
          ativo: true, unidade: 'horas', modo: 'absoluto',
          inicio: 1700000000000, fim: 1700003600000, origem: null,
        },
      }),
      op({
        entityType: 'catalogLayer', operationType: 'create', entityId: 'hillshade', mapId: mapa.id,
        data: entradaDoRelevo(),
      }),
      op({
        entityType: 'briefing', operationType: 'update', entityId: briefing.id, mapId: null,
        changes: {
          name: 'Briefing renomeado',
          settings: { panelPosition: 'right', panelWidth: 420, panelBackgroundColor: '#ffffff' },
        },
      }),
      op({
        entityType: 'slide', operationType: 'update', entityId: slide.id, mapId: null,
        changes: {
          title: 'Slide renomeado',
          position: { longitude: -45.5, latitude: -20.25, zoom: 11, altitude: null },
          orientation: { bearing: 33, pitch: -25, heading: null, lon: null, lat: null, fov: null },
          temporal_cursor: 1700001800000,
        },
      }),
      op({
        entityType: 'comment', operationType: 'create', entityId: idDoComentario, mapId: mapa.id,
        data: {
          id: idDoComentario, mapId: mapa.id, lng: -45, lat: -20,
          text: 'Comentário espacial', status: 'open', authorId: dono.id,
        },
      }),
      op({
        entityType: 'marker3d', operationType: 'create', entityId: idDoMarcador3d, mapId: mapa.id,
        data: {
          id: idDoMarcador3d,
          tilesetId: TILESET_PUBLICO,
          position: { longitude: -43.2, latitude: -22.9, height: 150 },
          properties: { name: 'Alvo', color: '#ff0000' },
        },
      }),
      op({
        entityType: 'orientation360', operationType: 'create', entityId: idDaOrientacao360, mapId: mapa.id,
        data: {
          id: idDaOrientacao360,
          photoName: FOTO_PUBLICA,
          heading: 120, pitch: -5, fov: 75,
        },
      }),
      op({
        entityType: 'setting', operationType: 'update', entityId: atlas.id, mapId: null,
        data: {
          customIcons: [{
            id: `icone-${sufixo}`, name: 'Ícone da OM', thumbnail: 'data:image/png;base64,AAA',
            type: 'png', createdAt: 1700000000000,
          }],
        },
      }),
    ];

    // PISO da cobertura: o lote precisa mesmo cobrir a superfície, senão "nenhuma recusa" seria a
    // afirmação de um lote de duas ops.
    const tipos = new Set(operacoes.map((o) => o.entityType));
    assert.equal(tipos.size, 16, 'dezesseis tipos de entidade distintos no mesmo lote');
    assert.equal(operacoes.length, 16, 'uma op por tipo');

    const dados = await push(tokenDono, operacoes);
    acksDoLote = dados.acks;
    resultadosDoLote = dados.results;
    versaoDoLote = dados.serverVersion;

    assert.equal(acksDoLote.length, 16, 'todas as ops foram acked');
    const recusadas = acksDoLote.filter((a) => a.rejected);
    assert.deepEqual(
      recusadas.map((a) => a.reason), [],
      'uma recusa aqui congela a fila de saída do cliente: a borda DESCARTA campo, nunca recusa op',
    );
  });

  it('e o contrato POR OPERAÇÃO diz sucesso nas dezesseis, com versão de servidor', () => {
    // `results` é o contrato de dequeue confiante do cliente: `success:false` é o que ele guarda
    // na fila para reenviar. Medir só o 200 da rota deixaria passar um lote inteiro recusado.
    assert.equal(resultadosDoLote.length, 16, 'o lote acima precisa ter rodado');
    const semSucesso = resultadosDoLote.filter((r) => r.success !== true);
    assert.deepEqual(semSucesso.map((r) => r.reason), [], 'nenhuma op pode voltar sem sucesso');
    const semVersao = resultadosDoLote.filter((r) => !Number.isInteger(r.currentVersion) || r.currentVersion <= 0);
    assert.deepEqual(semVersao.map((r) => r.operationId), [], 'op sem versão é op logada sem efeito');
    assert.ok(versaoDoLote >= 16, `a versão do atlas avançou com o lote (${versaoDoLote})`);
  });

  it('o conteúdo legítimo está no banco, campo a campo, nas colunas que a fase apertou', async () => {
    const { rows: mapas } = await db.query(
      'SELECT name, grid_style, temporal_config, notes_title, notes_description, base_layer, zoom FROM maps WHERE id = $1',
      [mapa.id],
    );
    assert.equal(mapas.length, 1, 'o mapa existe');
    assert.match(mapas[0].name, /^Mapa renomeado/, 'o rename pegou');
    assert.deepEqual(mapas[0].grid_style, { format: 'utm', visible: true });
    assert.deepEqual(mapas[0].temporal_config, {
      ativo: true, unidade: 'horas', modo: 'absoluto',
      inicio: 1700000000000, fim: 1700003600000, origem: null,
    });
    assert.equal(mapas[0].notes_title, 'Notas do mapa');
    assert.equal(mapas[0].notes_description, 'Descrição livre da operação');
    assert.equal(mapas[0].base_layer, 'carta-topografica');
    assert.equal(Number(mapas[0].zoom), 14);

    const { rows: feicoes } = await db.query('SELECT properties FROM features WHERE id = $1', [idDaFeicao]);
    assert.equal(feicoes.length, 1, 'a feição foi criada');
    assert.deepEqual(feicoes[0].properties, {
      nome: 'Ponto legítimo', descricao: 'texto livre', visivel: true,
    }, 'as propriedades do domínio chegam inteiras: `features.properties` é VARRIDA, não fechada');

    const { rows: briefings } = await db.query('SELECT settings FROM briefings WHERE id = $1', [briefing.id]);
    assert.equal(briefings.length, 1, 'o briefing existe');
    assert.deepEqual(briefings[0].settings, {
      panelPosition: 'right', panelWidth: 420, panelBackgroundColor: '#ffffff',
    });

    const { rows: slides } = await db.query(
      'SELECT position, orientation, temporal_cursor FROM slides WHERE id = $1', [slide.id],
    );
    assert.equal(slides.length, 1, 'o slide existe');
    assert.deepEqual(slides[0].position, {
      longitude: -45.5, latitude: -20.25, zoom: 11, altitude: null,
    }, '`null` é valor, não ausência: um campo fechado não pode comê-lo');
    assert.deepEqual(slides[0].orientation, {
      bearing: 33, pitch: -25, heading: null, lon: null, lat: null, fov: null,
    });
    assert.equal(Number(slides[0].temporal_cursor), 1700001800000);

    const { rows: comentarios } = await db.query('SELECT data FROM comments WHERE id = $1', [idDoComentario]);
    assert.equal(comentarios.length, 1, 'o comentário foi criado');
    assert.equal(comentarios[0].data.text, 'Comentário espacial');
    assert.equal(comentarios[0].data.status, 'open');

    const { rows: tresD } = await db.query('SELECT data, tileset_id FROM cesium3d_data WHERE id = $1', [idDoMarcador3d]);
    assert.equal(tresD.length, 1, 'o marcador 3D foi criado');
    assert.equal(tresD[0].tileset_id, TILESET_PUBLICO);
    assert.deepEqual(tresD[0].data.position, { longitude: -43.2, latitude: -22.9, height: 150 });
    assert.deepEqual(tresD[0].data.properties, { name: 'Alvo', color: '#ff0000' });

    const { rows: trezentos } = await db.query(
      'SELECT data, photo_name FROM streetview360_data WHERE id = $1', [idDaOrientacao360],
    );
    assert.equal(trezentos.length, 1, 'a orientação 360 foi criada');
    assert.equal(trezentos[0].photo_name, FOTO_PUBLICA);
    assert.equal(trezentos[0].data.heading, 120);

    const { rows: atlasRows } = await db.query('SELECT settings FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(atlasRows.length, 1, 'o atlas existe');
    assert.deepEqual(atlasRows[0].settings.customIcons, [{
      id: `icone-${sufixo}`, name: 'Ícone da OM', thumbnail: 'data:image/png;base64,AAA',
      type: 'png', createdAt: 1700000000000,
    }], 'o registro de ícones é uma LISTA DE OBJETOS e `atlas.settings` é varrida, não fechada');
  });

  it('a fila continua drenando: o lote seguinte é aceito e a versão avança de novo', async () => {
    // O sintoma de uma recusa nova não é um erro, é uma fila que nunca esvazia. O que se pode
    // medir do lado do servidor é que o próximo lote do MESMO cliente passa e move a versão.
    const dados = await push(tokenDono, [op({
      entityType: 'feature', operationType: 'update', entityId: idDaFeicao, mapId: mapa.id,
      changes: { properties: { nome: 'Ponto legítimo', descricao: 'editado' } },
    })]);

    assert.equal(dados.acks.length, 1);
    assert.equal(dados.acks[0].rejected, undefined, 'a op seguinte também não é recusada');
    assert.ok(
      dados.serverVersion > versaoDoLote,
      `a versão precisa avançar (${versaoDoLote} -> ${dados.serverVersion})`,
    );

    const { rows } = await db.query('SELECT properties FROM features WHERE id = $1', [idDaFeicao]);
    assert.equal(rows[0].properties.descricao, 'editado');
  });

  // ============================================================================================
  // (2) O HILLSHADE CHEGA PARA TODO MUNDO
  // ============================================================================================

  it('o relevo ATRAVESSOU a borda de escrita: a definição estática dele foi gravada', async () => {
    const { rows } = await db.query(
      'SELECT data FROM catalog_layers WHERE map_id = $1 AND id = $2', [mapa.id, 'hillshade'],
    );
    assert.equal(rows.length, 1, 'a entrada do relevo foi criada pela op do lote');
    assert.deepEqual(
      rows[0].data, entradaDoRelevo(),
      'a entrada do relevo É `{name, config.source.url}`: barrá-la na escrita tiraria o relevo '
      + 'sombreado do mapa de todo mundo. É o teto declarado da fase, não um esquecimento.',
    );
  });

  it('e SAI inteiro para os três principais: dono, membro com `read` e visitante ANÔNIMO', async () => {
    const principais = [
      ['dono', tokenDono],
      ['membro com read', tokenMembro],
      ['visitante anônimo de link público', tokenVisitante],
    ];
    assert.equal(principais.length, 3, 'os três principais da superfície');

    for (const [quem, token] of principais) {
      const snap = await snapshot(token);
      const entradas = camadasDeCatalogo(snap);
      const relevo = entradas.find((c) => c.id === 'hillshade');
      assert.ok(relevo, `${quem}: a entrada do relevo precisa chegar`);
      assert.equal(relevo.name, 'Sombreamento do Relevo', `${quem}: com o nome`);
      assert.equal(relevo.config.source.url, URL_HILLSHADE, `${quem}: e com a definição estática`);
      assert.equal(relevo.visible, true, `${quem}: e com o estado por atlas`);

      // A DISCRIMINAÇÃO, na MESMA resposta: a entrada vizinha, que reclama um recurso de catálogo,
      // perde a cópia velha que o cliente guardou. Sem esta metade, o caso acima passaria num
      // servidor que devolve tudo, e não haveria diferença entre "o relevo é poupado" e "nada é
      // podado".
      const privada = entradas.find((c) => c.id === ID_ENTRADA_PRIVADA);
      assert.ok(privada, `${quem}: a entrada privada continua sendo servida como referência`);
      assert.ok(
        !JSON.stringify(snap).includes(URL_COPIA_VELHA),
        `${quem}: a cópia velha guardada pelo cliente não sai para ninguém`,
      );
    }
  });

  it('e a URL viva do recurso PRIVADO não sai para quem não o alcança', async () => {
    const forasteiros = [
      ['membro com read', tokenMembro],
      ['visitante anônimo de link público', tokenVisitante],
    ];
    assert.equal(forasteiros.length, 2, 'os dois principais sem concessão sobre o recurso');

    for (const [quem, token] of forasteiros) {
      const snap = await snapshot(token);
      const privada = camadasDeCatalogo(snap).find((c) => c.id === ID_ENTRADA_PRIVADA);
      assert.equal(privada.config, undefined, `${quem}: a entrada privada chega sem definição`);
      assert.ok(
        !JSON.stringify(snap).includes(URL_PRIVADA_VIVA),
        `${quem}: a URL viva do recurso privado VAZOU`,
      );
      // E o relevo, na mesma resposta, continua lá: é o par que separa "a poda respeita o acesso"
      // de "a poda cortou tudo que tem `config`".
      assert.equal(
        camadasDeCatalogo(snap).find((c) => c.id === 'hillshade').config.source.url, URL_HILLSHADE,
        `${quem}: o relevo continua inteiro na mesma resposta`,
      );
    }
  });
});
