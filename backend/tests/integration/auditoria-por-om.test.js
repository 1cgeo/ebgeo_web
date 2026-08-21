// Path: tests/integration/auditoria-por-om.test.js
//
// A TRILHA GANHOU UM EIXO DE ORGANIZAÇÃO, E O RECORTE NÃO É PARÂMETRO DO CLIENTE.
//
// `GET /api/v1/audit` deixou de ser só-admin. Quem mantém o acervo de uma OM (o
// produtor) passa a ler a trilha DELA — e só dela. O recorte é resolvido no banco por
// `requireAuditReader` e imposto na primeira linha de `listAudit`; a query string do
// chamador não decide nada.
//
// O QUE CADA CASO PRECISA PROVAR, e por que a metade positiva vem primeiro: um filtro
// quebrado que devolvesse ZERO linhas passaria em toda asserção de ausência. Por isso o
// piso é sempre "o produtor recebe resposta NÃO VAZIA contendo a linha da OM dele", e só
// depois se afirma o que não está lá.
//
// AS LINHAS SÃO PLANTADAS POR ATOS REAIS (PUT no catálogo, PUT em /users/me), nunca por
// INSERT à mão em `audit_trail`: um INSERT à mão testaria a consulta contra um dado que
// o emissor talvez nunca produza, que é o vácuo clássico deste guarda.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, loginUser,
} from '../helpers/fixtures.js';
import * as auditService from '../../src/modules/audit/audit.service.js';

describe('Auditoria por OM — o produtor lê a trilha do próprio acervo, e só dela', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  let orgA, orgB;

  const DA_A = `aud-om-a-${sufixo}`;
  const DA_B = `aud-om-b-${sufixo}`;

  /** A trilha como `quem`, com os filtros dados. */
  const trilha = (quem, qs = '') => supertest(app)
    .get(`/api/v1/audit${qs}`)
    .set('Authorization', `Bearer ${tokens[quem]}`);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const criaOrg = async (rotulo) => (await db.query(
      'INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id',
      [`OM aud ${rotulo} ${sufixo}`, `om-aud-${rotulo}-${sufixo}`, `${rotulo}${sufixo.slice(0, 3)}`],
    )).rows[0].id;
    orgA = await criaOrg('a');
    orgB = await criaOrg('b');

    atores.admin = await createAdminUser(db, { username: `aud_admin_${sufixo}` });
    atores.produtorA = await createProducerUser(db, orgA, { username: `aud_prod_a_${sufixo}` });
    atores.produtorB = await createProducerUser(db, orgB, { username: `aud_prod_b_${sufixo}` });
    atores.comum = await createUser(db, { username: `aud_comum_${sufixo}` });
    for (const nome of Object.keys(atores)) {
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }

    for (const [id, org] of [[DA_A, orgA], [DA_B, orgB]]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, sort_order, owner_org_id)
         VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, $3::uuid)`,
        [id, `Tileset ${id}`, org],
      );
    }

    // OS TRÊS ATOS QUE PLANTAM A FIXTURE. Dois tocam acervo (um por OM) e o terceiro é
    // uma auto-edição de perfil, cuja linha nasce SEM OM — ela é a discriminação que
    // separa "recortado pela OM" de "recortado por qualquer coisa".
    await supertest(app).put(`/api/v1/tilesets/${DA_A}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ name: `Editado A ${sufixo}` }).expect(200);
    await supertest(app).put(`/api/v1/tilesets/${DA_B}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ name: `Editado B ${sufixo}` }).expect(200);
    await supertest(app).put('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokens.comum}`)
      .send({ nome: `Comum ${sufixo}` }).expect(200);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('piso: o produtor da OM-A recebe a linha da OM-A, e a resposta NÃO é vazia', async () => {
    const res = await trilha('produtorA').expect(200);
    const linhas = res.body.data.data;
    assert.ok(linhas.length >= 1, 'resposta vazia: toda asserção de ausência abaixo seria vácuo');
    const daA = linhas.filter((l) => l.target_id === DA_A);
    assert.equal(daA.length, 1, 'a edição do tileset da OM dele precisa estar na trilha dele');
    assert.equal(daA[0].action, 'CATALOG_UPDATE');
    assert.equal(daA[0].target_org_id, orgA, 'a linha nasce carimbada com a OM DONA do recurso');
  });

  it('a mesma resposta NÃO traz a OM vizinha nem o que não tem OM', async () => {
    const res = await trilha('produtorA').expect(200);
    const linhas = res.body.data.data;

    assert.deepEqual(
      linhas.filter((l) => l.target_id === DA_B), [],
      'o produtor da OM-A não pode ver o que aconteceu com o acervo da OM-B',
    );
    assert.deepEqual(
      linhas.filter((l) => l.target_type === 'USER'), [],
      'linha sem OM (auto-edição de perfil) não entra no recorte de OM nenhuma',
    );
    // TODA linha do recorte carrega a OM dele: uma única fora seria um vazamento que a
    // asserção por id acima não pegaria (ela só olha as três linhas plantadas).
    assert.deepEqual(
      [...new Set(linhas.map((l) => l.target_org_id))], [orgA],
      'nenhuma linha de outra OM (nem sem OM) pode atravessar o recorte',
    );
    assert.equal(res.body.data.escopoOrgId, orgA, 'a tela precisa saber que a lista é recortada');
    assert.equal(res.body.data.administra, false);
  });

  it('a DISCRIMINAÇÃO: o administrador, na MESMA fixture, vê as três linhas', async () => {
    const res = await trilha('admin').expect(200);
    const linhas = res.body.data.data;
    for (const alvo of [DA_A, DA_B]) {
      assert.equal(
        linhas.filter((l) => l.target_id === alvo).length, 1,
        `o administrador precisa ver a linha de ${alvo}`,
      );
    }
    assert.ok(
      linhas.some((l) => l.target_type === 'USER' && l.details?.self === true),
      'o administrador vê também o que não tem OM',
    );
    assert.equal(res.body.data.escopoOrgId, null);
    assert.equal(res.body.data.administra, true);
  });

  it('o recorte NÃO é parâmetro do cliente: `?targetOrgId=` da OM alheia é ignorado', async () => {
    const res = await trilha('produtorA', `?targetOrgId=${orgB}`).expect(200);
    const linhas = res.body.data.data;
    assert.ok(linhas.length >= 1, 'piso: a resposta continua sendo a DELE, não vazia');
    assert.deepEqual(
      [...new Set(linhas.map((l) => l.target_org_id))], [orgA],
      'pedir a OM alheia não pode mover o recorte',
    );
  });

  it('e o parâmetro EXISTE e funciona: o administrador o usa para estreitar', async () => {
    // A metade que impede a leitura errada do caso acima. Sem ela, um `targetOrgId`
    // simplesmente ignorado por todo mundo passaria verde e o filtro seria decorativo.
    const res = await trilha('admin', `?targetOrgId=${orgB}`).expect(200);
    const linhas = res.body.data.data;
    assert.ok(linhas.length >= 1, 'o administrador precisa conseguir estreitar por OM');
    assert.deepEqual([...new Set(linhas.map((l) => l.target_org_id))], [orgB]);
    assert.ok(linhas.some((l) => l.target_id === DA_B));
  });

  it('o recorte mora no SERVIÇO, e uma query hostil não o move (sem HTTP)', async () => {
    // O CAMINHO INDEPENDENTE: aqui não há rota, nem middleware, nem Joi. A query chega
    // hostil e o escopo chega recortado, e o que se afirma é o que a CONSULTA recebeu.
    const hostil = {
      targetOrgId: orgB, page: 1, limit: 50, targetType: 'TILESET',
    };
    const doProdutor = await auditService.listAudit(hostil, { administra: false, orgId: orgA });
    assert.deepEqual(
      [...new Set(doProdutor.data.map((l) => l.target_org_id))], [orgA],
      'o `targetOrgId` de quem não administra nunca é lido',
    );
    assert.equal(doProdutor.escopoOrgId, orgA);

    // A discriminação, na mesma chamada e com a mesma query: quem administra usa o
    // parâmetro. Se as duas linhas devolvessem OM-A, o recorte estaria travado em vez
    // de imposto, e o caso acima passaria pelo motivo errado.
    const doAdmin = await auditService.listAudit(hostil, { administra: true, orgId: null });
    assert.deepEqual([...new Set(doAdmin.data.map((l) => l.target_org_id))], [orgB]);
  });

  it('escopo ausente LEVANTA, em vez de listar tudo (falha fechada)', async () => {
    await assert.rejects(
      () => auditService.listAudit({ page: 1, limit: 10 }, undefined),
      /escopo de auditoria ausente/,
    );
  });

  it('o TOTAL do rodapé obedece ao MESMO recorte da lista (`COUNT_AUDIT`)', async () => {
    // SÃO DUAS CONSULTAS, e nada além de as strings terem sido escritas juntas garante
    // que elas concordem. `LIST_AUDIT` e `COUNT_AUDIT` recebem os mesmos sete
    // parâmetros; medido pela revisão adversarial, neutralizar o filtro de OM SÓ na
    // contagem passava verde em tudo. O sintoma seria "1.284 eventos · página 1 de 26"
    // com três linhas na tela, e a página 2 devolvendo o `emptyState` cujo texto afirma
    // que lista vazia significa "nada casou o filtro".
    const doProdutor = await trilha('produtorA').expect(200);
    const { total, data } = doProdutor.body.data;
    assert.ok(data.length >= 1, 'piso: a lista não é vazia, senão 0 === 0 passaria');
    assert.ok(data.length < 50, 'a fixture precisa caber numa página para esta igualdade valer');
    assert.equal(
      total, data.length,
      'o total conta o mesmo recorte que a lista mostra',
    );

    // A DISCRIMINAÇÃO: o total do administrador é MAIOR. Sem ela, uma contagem que
    // devolvesse sempre o tamanho da página passaria idêntica.
    const doAdmin = await trilha('admin').expect(200);
    assert.ok(
      doAdmin.body.data.total > total,
      'o administrador conta a trilha inteira, e ela tem mais que o recorte de uma OM',
    );
  });

  it('ator APAGADO não some da listagem: os JOIN são LEFT por contrato', async () => {
    // O COMENTÁRIO DE `audit.queries.js` diz que `LEFT` é contrato e não estilo, porque
    // um `INNER` apagaria da listagem exatamente as linhas cujo contexto se perdeu — as
    // que mais importam numa investigação. A metade de `organizations` já estava presa
    // de graça (a fixture tem linha com `target_org_id` nulo); a de `users` não estava:
    // medido, trocar aquele JOIN por `INNER` passava verde, porque toda fixture tinha
    // ator vivo. A tela já sabe desenhar o órfão (`nomeDoAtor` degrada para o id
    // truncado), o que tornava a assimetria pior: ela desenhava uma linha que o SQL
    // podia nunca entregar.
    const efemero = await createAdminUser(db, { username: `aud_efemero_${sufixo}` });
    const tokenEfemero = await loginUser(app, efemero.username, efemero.password);
    const DA_C = `aud-om-c-${sufixo}`;
    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, owner_org_id)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, $3::uuid)`,
      [DA_C, `Tileset ${DA_C}`, orgA],
    );
    await supertest(app).put(`/api/v1/tilesets/${DA_C}`)
      .set('Authorization', `Bearer ${tokenEfemero}`)
      .send({ name: `Editado C ${sufixo}` }).expect(200);

    const antes = await trilha('admin', `?targetId=${DA_C}`).expect(200);
    assert.equal(antes.body.data.data.length, 1, 'piso: a linha existe com o ator vivo');
    assert.equal(
      antes.body.data.data[0].actor_username, efemero.username,
      'piso: e o nome do ator desce resolvido — sem isto, o `null` de baixo não diria nada',
    );

    // `audit_trail.actor_id` NÃO TEM FK (decisão de schema: a trilha sobrevive à conta),
    // então o hard-delete da conta deixa a linha órfã em vez de levá-la junto.
    await db.query('DELETE FROM users WHERE id = $1', [efemero.id]);

    const depois = await trilha('admin', `?targetId=${DA_C}`).expect(200);
    assert.equal(
      depois.body.data.data.length, 1,
      'a linha do ator apagado continua na listagem: com `INNER JOIN users` ela sumiria',
    );
    assert.equal(depois.body.data.data[0].actor_username, null, 'e o nome vem nulo, não some a linha');
    assert.equal(depois.body.data.data[0].target_org_id, orgA, 'a OM segue gravada na coluna');
  });

  it('o produtor NÃO herda a administração: `GET /users` continua 403 para ele', async () => {
    // A cerca. Ler a trilha da própria OM não é administrar o sistema, e sem esta linha
    // o lote inteiro poderia ter promovido o papel sem nada ficar vermelho.
    await supertest(app).get('/api/v1/users')
      .set('Authorization', `Bearer ${tokens.produtorA}`).expect(403);
  });
});
