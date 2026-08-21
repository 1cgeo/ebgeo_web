// Path: tests/integration/register-tenant-claim.test.js
// Item 53. `registerSchema` deixa `organization_id` LIVRE: qualquer um se declara em
// qualquer OM ativa, sem aprovação de ninguém, e a declaração chega ao JWT.
//
// A METADE "conta ATIVA na hora" DEIXOU DE VALER: `email` virou obrigatório, a conta
// nasce PENDENTE e só entra depois do link de confirmação. O gate de login continua
// disparando por `email IS NOT NULL`, o que agora sempre acontece por este caminho — e
// nunca pelo caminho administrativo, que é o par de discriminação no fim do arquivo.
//
// O QUE MUDOU NESTE CABEÇALHO, e a mudança é o assunto da fase. Ele descrevia a
// ameaça de tenant-hop e dizia que a declaração comprava os projetos 360 privados da
// OM alvo. Era verdade, e foi por isso que `users.organization_id` PERDEU todo poder:
// ele é LOTAÇÃO e exibição, e quem autoriza passou a ser `users.producer_org_id`, o
// escopo de PRODUÇÃO, concedido só por administrador. Deixar a frase antiga aqui
// seria documentação que engana em dobro um agente, que a trata como verdade.
//
// O que este arquivo mede continua sendo o CAMINHO: a declaração chega ao JWT e a
// sessão é utilizável depois de confirmada. A CONSEQUÊNCIA foi invertida no caso abaixo, e a prova
// completa de inocuidade (360 oculto, 360 privado, catálogo privado, escrita) mora em
// `auto-cadastro-om-nao-autoriza.repro.test.js`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import config from '../../src/config.js';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, loginUser, confirmRegistrationEmail } from '../helpers/fixtures.js';

const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';

describe('POST /auth/register: the organization the applicant claims for themselves', () => {
  let app, db, adminToken, orgB, coronel;
  const tag = randomUUID().slice(0, 8);

  // `email` is required by registerSchema, so it is filled in from the username unless
  // the caller wants a specific one. Every account created here is therefore PENDING and
  // needs `confirmRegistrationEmail` before it can log in.
  const register = (payload) => supertest(app)
    .post('/api/v1/auth/register')
    .send({ email: `${payload.username}@example.mil`, ...payload });

  const login = (username, password) => supertest(app)
    .post('/api/v1/auth/login').send({ username, password });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    assert.equal(
      config.security.allowSelfRegistration, true,
      'fixture: self-registration is on in NODE_ENV=test, otherwise the route is not even mounted'
    );

    const admin = await createAdminUser(db, { username: `p53_admin_${tag}` });
    adminToken = await loginUser(app, admin.username, admin.password);

    const res = await supertest(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nome: `OM Bravo ${tag}`, slug: `om-bravo-${tag}`, sigla: 'BRV' })
      .expect(201);
    orgB = res.body.data;

    const { rows } = await db.query("SELECT id, nome FROM ranks WHERE nome ILIKE 'Coronel' LIMIT 1");
    coronel = rows[0];
    assert.ok(coronel, 'fixture: the seed rank "Coronel" must exist');
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('a signup into a chosen OM is PENDING, and after confirming the JWT carries that OM', async () => {
    // This case was "an e-mail-less signup is active at once". E-mail is mandatory now,
    // so the account is born pending and the confirmation is part of the path; what the
    // case exists to measure — which OM ends up in the token — is unchanged.
    const username = `p53_claim_${tag}`;
    await register({ username, password: 'Claim@1234', nome: 'Reivindicante', organization_id: orgB.id })
      .expect(201);

    const bloqueado = await login(username, 'Claim@1234');
    assert.equal(bloqueado.status, 401, 'pendente até confirmar');
    await confirmRegistrationEmail(app, db, username);

    const res = await login(username, 'Claim@1234').expect(200);
    const payload = jwt.verify(res.body.data.accessToken, config.jwt.secret);

    assert.equal(
      payload.organization_id, orgB.id,
      'the applicant chose their own tenant and the token now asserts it'
    );
    assert.equal(payload.role, 'user', 'self-registration never mints a global admin');
    assert.equal(payload.org_role, undefined, 'and there is no role-inside-the-org claim at all any more');
  });

  it('A CONSEQUÊNCIA, INVERTIDA: a declaração NÃO compra os 360 não publicados da OM', async () => {
    // ESTE CASO AFIRMAVA A ESCALAÇÃO, e virou o guarda contra ela. `LIST_PROJECTS`
    // filtrava `status = 'enabled' OR organization_id = $2`, então a lotação — que o
    // candidato concedia a si mesmo — bastava para ver um projeto que a OM dona
    // deliberadamente NÃO publicou. O ramo de OM não sumiu: ele passou a ser
    // `fn_can_produce_resource`, o escopo de produção, que só um administrador dá.
    //
    // O CONTROLE ANÔNIMO CONTINUA SENDO O MESMO, e agora ele carrega mais peso: sem
    // ele, "o declarante não vê" é indistinguível de "o projeto não existe". O
    // positivo que fecha o par (o MESMO usuário, promovido a produtor daquela OM,
    // passa a ver) mora no repro, porque é lá que ele é o assunto.
    const username = `p53_sv360_${tag}`;
    await register({ username, password: 'Claim@1234', nome: 'Espião', organization_id: orgB.id })
      .expect(201);
    await confirmRegistrationEmail(app, db, username);
    const token = (await login(username, 'Claim@1234').expect(200)).body.data.accessToken;

    const slug = `p53-secreto-${tag}`;
    await db.query(
      `INSERT INTO sv360.projects (slug, name, organization_id, status, db_filename)
       VALUES ($1, 'Projeto Secreto', $2, 'disabled', $3)`,
      [slug, orgB.id, `${orgB.id}__${slug}.db`]
    );

    // sv360 answers with a BARE array (its envelope is deliberately flat).
    const anon = await supertest(app).get('/api/v1/sv360/projects').expect(200);
    assert.ok(Array.isArray(anon.body), 'the flat sv360 envelope');
    assert.ok(
      !anon.body.some((p) => p.slug === slug),
      'CONTROL: a disabled project is invisible without the org claim'
    );

    const res = await supertest(app)
      .get('/api/v1/sv360/projects')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.ok(
      !res.body.some((p) => p.slug === slug),
      'a lotação auto-declarada não enxerga projeto não publicado da OM que ela declarou'
    );

    // E o DELTA medido de dentro do banco: a conta nasceu sem crachá de produção, que
    // é a única coluna que abriria aquele projeto.
    const { rows } = await db.query(
      'SELECT producer_org_id FROM users WHERE username = $1', [username]
    );
    assert.equal(rows[0].producer_org_id, null);
  });

  it('a nonexistent or inactive OM is refused, and no account is created', async () => {
    const ghost = `p53_ghost_${tag}`;
    await register({ username: ghost, password: 'Claim@1234', nome: 'Fantasma', organization_id: randomUUID() })
      .expect(400);

    const { rows } = await db.query('SELECT count(*)::int AS n FROM users WHERE username = $1', [ghost]);
    assert.equal(rows[0].n, 0, 'the guard fires before the INSERT');
  });

  it('no organization_id at all falls back to the default org', async () => {
    const username = `p53_default_${tag}`;
    await register({ username, password: 'Claim@1234', nome: 'Padrão' }).expect(201);

    const { rows } = await db.query('SELECT organization_id FROM users WHERE username = $1', [username]);
    assert.equal(rows[0].organization_id, DEFAULT_ORG, 'the COALESCE in INSERT_USER');
  });

  it('HAPPY PATH: rank_id + organization_id come back from /users/me as DERIVED NAMES', async () => {
    const username = `p53_happy_${tag}`;
    await register({
      username, password: 'Claim@1234', nome: 'Completo',
      rank_id: coronel.id, organization_id: orgB.id,
    }).expect(201);

    await confirmRegistrationEmail(app, db, username);
    const token = (await login(username, 'Claim@1234').expect(200)).body.data.accessToken;
    const me = await supertest(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(me.body.data.posto_graduacao, coronel.nome, 'a name, not the UUID');
    assert.equal(me.body.data.organizacao_militar, orgB.nome);
    assert.equal(me.body.data.rank_id, coronel.id, 'the FK travels alongside the derived name');
    assert.equal(me.body.data.organization_id, orgB.id);
  });

  it('DISCRIMINAÇÃO — a conta criada por ADMIN não tem e-mail e loga na hora', async () => {
    // O par que impede o gate de `login()` de ser "simplificado" para
    // `!user.email_verified`: por este caminho a conta nasce sem endereço, `email_verified`
    // é false e ela entra mesmo assim. Este arquivo tinha o caso espelhado ("uma conta COM
    // e-mail fica pendente"), que deixou de discriminar quando toda conta auto-cadastrada
    // passou a ter e-mail: ele afirmaria o mesmo que os três casos acima.
    const username = `p53_admin_made_${tag}`;
    await supertest(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username, password: 'Claim@1234', nome: 'Feito por admin', organization_id: orgB.id })
      .expect(201);

    const { rows } = await db.query(
      'SELECT email, email_verified FROM users WHERE username = $1', [username]
    );
    assert.equal(rows[0].email, null, 'createUserAdminSchema não tem campo de e-mail');
    assert.equal(rows[0].email_verified, false, 'e a flag continua falsa');

    await login(username, 'Claim@1234').expect(200);
  });
});
