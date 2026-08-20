// Path: tests/integration/escopo-de-producao-bicondicional.test.js
//
// O CRACHÁ E O ESCOPO ANDAM JUNTOS OU NÃO ANDAM.
//
// `users_producer_scope_check` é `(role = 'producer') = (producer_org_id IS NOT NULL)`
// — um BICONDICIONAL, não uma implicação. Os dois estados impossíveis são simétricos
// e cada um quebra o sistema de um jeito diferente:
//
//   crachá SEM escopo   → `fn_can_produce_resource` compara com NULL e o produtor não
//                         alcança linha nenhuma: um papel que não pode fazer o que o
//                         nome dele diz, e a tela não explica por quê;
//   escopo SEM crachá   → uma conta comum carregando a OM de produção. Hoje a função
//                         cobra `role = 'producer'` antes de olhar o escopo, então
//                         não abre nada; mas é uma bomba armada esperando o dia em
//                         que alguém escrever um gate que só pergunta pelo escopo — e
//                         `sv360.routes.js` JÁ o faz (`Boolean(u.producer_org_id)`),
//                         de propósito, porque ali o escopo é o crachá.
//
// POR QUE OS QUADRANTES E AS TRANSIÇÕES, e não só um par. Um teste que INSIRA os
// quatro estados não vê o caso que mais quebra em produção: a EDIÇÃO. Rebaixar um
// produtor sem limpar o escopo, ou limpar o escopo sem rebaixar, são dois `UPDATE`
// de uma coluna só — a forma em que um invariante de par morre.
//
// E A BORDA HTTP É OUTRA CAMADA, deliberadamente. O CHECK é a guarda que vale, e não
// pode sair; mas quando ele dispara o driver levanta 23514, que o `errorHandler`
// traduz num 400 genérico, sem dizer o que corrigir. As duas últimas asserções
// cobram a mensagem legível, e o par que prova que a borda não recusa tudo.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createProducerUser, loginUser } from '../helpers/fixtures.js';

const CHECK = /users_producer_scope_check/;

describe('O bicondicional de `producer_org_id`', () => {
  let app, db, admin, tokenAdmin, orgProd, orgOutra;
  const sufixo = randomUUID().slice(0, 8);

  /** Insere uma linha de usuário com o par (papel, escopo) pedido. */
  const inserir = (role, escopo) => db.query(
    `INSERT INTO users (username, password_hash, nome, role, producer_org_id)
     VALUES ($1, 'x', 'Quadrante', $2, $3::uuid)`,
    [`quad_${role}_${randomUUID().slice(0, 8)}`, role, escopo]
  );

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const criaOrg = async (rotulo) => (await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM ${rotulo} ${sufixo}`, `om-bic-${rotulo}-${sufixo}`, `${rotulo}${sufixo.slice(0, 3)}`]
    )).rows[0].id;
    orgProd = await criaOrg('p');
    orgOutra = await criaOrg('o');

    admin = await createAdminUser(db, { username: `bic_admin_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await db.query('DELETE FROM users WHERE username LIKE $1 OR username LIKE $2',
      ['quad_%', `bic_%${sufixo}`]);
    await db.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[orgProd, orgOutra]]);
    await teardownTestEnv(db);
  });

  it('OS QUATRO QUADRANTES, num corpo só', async () => {
    // Aceitos.
    await inserir('producer', orgProd);
    await inserir('user', null);
    // Recusados, e é o mesmo CHECK nos dois — a simetria é o ponto.
    await assert.rejects(() => inserir('producer', null), CHECK, 'crachá sem escopo');
    await assert.rejects(() => inserir('user', orgProd), CHECK, 'escopo sem crachá');
  });

  it('o bicondicional é sobre `producer`, e não sobre "não-user"', async () => {
    // A LEITURA ERRADA QUE ESTE CASO IMPEDE: "quem não é usuário comum tem OM". Os
    // quatro papéis não são uma escada, e nem `admin` nem `credenciado` produzem por
    // OM nenhuma — administrar é global e credenciar é leitura global.
    await assert.rejects(() => inserir('admin', orgProd), CHECK, 'administrador não tem OM de produção');
    await assert.rejects(() => inserir('credenciado', orgProd), CHECK, 'credenciado tampouco');
    // O par: os dois nascem sem escopo, sem reclamação nenhuma.
    await inserir('admin', null);
    await inserir('credenciado', null);
  });

  it('AS DUAS TRANSIÇÕES, que é onde o invariante de par realmente morre', async () => {
    const produtor = await createProducerUser(db, orgProd, { username: `bic_trans_${sufixo}` });

    // (a) Rebaixar sem limpar o escopo.
    await assert.rejects(
      () => db.query("UPDATE users SET role = 'user' WHERE id = $1", [produtor.id]),
      CHECK, 'rebaixar deixando o crachá para trás'
    );
    // (b) Limpar o escopo sem rebaixar.
    await assert.rejects(
      () => db.query('UPDATE users SET producer_org_id = NULL WHERE id = $1', [produtor.id]),
      CHECK, 'tirar a OM e manter o papel'
    );
    // (c) O par POSITIVO, no mesmo corpo: os dois campos juntos passam, nos dois
    // sentidos. Sem ele, "recusa os dois UPDATEs" também é o que se mede num CHECK
    // que recusaria qualquer escrita na tabela.
    await db.query("UPDATE users SET role = 'user', producer_org_id = NULL WHERE id = $1", [produtor.id]);
    await db.query(
      "UPDATE users SET role = 'producer', producer_org_id = $2::uuid WHERE id = $1",
      [produtor.id, orgProd]
    );
    const { rows } = await db.query('SELECT role, producer_org_id FROM users WHERE id = $1', [produtor.id]);
    assert.equal(rows[0].role, 'producer');
    assert.equal(rows[0].producer_org_id, orgProd);

    // (d) E trocar de OM de produção é livre: um produtor produz para UMA OM, não
    // para sempre a mesma.
    await db.query('UPDATE users SET producer_org_id = $2::uuid WHERE id = $1', [produtor.id, orgOutra]);
    const { rows: r2 } = await db.query('SELECT producer_org_id FROM users WHERE id = $1', [produtor.id]);
    assert.equal(r2[0].producer_org_id, orgOutra);
  });

  it('o escopo é FK: uma OM inexistente não vira crachá', async () => {
    // `producer_org_id UUID REFERENCES organizations(id)`. Sem a FK, um UUID digitado
    // errado produziria um produtor de OM nenhuma — que passa no bicondicional e não
    // alcança linha alguma, o modo de falha mais difícil de diagnosticar dos dois.
    // Casa pelo NOME DA CONSTRAINT, e não pelo texto do erro: a mensagem do driver é
    // LOCALIZADA (este banco fala pt-BR), então um regex sobre "violates foreign key"
    // reprova numa máquina e passa noutra — flake com cara de regressão.
    await assert.rejects(
      () => inserir('producer', randomUUID()),
      /users_producer_org_id_fkey/
    );
  });

  it('BORDA HTTP — criar Produtor sem OM é 422 com nome de campo, não 23514', async () => {
    // O Joi cobra o bicondicional na CRIAÇÃO, onde o corpo é o estado inteiro.
    const sem = await supertest(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ username: `bic_novo_a_${sufixo}`, password: 'Test@1234', nome: 'Sem OM', role: 'producer' })
      .expect(422);
    assert.match(JSON.stringify(sem.body), /producer_org_id|OM de produção/i, 'a recusa nomeia o campo');

    // E o simétrico: OM sem o papel.
    await supertest(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        username: `bic_novo_b_${sufixo}`, password: 'Test@1234', nome: 'OM sem papel',
        role: 'user', producer_org_id: orgProd,
      })
      .expect(422);

    // O PAR: com os dois campos, nasce.
    const ok = await supertest(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        username: `bic_novo_c_${sufixo}`, password: 'Test@1234', nome: 'Produtor',
        role: 'producer', producer_org_id: orgProd,
      })
      .expect(201);
    const { rows } = await db.query(
      'SELECT role, producer_org_id FROM users WHERE id = $1', [ok.body.data.id]
    );
    assert.equal(rows[0].role, 'producer');
    assert.equal(rows[0].producer_org_id, orgProd, 'e o escopo chega ao banco, não só à resposta');
  });

  it('BORDA HTTP — a EDIÇÃO resolve o par pelo estado efetivo, e o rebaixamento limpa sozinho', async () => {
    // A EDIÇÃO É PARCIAL, e é por isso que o Joi não basta: o par que vale é a
    // mistura do corpo com a linha, e o schema só enxerga o corpo. Um `when('role')`
    // aqui recusaria trocar a OM de um produtor sem reenviar o papel.
    const alvo = await createUser(db, { username: `bic_edit_${sufixo}` });

    // (a) Promover sem OM: 400 LEGÍVEL, não o 23514 genérico do driver.
    const ruim = await supertest(app)
      .put(`/api/v1/users/${alvo.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ role: 'producer' })
      .expect(400);
    assert.match(
      JSON.stringify(ruim.body), /OM de produção/i,
      'a mensagem precisa dizer o que corrigir — o 23514 traduzido não diz'
    );
    const { rows: intacto } = await db.query('SELECT role FROM users WHERE id = $1', [alvo.id]);
    assert.equal(intacto[0].role, 'user', 'e a recusa é sem efeito');

    // (b) Promover COM a OM: passa.
    await supertest(app)
      .put(`/api/v1/users/${alvo.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ role: 'producer', producer_org_id: orgProd })
      .expect(200);

    // (c) Trocar SÓ a OM, sem reenviar o papel: é o caso que um `when` no Joi
    // recusaria, e ele precisa passar.
    await supertest(app)
      .put(`/api/v1/users/${alvo.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ producer_org_id: orgOutra })
      .expect(200);
    const { rows: trocado } = await db.query(
      'SELECT role, producer_org_id FROM users WHERE id = $1', [alvo.id]
    );
    assert.equal(trocado[0].producer_org_id, orgOutra);
    assert.equal(trocado[0].role, 'producer', 'e o papel continua de pé');

    // (d) REBAIXAR sem mandar `producer_org_id`: o escopo cai junto, sem erro. Exigir
    // que quem edita se lembre do segundo campo transformaria a operação mais comum
    // num 400.
    await supertest(app)
      .put(`/api/v1/users/${alvo.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ role: 'user' })
      .expect(200);
    const { rows: limpo } = await db.query(
      'SELECT role, producer_org_id FROM users WHERE id = $1', [alvo.id]
    );
    assert.equal(limpo[0].role, 'user');
    assert.equal(limpo[0].producer_org_id, null, 'rebaixar LIMPA o escopo, e é assim que o par sobrevive');
  });

  it('o auto-serviço NÃO toca o crachá: `PUT /users/me` não aceita `producer_org_id`', async () => {
    // O AUTO-CADASTRO DE CRACHÁ SERIA ESTA FASE INTEIRA DESFEITA. `updateProfileSchema`
    // aceita dois campos e mais nada, e `stripUnknown` descarta o resto em silêncio —
    // então a asserção precisa ser sobre a LINHA, nunca sobre o status.
    const produtor = await createProducerUser(db, orgProd, { username: `bic_self_${sufixo}` });
    const token = await loginUser(app, produtor.username, produtor.password);

    await supertest(app)
      .put('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Autor de si mesmo', producer_org_id: orgOutra, organization_id: orgOutra, role: 'admin' })
      .expect(200);

    const { rows } = await db.query(
      'SELECT nome, role, producer_org_id FROM users WHERE id = $1', [produtor.id]
    );
    assert.equal(rows[0].nome, 'Autor de si mesmo', 'o campo legítimo do perfil muda — o par que prova que a rota rodou');
    assert.equal(rows[0].producer_org_id, orgProd, 'e o crachá não se move sozinho');
    assert.equal(rows[0].role, 'producer', 'nem o papel global');
  });
});
