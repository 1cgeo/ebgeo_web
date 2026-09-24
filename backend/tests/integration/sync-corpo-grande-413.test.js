// Path: tests/integration/sync-corpo-grande-413.test.js
//
// O CONTRATO QUE O CLIENTE LE: um push cujo CORPO passa do limite do parser JSON (10 MB,
// `src/app.js`) volta 413 com codigo PAYLOAD_TOO_LARGE, e nao uma queda de socket nem um 400.
//
// O cliente trata 413 como recusa PERMANENTE dos bytes (`PERMANENT_PUSH_REJECTIONS`,
// `frontend/src/js/store/sync/sync-engine.js`): encolhe o lote e, se uma op sozinha ainda nao
// cabe, guarda-a nas pendencias. Antes ele caia no ramo transitorio e reenviava o mesmo lote
// para sempre, com a fila inteira parada atras e um aviso culpando a conexao. Este caso prende a
// metade do servidor dessa conversa: se o status mudar, o cliente volta a travar em silencio.
//
// Medido em 2026-09-23 por um socket HTTP real (nao supertest) em loopback: 11, 13, 20 e 40 MB
// devolveram 413 com o corpo JSON inteiro.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('push de sync acima do limite do corpo', () => {
  let db, token, atlas, map, server, port;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
    const u = await createUser(db, { username: `s413_${randomUUID().slice(0, 6)}` });
    token = await loginUser(env.app, u.username, u.password);
    atlas = await createAtlas(db, u.id);
    map = await createMap(db, atlas.id);
    server = http.createServer(env.app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  it('responde 413 PAYLOAD_TOO_LARGE, e a op nao chega ao log', async () => {
    const featureId = randomUUID();
    const body = JSON.stringify({ operations: [{
      protocolVersion: 2, id: randomUUID(), entityType: 'feature', operationType: 'create',
      entityId: featureId, mapId: map.id, timestamp: Date.now(), clientId: 'c-413',
      data: { id: featureId, feature_type: 'point', geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { nome: 'x'.repeat(11 * 1024 * 1024) } },
    }] });

    const resposta = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port, method: 'POST', path: `/api/v1/atlas/${atlas.id}/sync`,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'content-length': Buffer.byteLength(body),
        },
      }, (res) => {
        let texto = '';
        res.on('data', (c) => { texto += c; });
        res.on('end', () => resolve({ status: res.statusCode, texto }));
      });
      req.on('error', reject);
      req.end(body);
    });

    assert.equal(resposta.status, 413);
    assert.equal(JSON.parse(resposta.texto).error.code, 'PAYLOAD_TOO_LARGE');
    const { rows } = await db.query('SELECT 1 FROM features WHERE id = $1', [featureId]);
    assert.equal(rows.length, 0);
  });
});
