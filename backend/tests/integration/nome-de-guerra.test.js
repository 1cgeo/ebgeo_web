// Path: tests/integration/nome-de-guerra.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, loginUser } from '../helpers/fixtures.js';

describe('military display name preserves the full name and travels through auth', () => {
  let app, db, token;
  before(async () => {
    ({ app, db } = await setupTestEnv());
    const admin = await createAdminUser(db, { username: 'war_name_admin' });
    token = await loginUser(app, admin.username, admin.password);
  });
  after(async () => teardownTestEnv(db));
  it('creates, authenticates, edits and clears the independent name', async () => {
    const data = { username: 'war_name_user', password: 'FixturePass123!', nome: 'Full Military Name', nome_guerra: 'Guerra', role: 'user' };
    const made = await supertest(app).post('/api/v1/users').set('Authorization', `Bearer ${token}`).send(data).expect(201);
    assert.equal(made.body.data.nome_guerra, 'Guerra');
    const login = await loginUser(app, data.username, data.password);
    assert.equal(jwt.decode(login).nome_guerra, 'Guerra');
    assert.equal(jwt.decode(login).nome, data.nome);
    const update = await supertest(app).put('/api/v1/users/me').set('Authorization', `Bearer ${login}`).send({ nome_guerra: 'Novo' }).expect(200);
    assert.equal(update.body.data.nome_guerra, 'Novo');
    assert.equal(update.body.data.nome, data.nome);
    const same = await supertest(app).put('/api/v1/users/me').set('Authorization', `Bearer ${login}`).send({ nome: 'Updated Full Name' }).expect(200);
    assert.equal(same.body.data.nome_guerra, 'Novo');
    const clear = await supertest(app).put('/api/v1/users/me').set('Authorization', `Bearer ${login}`).send({ nome_guerra: null }).expect(200);
    assert.equal(clear.body.data.nome_guerra, null);
    await supertest(app).put('/api/v1/users/me').set('Authorization', `Bearer ${login}`).send({ nome_guerra: 'x'.repeat(101) }).expect(422);
  });
});
