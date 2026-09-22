// Path: tests/integration/admin-cria-conta-com-email.test.js
//
// O ADMINISTRADOR PASSA A INFORMAR O E-MAIL NA CRIAÇÃO (pedido do dono, 2026-09-22), e o que este
// arquivo prende é a regra que a borda não exprime e o service impõe (`resolveCreationEmail`).
//
// Até esta data `createUserAdminSchema` não tinha o campo, o `stripUnknown` o descartava calado e a
// conta nascia sem endereço. Agora são QUATRO desfechos, e cada um tem um caso:
//
//   1. SEM endereço: a conta nasce como sempre nasceu, sem e-mail, e loga na hora. É o vizinho que
//      NÃO pode mudar, e ele já é prendido por `auto-cadastro-exige-email.test.js`; aqui ele volta
//      como CONTROLE, com a ausência de token de confirmação que só este arquivo mede.
//   2. COM endereço e sem marca: a conta nasce PENDENTE, o login devolve `EMAIL_NOT_VERIFIED`, e o
//      MESMO link `?verify=` do auto-cadastro é cunhado para o endereço; aberto, a conta entra. Um
//      endereço que ninguém provou possuir não vira canal de recuperação de senha por inércia.
//   3. COM endereço e `email_verified: true`: o administrador DECLARA o endereço conferido, a conta
//      entra na hora, nenhum token é cunhado, e a trilha diz que houve a declaração.
//   4. endereço TOMADO: 409 com o motivo, como na edição administrativa, e nada é criado.
//
// CONTROLE NEGATIVO previsto: devolver `resolveCreationEmail` a `{ email, verified: true }` derruba
// o caso 2 (a conta entraria sem confirmar); tirar o campo do schema derruba os casos 2, 3 e 4 (o
// endereço sumiria da linha); tirar a pré-checagem faz o 4 cair no 409 GENÉRICO do índice, que
// este arquivo distingue pela frase.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createAdminUser, createUser, loginUser, confirmRegistrationEmail,
} from '../helpers/fixtures.js';

const SFX = randomUUID().slice(0, 8);
const PW = 'Sup3r-Secret-Pw!';
const EM_USO = 'Este e-mail já está em uso por outra conta.';

describe('o administrador cria conta COM e-mail (e sem, como antes)', () => {
  let app, db, adminToken;

  const criar = (body) => supertest(app)
    .post('/api/v1/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ password: PW, nome: 'Criada por admin', ...body });
  const login = (username) =>
    supertest(app).post('/api/v1/auth/login').send({ username, password: PW });

  const linha = async (username) => {
    const { rows } = await db.query(
      'SELECT id, email, email_verified FROM users WHERE LOWER(username) = LOWER($1)', [username]
    );
    return rows;
  };
  const tokensDeConfirmacao = async (userId) => {
    const { rows } = await db.query(
      `SELECT purpose, email_at_issue FROM email_verification_tokens
        WHERE user_id = $1 AND purpose = 'verify' AND consumed_at IS NULL`,
      [userId]
    );
    return rows;
  };
  const trilhaDeCriacao = async (userId) => {
    const { rows } = await db.query(
      `SELECT details FROM audit_trail
        WHERE action = 'USER_CREATE' AND target_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return rows;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db, { username: `adm_mail_${SFX}` });
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('CONTROLE — sem endereço, a conta nasce sem e-mail, entra na hora e nenhum link é cunhado', async () => {
    const username = `semmail_${SFX}`;
    const res = await criar({ username }).expect(201);
    assert.equal(res.body.data.email, null, 'a resposta diz o que foi gravado: nada');
    assert.equal(res.body.data.email_verified, false);

    const rows = await linha(username);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, null);
    assert.deepEqual(await tokensDeConfirmacao(rows[0].id), [], 'sem endereço não há para onde mandar link');

    const ok = await login(username).expect(200);
    assert.ok(ok.body.data.accessToken, 'a conta sem endereço continua entrando sem confirmar nada');

    const trilha = await trilhaDeCriacao(rows[0].id);
    assert.equal(trilha.length, 1);
    assert.equal('email_verified' in trilha[0].details, false,
      'a ausência da chave é a conta nascida sem endereço');
  });

  it('string vazia é o mesmo que ausência (é o que a tela manda com o campo em branco)', async () => {
    const username = `vazio_${SFX}`;
    await criar({ username, email: '', email_verified: true }).expect(201);
    const rows = await linha(username);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, null);
    assert.equal(rows[0].email_verified, false,
      'marca sem endereço é descartada: linha confirmada sobre NULL só confunde a próxima leitura');
  });

  it('COM endereço e sem marca: nasce PENDENTE, recebe o link do auto-cadastro, e o link abre a conta',
    async () => {
      const username = `pendente_${SFX}`;
      const email = `Pendente_${SFX}@Example.mil`;
      const res = await criar({ username, email: `  ${email}  ` }).expect(201);
      assert.equal(res.body.data.email, email, 'aparado, e sem trocar a caixa do que foi digitado');
      assert.equal(res.body.data.email_verified, false);

      const rows = await linha(username);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].email, email);
      assert.equal(rows[0].email_verified, false, 'endereço que ninguém provou não nasce confirmado');

      const bloqueado = await login(username).expect(401);
      assert.equal(bloqueado.body.error.code, 'EMAIL_NOT_VERIFIED',
        'o gate de login() vale para a conta administrativa COM endereço, como vale para o cadastro');

      const tokens = await tokensDeConfirmacao(rows[0].id);
      assert.equal(tokens.length, 1, 'o MESMO token `verify` do auto-cadastro, um só');
      assert.equal(tokens[0].email_at_issue, email, 'amarrado ao endereço a que foi enviado');

      await confirmRegistrationEmail(app, db, username);
      const ok = await login(username).expect(200);
      assert.ok(ok.body.data.accessToken, 'confirmado pelo link, a conta entra');

      const trilha = await trilhaDeCriacao(rows[0].id);
      assert.equal(trilha.length, 1);
      assert.equal(trilha[0].details.email_verified, false);
      assert.equal(JSON.stringify(trilha[0].details).toLowerCase().includes(email.toLowerCase()), false,
        'a trilha diz se houve endereço e se ele foi declarado conferido, nunca o endereço');
    });

  it('COM endereço e `email_verified: true`: a declaração do administrador abre a conta na hora',
    async () => {
      const username = `conferido_${SFX}`;
      const email = `conferido_${SFX}@example.mil`;
      const res = await criar({ username, email, email_verified: true }).expect(201);
      assert.equal(res.body.data.email, email);
      assert.equal(res.body.data.email_verified, true);

      const rows = await linha(username);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].email_verified, true);
      assert.deepEqual(await tokensDeConfirmacao(rows[0].id), [],
        'endereço já declarado conferido não recebe link de confirmação');

      const ok = await login(username).expect(200);
      assert.ok(ok.body.data.accessToken);

      const trilha = await trilhaDeCriacao(rows[0].id);
      assert.equal(trilha.length, 1);
      assert.equal(trilha[0].details.email_verified, true,
        'declarar conferido um endereço é ato explícito, e fica na trilha como tal');
    });

  it('endereço TOMADO (ignorando a caixa): 409 com o motivo, e nada é criado', async () => {
    const dono = await createUser(db, { username: `dono_mail_${SFX}` });
    const email = `tomado_${SFX}@example.mil`;
    await db.query('UPDATE users SET email = $1, email_verified = TRUE WHERE id = $2', [email, dono.id]);

    const username = `colide_${SFX}`;
    const res = await criar({ username, email: email.toUpperCase() }).expect(409);
    assert.equal(res.body.error.message, EM_USO,
      'a frase NOMEIA o campo, e não é o 409 genérico do índice');
    assert.deepEqual(await linha(username), [], 'a conta não nasce pela metade');
  });

  it('endereço sem forma de endereço: 422 que nomeia o campo', async () => {
    const username = `malformado_${SFX}`;
    const res = await criar({ username, email: 'sem-arroba' }).expect(422);
    const campos = res.body.error.details.map((d) => d.field);
    assert.deepEqual(campos, ['email']);
    assert.deepEqual(await linha(username), []);
  });

  it('usuário comum não alcança a rota, com ou sem e-mail no corpo', async () => {
    const comum = await createUser(db, { username: `comum_mail_${SFX}` });
    const token = await loginUser(app, comum.username, comum.password);
    await supertest(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: `tentou_${SFX}`, password: PW, nome: 'Tentou', email: `tentou_${SFX}@example.mil` })
      .expect(403);
  });
});
