// Path: tests/integration/sync-subentidade-de-mapa-como-create.test.js
//
// UMA SUB-ENTIDADE DE MAPA CHEGANDO COMO `create` TEM DE SER APLICADA, e nao recusada.
//
// O DEFEITO QUE ESTE ARQUIVO PRENDE, medido em producao local em 2026-09-16, com a frase que
// o usuario le na tela: "Alteracao descartada: campo obrigatorio ausente". Ligar a grade pela
// PRIMEIRA vez num mapa nunca chegava ao servidor.
//
// A cadeia inteira: `settings.operations.js:160` decide o tipo da op por
// `previousGridStyle ? UPDATE : CREATE`, entao a primeira gravacao da grade num mapa nasce
// como CREATE. O `gridStyle` roteia para `target: 'map'` (`ENTITY_TYPE_MAP`), e um `create` de
// mapa cai no UPSERT que insere a LINHA INTEIRA do mapa com `data.name` — que uma op de grade
// nao carrega. O Postgres avalia o NOT NULL da tupla proposta ANTES de resolver o
// `ON CONFLICT (id)`, entao nem o fato de o mapa ja existir salva: sai 23502 em `maps.name`,
// o lote inteiro volta recusado por integridade e o cliente e instruido a descartar a
// alteracao. Da segunda vez em diante a op vira UPDATE e passa, o que fazia o defeito parecer
// intermitente.
//
// O ALCANCE E A FAMILIA INTEIRA, e foi medido op a op: gridStyle, mapNotes, mapPosition,
// mapTemporal e baseLayer sao os cinco sub-tipos de `ENTITY_TYPE_MAP`, e os CINCO eram
// recusados como `create` e aplicados como `update`. Tres deles tem emissor de `create` no
// cliente hoje (grade e notas em `settings.operations.js`, posicao em `map.operations.js`), e
// os outros dois dependem so de um cliente antigo ou de uma refatoracao para chegar assim.
//
// POR QUE O CONSERTO E AQUI, e nao so no cliente: o cliente e a causa e sera corrigido, mas o
// navegador de quem ja usa o sistema continua emitindo `create`, e uma fila local presa nao se
// desfaz sozinha. Um `create` de sub-entidade e, semanticamente, um `update`: a sub-entidade
// nao e uma linha, e uma COLUNA de um mapa que ja existe. Criar o mapa e op de `map`, e essa
// carrega o nome.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, loginUser, seedCatalogRefs, dropCatalogRefs,
} from '../helpers/fixtures.js';

// `baseLayer` carrega uma referencia de recurso, e uma referencia que o autor nao enxerga e
// recusada por outro gate (`unseenResourceDenialReason`). Aqui ela e so cenario.
const REFS_DE_CATALOGO = { basemaps: ['carta-topografica', 'bdgex'] };

before(async () => {
  const env = await setupTestEnv();
  await seedCatalogRefs(env.db, REFS_DE_CATALOGO);
  await teardownTestEnv(env.db);
});

after(async () => {
  const env = await setupTestEnv();
  await dropCatalogRefs(env.db, REFS_DE_CATALOGO);
  await teardownTestEnv(env.db);
});

describe('sub-entidade de mapa enviada como create', () => {
  let app, db, owner, ownerToken, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: 'subent_create_owner' });
    ownerToken = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id);
    map = await createMap(db, atlas.id, {
      center_lat: -22.9,
      center_long: -43.2,
      zoom: 10,
      bearing: 0,
      pitch: 0,
      base_layer: 'carta-topografica',
    });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /**
   * Empurra UMA op e devolve o ack, sem exigir desfecho: o que este arquivo mede e justamente
   * o desfecho.
   * @param {string} entityType
   * @param {Object} data
   * @param {string} operationType
   * @returns {Promise<Object>} o ack da operacao
   */
  async function empurra(entityType, data, operationType) {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        operations: [{
          protocolVersion: 2,
          id: randomUUID(),
          entityType,
          operationType,
          entityId: map.id,
          mapId: map.id,
          data,
          changes: data,
          timestamp: Date.now(),
          clientId: 'teste-subentidade-create',
        }],
      })
      .expect(200);
    return res.body.data.acks[0];
  }

  it('a grade ligada pela PRIMEIRA vez chega ao servidor', async () => {
    // O gesto real: `setGridStyle` sem grade anterior emite `create`.
    const ack = await empurra('gridStyle', { format: 'utm', visible: true }, 'create');

    assert.equal(ack.rejected, undefined, `recusada: ${ack.reason}`);
    assert.equal(ack.status, 'applied');

    const { rows } = await db.query('SELECT grid_style FROM maps WHERE id = $1', [map.id]);
    assert.deepEqual(rows[0].grid_style, { format: 'utm', visible: true });
  });

  it('as notas escritas pela PRIMEIRA vez chegam ao servidor', async () => {
    const ack = await empurra('mapNotes', { title: 'Cota 300', description: 'Do reconhecimento' }, 'create');

    assert.equal(ack.rejected, undefined, `recusada: ${ack.reason}`);
    const { rows } = await db.query(
      'SELECT notes_title, notes_description FROM maps WHERE id = $1', [map.id]
    );
    assert.equal(rows[0].notes_title, 'Cota 300');
    assert.equal(rows[0].notes_description, 'Do reconhecimento');
  });

  it('a posicao salva pela PRIMEIRA vez chega ao servidor', async () => {
    const ack = await empurra(
      'mapPosition',
      { center_lat: -29.8, center_long: -55.8, zoom: 12, bearing: 0, pitch: 0 },
      'create'
    );

    assert.equal(ack.rejected, undefined, `recusada: ${ack.reason}`);
    const { rows } = await db.query('SELECT zoom FROM maps WHERE id = $1', [map.id]);
    assert.equal(Number(rows[0].zoom), 12);
  });

  it('os outros dois sub-tipos tambem passam como create', async () => {
    // A familia e de CINCO, e uma regua que provasse so os tres com emissor hoje deixaria os
    // outros dois passarem a falhar no dia em que um deles ganhasse um.
    const temporal = await empurra('mapTemporal', { ativo: true, unidade: 'dia' }, 'create');
    assert.equal(temporal.rejected, undefined, `mapTemporal recusada: ${temporal.reason}`);

    const base = await empurra('baseLayer', { baseLayer: 'bdgex' }, 'create');
    assert.equal(base.rejected, undefined, `baseLayer recusada: ${base.reason}`);

    const { rows } = await db.query('SELECT base_layer FROM maps WHERE id = $1', [map.id]);
    assert.equal(rows[0].base_layer, 'bdgex');
  });

  it('o mapa continua com o nome que tinha: nenhum create de sub-entidade o reescreve', async () => {
    // O CONTROLE do conserto. Rebaixar `create` para `update` nao pode virar uma porta para a
    // sub-entidade escrever colunas que nao sao dela: o nome do mapa e o campo que o INSERT
    // apagaria, e por isso e ele que se mede.
    const { rows } = await db.query('SELECT name FROM maps WHERE id = $1', [map.id]);
    assert.equal(rows[0].name, map.name);
  });

  it('um create de MAPA continua criando o mapa', async () => {
    // O controle do outro lado: o rebaixamento vale para SUB-ENTIDADE, e nao pode alcancar a
    // op de `map`, que e a unica que legitimamente insere a linha e a unica que carrega o nome.
    const novoId = randomUUID();
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        operations: [{
          protocolVersion: 2,
          id: randomUUID(),
          entityType: 'map',
          operationType: 'create',
          entityId: novoId,
          mapId: novoId,
          data: { id: novoId, name: 'Mapa novo pelo sync', base_layer: 'carta-topografica' },
          timestamp: Date.now(),
          clientId: 'teste-subentidade-create',
        }],
      })
      .expect(200);

    assert.equal(res.body.data.acks[0].rejected, undefined, `recusada: ${res.body.data.acks[0].reason}`);
    const { rows } = await db.query('SELECT name FROM maps WHERE id = $1', [novoId]);
    assert.equal(rows[0]?.name, 'Mapa novo pelo sync');
  });
});
