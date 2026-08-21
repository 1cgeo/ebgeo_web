// Path: tests/integration/register-organization-scope.test.js
// O auto-cadastro aceita um `organization_id` escolhido pelo cliente (o seletor de OM).
//
// O valor ia para o INSERT com uma checagem de FORMATO de UUID e nada mais, nunca com
// uma checagem de que a organização existe ou está ativa. Este arquivo fecha essa
// metade: OM inexistente ou desativada é recusada.
//
// A OUTRA METADE FOI FECHADA EM OUTRO LUGAR, e é por isso que este cabeçalho mudou.
// Ele dizia que a lotação declarada dava leitura dos projetos 360 não publicados
// daquela OM — o que era verdade e virou a razão de a coluna perder todo poder.
// `users.organization_id` é LOTAÇÃO e exibição; quem autoriza é o ESCOPO DE PRODUÇÃO
// (`users.producer_org_id`), que só um administrador concede. Manter a frase antiga
// aqui seria pior que não ter cabeçalho: ela descreveria como fato uma escalação que
// não existe mais, e um agente a leria como verdade.
//
// O ÚLTIMO CASO ABAIXO mede o que sobrou: a declaração ainda é aceita sem aprovação
// (o furo de ENTRADA continua aberto de propósito, porque fechá-lo pede um fluxo de
// aprovação) e agora é INÓCUA. A prova de inocuidade, com o acervo 360 e de catálogo
// da OM alheia, mora em `auto-cadastro-om-nao-autoriza.repro.test.js`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';

describe('self-registration validates the chosen organization', () => {
  let app, db, inactiveOrgId, activeOrgId;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const rid = randomUUID().slice(0, 8);
    const active = await db.query(
      `INSERT INTO organizations (nome, slug, sigla, is_active)
       VALUES ($1, $2, 'ATV', TRUE) RETURNING id`,
      [`OM Ativa ${rid}`, `om-ativa-${rid}`]
    );
    activeOrgId = active.rows[0].id;

    const inactive = await db.query(
      `INSERT INTO organizations (nome, slug, sigla, is_active)
       VALUES ($1, $2, 'INA', FALSE) RETURNING id`,
      [`OM Inativa ${rid}`, `om-inativa-${rid}`]
    );
    inactiveOrgId = inactive.rows[0].id;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const register = (body) => {
    const username = body?.username ?? `reg_${randomUUID().slice(0, 8)}`;
    return supertest(app).post('/api/v1/auth/register').send({
      username,
      password: 'Test@1234',
      nome: 'Fulano de Tal',
      // Mandatory since e-mail became required on self-registration. Derived from the
      // username so it is unique per call: a repeated address would take the collision
      // branch (201, nothing written) and every case here would silently stop measuring.
      email: `${username}@example.mil`,
      ...body,
    });
  };

  it('refuses an organization_id that does not exist', async () => {
    const ghost = randomUUID();
    const res = await register({ organization_id: ghost });
    assert.equal(res.status, 400, `expected a refusal, got ${res.status}`);

    const { rows } = await db.query(
      'SELECT id FROM users WHERE organization_id = $1', [ghost]
    );
    assert.equal(rows.length, 0, 'and no user row is bound to a nonexistent org');
  });

  it('refuses an INACTIVE organization', async () => {
    const res = await register({ organization_id: inactiveOrgId });
    assert.equal(res.status, 400, `expected a refusal, got ${res.status}`);

    const { rows } = await db.query(
      'SELECT id FROM users WHERE organization_id = $1', [inactiveOrgId]
    );
    assert.equal(rows.length, 0, 'a deactivated org gains no new members');
  });

  it('accepts an active organization', async () => {
    const username = `reg_ok_${randomUUID().slice(0, 8)}`;
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({
        username, password: 'Test@1234', nome: 'Beltrano',
        email: `${username}@example.mil`, organization_id: activeOrgId,
      })
      .expect(201);

    const { rows } = await db.query(
      'SELECT organization_id FROM users WHERE username = $1', [username]
    );
    assert.equal(rows[0].organization_id, activeOrgId, 'the legitimate choice is honoured');
  });

  it('falls back to the default organization when none is given', async () => {
    const username = `reg_def_${randomUUID().slice(0, 8)}`;
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username, password: 'Test@1234', nome: 'Sicrano', email: `${username}@example.mil` })
      .expect(201);

    const { rows } = await db.query(
      'SELECT organization_id FROM users WHERE username = $1', [username]
    );
    assert.equal(rows[0].organization_id, DEFAULT_ORG, 'COALESCE still routes to the default org');
  });

  it('a declaração continua sem aprovação — e agora nasce SEM poder nenhum', async () => {
    // O QUE ESTE CASO PASSOU A MEDIR. Ele era um KNOWN GAP: marcava que a declaração
    // era aceita e, na época, que ela COMPRAVA acesso. A primeira metade continua
    // valendo de propósito (fechá-la pede um fluxo de aprovação); a segunda foi
    // removida do produto, e a asserção nova é o que registra isso: a conta nasce sem
    // crachá de produção, que é a única coluna que autoriza alguma coisa.
    const username = `reg_gap_${randomUUID().slice(0, 8)}`;
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({
        username, password: 'Test@1234', nome: 'Não Membro',
        email: `${username}@example.mil`, organization_id: activeOrgId,
      })
      .expect(201);

    const { rows } = await db.query(
      'SELECT organization_id, org_role, role, producer_org_id FROM users WHERE username = $1',
      [username]
    );
    assert.equal(rows[0].organization_id, activeOrgId, 'a lotação é imediata, sem aprovação');
    assert.equal(rows[0].org_role, 'viewer', 'e no papel de organização mais baixo');
    assert.equal(rows[0].role, 'user', 'o auto-cadastro nunca cunha papel global');
    assert.equal(
      rows[0].producer_org_id, null,
      'E O CRACHÁ NÃO ACOMPANHA A LOTAÇÃO: é ele que autoriza, e só administrador o concede'
    );
  });

  it('o corpo do cadastro não alcança papel, crachá, papel de organização, atividade nem verificação',
    async () => {
      // PISO MEDIDO ANTES DO ATO: já havia guarda para `role`, `org_role`,
      // `producer_org_id` e `organization_id` (o caso acima). NÃO havia nenhuma para
      // `is_active` nem para `email_verified` vindos do corpo, e é justamente por
      // `email_verified` que a obrigatoriedade do e-mail passaria a valer zero se o
      // chamador pudesse declará-la: bastaria mandar `email_verified: true` e a conta
      // nasceria confirmada. O que os remove hoje é o `stripUnknown` do validate.
      const username = `reg_inj_${randomUUID().slice(0, 8)}`;
      await supertest(app)
        .post('/api/v1/auth/register')
        .send({
          username,
          password: 'Test@1234',
          nome: 'Injetor',
          email: `${username}@example.mil`,
          organization_id: activeOrgId,
          role: 'admin',
          producer_org_id: activeOrgId,
          org_role: 'owner',
          is_active: false,
          email_verified: true,
        })
        .expect(201);

      const { rows } = await db.query(
        `SELECT role, producer_org_id, org_role, is_active, email_verified, organization_id
           FROM users WHERE username = $1`,
        [username]
      );
      assert.equal(rows[0].role, 'user', 'papel global não vem do corpo');
      assert.equal(rows[0].producer_org_id, null, 'nem o crachá de produção');
      assert.equal(rows[0].org_role, 'viewer', 'nem o papel de organização');
      assert.equal(rows[0].is_active, true, 'nem a atividade da conta');
      assert.equal(
        rows[0].email_verified, false,
        'E NEM A VERIFICAÇÃO: declará-la esvaziaria a obrigatoriedade do e-mail inteira'
      );
      assert.equal(rows[0].organization_id, activeOrgId, 'só a lotação, que é o campo declarável');
    });

  it('DISCRIMINAÇÃO — o MESMO corpo, pelo caminho ADMINISTRATIVO, é aceito', async () => {
    // Sem este par, "os campos foram ignorados" seria indistinguível de "o servidor
    // ignora esses campos em todo lugar", e alguém poderia fechar o caminho de admin
    // junto sem nada ficar vermelho. Aqui `role` e `producer_org_id` GRAVAM.
    const { createAdminUser, loginUser } = await import('../helpers/fixtures.js');
    const admin = await createAdminUser(db);
    const adminToken = await loginUser(app, admin.username, admin.password);

    const username = `adm_inj_${randomUUID().slice(0, 8)}`;
    await supertest(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username,
        password: 'Test@1234',
        nome: 'Criado por admin',
        role: 'producer',
        producer_org_id: activeOrgId,
        organization_id: activeOrgId,
      })
      .expect(201);

    const { rows } = await db.query(
      'SELECT role, producer_org_id, email FROM users WHERE username = $1', [username]
    );
    assert.equal(rows[0].role, 'producer', 'pelo caminho de admin o papel É do corpo');
    assert.equal(rows[0].producer_org_id, activeOrgId, 'e o crachá também');
    assert.equal(rows[0].email, null, 'e a conta de admin nasce SEM e-mail: o schema nem tem o campo');

    // E ela loga NA HORA, sem confirmar nada: é o caso legítimo que obriga o gate de
    // login() a continuar condicional a `user.email`.
    await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username, password: 'Test@1234' })
      .expect(200);
  });
});
