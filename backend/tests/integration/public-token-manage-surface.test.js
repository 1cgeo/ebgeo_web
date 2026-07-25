// Path: tests/integration/public-token-manage-surface.test.js
// Item 127 — o token de visitante na superfície de MANAGE e contra atlas PRIVADO de
// terceiro.
//
// Sobre HTTP nada liga o token ao seu atlas: o gateway WS checa
// `payload.atlasId !== atlasId` (collab.gateway.js), o caminho REST NÃO — a segurança
// vem só de reler is_public/shares em `requireAtlasPermission`. O push e o pull já
// estavam cobertos (sync-gaps sync-09, cross-cutting-gaps) e o cruzamento
// público→público está caracterizado (maps-briefings-gaps maps-02b), mas o caso que
// vaza de verdade (público→PRIVADO) e a superfície de manage nunca foram tocados.
//
// O que estes verdes provam: as claims `permission:'read'` e `atlasId` do token NUNCA
// são tratadas como autoridade no REST.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, makeAtlasPublic, getPublicToken } from '../helpers/fixtures.js';

const U = () => `ptm_${randomUUID().slice(0, 8)}`;

describe('token de visitante — superfície de manage e atlas privado alheio', () => {
  let app, db, owner, terceiro;
  let publico, publicoMap, publicToken;
  let privadoAlheio;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    owner = await createUser(db, { username: U() });
    terceiro = await createUser(db, { username: U() });

    publico = await createAtlas(db, owner.id, { name: `Público ${U()}` });
    publicoMap = await createMap(db, publico.id);
    const link = await makeAtlasPublic(db, publico.id);
    publicToken = await getPublicToken(app, link);

    privadoAlheio = await createAtlas(db, terceiro.id, { name: `Privado ${U()}` });
    await createMap(db, privadoAlheio.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const comToken = (metodo, url) =>
    supertest(app)[metodo](url).set('Authorization', `Bearer ${publicToken}`);

  it('controle positivo: o token LÊ o próprio atlas público', async () => {
    const res = await comToken('get', `/api/v1/atlas/${publico.id}`).expect(200);
    assert.equal(res.body.data.id, publico.id, 'sem isto os negativos abaixo não provam nada');
  });

  it('GET /atlas/<privado de terceiro> → 403 e sem `data`', async () => {
    const res = await comToken('get', `/api/v1/atlas/${privadoAlheio.id}`).expect(403);
    assert.equal(res.body.data, undefined, 'nada do atlas privado atravessa a recusa');
  });

  it('GET /atlas/<privado de terceiro>/sync/0 → 403', async () => {
    const res = await comToken('get', `/api/v1/atlas/${privadoAlheio.id}/sync/0`).expect(403);
    assert.equal(res.body.data, undefined);
  });

  it('GET /atlas/:id/sharing do PRÓPRIO atlas → 403 (read < manage)', async () => {
    await comToken('get', `/api/v1/atlas/${publico.id}/sharing`).expect(403);
  });

  it('visitante não republica nem despublica: POST e DELETE /sharing/public → 403', async () => {
    await comToken('post', `/api/v1/atlas/${publico.id}/sharing/public`).expect(403);
    await comToken('delete', `/api/v1/atlas/${publico.id}/sharing/public`).expect(403);

    // E o estado do atlas não mudou.
    const { rows } = await db.query('SELECT is_public FROM atlas WHERE id = $1', [publico.id]);
    assert.equal(rows[0].is_public, true);
  });

  it('visitante não comenta: push de op `comment` → 403 e zero linhas em comments', async () => {
    const comentarioId = randomUUID();
    await comToken('post', `/api/v1/atlas/${publico.id}/sync`)
      .send({
        operations: [{
          id: randomUUID(), entityType: 'comment', operationType: 'create', entityId: comentarioId,
          mapId: publicoMap.id,
          data: { id: comentarioId, mapId: publicoMap.id, lng: -43.2, lat: -22.9, text: 'x', status: 'open' },
          timestamp: Date.now(), clientId: 'ptm-client',
        }],
      })
      .expect(403);

    const { rows } = await db.query('SELECT id FROM comments WHERE id = $1', [comentarioId]);
    assert.equal(rows.length, 0, 'o gate da rota é `comment`, e read < comment');
  });
});
