// Path: tests/integration/clone-leva-figura-de-slide.repro.test.js
//
// O CLONE LEVA A FIGURA DE SLIDE POR REFERÊNCIA (decisão do dono de 2026-09-26).
//
// A figura de um slide deixou de morar no HTML como data URL: os bytes vivem em `images` e o
// `slides.content` cita `https://figura.ebgeo/<id da imagem>`. O clone de atlas copia TODA imagem da
// origem sob um id NOVO (o id de `images` é chave global), e reescrevia o id nos lugares que
// conhecia (feição de imagem, ícone, fotos anexas). O HTML do slide e as notas do mapa ficavam de
// fora: o slide clonado citaria a imagem da ORIGEM, que o cliente pede ao atlas ATIVO e recebe 404
// para sempre, e a figura some no clone sem erro nenhum.
//
// E O IMPORT EXIGE OS BYTES DA FIGURA: `importImageIds` passa a citar as figuras, senão um envio
// que declarasse uma figura ausente seria recusado ("imagem que o atlas não cita"), e um envio sem
// ela publicaria um slide citando bytes que o atlas nunca recebeu.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createBriefing, createSlide, loginUser } from '../helpers/fixtures.js';
import { importImageIds } from '../../src/modules/atlas/import-image-refs.js';

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SENTINELA = /https:\/\/figura\.ebgeo\/([0-9a-f-]{36})/;
const comFigura = (id) => `<p>legenda</p><p><img src="https://figura.ebgeo/${id}" width="320"></p>`;

describe('clone e import: a figura de slide por referência', () => {
  let app, db, owner, token;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `figslide_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, owner.username, owner.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('REPRO: o slide e as notas do clone citam a imagem DO CLONE, e ela responde 200', async () => {
    const atlas = await createAtlas(db, owner.id, { name: `Fig src ${randomUUID().slice(0, 6)}` });
    const map = await createMap(db, atlas.id, { name: 'Mapa' });
    const figura = randomUUID();
    const colada = randomUUID();
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({ images: [figura, colada].map((localId) => ({ localId, filename: `${localId}.png`, mimeType: 'image/png', data: PNG_B64 })) })
      .expect(201);
    const briefing = await createBriefing(db, atlas.id);
    await createSlide(db, briefing.id, { content: comFigura(figura), map_id: map.id });
    await db.query('UPDATE maps SET notes_description = $2 WHERE id = $1', [map.id, comFigura(colada)]);

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/clone`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const cloneId = res.body.data.id;

    const { rows: [slide] } = await db.query(
      `SELECT s.content FROM slides s JOIN briefings b ON b.id = s.briefing_id WHERE b.atlas_id = $1`, [cloneId]);
    const { rows: [mapa] } = await db.query('SELECT notes_description FROM maps WHERE atlas_id = $1', [cloneId]);
    const doSlide = slide.content.match(SENTINELA)?.[1];
    const dasNotas = mapa.notes_description.match(SENTINELA)?.[1];
    assert.ok(doSlide && dasNotas, 'o clone perdeu a referência');
    assert.notEqual(doSlide, figura, 'o slide do clone cita a imagem da ORIGEM');
    assert.notEqual(dasNotas, colada, 'as notas do clone citam a imagem da ORIGEM');
    assert.ok(slide.content.includes('width="320"') && slide.content.includes('<p>legenda</p>'), 'o resto do HTML mudou');

    for (const id of [doSlide, dasNotas]) {
      const blob = await supertest(app)
        .get(`/api/v1/atlas/${cloneId}/images/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      assert.deepEqual(blob.body, Buffer.from(PNG_B64, 'base64'));
    }
    // A origem continua citando a própria imagem: o clone copia, nunca rouba.
    const { rows: [original] } = await db.query(
      `SELECT s.content FROM slides s JOIN briefings b ON b.id = s.briefing_id WHERE b.atlas_id = $1`, [atlas.id]);
    assert.equal(original.content.match(SENTINELA)?.[1], figura);
  });

  it('o import cita a figura do slide e a das notas; a figura inline antiga não', () => {
    const [figura, colada] = [randomUUID(), randomUUID()];
    const payload = {
      maps: [{ features: [], notes_description: comFigura(colada) }],
      briefings: [{ slides: [{ content: comFigura(figura) }, { content: '<img src="data:image/png;base64,iVBOR">' }] }],
    };
    assert.deepEqual([...importImageIds(payload)].sort(), [figura, colada].sort());
  });
});
