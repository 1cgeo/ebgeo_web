// Path: tests/integration/recibo-canonico-por-entidade.test.js
//
// O QUE ESTE ARQUIVO PRENDE (B5, item 3). Até 2026-09-13 uma recusa por conflito de entidade
// devolvia a revisão da linha e `serverData: null`, e o comentário que deixava o nulo dizia por
// quê: publicar um canônico sem serializador seria devolver o documento do REMETENTE com cara de
// aval do servidor. O painel de pendências ficava com metade do par para desenhar (o que o autor
// escreveu, nunca o que o servidor guarda), e a estreitada da escrita do item 4 ficava insegura
// pelo mesmo motivo. `entity-canonical.js` fecha os dois: um serializador por entidade, lendo a
// linha VIVA e nada mais.
//
// A ASSERÇÃO QUE VALE, e é a mesma em todos os casos: A escreve um valor, C tenta escrever OUTRO a
// partir da base velha e é recusada, e o `serverData` do recibo carrega o valor de A. Comparar o
// `serverData` com o payload de C é o que distingue "o servidor leu a linha" de "o servidor
// devolveu o que você mandou": um eco passaria verde numa asserção que só conferisse a forma.
//
// CONTROLE NEGATIVO, medido em 2026-09-13 fazendo `canonicalEntityData` devolver `null` sempre:
// ficam VERMELHOS os 9 casos por entidade mais o do túmulo; o estrutural segue verde, porque ele
// mede a TABELA de leitores e não o que ela produz. É por isso que os dois existem: o estrutural
// reprova a entidade nova sem serializador, e os por entidade reprovam o serializador que mente.
//
// O QUE ELE NÃO MEDE, declarado para não ser relido como promessa: a poda de definição de recurso
// que o limite de saída aplica (`middleware/prune-resource-payload.js`) não passa por aqui, porque
// estes casos leem o corpo da resposta HTTP DEPOIS da poda e nenhum deles semeia uma definição
// privada. Quem mede aquilo é `tests/unit/superficies-de-recurso-censo.test.js` e a suíte de poda.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createLayer, createGroup,
  createBriefing, createSlide, createStreetview360Data, loginUser,
} from '../helpers/fixtures.js';
import { DISPUTE_UNITS } from '../../src/modules/sync/entity-conflicts.js';
import { hasCanonicalSerializer } from '../../src/modules/sync/entity-canonical.js';

const EXCLUIDO = 'O item foi excluido no servidor.';

describe('B5.3 — o recibo de conflito carrega a operação canônica da entidade', () => {
  let app, db, token, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const owner = await createUser(db, { username: 'canonico_owner' });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Recibo canonico' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations })
      .expect(200);

  const uma = async (extra) => (await push([{
    protocolVersion: 2, id: randomUUID(), timestamp: Date.now(), clientId: 'c-canonico', ...extra,
  }])).body.data.acks[0];

  const versaoDe = async (tabela, id) => {
    const { rows } = await db.query(`SELECT version FROM ${tabela} WHERE id = $1`, [id]);
    assert.equal(rows.length, 1, `a linha de ${tabela} existe (uma só)`);
    return Number(rows[0].version);
  };

  /**
   * O roteiro comum: A escreve da base, C tenta da MESMA base e é recusada, e o que volta em
   * `serverData` é a linha de A.
   *
   * @param {Object} caso
   * @param {string} caso.nome - Alvo, para as mensagens.
   * @param {string} caso.tabela - Tabela da linha.
   * @param {string} caso.id - Id da linha.
   * @param {function(string, number): Object} caso.escrita - Envelope de quem escreve.
   * @param {function(Object): *} caso.leitura - O campo disputado, lido do `serverData`.
   */
  const parDeEscritas = async ({ nome, tabela, id, escrita, leitura }) => {
    const base = await versaoDe(tabela, id);

    const aplicado = await uma(escrita('valor de A', base));
    assert.equal(aplicado.rejected, undefined,
      `${nome}: a escrita de A entrou (motivo: ${aplicado.reason})`);

    const recusado = await uma(escrita('valor de C', base));
    assert.equal(recusado.rejected, true, `${nome}: C da base velha é recusada`);
    assert.equal(recusado.status, 'conflict', `${nome}: pelo canal de conflito`);

    const servidor = recusado.conflict.serverData;
    assert.ok(servidor && typeof servidor === 'object',
      `${nome}: a recusa carrega o documento do servidor, e não mais um nulo`);
    assert.equal(leitura(servidor), 'valor de A',
      `${nome}: e o documento é a LINHA VIVA (o valor de A), nunca o payload de C ecoado de volta`);
    assert.notEqual(leitura(servidor), 'valor de C',
      `${nome}: se isto falhar, o servidor está devolvendo o documento do remetente com aval dele`);
    assert.equal(servidor.id, id, `${nome}: e ele nomeia a própria entidade`);
    assert.equal(recusado.conflict.entityVersion, base + 1,
      `${nome}: a versão do recibo é a que a linha realmente tem`);
    return servidor;
  };

  // ==========================================================================
  // ESTRUTURAL — entidade com unidade de disputa tem serializador canônico
  // ==========================================================================

  it('ESTRUTURAL: toda entidade que pode conflitar tem serializador canônico', () => {
    // ESTE É O CASO QUE FECHA A PORTA PARA A PRÓXIMA ENTIDADE. `DISPUTE_UNITS` é a lista do que
    // pode ser recusado por conflito; sem um leitor correspondente, a recusa daquela entidade
    // volta a ser meio par, e nada fica vermelho: `serverData: null` é resposta bem-formada.
    const alvos = Object.keys(DISPUTE_UNITS);
    assert.ok(alvos.length >= 9, 'a varredura não é vácua (nove alvos com unidade em 2026-09-13)');
    const semLeitor = alvos.filter((alvo) => !hasCanonicalSerializer(alvo));
    assert.deepEqual(semLeitor, [],
      'alvo que pode conflitar e não sabe se serializar: a recusa dele nasce sem o lado do servidor');
    // Controle absoluto nos dois sentidos: `feature` tem canônico PRÓPRIO (`canonicalFeature`, em
    // `feature-conflicts.js`) e não deve aparecer nesta tabela, senão haveria dois donos da
    // projeção GeoJSON.
    assert.equal(hasCanonicalSerializer('feature'), false,
      'a feição não entra aqui: quem a projeta é `canonicalFeature`');
    assert.equal(hasCanonicalSerializer('group_feature'), false,
      'membresia não é linha com documento, e não conflita');
  });

  // ==========================================================================
  // UMA ENTIDADE POR CASO
  // ==========================================================================

  it('MAPA: o canônico é a linha do mapa, sem arrastar as feições dela', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa canonico' });
    const servidor = await parDeEscritas({
      nome: 'map', tabela: 'maps', id: map.id,
      escrita: (quem, baseVersion) => ({
        type: 'update', target: 'map', targetId: map.id, baseVersion, changes: { name: quem },
      }),
      leitura: (doc) => doc.name,
    });
    // OS FILHOS FICAM DE FORA, de propósito: a recusa roda dentro do savepoint por operação, sob a
    // trava de escrita do atlas, e puxar a coleção de feições do mapa poria o custo de um snapshot
    // em cada recusa. O que a linha do mapa tem é o que viaja.
    assert.equal(servidor.features, undefined, 'sem as feições');
    assert.equal(servidor.layers, undefined, 'sem as camadas');
    assert.equal(servidor.sync.deleted, false, 'e o mapa não é um túmulo');
    assert.ok(Number.isInteger(servidor.sync.createdAt), 'com o bloco de sync que o snapshot emite');
  });

  it('CAMADA: o canônico usa `order`, o nome que o cliente lê, nunca `sort_order`', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa da camada canonica' });
    const layer = await createLayer(db, map.id, { name: 'Camada canonica' });
    const servidor = await parDeEscritas({
      nome: 'layer', tabela: 'layers', id: layer.id,
      escrita: (quem, baseVersion) => ({
        type: 'update', target: 'layer', targetId: layer.id, mapId: map.id, baseVersion,
        changes: { name: quem },
      }),
      leitura: (doc) => doc.name,
    });
    assert.equal(servidor.sort_order, undefined,
      'o cliente não conhece `sort_order`: o snapshot renomeia, e este canônico tem de renomear igual');
    assert.ok(Object.hasOwn(servidor, 'order'), 'a ordem viaja como `order`');
  });

  it('GRUPO: o canônico carrega a MEMBRESIA, que é o único filho que não pode faltar', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa do grupo canonico' });
    const group = await createGroup(db, map.id, { name: 'Grupo canonico' });
    const featureId = randomUUID();
    await db.query(
      `INSERT INTO features (id, map_id, feature_type, geometry, properties)
       VALUES ($1, $2, 'point', $3::jsonb, '{}'::jsonb)`,
      [featureId, map.id, JSON.stringify({ type: 'Point', coordinates: [-43.2, -22.9] })],
    );
    await db.query('INSERT INTO group_features (group_id, feature_id) VALUES ($1, $2)',
      [group.id, featureId]);

    const servidor = await parDeEscritas({
      nome: 'group', tabela: 'groups', id: group.id,
      escrita: (quem, baseVersion) => ({
        type: 'update', target: 'group', targetId: group.id, mapId: map.id, baseVersion,
        changes: { name: quem },
      }),
      leitura: (doc) => doc.name,
    });
    // POR QUE ESTE FILHO VIAJA E OS OUTROS NÃO: `applyRemoteGroupOp` substitui o documento do
    // grupo INTEIRO, então um canônico sem membresia esvaziaria o grupo em todo par que o
    // aplicasse. O grupo é a exceção declarada no cabeçalho de `entity-canonical.js`.
    assert.deepEqual(servidor.features, [{ type: 'point', id: featureId }],
      'a membresia vem da tabela de junção, que é o único lugar onde ela mora');
  });

  it('BRIEFING: o canônico traz `slide_order` e não os slides', async () => {
    const briefing = await createBriefing(db, atlas.id, { name: 'Briefing canonico' });
    const servidor = await parDeEscritas({
      nome: 'briefing', tabela: 'briefings', id: briefing.id,
      escrita: (quem, baseVersion) => ({
        type: 'update', target: 'briefing', targetId: briefing.id, baseVersion,
        changes: { name: quem },
      }),
      leitura: (doc) => doc.name,
    });
    assert.ok(Object.hasOwn(servidor, 'slide_order'),
      'a ordem dos slides é COLUNA do briefing, e é uma das unidades em disputa dele');
    assert.equal(servidor.slides, undefined, 'os slides são entidades próprias e não viajam aqui');
  });

  it('SLIDE: o canônico traduz `map_id` para o NOME do mapa, como o snapshot', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa do slide canonico' });
    const briefing = await createBriefing(db, atlas.id, { name: 'Briefing do slide' });
    const slide = await createSlide(db, briefing.id, { title: 'Slide canonico', map_id: map.id });
    await db.query('UPDATE briefings SET slide_order = $1::uuid[] WHERE id = $2',
      [[slide.id], briefing.id]);

    const servidor = await parDeEscritas({
      nome: 'slide', tabela: 'slides', id: slide.id,
      escrita: (quem, baseVersion) => ({
        type: 'update', target: 'slide', targetId: slide.id, mapId: briefing.id, baseVersion,
        changes: { title: quem },
      }),
      leitura: (doc) => doc.title,
    });
    // O `mapId` DO CLIENTE É UM NOME. O editor de briefing casa esse campo com um `<option
    // value=nome>` e o apresentador o compara com o nome do mapa corrente: devolver o UUID cru
    // faria o slide parar de trocar de mapa durante a apresentação, sem erro nenhum.
    assert.equal(servidor.mapId, 'Mapa do slide canonico', 'o NOME, não o UUID');
    assert.equal(servidor.slide_order, undefined,
      'a ordem é do BRIEFING: ela entrou no SELECT só para calcular `order`');
    assert.equal(servidor.order, 0, 'e o índice do slide na ordem do briefing veio junto');
  });

  it('COMENTÁRIO: o canônico espalha o `data` e o autor vem da COLUNA', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa do comentario' });
    const id = randomUUID();
    await uma({
      type: 'create', target: 'comment', targetId: id, mapId: map.id,
      data: { lng: -43.2, lat: -22.9, texto: 'original', authorId: 'mentira-do-cliente' },
    });
    const servidor = await parDeEscritas({
      nome: 'comment', tabela: 'comments', id,
      escrita: (quem, baseVersion) => ({
        type: 'update', target: 'comment', targetId: id, mapId: map.id, baseVersion,
        changes: { texto: quem },
      }),
      leitura: (doc) => doc.texto,
    });
    assert.notEqual(servidor.authorId, 'mentira-do-cliente',
      'o autor autoritativo é a COLUNA, e ela é escrita a partir do principal autenticado');
    assert.equal(servidor.mapId, map.id, 'o mapa vem em camelCase, como no snapshot');
    assert.equal(servidor.status, 'open', 'e o estado da linha viaja junto');
  });

  it('CAMADA DE CATÁLOGO: o canônico serializa a linha de id TEXT', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa do catalogo canonico' });
    const id = 'camada-canonica-de-teste';
    await db.query('INSERT INTO catalog_layers (id, map_id, data) VALUES ($1, $2, $3::jsonb)',
      [id, map.id, JSON.stringify({ nome: 'original' })]);
    await parDeEscritas({
      nome: 'catalog_layer', tabela: 'catalog_layers', id,
      escrita: (quem, baseVersion) => ({
        operationType: 'update', entityType: 'catalogLayer', entityId: id, mapId: map.id,
        baseVersion, changes: { nome: quem },
      }),
      leitura: (doc) => doc.nome,
    });
  });

  it('3D: o canônico é a entrada plana `{id, tilesetId, ...data}`', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa do 3D canonico' });
    const id = randomUUID();
    // `tileset_id: null` de propósito: uma medição não referencia recurso de catálogo, então o
    // caso mede o canônico e não o gate de visibilidade de recurso.
    await uma({
      type: 'create', target: 'cesium3d', targetId: id, mapId: map.id,
      data: { data_type: 'measurement', tileset_id: null, data: { autor: 'original' } },
    });
    const servidor = await parDeEscritas({
      nome: 'cesium3d', tabela: 'cesium3d_data', id,
      escrita: (quem, baseVersion) => ({
        type: 'update', target: 'cesium3d', targetId: id, mapId: map.id, baseVersion,
        changes: { data: { autor: quem } },
      }),
      leitura: (doc) => doc.autor,
    });
    assert.ok(Object.hasOwn(servidor, 'tilesetId'),
      'a chave própria da linha viaja em camelCase, como o snapshot a emite');
    assert.equal(servidor.tileset_id, undefined, 'e nunca em snake_case ao lado dela');
  });

  it('360: o canônico é a entrada plana `{id, photoName, ...data}`', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa do 360 canonico' });
    const row = await createStreetview360Data(db, map.id, { data: { autor: 'original' } });
    const servidor = await parDeEscritas({
      nome: 'streetview360', tabela: 'streetview360_data', id: row.id,
      escrita: (quem, baseVersion) => ({
        type: 'update', target: 'streetview360', targetId: row.id, mapId: map.id, baseVersion,
        changes: { data: { autor: quem } },
      }),
      leitura: (doc) => doc.autor,
    });
    assert.equal(servidor.photoName, 'foto-001', 'a foto que a orientação descreve, em camelCase');
  });

  // ==========================================================================
  // TÚMULO — a recusa que mais precisa do outro lado do par
  // ==========================================================================

  it('TÚMULO: a recusa por exclusão no servidor também carrega o documento, com `deleted`', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa que sera excluido' });
    await db.query('UPDATE maps SET deleted_at = NOW() WHERE id = $1', [map.id]);

    // SEM BASE DE PROPÓSITO: este é o caminho de `tombstoneConflict`, que responde por toda op dos
    // sete alvos guardados, tenha ela declarado base ou não.
    const ack = await uma({
      type: 'update', target: 'map', targetId: map.id, changes: { name: 'Tarde demais' },
    });
    assert.equal(ack.rejected, true, 'a edição sobre o túmulo é recusada');
    assert.equal(ack.reason, EXCLUIDO, 'com a frase do vocabulário compartilhado');
    assert.ok(ack.conflict.serverData, 'e agora com o documento, que antes era nulo aqui também');
    assert.equal(ack.conflict.serverData.name, 'Mapa que sera excluido',
      'o nome que a linha tinha quando morreu, que é o que a pessoa reconhece na tela');
    assert.equal(ack.conflict.serverData.sync.deleted, true,
      'o túmulo viaja em `sync.deleted`: é por isso que o serializador NÃO filtra `deleted_at`');
    assert.equal(ack.conflict.serverData.deleted_at, undefined,
      'e não como coluna solta ao lado, que o reshape do cliente teria de aprender a ignorar');
  });
});
