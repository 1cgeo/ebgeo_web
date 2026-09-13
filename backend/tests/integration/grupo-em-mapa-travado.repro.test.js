// Path: tests/integration/grupo-em-mapa-travado.repro.test.js
//
// A TRAVA DO MAPA NÃO ALCANÇAVA `group_feature`, e a razão é a forma do gate, não um alvo
// esquecido: `group_feature` SEMPRE esteve em `LOCKABLE_CHILD_TARGETS`.
//
// `lockedMapDenialReason` (sync.service.js) resolve o mapa por `op.mapId`, um campo do
// PAYLOAD, e sai cedo quando ele falta. A escrita de membresia, por outro lado, não usa
// `op.mapId` para nada: os dois EXISTS dela pedem apenas que o grupo e a feição morem em
// ALGUM mapa deste atlas. Os dois fatos juntos dão um gate que o próprio remetente escolhe
// se quer atender:
//
//   - op SEM `mapId`: a checagem sai antes de perguntar qualquer coisa, e a linha entra;
//   - op com o `mapId` de OUTRO mapa do atlas (destravado): a checagem pergunta pelo mapa
//     errado, responde "destravado", e a linha entra no grupo do mapa TRAVADO.
//
// O que se perde é o que a trava existe para segurar: com o mapa travado, o agrupamento das
// feições dele continua editável. É a classe "gate parametrizado pelo payload do cliente"
// que este arquivo já nomeia em `lockedMapDenialReason` sobre outro campo.
//
// CONTROLE NEGATIVO: devolva o `if (!op.mapId) return null;` ao topo da função (isto é,
// remova o ramo de `group_feature`) e os dois primeiros casos ficam vermelhos.
// CONTROLE POSITIVO: os dois últimos casos exigem que, com o mapa DESTRAVADO, a mesma op
// sem `mapId` continue sendo aplicada — senão "verde" significaria só que a membresia parou
// de funcionar.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createGroup, createFeature, createShare, loginUser,
} from '../helpers/fixtures.js';

const MOTIVO = 'O mapa está bloqueado e não aceita edições';

describe('group_feature e a trava do mapa (repro)', () => {
  let app, db, owner, writer, writerTok, atlas, travado, livre;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const rid = randomUUID().slice(0, 8);
    owner = await createUser(db, { username: `gft_own_${rid}` });
    writer = await createUser(db, { username: `gft_wr_${rid}` });
    writerTok = await loginUser(app, writer.username, writer.password);

    atlas = await createAtlas(db, owner.id, { name: 'Atlas da trava de grupo' });
    travado = await createMap(db, atlas.id, { name: 'Travado' });
    livre = await createMap(db, atlas.id, { name: 'Livre' });
    await createShare(db, atlas.id, writer.id, 'write', owner.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Um par grupo/feição novo dentro de `mapId`. */
  async function parNoMapa(mapId) {
    const grupo = await createGroup(db, mapId);
    const feicao = await createFeature(db, mapId);
    return { grupo, feicao };
  }

  function push(operations) {
    return supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${writerTok}`)
      .send({ operations });
  }

  /** A op de membresia, com o `mapId` que o chamador quiser (ou nenhum). */
  function opMembresia(tipo, grupoId, feicaoId, mapId) {
    return {
      protocolVersion: 2,
      id: randomUUID(),
      type: tipo,
      target: 'group_feature',
      targetId: randomUUID(),
      ...(mapId ? { mapId } : {}),
      data: { group_id: grupoId, feature_id: feicaoId },
      timestamp: Date.now(),
      clientId: 'repro-gft',
    };
  }

  async function contarPar(grupoId, feicaoId) {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS c FROM group_features WHERE group_id = $1 AND feature_id = $2',
      [grupoId, feicaoId]
    );
    return rows[0].c;
  }

  async function travar(mapId, valor) {
    await db.query('UPDATE maps SET locked = $2 WHERE id = $1', [mapId, valor]);
  }

  it('op SEM mapId não agrupa feição de mapa travado', async () => {
    const { grupo, feicao } = await parNoMapa(travado.id);
    await travar(travado.id, true);

    const r = await push([opMembresia('create', grupo.id, feicao.id, null)]).expect(200);
    await travar(travado.id, false);

    assert.equal(r.body.data.results[0].success, false, 'a op tinha de ser recusada');
    assert.equal(r.body.data.results[0].reason, MOTIVO);
    assert.equal(await contarPar(grupo.id, feicao.id), 0, 'nenhuma linha podia entrar');
  });

  it('op com o mapId de OUTRO mapa não agrupa feição de mapa travado', async () => {
    const { grupo, feicao } = await parNoMapa(travado.id);
    await travar(travado.id, true);

    const r = await push([opMembresia('create', grupo.id, feicao.id, livre.id)]).expect(200);
    await travar(travado.id, false);

    assert.equal(r.body.data.results[0].success, false, 'a op tinha de ser recusada');
    assert.equal(r.body.data.results[0].reason, MOTIVO);
    assert.equal(await contarPar(grupo.id, feicao.id), 0, 'nenhuma linha podia entrar');
  });

  it('a REMOÇÃO de membresia também para na trava', async () => {
    const { grupo, feicao } = await parNoMapa(travado.id);
    await db.query('INSERT INTO group_features (group_id, feature_id) VALUES ($1, $2)',
      [grupo.id, feicao.id]);
    await travar(travado.id, true);

    const r = await push([opMembresia('delete', grupo.id, feicao.id, null)]).expect(200);
    await travar(travado.id, false);

    assert.equal(r.body.data.results[0].success, false, 'a op tinha de ser recusada');
    assert.equal(await contarPar(grupo.id, feicao.id), 1, 'o par tinha de sobreviver');
  });

  // ── CONTROLES POSITIVOS: a membresia continua funcionando fora da trava ──────────
  it('com o mapa DESTRAVADO, a mesma op sem mapId aplica', async () => {
    const { grupo, feicao } = await parNoMapa(travado.id);
    const r = await push([opMembresia('create', grupo.id, feicao.id, null)]).expect(200);
    assert.equal(r.body.data.results[0].success, true, r.body.data.results[0].reason);
    assert.equal(await contarPar(grupo.id, feicao.id), 1);
  });

  it('a trava de UM mapa não alcança a membresia de outro', async () => {
    const { grupo, feicao } = await parNoMapa(livre.id);
    await travar(travado.id, true);
    const r = await push([opMembresia('create', grupo.id, feicao.id, livre.id)]).expect(200);
    await travar(travado.id, false);
    assert.equal(r.body.data.results[0].success, true, r.body.data.results[0].reason);
    assert.equal(await contarPar(grupo.id, feicao.id), 1);
  });
});
