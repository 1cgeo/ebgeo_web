// Path: tests/integration/foto-anexa-na-copia-e-na-importacao.repro.test.js
//
// FASE 2c DAS FOTOS ANEXAS (2026-09-24). Desde a fase 2b a foto anexa a uma FEIÇÃO é uma linha de
// `images` com referência em `properties.images[].id`, e dois caminhos do servidor não sabiam disso:
//
//   - o CLONE copia toda linha de `images` para ids novos, mas `rewriteFeatureProperties` só
//     reescrevia o id da feição de imagem e o `markerSymbol`: a foto da cópia apontava para o id do
//     atlas de ORIGEM, e a leitura, escopada pelo par (id, atlas), respondia 404 para sempre;
//   - a IMPORTAÇÃO ATÔMICA não citava foto de feição (`importImageIds`), então o manifesto aceitava
//     um atlas que apontava para uma foto que nunca subiu. E citava a foto INLINE de 3D/360, que
//     viaja dentro do item: o cliente era obrigado a declará-la ausente.
//
// Duplicar mapa NÃO reescreve: o mapa novo fica no MESMO atlas, e a foto é um blob imutável
// compartilhado (a coleta da fase 2e conta as duas referências).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

// 1x1 PNG, real magic bytes (the upload sniffs the content).
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const INLINE = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

describe('fase 2c · a foto anexa de feição na cópia e na importação atômica', () => {
  let app, db, owner, token;
  const req = (method, path) => supertest(app)[method](`/api/v1/atlas${path}`).set('Authorization', `Bearer ${token}`);

  before(async () => {
    ({ app, db } = await setupTestEnv());
    owner = await createUser(db, { username: `foto2c_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, owner.username, owner.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const snapshot = async (atlasId) => (await req('get', `/${atlasId}/sync/0`).expect(200)).body.data.snapshot;

  /** A source atlas with a point carrying one photo by reference and one inline. */
  async function atlasComFoto() {
    const atlas = await createAtlas(db, owner.id, { name: `Foto 2c ${randomUUID().slice(0, 6)}` });
    const map = await createMap(db, atlas.id, { name: 'Mapa com foto' });
    const fotoId = randomUUID();
    await req('post', `/${atlas.id}/images/bulk`)
      .send({ images: [{ localId: fotoId, filename: 'foto.png', mimeType: 'image/png', data: PNG_B64 }] })
      .expect(201);
    const pointId = randomUUID();
    const images = [
      { id: fotoId, name: 'foto.png', type: 'image/png', thumbnail: 'data:image/jpeg;base64,/9j/', addedAt: 1 },
      { id: randomUUID(), name: 'velha.gif', data: INLINE },
    ];
    await db.query(
      `INSERT INTO features (id, map_id, feature_type, geometry, properties)
       VALUES ($1, $2, 'point', $3::jsonb, $4::jsonb)`,
      [pointId, map.id, JSON.stringify({ type: 'Point', coordinates: [-43.2, -22.9] }),
        JSON.stringify({ id: pointId, nome: 'Ponto', images })]
    );
    return { atlas, map, fotoId, images };
  }

  it('o clone reescreve o id da foto por referência, e ela abre DENTRO do clone', async () => {
    const src = await atlasComFoto();
    const cloneId = (await req('post', `/${src.atlas.id}/clone`).send({}).expect(201)).body.data.id;

    const [ponto] = (await snapshot(cloneId)).maps[0].features.points;
    const [foto, inline] = ponto.properties.images;
    assert.notEqual(foto.id, src.fotoId, 'the photo of the copy points at the copied row');
    assert.equal(foto.name, 'foto.png');
    assert.equal(foto.thumbnail, src.images[0].thumbnail);
    const bytes = await req('get', `/${cloneId}/images/${foto.id}`).expect(200);
    assert.deepEqual(bytes.body, Buffer.from(PNG_B64, 'base64'));
    // The failure mode being fixed: the source id does not resolve inside the clone.
    await req('get', `/${cloneId}/images/${src.fotoId}`).expect(404);
    // An inline photo carries its bytes and passes untouched.
    assert.deepEqual(inline, src.images[1]);
  });

  it('duplicar mapa mantém o id da foto (mesmo atlas, blob compartilhado) e ela abre', async () => {
    const src = await atlasComFoto();
    const newMapId = (await req('post', `/${src.atlas.id}/maps/${src.map.id}/duplicate`).expect(201)).body.data.id;
    const dup = (await snapshot(src.atlas.id)).maps.find((m) => m.id === newMapId);
    assert.equal(dup.features.points[0].properties.images[0].id, src.fotoId);
    await req('get', `/${src.atlas.id}/images/${src.fotoId}`).expect(200);
  });

  describe('importação atômica', () => {
    const rascunho = (images, imageIds) => ({
      id: randomUUID(), sourceKey: randomUUID().replace(/-/g, '').padEnd(64, '0'), imageIds,
      payload: { atlas: { name: 'Import 2c' }, maps: [{ id: randomUUID(), name: 'M', features: [{
        id: randomUUID(), feature_type: 'point', geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { images } }] }] },
    });

    it('cita a foto de feição por referência: o manifesto sem ela é recusado', async () => {
      const foto = randomUUID();
      await req('post', '/imports').send(rascunho([{ id: foto, name: 'f.jpg' }], [])).expect(400);
      const ok = rascunho([{ id: foto, name: 'f.jpg' }], [foto]);
      await req('post', '/imports').send(ok).expect(201);
      await req('post', `/imports/${ok.id}/commit`).send({}).expect(409);
      await req('post', `/imports/${ok.id}/images`).send({ images: [{ localId: foto, filename: 'f.png', mimeType: 'image/png', data: PNG_B64 }] }).expect(200);
      const atlas = (await req('post', `/imports/${ok.id}/commit`).send({}).expect(201)).body.data;
      const ponto = (await snapshot(atlas.id)).maps[0].features.points[0];
      assert.equal(ponto.properties.images[0].id, foto);
      await req('get', `/${atlas.id}/images/${foto}`).expect(200);
    });

    it('NÃO cita a foto inline (feição e 3D): ela viaja no documento e não é original a esperar', async () => {
      const draft = rascunho([{ id: randomUUID(), data: INLINE }], []);
      draft.payload.maps[0].cesium3dData = [{ id: randomUUID(), data_type: 'marker', tileset_id: null,
        data: { images: [{ id: randomUUID(), data: INLINE }] } }];
      await req('post', '/imports').send(draft).expect(201);
      await req('post', `/imports/${draft.id}/commit`).send({}).expect(201);
    });
  });
});
