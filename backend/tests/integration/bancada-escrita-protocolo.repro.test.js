// Path: tests/integration/bancada-escrita-protocolo.repro.test.js
// A fast HTTP rejection is not a successful write benchmark.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createFeature, loginUser } from '../helpers/fixtures.js';
import { criarLote, criarRegistro, escritorRest } from '../bench/lib/escritor.mjs';
import { Serie } from '../bench/lib/metricas.mjs';
import { reconciliar } from '../bench/lib/reconciliar.mjs';

describe('write benchmark exercises the accepted protocol', () => {
  let app, db, atlas, map, token;
  before(async () => {
    ({ app, db } = await setupTestEnv());
    const user = await createUser(db);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
    token = await loginUser(app, user.username, user.password);
  });
  after(async () => { await teardownTestEnv(db); });

  it('benchmark create batches reach the feature table and receive individual receipts', async () => {
    const operations = criarLote({ mapId: map.id, clientId: randomUUID(), quantidade: 3, lamport: 1 });
    const response = await supertest(app).post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`).send({ operations }).expect(200);
    assert.equal(response.body.data.results.length, 3);
    assert.ok(response.body.data.results.every(result => result.success));
    const { rows } = await db.query('SELECT id FROM features WHERE map_id = $1', [map.id]);
    assert.deepEqual(rows.map(row => row.id).sort(), operations.map(op => op.entityId).sort());
  });

  it('a run with only rejected envelopes is invalid even when it lost no acknowledged data', async () => {
    const registro = criarRegistro();
    registro.enviados.add(randomUUID());
    for (const id of registro.enviados) registro.semVeredito.add(id);
    const result = await reconciliar({ dsn: process.env.DATABASE_URL, atlasIds: [atlas.id], registro });
    assert.equal(result.ok, false);
    assert.ok(result.provas.some(proof => !proof.ok && proof.nome.startsWith('P0')));
  });

  it('update writers use observed versions and advance them from real receipts', async () => {
    const targets = [await createFeature(db, map.id), await createFeature(db, map.id)];
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const registro = criarRegistro();
    try {
      await escritorRest({ base: `http://127.0.0.1:${server.address().port}`, token,
        atlasId: atlas.id, mapId: map.id, lotes: 3, opsPorLote: 2,
        alvos: targets.map(feature => feature.id), serie: new Serie('updates'), registro });
      assert.equal(registro.acked.size, 6);
      assert.equal(registro.recusados.size, 0);
      assert.equal(registro.semVeredito.size, 0);
      const { rows } = await db.query('SELECT version, properties FROM features WHERE id=ANY($1::uuid[])',
        [targets.map(feature => feature.id)]);
      assert.ok(rows.every(row => Number(row.version) === 4));
      assert.ok(rows.every(row => row.properties.nome.startsWith('Editado ')));
      const result = await reconciliar({ dsn: process.env.DATABASE_URL, atlasIds: [atlas.id], registro });
      assert.equal(result.ok, true);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
});
