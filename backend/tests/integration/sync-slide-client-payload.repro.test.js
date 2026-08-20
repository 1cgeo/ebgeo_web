// Path: tests/integration/sync-slide-client-payload.repro.test.js
// Regression: a slide created by the REAL app never reached Postgres.
//
// Every pre-existing slide test (20+ across sync-briefing-ops / sync-advanced /
// sync-cross-atlas-access) hand-writes the SERVER dialect: `data.briefing_id`,
// `data.map_id`, `data.model_id`, snake_case throughout. The real client emits
// something else entirely, and no test ever fed it in — so the whole feature was
// green and dead at the same time. Same class of blind spot as the catalog_layers
// primary key: the suite spoke the server's language back to the server.
//
// What the real client actually emits (frontend briefing.operations.js addSlide →
// operation-dispatcher logOperation → operation-factory createOperation):
//
//   logOperation(EntityType.SLIDE, CREATE, slide.id, briefingId, slide)
//                                            ^entityId  ^the mapId SLOT   ^camelCase
//
//   { entityType:'slide', operationType:'create', entityId:<slideId>,
//     mapId:<briefingId>,                       // the parent id rides in the mapId slot
//     data: { id, order, title, content, mode,  // createEmptySlide() — camelCase
//             mapId, modelId, photoId, temporalCursor, position, orientation } }
//
// Two independent breaks, both silent:
//   1. `data.briefing_id` is undefined, so the INSERT's
//      `WHERE EXISTS (SELECT 1 FROM briefings WHERE id = $2 ...)` matches nothing.
//      Zero rows, no error, and the op is acked as SUCCESS. The client marks it
//      synced and dequeues it: the slide is alive locally, absent on the server.
//   2. Even with the briefing resolved, `mapId`/`modelId`/`photoId`/`temporalCursor`
//      never land, because the insert reads snake_case only.
//
// Why nobody noticed: between two LIVE peers the briefing op relays `data.slides`
// over the WS and applyRemoteBriefingOp saves the whole briefing, so a colleague
// watching in real time sees the slide appear. It is only gone after a reload,
// because the snapshot rebuilds `briefing.slides` from the (empty) slides table.
// Works in the demo, gone tomorrow.
//
// Why the e2e did not catch it either, despite covering briefings over the full
// chain: browser-collab-briefing-temporal.spec.js asserts expectFullSync with
// `entityType: 'briefing'` and lets slide edits "ride" on the parent op. The
// briefing ROW really does persist (name/description/settings), so the full-chain
// assertion is honestly green while the slides table stays empty. Verifying the
// parent and inferring the child is the "check a subset, call it the set" failure
// from CLAUDE.md, in test form.
//
// Negative control: revert the briefing-id resolution in sync.service.js and the
// first test below fails with 0 rows.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createBriefing, loginUser,
} from '../helpers/fixtures.js';

describe('slide sync accepts the payload the real client emits (repro)', () => {
  let app, db, owner, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `slide_own_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Briefing Atlas' });
    map = await createMap(db, atlas.id, { name: 'Mapa do briefing' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations });

  /**
   * Mirrors frontend createEmptySlide() + addSlide() exactly: camelCase, no
   * briefing_id, parent id in the mapId slot. If this helper and the frontend ever
   * drift, this suite stops proving anything — that is the risk it is built to
   * expose, so it is spelled out rather than imported.
   *
   * The other half of the contract is pinned in
   * frontend/tests/store/briefing-operations.test.js ('createEmptySlide' asserts each
   * camelCase field; 'addSlide' asserts the op is logged with the briefing id in the
   * mapId slot). Change either side and both files must move together — that pair IS
   * the contract, since no single suite spans the two packages.
   */
  const clientSlideOp = (slideId, briefingId, overrides = {}) => ({
    id: randomUUID(),
    entityType: 'slide',
    operationType: 'create',
    entityId: slideId,
    mapId: briefingId,
    data: {
      id: slideId,
      order: 0,
      title: '',
      content: '',
      mode: '2d',
      mapId: null,
      position: { longitude: null, latitude: null, zoom: null, altitude: null },
      orientation: { bearing: 0, pitch: 0, heading: null, lon: null, lat: null, fov: null },
      modelId: null,
      photoId: null,
      temporalCursor: null,
      ...overrides,
    },
    timestamp: Date.now(),
    lamportTimestamp: 1,
    clientId: 'real-client',
  });

  it('persists a slide created with the client envelope (parent id in the mapId slot)', async () => {
    const briefing = await createBriefing(db, atlas.id, { name: 'Briefing Real' });
    const slideId = randomUUID();

    const res = await push([
      clientSlideOp(slideId, briefing.id, { title: 'Situação Atual', content: 'Texto do slide' }),
    ]).expect(200);

    assert.equal(res.body.data.results[0].success, true, 'the op is acked as applied');

    const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [slideId]);
    assert.equal(rows.length, 1, 'the slide really reached Postgres, not just a success ack');
    assert.equal(rows[0].briefing_id, briefing.id, 'attached to the right briefing');
    assert.equal(rows[0].title, 'Situação Atual');
    assert.equal(rows[0].content, 'Texto do slide');
  });

  it('carries the camelCase fields the client sends (mapId/modelId/photoId/temporalCursor)', async () => {
    const briefing = await createBriefing(db, atlas.id, { name: 'Briefing 3D' });
    const slideId = randomUUID();

    await push([
      clientSlideOp(slideId, briefing.id, {
        title: 'Slide 3D',
        mode: '3d',
        mapId: map.id,
        modelId: 'modelo-abc',
        photoId: 'foto-xyz',
        temporalCursor: 1750000000000,
      }),
    ]).expect(200);

    const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [slideId]);
    assert.equal(rows.length, 1, 'slide persisted');
    assert.equal(rows[0].map_id, map.id, 'camelCase mapId lands in map_id');
    assert.equal(rows[0].model_id, 'modelo-abc', 'camelCase modelId lands in model_id');
    assert.equal(rows[0].photo_id, 'foto-xyz', 'camelCase photoId lands in photo_id');
    assert.equal(
      Number(rows[0].temporal_cursor), 1750000000000,
      'camelCase temporalCursor lands in temporal_cursor'
    );
  });

  it('the slide survives the round trip: it comes back in the snapshot', async () => {
    const briefing = await createBriefing(db, atlas.id, { name: 'Briefing Round Trip' });
    const slideId = randomUUID();

    await push([
      clientSlideOp(slideId, briefing.id, { title: 'Sobrevivente' }),
    ]).expect(200);

    // This is the half a live-peer test can never catch: the WS relay carries the
    // briefing op with its slides array, so a peer sees the slide even when nothing
    // was stored. Only the snapshot proves durability.
    const snap = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const returned = snap.body.data.snapshot.briefings.find((b) => b.id === briefing.id);
    assert.ok(returned, 'the briefing is in the snapshot');
    assert.ok(
      returned.slides.some((s) => s.id === slideId && s.title === 'Sobrevivente'),
      'and it carries the slide back, so a reload does not lose it'
    );
  });

  // The return leg. applyRemoteSnapshot saves each briefing VERBATIM into IndexedDB
  // and the frontend slide model is camelCase, so a snapshot that answers only in
  // snake_case restores slides stripped of map, model and photo. This half could not
  // fail before, because the slides array was always empty — fixing the outbound leg
  // is what put weight on it.
  it('answers the snapshot in the vocabulary the client reads (camelCase aliases)', async () => {
    const briefing = await createBriefing(db, atlas.id, { name: 'Briefing Ida e Volta' });
    const slideId = randomUUID();

    await push([
      clientSlideOp(slideId, briefing.id, {
        title: 'Slide 3D',
        mode: '3d',
        mapId: map.id,
        modelId: 'modelo-abc',
        photoId: 'foto-xyz',
        temporalCursor: 1750000000000,
      }),
    ]).expect(200);

    const snap = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const slide = snap.body.data.snapshot.briefings
      .find((b) => b.id === briefing.id).slides
      .find((s) => s.id === slideId);

    assert.ok(slide, 'the slide is in the snapshot');
    // `mapId` carries the map NAME, not the UUID: that is what the field means on the
    // client. This assertion originally expected the UUID — it encoded my own wrong
    // reading of the contract, and a cross-package audit is what corrected it. The
    // snake_case `map_id` below is the one that carries the id.
    assert.equal(slide.mapId, map.name, 'mapId is the display name the client compares against');
    assert.equal(slide.modelId, 'modelo-abc', 'modelId');
    assert.equal(slide.photoId, 'foto-xyz', 'photoId');
    assert.equal(Number(slide.temporalCursor), 1750000000000, 'temporalCursor');
    assert.equal(slide.map_id, map.id, 'the snake_case columns stay for existing readers');
  });

  // REGRESSION INTRODUCED BY THIS VERY FIX, caught by a cross-package audit.
  //
  // `normalizeSlidePayload` maps camelCase `mapId` onto the `map_id` column. But the
  // frontend's `slide.mapId` is NOT a UUID — it holds the map's DISPLAY NAME:
  //   briefing-editor.control.js:1176  slide.mapId = getCurrentMapNameSync()
  //   :829                             slide.mapId = mapNames[0]
  //   :672                             slide.mapId = mapSelect.value   // <option value=name>
  // while `slides.map_id` is `UUID REFERENCES maps(id)` (003_atlas.sql).
  //
  // Sending a name into a UUID column raises 22P02, which aborts the tx wrapping the
  // WHOLE push batch. The client only re-queues on a non-2xx, so it replays the same
  // poisoned batch forever: that user's sync stops permanently and silently — no
  // feature, comment or map ever reaches their colleagues again. And the briefing
  // editor sets the field BY ITSELF (auto-selecting mapNames[0] with autosave), so it
  // does not even need a deliberate action.
  //
  // Before this fix `data.map_id` was simply undefined, so the association was lost
  // but nothing broke. Losing it again is the correct fallback: the same
  // non-UUID-drops-to-null guard the codebase already applies to comment authorId
  // (asUuidOrNull) and to feature layer_id (FEATURE_UUID_RE). Restoring the
  // association properly needs the client to carry the map UUID, which is a separate
  // change; freezing sync is not an acceptable price for it in the meantime.
  it('a non-UUID mapId does not poison the batch (the client sends a map NAME)', async () => {
    const briefing = await createBriefing(db, atlas.id, { name: 'Briefing Poison' });
    const slideId = randomUUID();
    const siblingFeatureId = randomUUID();

    const res = await push([
      // Exactly what the briefing editor emits: mapId is the map's NAME.
      clientSlideOp(slideId, briefing.id, { title: 'Slide com mapa', mapId: 'Mapa Principal' }),
      // A sibling in the same batch: if the slide poisons the tx, this dies too.
      {
        id: randomUUID(), entityType: 'feature', operationType: 'create',
        entityId: siblingFeatureId, mapId: map.id,
        data: {
          feature_type: 'point',
          geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
          properties: { id: siblingFeatureId, nome: 'sobrevivente' },
        },
        timestamp: Date.now(), clientId: 'real-client',
      },
    ]);

    assert.equal(res.status, 200, `the batch must not 500 (got ${res.status})`);

    const { rows: s } = await db.query('SELECT map_id FROM slides WHERE id = $1', [slideId]);
    assert.equal(s.length, 1, 'the slide is still created');
    assert.equal(s[0].map_id, null, 'the unusable name drops to null instead of raising 22P02');

    const { rows: f } = await db.query('SELECT id FROM features WHERE id = $1', [siblingFeatureId]);
    assert.equal(f.length, 1, 'and the sibling operation survived — no batch rollback');
  });

  // The association itself, which never worked in either direction. The two packages
  // spell the same idea differently — client `slide.mapId` is the map's DISPLAY NAME,
  // server `slides.map_id` is a UUID FK — so the server translates on both legs. The
  // round trip is the only assertion that proves it, since either leg alone can look
  // right while the pair is useless.
  it('round-trips the slide-to-map association through NAME on the wire', async () => {
    const briefing = await createBriefing(db, atlas.id, { name: 'Briefing Assoc' });
    const slideId = randomUUID();

    // The client sends the NAME, exactly as the briefing editor does.
    await push([
      clientSlideOp(slideId, briefing.id, { title: 'Slide 2D', mapId: map.name }),
    ]).expect(200);

    // Stored as the real foreign key...
    const { rows } = await db.query('SELECT map_id FROM slides WHERE id = $1', [slideId]);
    assert.equal(rows[0].map_id, map.id, 'the name resolved to the map UUID');

    // ...and handed back as the NAME the client can actually use.
    const snap = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const slide = snap.body.data.snapshot.briefings
      .find((b) => b.id === briefing.id).slides.find((s) => s.id === slideId);

    assert.equal(
      slide.mapId, map.name,
      'the client compares this against the active map NAME; a UUID here breaks the '
      + 'editor dropdown and stops a 2D slide from switching maps in a presentation'
    );
  });

  it('an unknown map name resolves to null instead of failing', async () => {
    const briefing = await createBriefing(db, atlas.id, { name: 'Briefing Sem Mapa' });
    const slideId = randomUUID();

    await push([
      clientSlideOp(slideId, briefing.id, { title: 'Slide', mapId: 'Mapa Que Não Existe' }),
    ]).expect(200);

    const { rows } = await db.query('SELECT map_id FROM slides WHERE id = $1', [slideId]);
    assert.equal(rows[0].map_id, null, 'losing the association beats failing the batch');
  });

  it('does not resolve a map name from ANOTHER atlas', async () => {
    // The lookup is scoped by atlas_id; without that it would be a cross-tenant read
    // that also silently attaches a slide to a stranger's map.
    const stranger = await createUser(db, { username: `slide_x_${randomUUID().slice(0, 8)}` });
    const otherAtlas = await createAtlas(db, stranger.id, { name: 'Atlas Alheio' });
    const foreignMap = await createMap(db, otherAtlas.id, { name: 'Mapa Exclusivo Alheio' });

    const briefing = await createBriefing(db, atlas.id, { name: 'Briefing Cross' });
    const slideId = randomUUID();
    await push([
      clientSlideOp(slideId, briefing.id, { title: 'Slide', mapId: foreignMap.name }),
    ]).expect(200);

    const { rows } = await db.query('SELECT map_id FROM slides WHERE id = $1', [slideId]);
    assert.equal(rows[0].map_id, null, 'a name only resolves within the caller own atlas');
  });

  it('the UPDATE path is guarded too, not just create', async () => {
    // UPDATE_FIELDS.slide also writes `map_id`, reading from op.changes — which
    // normalizeOperation falls back to the normalized `data`. If the guard only
    // covered create, editing a slide would still freeze the batch, and editing is
    // the far more frequent gesture.
    const briefing = await createBriefing(db, atlas.id, { name: 'Briefing Update' });
    const slideId = randomUUID();
    await push([clientSlideOp(slideId, briefing.id, { title: 'Antes', mapId: map.id })]).expect(200);

    const res = await push([{
      id: randomUUID(),
      entityType: 'slide',
      operationType: 'update',
      entityId: slideId,
      mapId: briefing.id,
      data: { id: slideId, title: 'Depois', mapId: 'Mapa Principal' }, // a NAME again
      timestamp: Date.now(),
      clientId: 'real-client',
    }]);

    assert.equal(res.status, 200, `the update must not 500 (got ${res.status})`);
    const { rows } = await db.query('SELECT title, map_id FROM slides WHERE id = $1', [slideId]);
    assert.equal(rows[0].title, 'Depois', 'the edit applied');
    assert.equal(rows[0].map_id, null, 'and the unusable name did not reach the UUID column');
  });

  it('a genuine map UUID in mapId still binds the slide to the map', async () => {
    // The guard must reject only what cannot work, not the legitimate case.
    const briefing = await createBriefing(db, atlas.id, { name: 'Briefing UUID' });
    const slideId = randomUUID();

    await push([clientSlideOp(slideId, briefing.id, { title: 'Slide', mapId: map.id })]).expect(200);

    const { rows } = await db.query('SELECT map_id FROM slides WHERE id = $1', [slideId]);
    assert.equal(rows[0].map_id, map.id, 'a real UUID is honoured');
  });

  // The ARRAY order matters as much as the `order` field, and for a reason that only
  // surfaced once slides began persisting: the briefing editor and the presenter index
  // `briefing.slides[i]` directly. GET_BRIEFING_SLIDES has no ORDER BY, so the snapshot
  // returned them in whatever order Postgres chose — harmless while the table was
  // always empty, and "the presentation plays out of sequence" as soon as it was not.
  it('returns the slides array in presentation order, not just an order field', async () => {
    const briefingId = randomUUID();
    const first = randomUUID();
    const second = randomUUID();
    const third = randomUUID();

    await push([{
      id: randomUUID(),
      entityType: 'briefing',
      operationType: 'create',
      entityId: briefingId,
      mapId: null,
      data: {
        id: briefingId,
        name: 'Briefing Sequência',
        slides: [
          { id: third, order: 2, title: 'Terceiro' },
          { id: first, order: 0, title: 'Primeiro' },
          { id: second, order: 1, title: 'Segundo' },
        ],
      },
      timestamp: Date.now(),
      clientId: 'real-client',
    }]).expect(200);

    // The slides themselves arrive as individual ops, deliberately out of sequence.
    for (const [id, title] of [[second, 'Segundo'], [third, 'Terceiro'], [first, 'Primeiro']]) {
      await push([clientSlideOp(id, briefingId, { title })]).expect(200);
    }

    const snap = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const returned = snap.body.data.snapshot.briefings.find((b) => b.id === briefingId);
    assert.deepEqual(
      returned.slides.map((s) => s.title),
      ['Primeiro', 'Segundo', 'Terceiro'],
      'the array itself is ordered — the client indexes slides[i] and never sorts'
    );
    assert.deepEqual(
      returned.slides.map((s) => s.order), [0, 1, 2],
      'and the order field agrees with the array position'
    );
  });

  // Second, independent break in the same feature: slide ORDER.
  //
  // `briefings.slide_order` (uuid[]) is what the snapshot treats as canonical — it
  // computes each slide's `order` as `slide_order.indexOf(slide.id)`. But the string
  // `slide_order` appears NOWHERE in the frontend: the client models ordering as an
  // `order` integer on each slide inside the briefing's `slides` array, and the
  // briefing insert reads `data.slide_order || []`. So the column stayed empty and
  // every slide came back with order -1, i.e. a briefing whose slides return in
  // arbitrary sequence. Deriving the array from the payload the client does send
  // keeps one canonical representation on the server without asking the client to
  // learn a second one.
  it('rebuilds slide order from the briefing payload the client sends', async () => {
    const briefingId = randomUUID();
    const first = randomUUID();
    const second = randomUUID();
    const third = randomUUID();

    // The client logs the whole briefing (updateBriefing → logBriefingOperation),
    // slides array included, with an `order` integer per slide and no slide_order.
    await push([{
      id: randomUUID(),
      entityType: 'briefing',
      operationType: 'create',
      entityId: briefingId,
      mapId: null,
      data: {
        id: briefingId,
        name: 'Briefing Ordenado',
        description: 'Três slides fora de ordem no array',
        slides: [
          { id: third, order: 2, title: 'Terceiro' },
          { id: first, order: 0, title: 'Primeiro' },
          { id: second, order: 1, title: 'Segundo' },
        ],
      },
      timestamp: Date.now(),
      clientId: 'real-client',
    }]).expect(200);

    const { rows } = await db.query('SELECT slide_order FROM briefings WHERE id = $1', [briefingId]);
    assert.deepEqual(
      rows[0].slide_order, [first, second, third],
      'slide_order follows each slide\'s `order` field, not the array position'
    );
  });

  // Worth being explicit: BEFORE the fix this assertion passed for the wrong reason.
  // Nothing was inserted for any briefing id, foreign or not, so "no row exists" proved
  // nothing about scoping. It only became a real test once the insert started working —
  // which is the point of keeping it here rather than trusting the guard by inspection.
  it('still refuses a cross-atlas briefing id (the scoping guard survives the fix)', async () => {
    const stranger = await createUser(db, { username: `slide_str_${randomUUID().slice(0, 8)}` });
    const otherAtlas = await createAtlas(db, stranger.id, { name: 'Atlas Alheio' });
    const foreign = await createBriefing(db, otherAtlas.id, { name: 'Briefing Alheio' });
    const slideId = randomUUID();

    await push([clientSlideOp(slideId, foreign.id, { title: 'Invasor' })]).expect(200);

    const { rows } = await db.query('SELECT id FROM slides WHERE id = $1', [slideId]);
    assert.equal(rows.length, 0, 'a slide cannot be attached to another atlas briefing');
  });

  it('the server dialect keeps working (snake_case + data.briefing_id)', async () => {
    const briefing = await createBriefing(db, atlas.id, { name: 'Briefing Dialeto Servidor' });
    const slideId = randomUUID();

    await push([{
      id: randomUUID(),
      type: 'create',
      target: 'slide',
      targetId: slideId,
      data: { briefing_id: briefing.id, title: 'Servidor', mode: '2d', map_id: map.id },
      timestamp: Date.now(),
      clientId: 'server-dialect',
    }]).expect(200);

    const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [slideId]);
    assert.equal(rows.length, 1, 'the pre-existing dialect is not broken by accepting the new one');
    assert.equal(rows[0].map_id, map.id, 'snake_case still wins where both could apply');
  });
});
