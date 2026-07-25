// Path: tests/integration/zones-revogacao-parcial.test.js
// Item 125 — setZonePermissions apaga SEMPRE as duas tabelas e o Joi preenche
// `default([])` para a chave ausente.
//
// Logo `PUT { groups: [g] }` — sem a chave `users` — APAGA todos os grants de
// usuário da zona. zones-gaps.test.js cobre encolher a lista de users e `users: []`,
// e zones-01 cobre preservação após ROLLBACK, mas ninguém pinava o CRUZAMENTO entre
// as duas chaves. Isso é semântica de REVOGAÇÃO: se alguém "consertar" tornando o
// DELETE condicional (`if (users.length) delete`), a revogação por lista vazia para
// de funcionar em silêncio e um usuário removido continua vendo dado privado, sem
// nenhum teste falhando.
//
// Cada caso monta seu PRÓPRIO cenário (zona + nome privado dentro dela, em
// coordenadas exclusivas): zonas de casos anteriores continuam existindo e
// concederiam acesso ao mesmo nome, mascarando a revogação sob teste.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

const TAG = `REV${randomUUID().slice(0, 6).toUpperCase()}`;

describe('Revogação por PUT parcial de permissões de zona (item 125)', () => {
  let app, db, admin, adminTok;
  let direto, diretoTok, membro, membroTok, grupoId;
  let contador = 0;

  const permissoes = async (zoneId) => {
    const res = await supertest(app)
      .get(`/api/v1/zones/${zoneId}/permissions`)
      .set('Authorization', `Bearer ${adminTok}`)
      .expect(200);
    return res.body.data;
  };

  const setPerms = (zoneId, body) =>
    supertest(app)
      .put(`/api/v1/zones/${zoneId}/permissions`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send(body)
      .expect(200);

  /** Zona exclusiva + nome privado dentro dela, em coordenadas só deste caso. */
  async function cenario() {
    contador += 1;
    const lon = -64.0 - contador;
    const lat = -14.0 - contador;
    const nome = `Deposito ${TAG} ${contador}`;

    await db.query(
      `INSERT INTO ng.nomes_geograficos (nome, tipo, access_level, geom)
       VALUES ($1, 'Cidade', 'private', ST_SetSRID(ST_MakePoint($2,$3),4674))`,
      [nome, lon, lat]
    );
    await db.query('SELECT ng.refresh_busca()');

    const geom = {
      type: 'Polygon',
      coordinates: [[
        [lon - 0.1, lat - 0.1], [lon + 0.1, lat - 0.1],
        [lon + 0.1, lat + 0.1], [lon - 0.1, lat + 0.1], [lon - 0.1, lat - 0.1],
      ]],
    };
    const res = await supertest(app)
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: `Zona ${TAG} ${contador}`, geom })
      .expect(201);

    const ve = async (token) => {
      const r = await supertest(app)
        .get('/api/v1/nomes/busca')
        .query({ q: nome, lat, lon })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      assert.ok(Array.isArray(r.body));
      return r.body.some((x) => x.nome === nome);
    };

    return { zoneId: res.body.data.id, ve };
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `rev_adm_${TAG.toLowerCase()}` });
    adminTok = await loginUser(app, admin.username, admin.password);
    direto = await createUser(db, { username: `rev_dir_${TAG.toLowerCase()}` });
    diretoTok = await loginUser(app, direto.username, direto.password);
    membro = await createUser(db, { username: `rev_mem_${TAG.toLowerCase()}` });
    membroTok = await loginUser(app, membro.username, membro.password);

    const { rows } = await db.query('INSERT INTO ng.groups (name) VALUES ($1) RETURNING id', [`Grupo ${TAG}`]);
    assert.equal(rows.length, 1);
    grupoId = rows[0].id;
    await db.query('INSERT INTO ng.user_groups (user_id, group_id) VALUES ($1, $2)', [membro.id, grupoId]);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('PUT {groups} SEM a chave users apaga os grants de usuário (replace total nas DUAS chaves)', async () => {
    const { zoneId, ve } = await cenario();
    await setPerms(zoneId, { users: [direto.id], groups: [grupoId] });

    const antes = await permissoes(zoneId);
    assert.deepEqual(antes.users, [direto.id]);
    assert.deepEqual(antes.groups, [grupoId]);
    assert.equal(await ve(diretoTok), true, 'baseline: o usuário com grant direto vê o nome privado');

    // A chave `users` está AUSENTE do corpo; o Joi preenche default([]).
    await setPerms(zoneId, { groups: [grupoId] });

    const depois = await permissoes(zoneId);
    assert.deepEqual(depois.users, [], 'o grant direto foi revogado implicitamente');
    assert.deepEqual(depois.groups, [grupoId], 'e o de grupo sobreviveu');

    // Efeito end-to-end, com o MESMO token: nada além do PUT mudou.
    assert.equal(await ve(diretoTok), false, 'a revogação vale imediatamente na busca');
    assert.equal(await ve(membroTok), true, 'o membro do grupo continua vendo');
  });

  it('simétrico: PUT {users} SEM a chave groups apaga os grants de grupo', async () => {
    const { zoneId, ve } = await cenario();
    await setPerms(zoneId, { users: [direto.id], groups: [grupoId] });
    assert.equal(await ve(membroTok), true, 'baseline: o membro do grupo vê o privado');

    await setPerms(zoneId, { users: [direto.id] });

    const depois = await permissoes(zoneId);
    assert.deepEqual(depois.groups, []);
    assert.deepEqual(depois.users, [direto.id]);
    assert.equal(await ve(membroTok), false, 'o membro do grupo perde a visibilidade');
    assert.equal(await ve(diretoTok), true, 'e o grant direto continua valendo');
  });

  it('o audit PERMISSION_GRANT registra o conjunto apagado IMPLICITAMENTE em details.before', async () => {
    const { zoneId } = await cenario();
    await setPerms(zoneId, { users: [direto.id], groups: [grupoId] });
    await setPerms(zoneId, { groups: [grupoId] });

    const { rows } = await db.query(
      `SELECT details FROM audit_trail
        WHERE action = 'PERMISSION_GRANT' AND target_type = 'ZONE' AND target_id = $1
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [zoneId]
    );
    assert.equal(rows.length, 1, 'a revogação implícita precisa deixar rastro');
    const d = rows[0].details;
    assert.deepEqual(d.before.users, [direto.id], 'before registra quem foi apagado sem ser nomeado');
    assert.deepEqual(d.after.users, [], 'after registra o resultado');
    assert.deepEqual(d.after.groups, [grupoId]);
  });

  it('corpo VAZIO {} revoga tudo (o default([]) vale para as duas chaves)', async () => {
    const { zoneId, ve } = await cenario();
    await setPerms(zoneId, { users: [direto.id], groups: [grupoId] });
    assert.equal(await ve(diretoTok), true, 'baseline');
    assert.equal(await ve(membroTok), true, 'baseline (grupo)');

    await setPerms(zoneId, {});

    const depois = await permissoes(zoneId);
    assert.deepEqual(depois.users, []);
    assert.deepEqual(depois.groups, []);
    assert.equal(await ve(diretoTok), false);
    assert.equal(await ve(membroTok), false);
  });
});
