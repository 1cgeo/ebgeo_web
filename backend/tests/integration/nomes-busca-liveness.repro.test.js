// Path: tests/integration/nomes-busca-liveness.repro.test.js
// Item 39 — reconciliação de liveness no caminho ANÔNIMO de GET /nomes/busca.
//
// /busca não passa pelo `auth` estrito (contrato congelado anônimo), só pelo
// flexibleAuth, que por construção NÃO reconcilia com o banco fora dos últimos
// 5 min de vida do token. Logo o único guarda que existe nessa rota é o filtro
// de acesso embutido no SQL: se ele confiar no `sub` do JWT sem olhar
// `users.is_active` / `organizations.is_active`, uma conta desativada continua
// enxergando NOMES GEOGRÁFICOS PRIVADOS por até JWT_ACCESS_EXPIRY (15 min),
// enquanto o MESMO token já recebe 401/403 em /nomes/feicoes.
//
// A assimetria entre as rotas é deliberada (anônima vs estrita); o que não pode
// ser assimétrico é QUEM enxerga dado privado.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

const TAG = `LIV${randomUUID().slice(0, 6).toUpperCase()}`;
const PRIVADO = `Sitio Restrito ${TAG}`;
const PUBLICO = `Largo Aberto ${TAG}`;

const ZONA = {
  type: 'Polygon',
  coordinates: [[[-63.3, -12.95], [-63.1, -12.95], [-63.1, -12.85], [-63.3, -12.85], [-63.3, -12.95]]],
};

describe('Liveness no caminho anônimo de /nomes/busca (item 39)', () => {
  let app, db;
  let admin, adminTok;
  let zoneId;

  const busca = async (token, q) => {
    const req = supertest(app).get('/api/v1/nomes/busca').query({ q, lat: -12.9, lon: -63.2 });
    if (token) req.set('Authorization', `Bearer ${token}`);
    const res = await req.expect(200);
    assert.ok(Array.isArray(res.body), 'contrato congelado: array nu');
    return res.body;
  };

  const vePrivado = async (token) => (await busca(token, PRIVADO)).some((r) => r.nome === PRIVADO);

  /** Cria um usuário com grant na zona e devolve { user, token }. */
  async function usuarioComGrant(nome, overrides = {}) {
    const user = await createUser(db, { username: `${nome}_${TAG.toLowerCase()}`, ...overrides });
    const token = await loginUser(app, user.username, user.password);
    await db.query('INSERT INTO ng.zone_permissions (zone_id, user_id) VALUES ($1, $2)', [zoneId, user.id]);
    return { user, token };
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `liv_adm_${TAG.toLowerCase()}` });
    adminTok = await loginUser(app, admin.username, admin.password);

    await db.query(
      `INSERT INTO ng.nomes_geograficos (nome, tipo, access_level, geom)
       VALUES ($1, 'Cidade', 'private', ST_SetSRID(ST_MakePoint(-63.2,-12.9),4674)),
              ($2, 'Cidade', 'public',  ST_SetSRID(ST_MakePoint(-63.2,-12.9),4674))`,
      [PRIVADO, PUBLICO]
    );
    await db.query('SELECT ng.refresh_busca()');
    await db.query(
      `INSERT INTO ng.edificacoes (nome, tipo, altitude_base, altitude_topo, access_level, geom)
       VALUES ($1, 'edificacao', 0, 50, 'private',
         ST_GeomFromText('POLYGON((-63.2001 -12.9001,-63.1999 -12.9001,-63.1999 -12.8999,-63.2001 -12.8999,-63.2001 -12.9001))', 4326))`,
      [`Torre ${TAG}`]
    );

    const created = await supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: `Zona ${TAG}`, geom: ZONA })
      .expect(201);
    zoneId = created.body.data.id;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('usuário DESATIVADO perde o nome privado em /busca com o MESMO token', async () => {
    const { user, token } = await usuarioComGrant('liv_off');

    assert.equal(await vePrivado(token), true, 'baseline: com grant e ativo, vê o privado');

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);

    assert.equal(await vePrivado(token), false, 'desativado NÃO pode mais ver o nome privado');
    // O caminho anônimo continua servindo o que é público — a rota não vira 401.
    const publicos = await busca(token, PUBLICO);
    assert.ok(publicos.some((r) => r.nome === PUBLICO), 'os nomes públicos continuam servidos');
  });

  it('o MESMO token desativado recebe 401 em /nomes/feicoes (a assimetria é só de rota)', async () => {
    const { user, token } = await usuarioComGrant('liv_asym');

    const antes = await supertest(app)
      .get('/api/v1/nomes/feicoes')
      .query({ lat: -12.9, lon: -63.2, z: 25 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(antes.body.nome, `Torre ${TAG}`, 'baseline: identifica a edificação privada');

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);

    const depois = await supertest(app)
      .get('/api/v1/nomes/feicoes')
      .query({ lat: -12.9, lon: -63.2, z: 25 })
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    assert.equal(depois.body.error.code, 'UNAUTHORIZED');

    // E o mesmo token, na rota anônima, também deixou de ver privado.
    assert.equal(await vePrivado(token), false);
  });

  it('ADMIN global desativado deixa de expor nomes privados em /busca', async () => {
    const adm = await createAdminUser(db, { username: `liv_adm2_${TAG.toLowerCase()}` });
    const tok = await loginUser(app, adm.username, adm.password);

    assert.equal(await vePrivado(tok), true, 'baseline: admin ativo vê privado sem zona');

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [adm.id]);

    assert.equal(await vePrivado(tok), false, 'o branch role=admin também exige is_active');
  });

  it('usuário ATIVO cuja ORGANIZAÇÃO foi desativada perde o privado em /busca', async () => {
    const { rows: org } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, 'TMP') RETURNING id`,
      [`Org ${TAG}`, `org-${TAG.toLowerCase()}`]
    );
    const orgId = org[0].id;
    const { token } = await usuarioComGrant('liv_org', { organization_id: orgId });

    assert.equal(await vePrivado(token), true, 'baseline: org ativa, vê privado');

    await db.query('UPDATE organizations SET is_active = false WHERE id = $1', [orgId]);

    // Mesmo tratamento que o `auth` estrito dá (403 Organization is inactive):
    // na rota anônima o efeito equivalente é degradar para o conjunto público.
    assert.equal(await vePrivado(token), false, 'membro de org desativada não vê dado privado');
  });

  it('controle: usuário ativo com grant continua vendo o nome privado', async () => {
    const { token } = await usuarioComGrant('liv_ok');
    assert.equal(await vePrivado(token), true, 'o caminho feliz não foi quebrado');
    const anon = await busca(null, PRIVADO);
    assert.ok(!anon.some((r) => r.nome === PRIVADO), 'anônimo continua sem ver privado');
  });
});
