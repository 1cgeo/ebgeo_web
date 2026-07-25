// Path: tests/integration/sv360-target-override-patch.repro.test.js
// Repro/regressão: PUT /sv360/photos/:uuid/targets/:targetId/override era um
// REPLACE disfarçado de patch. O service mandava `overrides.x ?? null` para as três
// colunas, então todo campo AUSENTE do corpo chegava ao SQL como NULL e era APAGADO:
// mandar só override_bearing zerava distance e height do mesmo link.
//
// O campo tem TRÊS estados, não dois, e o teste prova os três separadamente:
//   - número       -> DEFINE
//   - null explícito -> LIMPA
//   - chave ausente  -> MANTÉM
// `??`, `||` e COALESCE colapsam dois desses três (e `||` ainda comeria o 0
// legítimo). A forma adotada é a flag "provided?" (`campo !== undefined`) por
// coluna, com `CASE WHEN $N THEN $M ELSE coluna END` no SQL — a mesma de
// UPDATE_ATLAS / UPDATE_ORGANIZATION / UPDATE_RANK.
//
// Cada caso afirma o campo tocado E os não tocados: sem a segunda metade o replace
// antigo passaria verde.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

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

const SLUG = `ovr-patch-${RID}`;
const src = uuidv5(`default/${SLUG}/src.jpg`);
const dst = uuidv5(`default/${SLUG}/dst.jpg`);

const url = (p) => `/api/v1/sv360${p}`;

// Estado semeado antes de CADA caso (valores distintos entre si, para que uma troca
// de coluna não passe despercebida).
const SEMENTE = { b: 7, d: 8, h: 9 };

describe('StreetView 360 — override de target é PATCH, não REPLACE', () => {
  let app, db, orgId, token, projectId;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    orgId = org.rows[0].id;
    token = jwt.sign(
      {
        sub: randomUUID(),
        username: `ovrp_${RID}`,
        role: 'user',
        organization_id: orgId,
        org_role: 'editor',
      },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );

    const proj = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Override patch', -23.5, -46.6, $3, 'enabled', 2) RETURNING id`,
      [orgId, SLUG, `${orgId}__${SLUG}.db`]
    );
    projectId = proj.rows[0].id;

    let seq = 0;
    for (const id of [src, dst]) {
      await db.query(
        `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
         VALUES ($1, $2, $3, $4, -23.5, -46.6)`,
        [id, projectId, `${id}.jpg`, ++seq]
      );
    }
  });

  beforeEach(async () => {
    await db.query(`DELETE FROM sv360.targets WHERE source_id = $1`, [src]);
    await db.query(
      `INSERT INTO sv360.targets
         (source_id, target_id, distance_m, bearing_deg, is_next, is_original,
          override_bearing, override_distance, override_height, hidden)
       VALUES ($1, $2, 10, 90, true, true, $3, $4, $5, false)`,
      [src, dst, SEMENTE.b, SEMENTE.d, SEMENTE.h]
    );
  });

  after(async () => {
    await db.query(`DELETE FROM sv360.targets WHERE source_id = $1`, [src]);
    await db.query(`DELETE FROM sv360.photos WHERE project_id = $1`, [projectId]);
    await db.query(`DELETE FROM sv360.projects WHERE id = $1`, [projectId]);
    await teardownTestEnv(db);
  });

  // Lê a linha crua. NÃO converte com Number(): Number(null) === 0, o que tornaria
  // "limpo" e "zero legítimo" indistinguíveis — a confusão exata que o fix desfaz.
  async function linha() {
    const { rows } = await db.query(
      `SELECT override_bearing, override_distance, override_height
         FROM sv360.targets WHERE source_id = $1 AND target_id = $2`,
      [src, dst]
    );
    return rows[0];
  }

  // `null` continua null; qualquer outra coisa vira número (float8 pode voltar como
  // string dependendo do parser).
  const num = (v) => (v === null ? null : Number(v));

  async function estado() {
    const r = await linha();
    return {
      b: num(r.override_bearing),
      d: num(r.override_distance),
      h: num(r.override_height),
    };
  }

  function put(body) {
    return supertest(app)
      .put(url(`/photos/${src}/targets/${dst}/override`))
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('campo AUSENTE mantém o valor (o bug: um PUT parcial zerava os outros dois)', async () => {
    const res = await put({ override_bearing: 42 }).expect(200);

    assert.deepEqual(
      await estado(),
      { b: 42, d: SEMENTE.d, h: SEMENTE.h },
      'só o campo enviado muda; os ausentes permanecem'
    );

    const t = res.body.targets.find((x) => x.id === dst);
    assert.deepEqual(
      { b: t.override_bearing, d: t.override_distance, h: t.override_height },
      { b: 42, d: SEMENTE.d, h: SEMENTE.h },
      'o shape congelado devolvido precisa refletir a linha, não o corpo enviado'
    );
  });

  it('null explícito LIMPA só o campo enviado', async () => {
    await put({ override_distance: null }).expect(200);

    assert.deepEqual(
      await estado(),
      { b: SEMENTE.b, d: null, h: SEMENTE.h },
      'null limpa a própria coluna e não toca nas irmãs'
    );
  });

  it('ausente e null são estados DISTINTOS na mesma coluna', async () => {
    await put({ override_bearing: 1 }).expect(200);
    const depoisDeAusente = (await estado()).d;

    await put({ override_distance: null }).expect(200);
    const depoisDeNull = (await estado()).d;

    assert.equal(depoisDeAusente, SEMENTE.d, 'ausente manteve');
    assert.equal(depoisDeNull, null, 'null limpou');
    assert.notEqual(
      depoisDeAusente,
      depoisDeNull,
      'se os dois caminhos dessem o mesmo resultado, o patch teria colapsado em replace'
    );
  });

  // Falsy legítimo: 0 é um override VÁLIDO (override_height 0 = solo, o default do
  // projetor). `||` o trocaria pelo valor antigo; um "provided?" derivado de
  // truthiness o trataria como ausente.
  it('0 é gravado como 0, não confundido com ausente nem com null', async () => {
    await put({ override_height: 0 }).expect(200);

    const r = await linha();
    assert.notEqual(r.override_height, null, '0 não pode virar NULL');
    assert.equal(Number(r.override_height), 0, '0 precisa chegar à coluna');
    assert.deepEqual(
      await estado(),
      { b: SEMENTE.b, d: SEMENTE.d, h: 0 },
      'gravar 0 não pode arrastar as outras colunas'
    );
  });

  it('um 0 já gravado SOBREVIVE a um PUT que não menciona a coluna', async () => {
    await put({ override_bearing: 0, override_distance: 0, override_height: 0 }).expect(200);
    assert.deepEqual(await estado(), { b: 0, d: 0, h: 0 }, 'guard: os três zerados de propósito');

    await put({ override_bearing: 5 }).expect(200);

    assert.deepEqual(
      await estado(),
      { b: 5, d: 0, h: 0 },
      'os 0 legítimos ausentes do corpo continuam 0 (não viram NULL nem somem)'
    );
  });

  it('um null já gravado SOBREVIVE a um PUT que não menciona a coluna', async () => {
    await put({ override_height: null }).expect(200);
    await put({ override_bearing: 3 }).expect(200);

    assert.deepEqual(
      await estado(),
      { b: 3, d: SEMENTE.d, h: null },
      'manter é manter também quando o valor mantido é NULL'
    );
  });

  it('corpo com os três campos ainda funciona como REPLACE completo', async () => {
    await put({ override_bearing: 11, override_distance: null, override_height: 12 }).expect(200);

    assert.deepEqual(
      await estado(),
      { b: 11, d: null, h: 12 },
      'o cliente que manda tudo continua obtendo exatamente o que mandou'
    );
  });
});
