// Path: tests/integration/identity.test.js
// Fase 5: JWT org claims, legacy-token compatibility, and API-key rotation
// consumed via the global flexibleAuth (x-api-key).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';

describe('Identity: JWT org claims & API keys', () => {
  let app, db, user, token;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'identity_user' });
    await db.query(`UPDATE users SET organization_id = $1 WHERE id = $2`, [DEFAULT_ORG, user.id]);
    token = await loginUser(app, user.username, user.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('emits organization_id in the access token, e NENHUMA claim de papel dentro da OM', () => {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    assert.equal(payload.organization_id, DEFAULT_ORG);
    // A ausência é asserida, não presumida: `org_role` foi emitida até 2026-08-20 (D7) e
    // o cliente a lia como papel POR ATLAS. Enquanto o emissor a mandasse, apagar o
    // leitor não fecharia nada — bastaria alguém escrever um leitor novo. O par
    // (organization_id presente, org_role ausente) é o que separa "a claim sumiu" de
    // "o token inteiro parou de carregar organização", que passaria verde se este caso
    // só olhasse para a ausência.
    assert.equal(payload.org_role, undefined, 'o eixo de papel dentro da OM não é mais emitido');
  });

  it('a coluna do eixo de papel dentro da OM não existe mais no schema', async () => {
    // A prova de que a remoção é de VERDADE, e não só do emissor: enquanto a coluna
    // existisse, uma consulta nova a selecionaria por analogia e o eixo voltaria pela
    // porta de trás. Ela sai em `011_grupo_com_dono_e_producao.sql` (D7), com entrada na
    // lista de DDL destrutiva deliberada.
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users'`
    );
    const colunas = rows.map((r) => r.column_name);
    // CONTROLE DE VÁCUO: a consulta enxerga a tabela. Sem estas duas linhas, um nome de
    // tabela errado devolveria zero colunas e o `not.includes` passaria provando nada.
    assert.ok(colunas.includes('organization_id'), 'a lotação continua de pé');
    assert.ok(colunas.includes('producer_org_id'), 'e o escopo de produção, que é quem autoriza');
    assert.ok(!colunas.includes('org_role'), 'o eixo de papel dentro da OM saiu do banco');
  });

  it('accepts legacy tokens without the org claim (falls back)', async () => {
    const legacy = jwt.sign(
      { sub: user.id, username: user.username, role: 'user' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );
    const res = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${legacy}`)
      .expect(200);
    assert.equal(res.body.data.id, user.id);
  });

  it('rotates the API key atomically and authenticates via x-api-key', async () => {
    const r1 = await supertest(app)
      .post('/api/v1/users/me/api-key/rotate')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const key1 = r1.body.data.apiKey;
    assert.match(key1, /^[0-9a-f-]{36}$/i);

    // The api key authenticates on a strict route via flexibleAuth.
    await supertest(app).get('/api/v1/auth/me').set('x-api-key', key1).expect(200);

    // Rotate again -> old key archived, no longer valid.
    const r2 = await supertest(app)
      .post('/api/v1/users/me/api-key/rotate')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const key2 = r2.body.data.apiKey;
    assert.notEqual(key1, key2);

    await supertest(app).get('/api/v1/auth/me').set('x-api-key', key1).expect(401);
    await supertest(app).get('/api/v1/auth/me').set('x-api-key', key2).expect(200);

    // History has exactly one revoked entry (the first key); two audit rows.
    const hist = await db.query('SELECT COUNT(*)::int AS n FROM api_key_history WHERE user_id = $1', [user.id]);
    assert.equal(hist.rows[0].n, 1);
    const audit = await db.query(`SELECT COUNT(*)::int AS n FROM audit_trail WHERE action='API_KEY_ROTATE' AND actor_id=$1`, [user.id]);
    assert.equal(audit.rows[0].n, 2);
  });

  it('a malformed x-api-key does not authenticate (anonymous)', async () => {
    await supertest(app).get('/api/v1/auth/me').set('x-api-key', 'not-a-uuid').expect(401);
  });
});
