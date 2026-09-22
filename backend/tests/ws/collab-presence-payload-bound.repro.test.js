// Path: tests/ws/collab-presence-payload-bound.repro.test.js
//
// Achado #9 — the presence payload (cursor / selection) was stored RAW on the
// `ws` object (collab.handlers.js: `ws.cursorPosition = data.position`,
// `ws.selectedFeatures = data.featureIds`) with no schema and no size
// ceiling, and `getRoomUsers` re-serializes it into the `connected` frame of EVERY new
// join. A single socket could therefore retain up to the frame ceiling (10 MB,
// COLLAB_MAX_PAYLOAD_BYTES) per slot and make every subsequent join cost that much
// JSON.stringify. `cursor` has NO permission gate, so a read-only public
// visitor reaches the vector.
//
// HAVIA UM TERCEIRO QUADRO NESTE ACHADO, o da linha do tempo, e ele era o pior vetor (blob
// opaco, ungated, retido e re-serializado). Ele saiu INTEIRO em 2026-09-21, por decisão do dono:
// o instante de uma pessoa não se propaga. Não há mais o que limitar ali, então os casos dele
// saíram daqui e viraram a afirmação de ausência em
// `tests/ws/presenca-temporal-removida.test.js`, que inclui o caso do visitante público.
//
// These tests pin (a) that no client can inflate the join snapshot, and (b) the
// radius of effect: every payload the REAL frontend emits
// (frontend/src/js/presence/presence-bridge.js) still round-trips intact, and
// read/comment still never emit a selection.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser,
  createAtlas,
  createMap,
  createShare,
  loginUser,
  seedCatalogRefs,
  dropCatalogRefs,
  seedPublic360Photos,
  drop360Fixture,
} from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

/**
 * Ceiling for the whole `connected` frame in the abuse tests. Measured from the real
 * client (frontend/src/js/presence/presence-bridge.js): a cursor frame is ~128 B and a
 * selection frame ~115 B per selected feature. A snapshot
 * holding a handful of peers is therefore a few KB; 64 KB is two orders of magnitude of
 * headroom, and ~150x below the multi-MB blobs the abuse frames carry.
 */
const SNAPSHOT_CEILING_BYTES = 64 * 1024;

/** Size of the abusive blob: comfortably under the 10 MB frame ceiling, fast to build. */
const HUGE = 'A'.repeat(2 * 1024 * 1024);

/**
 * OS ESCOPOS DE 3D E DE 360 SÃO RECURSOS DE VERDADE, e PÚBLICOS, desde 2026-09-22. O escopo de um
 * cursor ou de uma seleção nessas superfícies passou a ser resolvido no catálogo e recortado por
 * destinatário (`collab.recorte.js`), e um identificador que não resolve é privado para todos: os
 * casos deste arquivo, que usavam nomes inventados e esperavam vê-los chegar ao par, mediriam a
 * redação e não o transporte. Semeados públicos, eles continuam medindo o que sempre mediram, que é
 * o quadro inteiro atravessando. O recorte em si tem arquivo próprio,
 * `tests/ws/presenca-escopo-recortado.repro.test.js`.
 */
const SUFIXO = randomUUID().slice(0, 8);
const TILE = `3d-PCL-${SUFIXO}`;
const FOTO = `IMG_20240712_143201-${SUFIXO}.jpg`;

describe('WebSocket collab — presence payload is validated and bounded (achado #9)', () => {
  let app, db, server;
  let owner, ownerToken, viewer, viewerToken, commenter, commenterToken, editor, editorToken;
  let openClients;
  let projeto360;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: `pb_own_${randomUUID().slice(0, 6)}` });
    viewer = await createUser(db, { username: `pb_view_${randomUUID().slice(0, 6)}` });
    commenter = await createUser(db, { username: `pb_cmt_${randomUUID().slice(0, 6)}` });
    editor = await createUser(db, { username: `pb_edit_${randomUUID().slice(0, 6)}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    viewerToken = await loginUser(app, viewer.username, viewer.password);
    commenterToken = await loginUser(app, commenter.username, commenter.password);
    editorToken = await loginUser(app, editor.username, editor.password);
    await seedCatalogRefs(db, { tilesets: [TILE] });
    projeto360 = await seedPublic360Photos(db, [FOTO]);
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await dropCatalogRefs(db, { tilesets: [TILE] });
    await drop360Fixture(db, projeto360);
    await teardownTestEnv(db);
  });

  beforeEach(() => {
    openClients = [];
  });

  afterEach(async () => {
    // Clean close (code 1000) so the socket leaves the room immediately instead of
    // lingering in the `away` grace window and polluting a later snapshot.
    for (const c of openClients) {
      try {
        if (c.ws && c.ws.readyState <= 1) c.close();
      } catch {
        /* already gone */
      }
    }
    openClients = [];
  });

  /** Creates a fresh atlas + map so each test gets its own (empty) collab room. */
  async function freshAtlas() {
    const atlas = await createAtlas(db, owner.id, { name: `Presence Bound ${randomUUID().slice(0, 8)}` });
    const map = await createMap(db, atlas.id);
    await createShare(db, atlas.id, viewer.id, 'read', owner.id);
    await createShare(db, atlas.id, commenter.id, 'comment', owner.id);
    await createShare(db, atlas.id, editor.id, 'write', owner.id);
    return { atlas, map };
  }

  async function connect(atlasId, token, clientId) {
    const client = await createWsClient(server, atlasId, token, clientId);
    openClients.push(client);
    await client.waitForType('connected');
    return client;
  }

  /**
   * Round-trips a ping so the previously sent presence frame is guaranteed processed
   * (per-socket messages are handled in series by the gateway's message chain).
   */
  async function settle(client) {
    client.send({ type: 'ping' });
    await client.waitForType('pong');
  }

  async function snapshotOf(atlasId, token) {
    const joiner = await createWsClient(server, atlasId, token, `joiner-${randomUUID().slice(0, 8)}`);
    openClients.push(joiner);
    const connected = await joiner.waitForType('connected');
    return { connected, bytes: Buffer.byteLength(JSON.stringify(connected)) };
  }

  // ---------------------------------------------------------------- abuse vectors

  it('a read-only viewer cannot inflate the join snapshot via `cursor`', async () => {
    const { atlas } = await freshAtlas();

    const v = await connect(atlas.id, viewerToken, `v-${randomUUID().slice(0, 8)}`);
    v.send({ type: 'cursor', position: { lng: -43.2, lat: -22.9, junk: HUGE }, mapId: HUGE });
    await settle(v);

    const { bytes } = await snapshotOf(atlas.id, ownerToken);
    assert.ok(
      bytes < SNAPSHOT_CEILING_BYTES,
      `join snapshot grew to ${bytes} bytes — the raw cursor payload is retained`
    );
  });

  it('an editor cannot retain an unbounded selection', async () => {
    const { atlas, map } = await freshAtlas();

    const e = await connect(atlas.id, editorToken, `e-${randomUUID().slice(0, 8)}`);
    const featureIds = Array.from({ length: 60000 }, () => randomUUID());
    e.send({
      type: 'selection',
      surface: '2d',
      featureIds,
      featureMeta: featureIds.map((id) => ({ id, type: 'point' })),
      mapId: map.name,
    });
    await settle(e);

    const { bytes } = await snapshotOf(atlas.id, ownerToken);
    assert.ok(
      bytes < SNAPSHOT_CEILING_BYTES,
      `join snapshot grew to ${bytes} bytes — the raw selection array is retained`
    );
  });

  it('answers an over-sized selection with VALIDATION_ERROR (and keeps the socket open)', async () => {
    const { atlas, map } = await freshAtlas();

    const e = await connect(atlas.id, editorToken, `e2-${randomUUID().slice(0, 8)}`);
    e.send({
      type: 'selection',
      surface: '2d',
      featureIds: Array.from({ length: 60000 }, () => randomUUID()),
      mapId: map.name,
    });

    const err = await e.waitForType('error');
    assert.equal(err.code, 'VALIDATION_ERROR');
    await settle(e); // socket still usable
  });

  // ------------------------------------------------------- radius of effect (regression)

  it('keeps a real 2D selection frame intact: peer relay + join snapshot', async () => {
    const { atlas, map } = await freshAtlas();

    const e = await connect(atlas.id, editorToken, `e3-${randomUUID().slice(0, 8)}`);
    const peer = await connect(atlas.id, ownerToken, `p3-${randomUUID().slice(0, 8)}`);

    const ids = [randomUUID(), randomUUID()];
    e.send({
      type: 'selection',
      surface: '2d',
      featureIds: ids,
      featureMeta: [
        { id: ids[0], type: 'military_symbol' },
        { id: ids[1], type: 'coordination_measure' },
      ],
      mapId: map.name,
    });

    const relayed = await peer.waitForType('selection');
    assert.deepEqual(relayed.featureIds, ids);
    assert.equal(relayed.surface, '2d');
    assert.equal(relayed.mapId, map.name);
    assert.deepEqual(relayed.featureMeta, [
      { id: ids[0], type: 'military_symbol' },
      { id: ids[1], type: 'coordination_measure' },
    ]);

    const { connected } = await snapshotOf(atlas.id, viewerToken);
    const entry = connected.usersOnline.find((u) => u.id === editor.id);
    assert.ok(entry, 'editor missing from the join snapshot');
    assert.deepEqual(entry.selectedFeatures, ids);
    assert.equal(entry.selectionContext.surface, '2d');
    assert.equal(entry.selectionContext.mapId, map.name);
    assert.deepEqual(entry.selectionContext.featureIds, ids);
    assert.equal(entry.selectionContext.featureMeta.length, 2);
  });

  it('keeps 3D and 360 scoped selections intact (tilesetId / photoName)', async () => {
    const { atlas, map } = await freshAtlas();

    const e = await connect(atlas.id, editorToken, `e4-${randomUUID().slice(0, 8)}`);
    const peer = await connect(atlas.id, ownerToken, `p4-${randomUUID().slice(0, 8)}`);

    const markerId = randomUUID();
    e.send({ type: 'selection', surface: '3d', featureIds: [markerId], mapId: map.name, tilesetId: TILE });
    const r3d = await peer.waitForType('selection');
    assert.equal(r3d.surface, '3d');
    assert.equal(r3d.tilesetId, TILE);
    assert.deepEqual(r3d.featureIds, [markerId]);

    peer.clearMessages();
    const poiId = randomUUID();
    e.send({
      type: 'selection',
      surface: '360',
      featureIds: [poiId],
      mapId: map.name,
      photoName: FOTO,
    });
    const r360 = await peer.waitForType('selection');
    assert.equal(r360.surface, '360');
    assert.equal(r360.photoName, FOTO);
    assert.deepEqual(r360.featureIds, [poiId]);

    // Deselect (empty list) must still travel — it is what clears the peer's highlight.
    peer.clearMessages();
    e.send({ type: 'selection', surface: '3d', featureIds: [], mapId: map.name, tilesetId: TILE });
    const cleared = await peer.waitForType('selection');
    assert.deepEqual(cleared.featureIds, []);
  });

  it('keeps real cursor frames intact (relay + snapshot)', async () => {
    const { atlas, map } = await freshAtlas();

    const v = await connect(atlas.id, viewerToken, `v5-${randomUUID().slice(0, 8)}`);
    const peer = await connect(atlas.id, ownerToken, `p5-${randomUUID().slice(0, 8)}`);

    // Exactly what presence-bridge.js emits: a float lng/lat pair + the map NAME.
    v.send({ type: 'cursor', position: { lng: -43.20991234567891, lat: -22.90112345678912 }, mapId: map.name });
    const cur = await peer.waitForCursor();
    assert.deepEqual(cur.position, { lng: -43.20991234567891, lat: -22.90112345678912 });
    assert.equal(cur.mapId, map.name);

    // A map switch piggybacks on a POSITIONLESS cursor frame (broadcastCurrentMap).
    peer.clearMessages();
    v.send({ type: 'cursor', position: null, mapId: map.name });
    const noPos = await peer.waitForCursor();
    assert.equal(noPos.position, null);
    assert.equal(noPos.mapId, map.name);

    // Re-send a positioned cursor (the positionless map-switch frame above legitimately
    // clears the retained position) and check what a late joiner actually receives.
    v.send({ type: 'cursor', position: { lng: -43.20991234567891, lat: -22.90112345678912 }, mapId: map.name });
    await settle(v);

    const { connected } = await snapshotOf(atlas.id, ownerToken);
    const entry = connected.usersOnline.find((u) => u.id === viewer.id);
    assert.ok(entry, 'viewer missing from the join snapshot');
    assert.deepEqual(entry.cursorPosition, { lng: -43.20991234567891, lat: -22.90112345678912 });
    assert.equal(entry.mapId, map.name);
  });

  it('keeps 3D and 360 cursors intact, each with ITS position shape and scope', async () => {
    const { atlas, map } = await freshAtlas();

    const e = await connect(atlas.id, editorToken, `e8-${randomUUID().slice(0, 8)}`);
    const peer = await connect(atlas.id, ownerToken, `p8-${randomUUID().slice(0, 8)}`);

    // 360: direcao na esfera (heading em graus, pitch em radianos), escopada pela foto.
    e.send({
      type: 'cursor',
      surface: '360',
      position: { heading: 187.53, pitch: -0.2137 },
      mapId: map.name,
      photoName: FOTO,
    });
    const c360 = await peer.waitForCursor();
    assert.equal(c360.surface, '360');
    assert.equal(c360.photoName, FOTO);
    assert.deepEqual(c360.position, { heading: 187.53, pitch: -0.2137 });

    // 3D: ponto picado no tileset, com altura, escopado pelo modelo.
    peer.clearMessages();
    e.send({
      type: 'cursor',
      surface: '3d',
      position: { lng: -43.2099, lat: -22.9011, alt: 15.75 },
      mapId: map.name,
      tilesetId: TILE,
    });
    const c3d = await peer.waitForCursor();
    assert.equal(c3d.surface, '3d');
    assert.equal(c3d.tilesetId, TILE);
    assert.deepEqual(c3d.position, { lng: -43.2099, lat: -22.9011, alt: 15.75 });

    // E o que o late joiner recebe carrega a superficie junto: sem ela o roster desenharia o
    // cursor do panorama sobre o mapa.
    await settle(e);
    const { connected } = await snapshotOf(atlas.id, ownerToken);
    const entry = connected.usersOnline.find((u) => u.id === editor.id);
    assert.ok(entry, 'editor missing from the join snapshot');
    assert.deepEqual(entry.cursorPosition, { lng: -43.2099, lat: -22.9011, alt: 15.75 });
    assert.equal(entry.cursorContext?.surface, '3d');
    assert.equal(entry.cursorContext?.tilesetId, TILE);
  });

  it('RECUSA a posicao da superficie errada, em vez de repassar meia coordenada', async () => {
    // O PIOR CASO desta regua, e o unico jeito de ela provar alguma coisa: `stripUnknown` APAGA o
    // que o schema nao declara, entao um schema frouxo aceitaria `{lng,lat}` rotulado como 360 e
    // entregaria ao par um cursor sem posicao nenhuma, sem erro em lugar algum. Cada superficie
    // tem de ter a regua dela.
    const { atlas, map } = await freshAtlas();

    const e = await connect(atlas.id, editorToken, `e9-${randomUUID().slice(0, 8)}`);
    const peer = await connect(atlas.id, ownerToken, `p9-${randomUUID().slice(0, 8)}`);

    // Forma de mapa declarada como 360.
    e.send({ type: 'cursor', surface: '360', position: { lng: 1, lat: 2 }, mapId: map.name, photoName: 'f.jpg' });
    const err1 = await e.waitForType('error');
    assert.equal(err1.code, 'VALIDATION_ERROR');

    // Forma de esfera declarada como mapa.
    e.send({ type: 'cursor', surface: '2d', position: { heading: 10, pitch: 0 }, mapId: map.name });
    const err2 = await e.waitForType('error');
    assert.equal(err2.code, 'VALIDATION_ERROR');

    // 3D sem altura: o ponto picado sem `alt` nao situa nada na cena.
    e.send({ type: 'cursor', surface: '3d', position: { lng: 1, lat: 2 }, mapId: map.name, tilesetId: 't1' });
    const err3 = await e.waitForType('error');
    assert.equal(err3.code, 'VALIDATION_ERROR');

    // Nenhum dos tres chegou ao par, e o socket segue de pe.
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(peer.messages.filter((m) => m.type === 'cursor' || m.type === 'cursors').length, 0);
    e.send({ type: 'cursor', surface: '2d', position: { lng: 1, lat: 2 }, mapId: map.name });
    const ok = await peer.waitForCursor();
    assert.deepEqual(ok.position, { lng: 1, lat: 2 });
  });

  it('a longitude past the antimeridian is still accepted (MapLibre does not clamp)', async () => {
    const { atlas, map } = await freshAtlas();

    const v = await connect(atlas.id, viewerToken, `v6-${randomUUID().slice(0, 8)}`);
    const peer = await connect(atlas.id, ownerToken, `p6-${randomUUID().slice(0, 8)}`);

    v.send({ type: 'cursor', position: { lng: 197.5, lat: -22.9 }, mapId: map.name });
    const cur = await peer.waitForCursor();
    assert.deepEqual(cur.position, { lng: 197.5, lat: -22.9 });
  });

  it('read and comment still never emit a selection', async () => {
    const { atlas, map } = await freshAtlas();

    const v = await connect(atlas.id, viewerToken, `v7-${randomUUID().slice(0, 8)}`);
    const c = await connect(atlas.id, commenterToken, `c7-${randomUUID().slice(0, 8)}`);
    const peer = await connect(atlas.id, ownerToken, `p7-${randomUUID().slice(0, 8)}`);

    v.send({ type: 'selection', surface: '2d', featureIds: [randomUUID()], mapId: map.name });
    c.send({ type: 'selection', surface: '2d', featureIds: [randomUUID()], mapId: map.name });
    await settle(v);
    await settle(c);
    await new Promise((r) => setTimeout(r, 150));

    assert.equal(peer.getMessagesOfType('selection').length, 0);

    const { connected } = await snapshotOf(atlas.id, ownerToken);
    for (const id of [viewer.id, commenter.id]) {
      const entry = connected.usersOnline.find((u) => u.id === id);
      // Both sockets are still open, so both users MUST be in the roster: a
      // missing entry used to make the two assertions below silently vanish.
      assert.ok(entry, `user ${id} must appear in the presence roster`);
      assert.deepEqual(entry.selectedFeatures, [], 'read/comment must not retain a selection');
      // Era `undefined` — a AUSÊNCIA da chave no fio — e isso congelava um defeito de
      // shape, não a regra que este teste existe para provar: `ws.selectionContext`
      // nunca era inicializado, então `JSON.stringify` removia a chave e o frame
      // `connected` mudava de FORMA conforme o par já ter emitido uma seleção ou não
      // (o vizinho `selectedFeatures` já tinha default). Desde
      // 2026-07-25 o campo é inicializado a `null` em onConnection; a regra afirmada
      // aqui — read/comment não retêm seleção — é a mesma, agora com shape estável.
      // Shape completo do roster em tests/ws/collab-users-online-shape.test.js.
      assert.equal(entry.selectionContext, null);
    }
  });
});
