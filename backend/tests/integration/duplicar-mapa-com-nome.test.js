// Path: tests/integration/duplicar-mapa-com-nome.test.js
// The duplicate route takes the name the person typed; without it the copy keeps the old suffix.
// The client resolves maps by NAME, so a second duplicate named by the server ("X (cópia)" again)
// would collide with the first copy (frontend/tests/e2e-ui/duplicar-mapa-no-servidor.repro.spec.js).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('POST /atlas/:id/maps/:mapId/duplicate names the copy', () => {
  let app, db, atlas, map, token;
  before(async () => {
    ({ app, db } = await setupTestEnv());
    const owner = await createUser(db);
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id);
    map = await createMap(db, atlas.id);
  });
  after(async () => { await teardownTestEnv(db); });

  const duplicate = (body) => supertest(app).post(`/api/v1/atlas/${atlas.id}/maps/${map.id}/duplicate`)
    .set('Authorization', `Bearer ${token}`).send(body);

  it('uses the requested name, trimmed', async () => {
    const response = await duplicate({ name: '  Copia pedida  ' }).expect(201);
    assert.equal(response.body.data.name, 'Copia pedida');
    const { rows } = await db.query('SELECT name FROM maps WHERE id = $1', [response.body.data.id]);
    assert.equal(rows[0].name, 'Copia pedida');
  });

  it('without a name keeps "<source> (cópia)"', async () => {
    const response = await duplicate({}).expect(201);
    const { rows } = await db.query('SELECT name FROM maps WHERE id = $1', [map.id]);
    assert.equal(response.body.data.name, `${rows[0].name} (cópia)`);
  });

  it('refuses an empty or oversized name instead of storing it', async () => {
    await duplicate({ name: '   ' }).expect(422);
    await duplicate({ name: 'x'.repeat(256) }).expect(422);
    await duplicate({ name: 42 }).expect(422);
  });
});
