// Path: tests/integration/sv360-write-tombstone-tx.repro.test.js
// Repro/regressão do achado 68: escritas do sv360 persistiam FORA de transação
// e só depois respondiam 404 — a mesma falha que a lição L8 corrigiu em
// updateCalibration ficou nas funções irmãs (visibilidade e criação de link).
//
// Mecânica: loadWritablePhoto usa GET_PHOTO_FOR_WRITE, que DELIBERADAMENTE não exclui
// tombstones (é o que faz o re-delete ser idempotente e a escada 404→403 funcionar);
// rebuildPhotoShape usa GET_PHOTO_BY_ID, que exclui — e lança NotFoundError. Com
// query() solto, cada statement é seu próprio commit: o UPDATE/INSERT COMMITA e o 404
// vem depois. Resultado: escrita persistida que o chamador foi informado que nunca
// aconteceu. Nem GET_TARGET_LINK nem CHECK_TARGET_SAME_PROJECT barram o caminho (o
// primeiro não filtra tombstone; o segundo só filtra o DESTINO).
//
// Cada caso afirma as DUAS metades: o 404 (contrato preservado) E que a linha no
// Postgres não mudou. Sem o tx() a primeira metade passa e a segunda cai.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createProducerUser } from '../helpers/fixtures.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
const RID = randomUUID().slice(0, 8);

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const SLUG = `write-tomb-${RID}`;
const src = uuidv5(`default/${SLUG}/src.jpg`); // a foto tombstonada (origem das escritas)
const dst = uuidv5(`default/${SLUG}/dst.jpg`); // destino do link existente
const spare = uuidv5(`default/${SLUG}/spare.jpg`); // destino do link a criar

const url = (p) => `/api/v1/sv360${p}`;

describe('StreetView 360 — escritas de target em foto tombstonada não deixam resíduo (achado 68)', () => {
  let app, db, orgId, token, projectId;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    orgId = org.rows[0].id;
    // Produtor de verdade da OM dona: `org_role` deixou de autorizar escrita de 360.
    const produtor = await createProducerUser(db, orgId, { username: `wtomb_${RID}` });
    token = jwt.sign(
      {
        sub: produtor.id,
        username: `wtomb_${RID}`,
        role: 'producer',
        organization_id: orgId,
        producer_org_id: orgId,
      },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );

    const proj = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Write tombstone', -23.5, -46.6, $3, 'enabled', 3) RETURNING id`,
      [orgId, SLUG, `${orgId}__${SLUG}.db`]
    );
    projectId = proj.rows[0].id;

    let seq = 0;
    for (const id of [src, dst, spare]) {
      await db.query(
        `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
         VALUES ($1, $2, $3, $4, -23.5, -46.6)`,
        [id, projectId, `${id}.jpg`, ++seq]
      );
    }

    // Link existente src -> dst com overrides e visibilidade conhecidos.
    await db.query(
      `INSERT INTO sv360.targets
         (source_id, target_id, distance_m, bearing_deg, is_next, is_original,
          override_bearing, override_distance, override_height, hidden)
       VALUES ($1, $2, 10, 90, true, true, 7, 8, 9, false)`,
      [src, dst]
    );

    // A origem é soft-deletada: o gate de escrita continua enxergando a linha, mas
    // toda leitura (e portanto o rebuild da resposta) passa a devolver 404.
    await db.query(`INSERT INTO sv360.deleted_photos (photo_id) VALUES ($1)`, [src]);
  });

  after(async () => {
    await db.query(`DELETE FROM sv360.deleted_photos WHERE photo_id = ANY($1::text[])`, [
      [src, dst, spare],
    ]);
    await db.query(`DELETE FROM sv360.targets WHERE source_id = ANY($1::text[])`, [[src, dst, spare]]);
    await db.query(`DELETE FROM sv360.photos WHERE project_id = $1`, [projectId]);
    await db.query(`DELETE FROM sv360.projects WHERE id = $1`, [projectId]);
    await teardownTestEnv(db);
  });

  const link = () =>
    db.query(
      `SELECT override_bearing, override_distance, override_height, hidden
         FROM sv360.targets WHERE source_id = $1 AND target_id = $2`,
      [src, dst]
    );

  it('updateTargetVisibility: 404 e hidden permanece false', async () => {
    const res = await supertest(app)
      .put(url(`/photos/${src}/targets/${dst}/visibility`))
      .set('Authorization', `Bearer ${token}`)
      .send({ hidden: true })
      .expect(404);
    assert.equal(typeof res.body.error, 'string'); // envelope plano do módulo

    const { rows } = await link();
    assert.equal(rows[0].hidden, false, 'a visibilidade não pode ter sido mutada');
  });

  it('createTarget: 404 e nenhum link novo é inserido', async () => {
    await supertest(app)
      .post(url(`/photos/${src}/targets`))
      .set('Authorization', `Bearer ${token}`)
      .send({ target_id: spare, distance_m: 5, bearing_deg: 180 })
      .expect(404);

    const { rows } = await db.query(
      `SELECT 1 FROM sv360.targets WHERE source_id = $1 AND target_id = $2`,
      [src, spare]
    );
    assert.equal(rows.length, 0, 'o link não pode existir depois de um 404');
  });

  it('updateCalibration (já corrigida pelo L8) segue sem resíduo — invariante irmã', async () => {
    await supertest(app)
      .put(url(`/photos/${src}/calibration`))
      .set('Authorization', `Bearer ${token}`)
      .send({ heading: 123 })
      .expect(404);

    const { rows } = await db.query(`SELECT heading FROM sv360.photos WHERE id = $1`, [src]);
    assert.equal(Number(rows[0].heading), 0, 'a calibração não pode ter sido gravada');
  });

  // As rotas GRANULARES reentram no MESMO updateCalibration com um único campo, e
  // nenhuma delas era exercitada sobre foto tombstonada. Isso importa porque o
  // whitelist de colunas (CALIBRATION_COLUMN_WHITELIST) mapeia nomes de rota para
  // COLUNAS DIFERENTES: um caso só sobre `heading` deixa o resto do mapa sem prova.
  const GRANULARES = [
    { rota: 'rotation-x', corpo: { mesh_rotation_x: 45 }, coluna: 'mesh_rotation_x' },
    { rota: 'rotation-z', corpo: { mesh_rotation_z: 30 }, coluna: 'mesh_rotation_z' },
  ];

  for (const g of GRANULARES) {
    it(`PUT /photos/:uuid/${g.rota} em foto tombstonada: 404 e ${g.coluna} inalterada`, async () => {
      const antes = await db.query(
        `SELECT ${g.coluna} AS v FROM sv360.photos WHERE id = $1`,
        [src]
      );
      assert.equal(antes.rows.length, 1, 'guard: a foto tombstonada continua na tabela');

      await supertest(app)
        .put(url(`/photos/${src}/${g.rota}`))
        .set('Authorization', `Bearer ${token}`)
        .send(g.corpo)
        .expect(404);

      const depois = await db.query(
        `SELECT ${g.coluna} AS v FROM sv360.photos WHERE id = $1`,
        [src]
      );
      assert.equal(
        Number(depois.rows[0].v),
        Number(antes.rows[0].v),
        'o 404 é a promessa de que nada foi escrito; a coluna é a prova'
      );
      assert.notEqual(
        Number(depois.rows[0].v),
        Number(Object.values(g.corpo)[0]),
        'o valor enviado não pode ter chegado à coluna'
      );
    });
  }

  // Controle POSITIVO na mesma classe de rota. Sem ele, todos os 404 acima
  // continuariam verdes se a rota granular tivesse simplesmente deixado de existir
  // (um 404 de rota inexistente é indistinguível de um 404 de tombstone).
  it('controle positivo: a mesma PUT numa foto VIVA responde 200 e persiste', async () => {
    const res = await supertest(app)
      .put(url(`/photos/${dst}/rotation-x`))
      .set('Authorization', `Bearer ${token}`)
      .send({ mesh_rotation_x: 12.5 })
      .expect(200);
    assert.equal(res.body.camera?.id, dst, 'a resposta é o shape congelado da foto');

    const { rows } = await db.query(`SELECT mesh_rotation_x FROM sv360.photos WHERE id = $1`, [dst]);
    assert.equal(Number(rows[0].mesh_rotation_x), 12.5, 'a escrita legítima precisa persistir');
  });
});
