// Path: tests/integration/sv360-by-name-tiebreak.test.js
// GET /sv360/photos/by-name/:nome — a PRIMEIRA chave do ORDER BY de
// GET_PHOTO_BY_NAME (sv360.queries.js), `(pr.organization_id = $2) DESC`, que nunca
// foi exercitada.
//
// O desempate tem duas chaves, nesta ordem: a org do CHAMADOR primeiro, o status
// `enabled` depois. Os casos que existem (sv360-gaps.test.js:242-266) só montam
// cenários em que o projeto `enabled` é a resposta certa — e esses passam igual com
// a ordenação ANTIGA, que olhava só o status. O caso que separa as duas ordenações é
// exatamente o que falta: a foto está num projeto DISABLED da org do chamador E
// noutro projeto ENABLED de OUTRA org.
//
// Por que a preferência por org vem primeiro: ordenando só por status, o membro
// recebia a linha da outra org e o gate de legibilidade a transformava em 404 —
// um falso negativo sobre dado da própria casa.
//
// CONTROLE NEGATIVO: remover a primeira chave do ORDER BY.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, createProducerUser } from '../helpers/fixtures.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
const RID = crypto.randomUUID().slice(0, 8);

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

// O MESMO original_name em dois projetos de orgs diferentes — a colisão que o
// desempate existe para resolver.
const NOME = `colisao-${RID}.jpg`;

const SLUG_A = `bynamedisab-a-${RID}`; // org A, projeto DISABLED
const SLUG_B = `bynameenab-b-${RID}`; // org B, projeto ENABLED

const fotoA = uuidv5(`orgA/${SLUG_A}/${NOME}`);
const fotoB = uuidv5(`orgB/${SLUG_B}/${NOME}`);

const url = (p) => `/api/v1/sv360${p}`;

describe('StreetView 360 — by-name: a org do chamador desempata ANTES do status', () => {
  let app, db, orgA, orgB, tokenA, tokenB, tokenAdmin;

  // A LEITURA DE PROJETO OCULTO/PRIVADO passou de `organization_id` (LOTACAO
  // auto-declarada no auto-cadastro) para `producer_org_id` (ESCOPO DE PRODUCAO,
  // concedido por administrador) e e resolvida NO SQL, a partir do UUID — por isso o
  // `sub` destes tokens precisa ser um usuario de VERDADE.
  function token({ organization_id, role = 'user', producer_org_id = null, sub = crypto.randomUUID() }) {
    return jwt.sign(
      {
        sub, username: `bn_${RID}_${sub.slice(0, 8)}`, role,
        organization_id, producer_org_id,
      },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const a = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla) VALUES ('OM A ByName', $1, 'BNA') RETURNING id`,
      [`sv360-byname-a-${RID}`]
    );
    orgA = a.rows[0].id;
    const b = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla) VALUES ('OM B ByName', $1, 'BNB') RETURNING id`,
      [`sv360-byname-b-${RID}`]
    );
    orgB = b.rows[0].id;

    const pa = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Projeto A (disabled)', -23, -46, $3, 'disabled', 1) RETURNING id`,
      [orgA, SLUG_A, `${orgA}__${SLUG_A}.db`]
    );
    const pb = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Projeto B (enabled)', -23, -46, $3, 'enabled', 1) RETURNING id`,
      [orgB, SLUG_B, `${orgB}__${SLUG_B}.db`]
    );

    await db.query(
      `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
       VALUES ($1, $2, $3, 1, -23, -46), ($4, $5, $3, 1, -23.1, -46.1)`,
      [fotoA, pa.rows[0].id, NOME, fotoB, pb.rows[0].id]
    );

    const produtorA = await createProducerUser(db, orgA, { username: `bn_pa_${RID}` });
    const produtorB = await createProducerUser(db, orgB, { username: `bn_pb_${RID}` });
    const administrador = await createAdminUser(db, { username: `bn_adm_${RID}` });
    tokenA = token({ organization_id: orgA, producer_org_id: orgA, sub: produtorA.id });
    tokenB = token({ organization_id: orgB, producer_org_id: orgB, sub: produtorB.id });
    tokenAdmin = token({ organization_id: orgB, role: 'admin', sub: administrador.id });
  });

  after(async () => {
    await db.query(`DELETE FROM sv360.photos WHERE id = ANY($1::text[])`, [[fotoA, fotoB]]);
    await db.query(`DELETE FROM sv360.projects WHERE slug = ANY($1::text[])`, [[SLUG_A, SLUG_B]]);
    // O PRODUTOR PRECISA CAIR ANTES DA OM: `users.producer_org_id` é FK sem ON DELETE,
    // então apagar a organização com um produtor de pé levanta 23503 dentro do `after`
    // — uma suíte inteiramente verde que termina vermelha por limpeza.
    await db.query('DELETE FROM public.users WHERE producer_org_id = ANY($1::uuid[])', [[orgA, orgB]]);
    await db.query(`DELETE FROM public.organizations WHERE id = ANY($1::uuid[])`, [[orgA, orgB]]);
    await teardownTestEnv(db);
  });

  it('guarda: as duas fotos existem e compartilham o MESMO original_name', async () => {
    // Se a semeadura tivesse falhado, todo desempate abaixo seria vacuoso — haveria
    // uma linha só e qualquer ORDER BY devolveria a mesma coisa.
    const { rows } = await db.query(
      `SELECT p.id, pr.status, pr.organization_id
         FROM sv360.photos p JOIN sv360.projects pr ON pr.id = p.project_id
        WHERE p.original_name = $1 ORDER BY pr.status`,
      [NOME]
    );
    assert.equal(rows.length, 2, 'o cenário exige exatamente duas candidatas');
    assert.deepEqual(rows.map((r) => r.status), ['disabled', 'enabled']);
  });

  it('membro da org A recebe a linha DISABLED da PRÓPRIA org (a org vence o status)', async () => {
    // Este é o caso que a ordenação antiga (só por status) errava: devolvia a linha
    // da org B e o gate de legibilidade a convertia em 404 sobre dado próprio.
    const res = await supertest(app)
      .get(url(`/photos/by-name/${encodeURIComponent(NOME)}`))
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    assert.equal(res.body.camera.id, fotoA, 'a preferência pela org do chamador não foi aplicada');
    assert.equal(res.body.projectSlug ?? res.body.project_slug, SLUG_A);
  });

  it('membro da org B recebe a linha da própria org (que por acaso também é a enabled)', async () => {
    const res = await supertest(app)
      .get(url(`/photos/by-name/${encodeURIComponent(NOME)}`))
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    assert.equal(res.body.camera.id, fotoB);
  });

  it('anônimo, sem org, cai na segunda chave: o projeto ENABLED', async () => {
    // $2 vem NULL, então `(organization_id = $2)` é NULL para as duas linhas e o
    // desempate por status decide. Este caso prova que a segunda chave continua viva
    // depois de a primeira ter sido introduzida.
    const res = await supertest(app)
      .get(url(`/photos/by-name/${encodeURIComponent(NOME)}`))
      .expect(200);
    assert.equal(res.body.camera.id, fotoB, 'o anônimo só pode enxergar o projeto habilitado');
  });

  it('admin global (lotado na org B) recebe a linha da org B — comportamento pinado, nunca 404', async () => {
    // O admin enxerga as duas, então a resposta é decidida pelo mesmo ORDER BY, com
    // $2 = a org DE LOTAÇÃO dele. Pinado porque é uma escolha, não uma consequência
    // óbvia: o papel global não zera a preferência por org.
    const res = await supertest(app)
      .get(url(`/photos/by-name/${encodeURIComponent(NOME)}`))
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    assert.equal(res.body.camera.id, fotoB);
    assert.notEqual(res.status, 404, 'um admin nunca pode levar 404 sobre foto que ele enxerga');
  });
});
