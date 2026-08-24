// Path: tests/integration/conta-email-leitura-e-troca.test.js
//
// O TITULAR VÊ E CORRIGE O PRÓPRIO E-MAIL, e este arquivo prende as duas metades.
//
// O ESTADO ANTERIOR, medido: `FIND_USER_BY_ID` (`src/modules/users/users.queries.js`) não
// selecionava `email` nem `email_verified`, então `GET /users/me` não os devolvia e a tela "Minha
// conta" não tinha como mostrá-los; `updateProfileSchema` aceitava `nome` e `rank_id` e mais nada;
// e `updateUserAdminSchema` aceitava `email_verified` mas NÃO `email`, de modo que nem o
// administrador corrigia um endereço errado — só APROVAVA o errado. Quem digitasse o e-mail errado
// no cadastro ficava com a conta pendente para sempre, sem ver o erro e sem quem o corrigisse.
//
// AS QUATRO PROPRIEDADES QUE ESTE ARQUIVO COBRA, e cada uma tem controle negativo próprio:
//
//   1. LEITURA — o endereço e o estado de confirmação chegam em `GET /users/me`.
//   2. RE-VERIFICAÇÃO — pedir a troca NÃO muda a linha da conta e NÃO confirma nada; o endereço
//      só se move quando o link do endereço NOVO é aberto, e aí nasce confirmado.
//   3. ANTI-ENUMERAÇÃO — endereço de outra conta responde o MESMO 200 do caso livre, e não muda
//      nada em conta nenhuma.
//   4. ADMINISTRADOR — ele corrige o endereço, e trocá-lo DERRUBA `email_verified`, salvo se o
//      mesmo pedido disser o contrário.
//
// A SESSÃO NÃO É TOCADA por nenhum dos dois passos, e isso é asserido em voz alta: é a assimetria
// deliberada com a troca de SENHA, que corta todas as sessões. A credencial de entrada é (usuário,
// senha) e nenhuma das duas se move aqui.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

const PW = 'Sup3r-Secret-Pw!';
const uniq = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

describe('Conta — e-mail: leitura e correção pelo titular', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Cria uma conta pelo auto-cadastro e a deixa CONFIRMADA, devolvendo id e tokens. */
  async function contaConfirmada(prefixo) {
    const username = `${prefixo}_${uniq()}`;
    const email = `${username}@example.mil`;
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username, password: PW, nome: 'Titular Teste', email })
      .expect(201);

    const { rows } = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const userId = rows[0]?.id;
    assert.ok(userId, 'a conta recém-cadastrada precisa existir');

    await db.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [userId]);

    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username, password: PW })
      .expect(200);

    return { userId, username, email, accessToken: login.body.data.accessToken };
  }

  /** Lê a linha da conta pelos campos que este arquivo julga. */
  async function linha(userId) {
    const { rows } = await db.query(
      'SELECT email, email_verified, sessions_valid_from FROM users WHERE id = $1',
      [userId]
    );
    assert.equal(rows.length, 1, 'a conta precisa continuar existindo');
    return rows[0];
  }

  /** O token de troca de e-mail ainda de pé desta conta, se houver. */
  async function tokenDeTroca(userId) {
    const { rows } = await db.query(
      `SELECT token, new_email, purpose FROM email_verification_tokens
       WHERE user_id = $1 AND purpose = 'change_email' AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return rows[0] ?? null;
  }

  it('1. GET /users/me devolve o endereço E o estado de confirmação', async () => {
    const conta = await contaConfirmada('leitura');

    const resp = await supertest(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${conta.accessToken}`)
      .expect(200);

    assert.equal(resp.body.data.email, conta.email);
    assert.equal(resp.body.data.email_verified, true);

    // CONTROLE NEGATIVO da LEITURA: a mesma rota, sobre uma conta cujo endereço NÃO está
    // confirmado, precisa dizer isso. Sem esta metade, um `email_verified` sempre-true passaria
    // verde na asserção acima.
    await db.query('UPDATE users SET email_verified = FALSE WHERE id = $1', [conta.userId]);
    const pendente = await supertest(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${conta.accessToken}`)
      .expect(200);
    assert.equal(pendente.body.data.email, conta.email);
    assert.equal(pendente.body.data.email_verified, false);
  });

  it('2. pedir a troca NÃO muda a conta; o link do endereço novo é que muda, e já confirmado', async () => {
    const conta = await contaConfirmada('troca');
    const novoEmail = `novo_${uniq()}@example.mil`;
    const antes = await linha(conta.userId);

    await supertest(app)
      .put('/api/v1/users/me/email')
      .set('Authorization', `Bearer ${conta.accessToken}`)
      .send({ email: novoEmail, currentPassword: PW })
      .expect(200);

    // A CONTA NÃO MUDOU: endereço antigo, ainda confirmado, e sem corte de sessão.
    const durante = await linha(conta.userId);
    assert.equal(durante.email, conta.email);
    assert.equal(durante.email_verified, true);
    assert.equal(
      durante.sessions_valid_from,
      antes.sessions_valid_from,
      'pedir a troca de e-mail não pode cortar sessão nenhuma'
    );

    // A SESSÃO CONTINUA VÁLIDA, e isto é asserido pelo caminho vivo e não pela coluna: o corte é
    // lido por `getLiveAuthState`, então a prova é uma requisição autenticada respondendo 200.
    await supertest(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${conta.accessToken}`)
      .expect(200);

    // O endereço pretendido está no TOKEN, e não na conta.
    const token = await tokenDeTroca(conta.userId);
    assert.ok(token, 'o pedido precisa ter cunhado um token de troca');
    assert.equal(token.new_email, novoEmail);

    // O MESMO `?verify=` que confirma um cadastro confirma a troca: uma rota só, um mecanismo só.
    await supertest(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: token.token })
      .expect(200);

    const depois = await linha(conta.userId);
    assert.equal(depois.email, novoEmail);
    assert.equal(depois.email_verified, true, 'o clique no link É a prova de posse');

    // USO ÚNICO: o mesmo link não troca nada uma segunda vez.
    await supertest(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: token.token })
      .expect(400);
  });

  it('2b. senha atual errada recusa a troca, e nada é cunhado', async () => {
    const conta = await contaConfirmada('senha');
    const novoEmail = `outro_${uniq()}@example.mil`;

    await supertest(app)
      .put('/api/v1/users/me/email')
      .set('Authorization', `Bearer ${conta.accessToken}`)
      .send({ email: novoEmail, currentPassword: 'senha-que-nao-e-a-dela' })
      .expect(401);

    const token = await tokenDeTroca(conta.userId);
    assert.equal(token, null, 'uma recusa não pode deixar convite cunhado');
    const linhaConta = await linha(conta.userId);
    assert.equal(linhaConta.email, conta.email);
  });

  it('3. endereço de OUTRA conta responde o mesmo 200, e não move nada', async () => {
    const dono = await contaConfirmada('dono');
    const pedinte = await contaConfirmada('pedinte');

    const resp = await supertest(app)
      .put('/api/v1/users/me/email')
      .set('Authorization', `Bearer ${pedinte.accessToken}`)
      .send({ email: dono.email, currentPassword: PW })
      .expect(200);

    // O CORPO TAMBÉM É IDÊNTICO: um campo a mais num dos ramos é o mesmo oráculo vestindo 200.
    assert.deepEqual(resp.body.data, { success: true });

    // Nada foi cunhado (o convite iria para uma caixa que não pediu nada) e nenhuma das duas
    // contas mudou.
    const token = await tokenDeTroca(pedinte.userId);
    assert.equal(token, null, 'colisão não cunha convite');
    const linhaDono = await linha(dono.userId);
    const linhaPedinte = await linha(pedinte.userId);
    assert.equal(linhaDono.email, dono.email);
    assert.equal(linhaPedinte.email, pedinte.email);

    // CONTROLE NEGATIVO: o MESMO pedido, com um endereço livre, cunha. Sem esta metade, um
    // serviço que nunca cunhasse nada passaria verde acima.
    const livre = `livre_${uniq()}@example.mil`;
    await supertest(app)
      .put('/api/v1/users/me/email')
      .set('Authorization', `Bearer ${pedinte.accessToken}`)
      .send({ email: livre, currentPassword: PW })
      .expect(200);
    const cunhado = await tokenDeTroca(pedinte.userId);
    assert.ok(cunhado, 'endereço livre precisa cunhar o convite');
    assert.equal(cunhado.new_email, livre);
  });

  it('3b. o próprio e-mail é recusado com motivo, e não vira convite', async () => {
    const conta = await contaConfirmada('mesmo');

    // Não é oráculo: dizer "este já é o seu" só conta à pessoa o que ela acabou de ler na tela.
    await supertest(app)
      .put('/api/v1/users/me/email')
      .set('Authorization', `Bearer ${conta.accessToken}`)
      .send({ email: conta.email.toUpperCase(), currentPassword: PW })
      .expect(400);

    const token = await tokenDeTroca(conta.userId);
    assert.equal(token, null);
  });

  it('4. o administrador corrige o endereço, e a troca DERRUBA a confirmação', async () => {
    const alvo = await contaConfirmada('alvo');
    const admin = await contaConfirmada('adm');
    await db.query('UPDATE users SET role = $2 WHERE id = $1', [admin.userId, 'admin']);
    const loginAdmin = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: admin.username, password: PW })
      .expect(200);
    const tokenAdmin = loginAdmin.body.data.accessToken;

    const corrigido = `corrigido_${uniq()}@example.mil`;
    const resp = await supertest(app)
      .put(`/api/v1/users/${alvo.userId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ email: corrigido })
      .expect(200);

    assert.equal(resp.body.data.email, corrigido);
    assert.equal(
      resp.body.data.email_verified,
      false,
      'trocar o endereço sem dizer mais nada não pode deixar a conta confirmada num endereço que ninguém provou'
    );

    // O SALVO-SE: administrador que diz explicitamente que confirma, confirma. É o caminho SEM
    // relay, em que ele é a única autoridade de confirmação possível.
    const aprovado = await supertest(app)
      .put(`/api/v1/users/${alvo.userId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ email: `outro_${uniq()}@example.mil`, email_verified: true })
      .expect(200);
    assert.equal(aprovado.body.data.email_verified, true);

    // CONTROLE NEGATIVO da queda: editar SEM tocar no endereço não derruba a confirmação. Sem
    // isto, um `email_verified = false` incondicional passaria verde na primeira asserção.
    const soNome = await supertest(app)
      .put(`/api/v1/users/${alvo.userId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nome: 'Nome Novo' })
      .expect(200);
    assert.equal(soNome.body.data.email_verified, true);
    assert.equal(soNome.body.data.nome, 'Nome Novo');
  });

  it('4b. o administrador não duplica um endereço já usado', async () => {
    const dono = await contaConfirmada('dono2');
    const alvo = await contaConfirmada('alvo2');
    const admin = await contaConfirmada('adm2');
    await db.query('UPDATE users SET role = $2 WHERE id = $1', [admin.userId, 'admin']);
    const loginAdmin = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: admin.username, password: PW })
      .expect(200);

    // 409 COM MOTIVO, e não a resposta uniforme do auto-serviço: quem chama aqui já lê a lista
    // inteira de contas com e-mail em `GET /users`, então esconder a colisão dele só produziria
    // um salvamento que não salva.
    await supertest(app)
      .put(`/api/v1/users/${alvo.userId}`)
      .set('Authorization', `Bearer ${loginAdmin.body.data.accessToken}`)
      .send({ email: dono.email })
      .expect(409);

    const linhaAlvo = await linha(alvo.userId);
    assert.equal(linhaAlvo.email, alvo.email, 'a recusa não pode ter escrito nada');
  });
});
