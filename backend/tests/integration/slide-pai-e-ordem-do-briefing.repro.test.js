// Path: tests/integration/slide-pai-e-ordem-do-briefing.repro.test.js
// Two defects found by the briefing coverage (frontend/tests/e2e-ui/briefing-editor-cobertura.spec.js):
// 1. a slide copied from briefing X into briefing Y carried X's `briefing_id` in its payload, and the
//    server created the copy under X although the envelope named Y as the parent. The server's first
//    answer (the envelope wins) broke the transport contract that sends the MAP id in the envelope;
//    the copy is now closed on the client, which never sends `briefing_id`, and the server keeps the
//    payload's parent first, as the first two cases pin;
// 2. a briefing envelope carried back a STALE `slide_order` (the client stores what the canonical
//    receipt and the snapshot give it), and the server kept it over the order of the slides array:
//    a reorder never reached the column.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createBriefing, createMap, loginUser } from '../helpers/fixtures.js';

describe('Slide parent and briefing order: payload parent first, order from the slides', () => {
  let app, db, atlas, token;
  before(async () => {
    ({ app, db } = await setupTestEnv());
    const user = await createUser(db);
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
  });
  after(async () => { await teardownTestEnv(db); });

  const push = (operations) => supertest(app).post(`/api/v1/atlas/${atlas.id}/sync`)
    .set('Authorization', `Bearer ${token}`).send({ operations }).expect(200);

  it('a slide create whose envelope carries the MAP id goes under the briefing its payload names', async () => {
    const briefing = await createBriefing(db, atlas.id, { name: 'Contrato' });
    const mapa = await createMap(db, atlas.id, { name: 'M1' });
    const id = randomUUID();
    await push([{ protocolVersion: 2, id: randomUUID(), entityType: 'slide', operationType: 'create', entityId: id,
      mapId: mapa.id, data: { id, briefing_id: briefing.id, title: 'Pelo payload', mode: '2d' },
      timestamp: Date.now(), clientId: 'c' }]);
    const { rows } = await db.query('SELECT briefing_id FROM slides WHERE id = $1', [id]);
    assert.equal(rows.length, 1, 'the slide was written');
    assert.equal(rows[0].briefing_id, briefing.id);
  });

  it('a slide create without a payload parent goes under the briefing the envelope names (the client shape)', async () => {
    const destino = await createBriefing(db, atlas.id, { name: 'Destino' });
    const id = randomUUID();
    await push([{ protocolVersion: 2, id: randomUUID(), entityType: 'slide', operationType: 'create', entityId: id,
      mapId: destino.id, data: { id, title: 'Copia', mode: '2d' },
      timestamp: Date.now(), clientId: 'c' }]);
    const { rows } = await db.query('SELECT briefing_id FROM slides WHERE id = $1', [id]);
    assert.equal(rows.length, 1, 'the slide was written');
    assert.equal(rows[0].briefing_id, destino.id);
  });

  it('a payload without an envelope parent keeps its own briefing_id (legacy callers)', async () => {
    const briefing = await createBriefing(db, atlas.id, { name: 'Legado' });
    const id = randomUUID();
    await push([{ protocolVersion: 2, id: randomUUID(), entityType: 'slide', operationType: 'create', entityId: id,
      data: { briefing_id: briefing.id, title: 'Sem envelope', mode: '2d' }, timestamp: Date.now(), clientId: 'c' }]);
    const { rows } = await db.query('SELECT briefing_id FROM slides WHERE id = $1', [id]);
    assert.equal(rows[0].briefing_id, briefing.id);
  });

  it('a briefing update with slides derives slide_order from them, ignoring a stale slide_order', async () => {
    const briefing = await createBriefing(db, atlas.id, { name: 'Ordem' });
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    await push([{ protocolVersion: 2, id: randomUUID(), entityType: 'briefing', operationType: 'update', entityId: briefing.id,
      data: { id: briefing.id, name: 'Ordem', slide_order: [a],
        slides: [{ id: c, order: 0 }, { id: a, order: 1 }, { id: b, order: 2 }] },
      timestamp: Date.now(), clientId: 'c' }]);
    const { rows } = await db.query('SELECT slide_order FROM briefings WHERE id = $1', [briefing.id]);
    assert.deepEqual(rows[0].slide_order, [c, a, b]);
  });

  it('an update carrying only slide_order keeps that explicit order', async () => {
    const briefing = await createBriefing(db, atlas.id, { name: 'Explicita' });
    const [a, b] = [randomUUID(), randomUUID()];
    await push([{ protocolVersion: 2, id: randomUUID(), entityType: 'briefing', operationType: 'update', entityId: briefing.id,
      changes: { slide_order: [b, a] }, timestamp: Date.now(), clientId: 'c' }]);
    const { rows } = await db.query('SELECT slide_order FROM briefings WHERE id = $1', [briefing.id]);
    assert.deepEqual(rows[0].slide_order, [b, a]);
  });
});
