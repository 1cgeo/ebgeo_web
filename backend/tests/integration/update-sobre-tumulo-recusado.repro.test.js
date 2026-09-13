// Path: tests/integration/update-sobre-tumulo-recusado.repro.test.js
//
// CAUSA RAIZ (F8, achado do fechamento 03). Base e revisão valiam só para feição, por um gate
// LITERAL por alvo (`rawOp.protocolVersion === 2 && op.target === 'feature'`), então `map`,
// `cesium3d` e `streetview360` iam direto para o seu statement:
//
//   - o UPDATE rodava contra linha já excluída. `buildUpdateQuery` não filtrava `deleted_at`,
//     de modo que a escrita CAÍA. MEDIDO em 2026-09-13, revertendo a guarda e relendo as linhas:
//     um mapa excluído e depois renomeado por op antiga voltou com `name: 'Renomeado tarde'`,
//     `version` 2→3 e `deleted_at` ainda posto, com ack `status: 'applied'`; a linha 3D do mesmo
//     jeito, `data.distance` de 100 para 999. Quem depois restaurasse lia uma edição feita
//     DEPOIS da exclusão, e ninguém era avisado. Com o filtro, o update passa a tocar zero
//     linhas, e zero linhas num update é ACK DE SUCESSO (só `rowsAffected === 0 && create`
//     lança, desde f8e109ea): silêncio nos dois arranjos, e é por isso que o filtro sozinho não
//     é o conserto.
//   - o CREATE de 3D/360 era `ON CONFLICT (id) DO NOTHING`, então recriar sobre túmulo (ou
//     sobre linha viva) não escrevia nada. Desde f8e109ea isso deixou de ser mudo, mas o que ele
//     diz é a frase genérica de 23503, "Alteração descartada: referencia um item que não existe
//     mais." (medida na mesma rodada) — uma frase sobre REFERÊNCIA ausente, para uma linha que
//     existe e está no caminho.
//
// O CONSERTO é `tombstoneConflict` (`sync.service.js`), que lê a linha sob a trava de escrita
// do atlas, ANTES do insert no log, e recusa POR OPERAÇÃO pelo mesmo canal `conflict` da
// feição, com as MESMAS palavras (`RAZAO_*`, `feature-conflicts.js`), mais o filtro
// `deleted_at IS NULL` no statement como cinto e suspensório.
//
// O QUE CONTINUA COMO ANTES, de propósito, e este arquivo o MEDE para que uma mudança futura
// apareça: linha que NÃO EXISTE. Um update nomeando linha ausente monta o statement, toca zero
// linhas e é acked como aplicado. Distinguir "nunca existiu" de "existiu e foi-se" exige a
// linha de revisão durável do passo 2 do B5: o log de operações é expurgável, então ausência
// não prova nada, e recusar por ausência hoje transformaria todo par create/update fora de
// ordem numa recusa permanente.
//
// CONTROLE NEGATIVO, por entidade: tirar um alvo de `TOMBSTONE_GUARDED_TARGETS` deixa vermelho o
// caso daquela entidade e SÓ dele. Medido em 2026-09-13 para os sete: `map` 2 vermelhos,
// `cesium3d` 3, `streetview360` 2, e `group`, `layer`, `briefing` e `slide` 1 cada (15 de 16
// verdes em cada uma das quatro rodadas). Removendo SÓ as cláusulas `deleted_at IS NULL` dos
// quatro statements novos: 16 verdes, que é a prova de que elas são cinto e suspensório e não a
// guarda. Pondo `layer` em `CREATE_OVER_EXISTING_REFUSED`: vermelho aqui no caso dos quatro
// desfazeres E em `sync-service-coverage` ("soft-delete then re-create with same id resurrects").

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, loginUser,
  seedPublic360Photos, drop360Fixture,
} from '../helpers/fixtures.js';

// The 360 payloads carry a `photo_name`, and `unseenResourceDenialReason` refuses an op whose
// reference does not resolve to a resource the author can SEE. Here the reference is only
// SCENERY: it exists and is public. The gate itself is measured elsewhere
// (`sync-referencia-privada.test.js`). Root hook because the seed belongs to the whole file and
// the `sv360` schema is shared by the suite.
const FOTOS_360 = ['foto-tumulo-001', 'foto-tumulo-002'];
let refs360;

before(async () => {
  const env = await setupTestEnv();
  refs360 = await seedPublic360Photos(env.db, FOTOS_360);
  await teardownTestEnv(env.db);
});

after(async () => {
  const env = await setupTestEnv();
  await drop360Fixture(env.db, refs360);
  await teardownTestEnv(env.db);
});

describe('F8 — mapa, 3D e 360 recusam escrita sobre linha excluída, com motivo', () => {
  let app, db, token, atlas;

  const EXCLUIDO = 'O item foi excluido no servidor.';
  const CRIACAO_NAO_RESTAURA = `${EXCLUIDO} A criacao antiga nao pode restaura-lo.`;
  const EM_USO = 'Ja existe um item com este identificador.';

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const owner = await createUser(db, { username: 'tumulo_owner' });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Tumulos' });
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

  const envelope = (extra) => ({
    protocolVersion: 2,
    id: randomUUID(),
    timestamp: Date.now(),
    clientId: 'c-tumulo',
    ...extra,
  });

  /** The one assertion shape for "refused, and the words say why". */
  const recusa = (ack, motivo) => {
    assert.equal(ack.rejected, true, `a op foi recusada (motivo recebido: ${ack.reason})`);
    assert.equal(ack.reason, motivo, 'e o motivo é o do vocabulário da feição');
    assert.equal(ack.status, 'conflict', 'pelo canal de conflito, não pelo de política');
    assert.equal(ack.conflict.deleted, true, 'o conflito diz que a linha está excluída');
    assert.ok(Number.isInteger(ack.conflict.entityVersion),
      'e carrega a versão que uma nova tentativa precisa');
  };

  const linhaDe = async (tabela, id) => {
    const { rows } = await db.query(
      `SELECT version, deleted_at FROM ${tabela} WHERE id = $1`, [id],
    );
    assert.equal(rows.length, 1, `a linha de ${tabela} existe (uma só)`);
    return rows[0];
  };

  // ==========================================================================
  // MAPA
  // ==========================================================================

  it('MAPA: o update antigo sobre mapa excluído é recusado, e não reescreve o túmulo', async () => {
    const map = await createMap(db, atlas.id, { name: 'Vai ser excluido' });

    await push([envelope({ type: 'delete', target: 'map', targetId: map.id })]);
    const apagado = await linhaDe('maps', map.id);
    assert.ok(apagado.deleted_at, 'pré-condição: o mapa está excluído');

    const res = await push([envelope({
      type: 'update', target: 'map', targetId: map.id, changes: { name: 'Renomeado tarde' },
    })]);
    recusa(res.body.data.acks[0], EXCLUIDO);

    const depois = await linhaDe('maps', map.id);
    assert.equal(depois.version, apagado.version, 'a versão do túmulo não andou');
    assert.equal(depois.deleted_at.getTime(), apagado.deleted_at.getTime(),
      'e é a MESMA exclusão');
    const { rows } = await db.query('SELECT name FROM maps WHERE id = $1', [map.id]);
    assert.notEqual(rows[0].name, 'Renomeado tarde', 'o nome velho não entrou no túmulo');
  });

  it('MAPA: a sub-entidade também é recusada, pelo mesmo motivo', async () => {
    // `mapPosition` endereça o mapa por `mapId`, não por `targetId`: o caminho de leitura da
    // guarda tem de fazer a mesma divisão que `buildUpdateQuery`, senão a sub-entidade escapa.
    const map = await createMap(db, atlas.id, { name: 'Subtipo sobre tumulo' });
    await push([envelope({ type: 'delete', target: 'map', targetId: map.id })]);

    const res = await push([envelope({
      operationType: 'update', entityType: 'mapPosition', entityId: map.id, mapId: map.id,
      data: { center_lat: -22.9, center_long: -43.2, zoom: 12, bearing: 0, pitch: 0 },
    })]);
    recusa(res.body.data.acks[0], EXCLUIDO);

    const { rows } = await db.query('SELECT zoom FROM maps WHERE id = $1', [map.id]);
    assert.notEqual(rows[0].zoom, 12, 'a posição não foi gravada no túmulo');
  });

  it('MAPA: o mapa VIVO continua aceitando update (controle absoluto)', async () => {
    const map = await createMap(db, atlas.id, { name: 'Vivo' });
    const antes = await linhaDe('maps', map.id);

    const res = await push([envelope({
      type: 'update', target: 'map', targetId: map.id, changes: { name: 'Vivo e renomeado' },
    })]);
    assert.equal(res.body.data.acks[0].rejected, undefined, 'nada é recusado no caminho normal');

    const { rows } = await db.query('SELECT name, version FROM maps WHERE id = $1', [map.id]);
    assert.equal(rows[0].name, 'Vivo e renomeado', 'o nome novo entrou');
    assert.equal(rows[0].version, antes.version + 1, 'e a versão andou uma vez');
  });

  it('MAPA: o create sobre túmulo continua RESSUSCITANDO, porque ele é o desfazer', async () => {
    // O guarda contra "completar" a guarda pondo `map` em `CREATE_OVER_EXISTING_REFUSED`. O
    // Ctrl+Z de uma exclusão reenvia um create com o MESMO id, e o servidor tem de reviver a
    // linha: é o contrato que `layer`, `group`, `map`, `briefing` e `slide` compartilham. Medido
    // em 2026-09-13: com `map` no conjunto do create, `sync-service-coverage.test.js` fica
    // vermelho em "map is revived: deleted_at cleared", e o desfazer do usuário some em silêncio.
    const map = await createMap(db, atlas.id, { name: 'Vai voltar' });
    await push([envelope({ type: 'delete', target: 'map', targetId: map.id })]);
    assert.ok((await linhaDe('maps', map.id)).deleted_at, 'pré-condição: excluído');

    const res = await push([envelope({
      type: 'create', target: 'map', targetId: map.id, data: { name: 'Ressuscitado' },
    })]);
    assert.equal(res.body.data.acks[0].rejected, undefined, 'o desfazer não é recusado');

    const { rows } = await db.query('SELECT name, deleted_at FROM maps WHERE id = $1', [map.id]);
    assert.equal(rows[0].deleted_at, null, 'a linha voltou viva');
    assert.equal(rows[0].name, 'Ressuscitado', 'e adotou a carga reenviada');
  });

  // ==========================================================================
  // 3D
  // ==========================================================================

  const criar3d = async (mapId, targetId) => push([envelope({
    type: 'create', target: 'cesium3d', targetId, mapId,
    // `tileset_id: null` de propósito: uma medição não referencia recurso de catálogo, então
    // este caso mede o túmulo e não o gate de visibilidade.
    data: { data_type: 'measurement', tileset_id: null, data: { distance: 100 } },
  })]);

  it('3D: update sobre linha excluída é recusado, e a linha não é reescrita', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa do 3D' });
    const id = randomUUID();
    await criar3d(map.id, id);
    await push([envelope({ type: 'delete', target: 'cesium3d', targetId: id, mapId: map.id })]);

    const apagado = await linhaDe('cesium3d_data', id);
    assert.ok(apagado.deleted_at, 'pré-condição: a entidade 3D está excluída');

    const res = await push([envelope({
      type: 'update', target: 'cesium3d', targetId: id, mapId: map.id,
      changes: { data: { distance: 999 } },
    })]);
    recusa(res.body.data.acks[0], EXCLUIDO);

    const depois = await linhaDe('cesium3d_data', id);
    assert.equal(depois.version, apagado.version, 'a versão do túmulo não andou');
    const { rows } = await db.query('SELECT data FROM cesium3d_data WHERE id = $1', [id]);
    assert.equal(rows[0].data.distance, 100, 'o dado velho do túmulo ficou como estava');
  });

  it('3D: create sobre túmulo é recusado NOMEANDO a exclusão, não um destino ausente', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa do 3D recriado' });
    const id = randomUUID();
    await criar3d(map.id, id);
    await push([envelope({ type: 'delete', target: 'cesium3d', targetId: id, mapId: map.id })]);

    const res = await push([envelope({
      type: 'create', target: 'cesium3d', targetId: id, mapId: map.id,
      data: { data_type: 'measurement', tileset_id: null, data: { distance: 777 } },
    })]);
    const ack = res.body.data.acks[0];
    recusa(ack, CRIACAO_NAO_RESTAURA);
    // A frase que este caso substitui, MEDIDA em 2026-09-13 com a guarda revertida: o create
    // caía no `DO NOTHING`, zero linhas viravam 23503 e o cliente recebia o texto genérico de
    // `PG_INTEGRITY_REASONS` sobre REFERÊNCIA ausente, para uma linha que existe e está no caminho.
    assert.notEqual(ack.reason, 'Alteração descartada: referencia um item que não existe mais.',
      'e NÃO é mais a frase genérica de integridade sobre referência ausente');

    assert.ok((await linhaDe('cesium3d_data', id)).deleted_at, 'a exclusão sobrevive');
  });

  it('3D: create sobre linha VIVA é recusado por identificador em uso', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa do 3D duplicado' });
    const id = randomUUID();
    await criar3d(map.id, id);

    const res = await push([envelope({
      type: 'create', target: 'cesium3d', targetId: id, mapId: map.id,
      data: { data_type: 'measurement', tileset_id: null, data: { distance: 555 } },
    })]);
    const ack = res.body.data.acks[0];
    assert.equal(ack.rejected, true, 'o create duplicado é recusado');
    assert.equal(ack.reason, EM_USO, 'e a frase nomeia o identificador, não um destino');
    assert.equal(ack.conflict.deleted, false, 'o conflito diz que a linha está VIVA');

    const { rows } = await db.query('SELECT data FROM cesium3d_data WHERE id = $1', [id]);
    assert.equal(rows[0].data.distance, 100, 'e a linha viva não foi sobrescrita');
  });

  // ==========================================================================
  // 360
  // ==========================================================================

  const criar360 = async (mapId, targetId) => push([envelope({
    type: 'create', target: 'streetview360', targetId, mapId,
    data: { data_type: 'orientation', photo_name: FOTOS_360[0], data: { heading: 45 } },
  })]);

  it('360: update sobre linha excluída é recusado, e a linha não é reescrita', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa do 360' });
    const id = randomUUID();
    await criar360(map.id, id);
    await push([envelope({ type: 'delete', target: 'streetview360', targetId: id, mapId: map.id })]);

    const apagado = await linhaDe('streetview360_data', id);
    assert.ok(apagado.deleted_at, 'pré-condição: a entidade 360 está excluída');

    const res = await push([envelope({
      type: 'update', target: 'streetview360', targetId: id, mapId: map.id,
      changes: { data: { heading: 180 } },
    })]);
    recusa(res.body.data.acks[0], EXCLUIDO);

    const depois = await linhaDe('streetview360_data', id);
    assert.equal(depois.version, apagado.version, 'a versão do túmulo não andou');
    const { rows } = await db.query('SELECT data FROM streetview360_data WHERE id = $1', [id]);
    assert.equal(rows[0].data.heading, 45, 'o dado velho do túmulo ficou como estava');
  });

  it('360: create sobre túmulo é recusado NOMEANDO a exclusão', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa do 360 recriado' });
    const id = randomUUID();
    await criar360(map.id, id);
    await push([envelope({ type: 'delete', target: 'streetview360', targetId: id, mapId: map.id })]);

    const res = await push([envelope({
      type: 'create', target: 'streetview360', targetId: id, mapId: map.id,
      data: { data_type: 'orientation', photo_name: FOTOS_360[1], data: { heading: 300 } },
    })]);
    recusa(res.body.data.acks[0], CRIACAO_NAO_RESTAURA);

    const { rows } = await db.query(
      'SELECT photo_name, data FROM streetview360_data WHERE id = $1', [id],
    );
    assert.equal(rows[0].photo_name, FOTOS_360[0], 'nem a foto do create novo encostou no túmulo');
    assert.equal(rows[0].data.heading, 45, 'nem o dado dele');
  });

  it('360: a linha VIVA continua aceitando update (controle absoluto)', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa do 360 vivo' });
    const id = randomUUID();
    await criar360(map.id, id);
    const antes = await linhaDe('streetview360_data', id);

    const res = await push([envelope({
      type: 'update', target: 'streetview360', targetId: id, mapId: map.id,
      changes: { data: { heading: 90 } },
    })]);
    assert.equal(res.body.data.acks[0].rejected, undefined, 'nada é recusado no caminho normal');

    const depois = await linhaDe('streetview360_data', id);
    assert.equal(depois.version, antes.version + 1, 'a versão andou uma vez');
    const { rows } = await db.query('SELECT data FROM streetview360_data WHERE id = $1', [id]);
    assert.equal(rows[0].data.heading, 90, 'e o dado novo entrou');
  });

  // ==========================================================================
  // OS QUATRO QUE FALTAVAM: grupo, camada, briefing e slide (2026-09-13)
  //
  // Eram os últimos alvos cujo UPDATE caía DENTRO do túmulo. MEDIDO revertendo a entrada deles em
  // `TOMBSTONE_GUARDED_TARGETS` e relendo as linhas: uma camada excluída e depois renomeada por op
  // antiga voltava com o nome novo, `version` 2 para 3 e `deleted_at` ainda posto, com ack
  // `status: 'applied'` — uma edição feita DEPOIS da exclusão, esperando dentro do túmulo por quem
  // restaurasse a linha. O mesmo para grupo, briefing e slide.
  //
  // O CREATE DELES CONTINUA RESSUSCITANDO, e é o que o último caso desta seção prende: é o caminho
  // do desfazer, o mesmo contrato de `map`. Pôr qualquer um dos quatro em
  // `CREATE_OVER_EXISTING_REFUSED` deixa `sync-service-coverage.test.js` vermelho no caso de
  // revival daquela entidade.
  // ==========================================================================

  /** O arranjo é o mesmo nos quatro: criar pelo sync, excluir pelo sync, tentar o update antigo. */
  const tumuloRecusaUpdate = async ({ tabela, criar, excluir, atualizar, leitura, esperado }) => {
    const id = randomUUID();
    await criar(id);
    await excluir(id);
    const apagado = await linhaDe(tabela, id);
    assert.ok(apagado.deleted_at, `pré-condição: a linha de ${tabela} está excluída`);

    const res = await push([envelope(atualizar(id))]);
    recusa(res.body.data.acks[0], EXCLUIDO);

    const depois = await linhaDe(tabela, id);
    assert.equal(depois.version, apagado.version, 'a versão do túmulo não andou');
    assert.equal(depois.deleted_at.getTime(), apagado.deleted_at.getTime(), 'e é a MESMA exclusão');
    assert.equal(await leitura(id), esperado, 'o valor velho do túmulo ficou como estava');
  };

  it('GRUPO: o update antigo sobre grupo excluído é recusado, e não reescreve o túmulo', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa do grupo tumulo' });
    await tumuloRecusaUpdate({
      tabela: 'groups',
      criar: (id) => push([envelope({
        type: 'create', target: 'group', targetId: id, mapId: map.id, data: { name: 'Grupo vivo' },
      })]),
      excluir: (id) => push([envelope({ type: 'delete', target: 'group', targetId: id, mapId: map.id })]),
      atualizar: (id) => ({
        type: 'update', target: 'group', targetId: id, mapId: map.id,
        changes: { name: 'Renomeado tarde' },
      }),
      leitura: async (id) => (await db.query('SELECT name FROM groups WHERE id = $1', [id])).rows[0].name,
      esperado: 'Grupo vivo',
    });
  });

  it('CAMADA: o update antigo sobre camada excluída é recusado, e não reescreve o túmulo', async () => {
    const map = await createMap(db, atlas.id, { name: 'Mapa da camada tumulo' });
    await tumuloRecusaUpdate({
      tabela: 'layers',
      criar: (id) => push([envelope({
        type: 'create', target: 'layer', targetId: id, mapId: map.id, data: { name: 'Camada viva' },
      })]),
      excluir: (id) => push([envelope({ type: 'delete', target: 'layer', targetId: id, mapId: map.id })]),
      atualizar: (id) => ({
        type: 'update', target: 'layer', targetId: id, mapId: map.id,
        changes: { name: 'Renomeada tarde' },
      }),
      leitura: async (id) => (await db.query('SELECT name FROM layers WHERE id = $1', [id])).rows[0].name,
      esperado: 'Camada viva',
    });
  });

  it('BRIEFING: o update antigo sobre briefing excluído é recusado, e não reescreve o túmulo', async () => {
    await tumuloRecusaUpdate({
      tabela: 'briefings',
      criar: (id) => push([envelope({
        type: 'create', target: 'briefing', targetId: id, data: { name: 'Briefing vivo' },
      })]),
      excluir: (id) => push([envelope({ type: 'delete', target: 'briefing', targetId: id })]),
      atualizar: (id) => ({
        type: 'update', target: 'briefing', targetId: id, changes: { name: 'Renomeado tarde' },
      }),
      leitura: async (id) => (await db.query('SELECT name FROM briefings WHERE id = $1', [id])).rows[0].name,
      esperado: 'Briefing vivo',
    });
  });

  it('SLIDE: o update antigo sobre slide excluído é recusado, e não reescreve o túmulo', async () => {
    // O slide endereça o briefing pelo `mapId` do envelope, e é pelo briefing pai que a leitura da
    // linha alcança o atlas (slides não têm `atlas_id`).
    const briefingId = randomUUID();
    await push([envelope({
      type: 'create', target: 'briefing', targetId: briefingId, data: { name: 'Briefing dos slides' },
    })]);
    await tumuloRecusaUpdate({
      tabela: 'slides',
      criar: (id) => push([envelope({
        type: 'create', target: 'slide', targetId: id, mapId: briefingId,
        data: { briefing_id: briefingId, title: 'Slide vivo' },
      })]),
      excluir: (id) => push([envelope({ type: 'delete', target: 'slide', targetId: id, mapId: briefingId })]),
      atualizar: (id) => ({
        type: 'update', target: 'slide', targetId: id, mapId: briefingId,
        changes: { title: 'Retitulado tarde' },
      }),
      leitura: async (id) => (await db.query('SELECT title FROM slides WHERE id = $1', [id])).rows[0].title,
      esperado: 'Slide vivo',
    });
  });

  it('OS QUATRO: o create sobre túmulo continua RESSUSCITANDO, porque ele é o desfazer', async () => {
    // A guarda contra "completar" a guarda pondo qualquer um dos quatro em
    // `CREATE_OVER_EXISTING_REFUSED`. O Ctrl+Z de uma exclusão reenvia um create com o MESMO id.
    const map = await createMap(db, atlas.id, { name: 'Mapa dos desfazeres' });
    const briefingId = randomUUID();
    await push([envelope({
      type: 'create', target: 'briefing', targetId: briefingId, data: { name: 'Briefing do desfazer' },
    })]);

    const casos = [
      { tabela: 'groups', target: 'group', mapId: map.id, campo: 'name', dado: { name: 'Grupo renascido' } },
      { tabela: 'layers', target: 'layer', mapId: map.id, campo: 'name', dado: { name: 'Camada renascida' } },
      { tabela: 'briefings', target: 'briefing', mapId: undefined, campo: 'name',
        dado: { name: 'Briefing renascido' } },
      { tabela: 'slides', target: 'slide', mapId: briefingId, campo: 'title',
        dado: { briefing_id: briefingId, title: 'Slide renascido' } },
    ];
    assert.equal(casos.length, 4, 'os quatro alvos novos da guarda (senão o laço abaixo é vácuo)');

    for (const caso of casos) {
      const id = randomUUID();
      const criar = () => push([envelope({
        type: 'create', target: caso.target, targetId: id, mapId: caso.mapId, data: caso.dado,
      })]);
      await criar();
      await push([envelope({ type: 'delete', target: caso.target, targetId: id, mapId: caso.mapId })]);
      assert.ok((await linhaDe(caso.tabela, id)).deleted_at, `${caso.target}: pré-condição excluído`);

      const res = await criar();
      assert.equal(res.body.data.acks[0].rejected, undefined, `${caso.target}: o desfazer não é recusado`);
      const { rows } = await db.query(
        `SELECT deleted_at, ${caso.campo} AS valor FROM ${caso.tabela} WHERE id = $1`, [id],
      );
      assert.equal(rows[0].deleted_at, null, `${caso.target}: a linha voltou viva`);
      assert.equal(rows[0].valor, caso.dado[caso.campo], `${caso.target}: e adotou a carga reenviada`);
    }
  });

  // ==========================================================================
  // A METADE QUE NÃO MUDOU, medida para que uma mudança futura apareça
  // ==========================================================================

  it('LINHA AUSENTE: o update de uma entidade que não existe continua sendo acked como aplicado', async () => {
    // Comportamento de HOJE, inalterado por este lote: a guarda só fala sobre linha que EXISTE.
    // Sem revisão durável por entidade, ausência não distingue "nunca existiu" de "foi
    // excluída", e recusar por ausência quebraria todo par create/update fora de ordem.
    const map = await createMap(db, atlas.id, { name: 'Mapa das ausentes' });

    const res = await push([envelope({
      type: 'update', target: 'cesium3d', targetId: randomUUID(), mapId: map.id,
      changes: { data: { distance: 1 } },
    })]);
    const ack = res.body.data.acks[0];
    assert.equal(ack.rejected, undefined, 'não é recusa');
    assert.equal(ack.status, 'applied', 'é ack de aplicado, sobre zero linhas escritas');

    const semMapa = await push([envelope({
      type: 'update', target: 'map', targetId: randomUUID(), changes: { name: 'Fantasma' },
    })]);
    assert.equal(semMapa.body.data.acks[0].rejected, undefined,
      'o mapa inexistente também: mesma metade pendente');
  });
});
