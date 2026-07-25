// Path: tests/integration/sharing-grantable-tiers.test.js
// Item 42 — GRANTABLE_PERMISSIONS: conceder 'comment' e 'manage' PELA API.
//
// Até aqui a API só era exercitada concedendo 'read' e 'write', e o único valor
// rejeitado testado era 'owner'. Os níveis DO MEIO eram semeados por INSERT direto
// (`createShare`) em atlas-config-authz/comments, nunca pela rota. Se alguém reduzir
// GRANTABLE_PERMISSIONS para ['read','write'] (ou tirar 'manage' de PERMISSION_LEVELS),
// TODOS os testes de sharing seguem verdes enquanto Comentarista e co-Gestor viram
// inconcedíveis em silêncio — a lista fechada que a constituição proíbe e que já
// causou bug real duas vezes.
//
// Cada caso prova as duas metades: que o grant EXISTE e que ele confere exatamente o
// poder daquele nível.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';

const U = () => `grt_${randomUUID().slice(0, 8)}`;

describe('GRANTABLE_PERMISSIONS — os níveis do meio são concedíveis pela rota', () => {
  let app, db, owner, ownerTok, beneficiado, beneficiadoTok;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: U() });
    ownerTok = await loginUser(app, owner.username, owner.password);
    beneficiado = await createUser(db, { username: U() });
    beneficiadoTok = await loginUser(app, beneficiado.username, beneficiado.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  async function cenario() {
    const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    const map = await createMap(db, atlas.id);
    return { atlas, map };
  }

  const grant = (atlasId, permission) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlasId}/sharing/users`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ userId: beneficiado.id, permission });

  const permissaoNoBanco = async (atlasId) =>
    (await db.query('SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2',
      [atlasId, beneficiado.id])).rows[0]?.permission;

  it("conceder 'manage' → 201, linha 'manage', e o beneficiado passa a ler /sharing", async () => {
    const { atlas } = await cenario();

    await grant(atlas.id, 'manage').expect(201);
    assert.equal(await permissaoNoBanco(atlas.id), 'manage');

    // Efeito: o grant realmente conferiu co-Gestor.
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sharing`)
      .set('Authorization', `Bearer ${beneficiadoTok}`)
      .expect(200);
  });

  it("conceder 'comment' → 201, linha 'comment', e ele consegue empurrar op de comentário", async () => {
    const { atlas, map } = await cenario();

    await grant(atlas.id, 'comment').expect(201);
    assert.equal(await permissaoNoBanco(atlas.id), 'comment');

    const comentarioId = randomUUID();
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${beneficiadoTok}`)
      .send({
        operations: [{
          id: randomUUID(), entityType: 'comment', operationType: 'create', entityId: comentarioId,
          mapId: map.id,
          data: { id: comentarioId, mapId: map.id, lng: -43.2, lat: -22.9, text: 'oi', status: 'open' },
          timestamp: Date.now(), clientId: 'grt-client',
        }],
      })
      .expect(200);

    const { rows } = await db.query('SELECT id FROM comments WHERE id = $1', [comentarioId]);
    assert.equal(rows.length, 1, 'o comentário existe');
  });

  it("o MESMO beneficiado 'comment' empurrando uma FEIÇÃO → 403 e zero linhas", async () => {
    const { atlas, map } = await cenario();
    await grant(atlas.id, 'comment').expect(201);

    const featureId = randomUUID();
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${beneficiadoTok}`)
      .send({
        operations: [{
          id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: featureId,
          mapId: map.id,
          data: { type: 'Feature', geometry: { type: 'Point', coordinates: [-43, -22] }, properties: { source: 'point' } },
          timestamp: Date.now(), clientId: 'grt-client',
        }],
      })
      .expect(403);

    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [featureId]);
    assert.equal(rows.length, 0, 'violação de NÍVEL envenena o lote inteiro, por decisão');
  });

  it("controle do teto: beneficiado 'comment' em GET /sharing → 403 (comment < manage)", async () => {
    const { atlas } = await cenario();
    await grant(atlas.id, 'comment').expect(201);

    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sharing`)
      .set('Authorization', `Bearer ${beneficiadoTok}`)
      .expect(403);
  });

  it("PUT de 'read' para 'manage' → 200, linha muda e o 403 de antes vira 200", async () => {
    const { atlas } = await cenario();
    await createShare(db, atlas.id, beneficiado.id, 'read', owner.id);

    // Antes: sem acesso à superfície de gestão.
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sharing`)
      .set('Authorization', `Bearer ${beneficiadoTok}`)
      .expect(403);

    await supertest(app)
      .put(`/api/v1/atlas/${atlas.id}/sharing/users/${beneficiado.id}`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ permission: 'manage' })
      .expect(200);
    assert.equal(await permissaoNoBanco(atlas.id), 'manage');

    // Depois: a mesma chamada passa. O efeito do PUT é observado, não presumido.
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sharing`)
      .set('Authorization', `Bearer ${beneficiadoTok}`)
      .expect(200);
  });

  it("'owner' segue NÃO concedível (422), e um valor inventado também", async () => {
    const { atlas } = await cenario();
    await grant(atlas.id, 'owner').expect(422);
    await grant(atlas.id, 'superuser').expect(422);
    assert.equal(await permissaoNoBanco(atlas.id), undefined, 'nenhuma linha criada');
  });
});
