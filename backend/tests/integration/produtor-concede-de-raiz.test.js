// Path: tests/integration/produtor-concede-de-raiz.test.js
//
// O PRODUTOR CONCEDE ACESSO AO QUE ELE MANTÉM, E CONCEDE DE RAIZ.
//
// `parent_grant_id` é escrito num lugar só, o INSERT de `grantResource`, e ele é NULL
// quando o concedente não deriva de ninguém. Até 2026-08-20 o único titular disso era o
// papel global; o produtor entrou pela mesma porta e pela mesma razão ESTRUTURAL: ele
// enxerga o recurso por PRODUÇÃO (`fn_can_see_resource` tem esse ramo desde a baseline
// de acesso), não por concessão, então não existe `view_share` de onde pendurar. Sem o
// ramo, ele passava no gate e morria no `ForbiddenError` do serviço.
//
// A FRONTEIRA QUE NÃO PODE VAZAR é "o produtor concede o que ele NÃO produz", e ela é
// medida com os três casos indistinguíveis entre si: o institucional que ele ENXERGA
// por uma concessão `view`, o privado de outra OM que ele não enxerga, e um id que não
// existe. Os três com a mesma resposta, para que o 403 não vire oráculo de inventário.
//
// O REBAIXAMENTO DERRUBA O QUE A PESSOA CONCEDEU, e os últimos casos deste arquivo o
// medem. Até 2026-08-21 valia o contrário, e o caso que afirmava isso foi INVERTIDO em
// vez de apagado: a lacuna era real (a raiz de um produtor sem OM, ou de um administrador
// rebaixado a `user`, sobrevivia até um ano) e o dono decidiu fechá-la pela forma SIMPLES
// — ao rebaixar, poda-se TODA concessão daquela pessoa, sem distinguir sob qual
// autoridade cada uma nasceu. A direção de falha correta numa revogação é a fechada.
//
// O PAR PREDICADO/GANCHO É O QUE ESTES CASOS SEPARAM, e é a razão de um deles continuar
// rebaixando por SQL cru. O PREDICADO (`fn_principal_vivo(g.granted_by)`, D8(b)) NÃO
// mudou e continua perguntando se a CONTA está viva: rebaixar não desativa ninguém, então
// mexer no papel por baixo do serviço não derruba nada. Quem derruba é o GANCHO da rota de
// administração (`updateUser`, `fundamentoDeRaizPerdido` + `podarPorRaizes`). Sem os dois
// casos lado a lado, um verde no primeiro seria compatível com uma poda que nasceu no
// lugar errado.
//
// O EMPRÉSTIMO por atlas nunca teve a assimetria (ele é reavaliado a cada leitura), e é o
// que `emprestimo-do-produtor-resolve.test.js` mede.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, loginUser,
} from '../helpers/fixtures.js';

describe('F17 — o produtor concede DE RAIZ o que ele produz', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  let orgA, orgB;

  const DELE = `raiz-a-${sufixo}`;
  const DO_VIZINHO = `raiz-b-${sufixo}`;
  const INSTITUCIONAL = `raiz-inst-${sufixo}`;
  const INEXISTENTE = `raiz-nao-existe-${sufixo}`;

  const conceder = (quem, id, corpo) => supertest(app)
    .post(`/api/v1/resource-access/tileset/${id}/grants`)
    .set('Authorization', `Bearer ${tokens[quem]}`)
    .send(corpo);

  const revogar = (quem, grantId) => supertest(app)
    .delete(`/api/v1/resource-access/grants/${grantId}`)
    .set('Authorization', `Bearer ${tokens[quem]}`);

  async function visiveis(quem) {
    const res = await supertest(app)
      .get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .expect(200);
    return res.body.data.tilesets.map((t) => t.id);
  }

  // A ROTA DE ADMINISTRAÇÃO, que é onde o gancho do rebaixamento vive. Rebaixar por
  // `UPDATE users` no banco exercita o PREDICADO e nunca o serviço, e era assim que o
  // caso antigo (o que media a lacuna) media a coisa errada para a pergunta nova.
  const editarUsuario = (quem, userId, corpo) => supertest(app)
    .put(`/api/v1/users/${userId}`)
    .set('Authorization', `Bearer ${tokens[quem]}`)
    .send(corpo);

  // Atores DESCARTÁVEIS, um jogo por caso: rebaixar é irreversível para as concessões, e
  // reusar os atores compartilhados faria um caso decidir o piso do seguinte.
  let seq = 0;
  async function ator(rotulo, producerOrgId = null) {
    seq += 1;
    const chave = `${rotulo}${seq}`;
    const u = producerOrgId
      ? await createProducerUser(db, producerOrgId, { username: `rz_${chave}_${sufixo}` })
      : await createUser(db, { username: `rz_${chave}_${sufixo}` });
    atores[chave] = u;
    tokens[chave] = await loginUser(app, u.username, u.password);
    return chave;
  }

  const linhaDaConcessao = async (grantId) => (await db.query(
    'SELECT revoked_at, revoked_by, parent_grant_id FROM resource_grants WHERE id = $1::uuid',
    [grantId],
  )).rows[0];

  const papelGravado = async (userId) => (await db.query(
    'SELECT role, producer_org_id, nome FROM users WHERE id = $1::uuid', [userId],
  )).rows[0];

  /** As linhas de trilha DA PODA sobre uma concessão, filtradas pela origem nova. */
  const trilhaDaPoda = async (grantId) => (await db.query(
    `SELECT action, details FROM audit_trail
      WHERE details->>'grantId' = $1 AND details->>'origem' = 'USER_DEMOTION'
      ORDER BY created_at`,
    [grantId],
  )).rows;

  const contaVivas = async (resourceId, granteeId) => (await db.query(
    `SELECT COUNT(*)::int AS n FROM resource_grants
      WHERE resource_id = $1 AND grantee_id = $2::uuid AND revoked_at IS NULL`,
    [resourceId, granteeId],
  )).rows[0].n;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const criaOrg = async (rotulo) => (await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM raiz ${rotulo} ${sufixo}`, `om-raiz-${rotulo}-${sufixo}`, `${rotulo}${sufixo.slice(0, 3)}`],
    )).rows[0].id;
    orgA = await criaOrg('a');
    orgB = await criaOrg('b');

    atores.admin = await createAdminUser(db, { username: `rz_admin_${sufixo}` });
    atores.produtor = await createProducerUser(db, orgA, { username: `rz_prod_${sufixo}` });
    atores.colega = await createProducerUser(db, orgA, { username: `rz_colega_${sufixo}` });
    for (const nome of ['beneficiario', 'terceiro', 'outro', 'quarto']) {
      atores[nome] = await createUser(db, { username: `rz_${nome}_${sufixo}` });
    }
    for (const nome of Object.keys(atores)) {
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }

    for (const [id, org] of [[DELE, orgA], [DO_VIZINHO, orgB], [INSTITUCIONAL, null]]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, sort_order, owner_org_id, access_level)
         VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, $3::uuid, 'private')`,
        [id, `Tileset ${id}`, org],
      );
    }
    // O produtor ENXERGA o institucional, por uma concessão `view` — o nível cuja
    // definição é "vê e NÃO repassa". É ele que torna o caso da fronteira honesto:
    // sem esta linha, o 403 sobre o institucional seria o de quem não conhece a linha.
    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${INSTITUCIONAL}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ granteeId: atores.produtor.id, grantLevel: 'view' })
      .expect(201);
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM tilesets WHERE id LIKE $1', [`%${sufixo}%`]);
    // POR NOME, e não só por `producer_org_id`: metade dos atores destes casos termina
    // REBAIXADA (papel `user`, escopo nulo), e a limpeza por escopo de produção não
    // alcança quem acabou de perdê-lo — que é justamente o que os casos novos produzem.
    await db.query('DELETE FROM users WHERE username LIKE $1', [`rz\\_%\\_${sufixo}`]);
    await db.query('DELETE FROM users WHERE producer_org_id = ANY($1::uuid[])', [[orgA, orgB]]);
    await db.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[orgA, orgB]]);
    await teardownTestEnv(db);
  });

  it('o produtor concede DE RAIZ o recurso que produz', async () => {
    // O PISO É A AUSÊNCIA DE PAI: ele não tem concessão nenhuma sobre este recurso, e é
    // isso que dá sentido a "de raiz". O que ele tem é o crachá.
    assert.equal(
      await contaVivas(DELE, atores.produtor.id), 0,
      'piso: o produtor não recebeu concessão nenhuma sobre o que ele mesmo mantém',
    );
    assert.ok(
      !(await visiveis('beneficiario')).includes(DELE),
      'piso: o beneficiário não via o recurso antes',
    );

    const criada = (await conceder('produtor', DELE, {
      granteeId: atores.beneficiario.id, grantLevel: 'view',
    }).expect(201)).body.data;

    assert.equal(criada.parent_grant_id, null, 'concessão de RAIZ: não há pai de onde derivar');
    assert.equal(criada.granted_by, atores.produtor.id);
    // O 201 SOZINHO PASSARIA numa concessão pendurada em pai errado, numa que nasce
    // morta pelo prazo, ou numa que não entrega acesso nenhum.
    assert.ok(
      (await visiveis('beneficiario')).includes(DELE),
      'e o beneficiário passa a VER o recurso, que é o que a concessão promete',
    );
  });

  it('A FRONTEIRA: o produtor não concede o que não produz, e os três casos são iguais', async () => {
    // O PISO ESTÁ NO MESMO ARQUIVO E NO MESMO INSTANTE: a rota funciona para ele, com
    // este token. Sem isso, três 403 são o que se mede numa rota quebrada.
    await conceder('produtor', DELE, {
      granteeId: atores.terceiro.id, grantLevel: 'view',
    }).expect(201);

    const fronteira = [
      // Ele VÊ este (por uma concessão `view`) e mesmo assim não o repassa.
      INSTITUCIONAL,
      // Este ele não vê: é privado de outra OM.
      DO_VIZINHO,
      // E este não existe. Os três com a MESMA resposta, para que o 403 não conte nada
      // sobre o inventário.
      INEXISTENTE,
    ];
    assert.equal(fronteira.length, 3, 'os três casos indistinguíveis');

    for (const id of fronteira) {
      await conceder('produtor', id, {
        granteeId: atores.outro.id, grantLevel: 'view',
      }).expect(403);
      const { rows } = await db.query(
        'SELECT COUNT(*)::int AS n FROM resource_grants WHERE resource_id = $1 AND grantee_id = $2::uuid',
        [id, atores.outro.id],
      );
      assert.equal(rows[0].n, 0, `${id}: a recusa precisa ser SEM EFEITO`);
    }

    // FECHA POR CIMA: o administrador concede o institucional, provando que o recurso é
    // concedível e que o que falta ao produtor é a AUTORIDADE sobre ele.
    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${INSTITUCIONAL}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ granteeId: atores.outro.id, grantLevel: 'view' })
      .expect(201);
    assert.ok((await visiveis('outro')).includes(INSTITUCIONAL));
  });

  it('quem revoga a concessão-raiz do produtor é quem a DEU (ou o administrador)', async () => {
    const doProdutor = (await conceder('produtor', DELE, {
      granteeId: atores.outro.id, grantLevel: 'view',
    }).expect(201)).body.data;
    const doAdmin = (await supertest(app)
      .post(`/api/v1/resource-access/tileset/${DELE}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ granteeId: atores.quarto.id, grantLevel: 'view' })
      .expect(201)).body.data;

    assert.ok((await visiveis('outro')).includes(DELE), 'piso: a concessão está viva e funciona');

    // O beneficiário da segunda linha é um usuário COMUM, e não o colega produtor: o
    // produtor da OM vê o recurso pelo crachá, então revogar a concessão dele não
    // mudaria nada na leitura e o controle de reversão não discriminaria nada.
    //
    // A DISCRIMINAÇÃO CENTRAL: um SEGUNDO produtor da MESMA OM não revoga o que o
    // colega deu. A autoridade de revogar é por AUTORIA (`granted_by`), não por OM —
    // sem esta linha, "o produtor revoga o que deu" passaria idêntico num gate que
    // deixasse qualquer produtor derrubar a subárvore alheia.
    await revogar('colega', doProdutor.id).expect(403);
    assert.ok((await visiveis('outro')).includes(DELE), 'e a recusa é sem efeito');

    await revogar('produtor', doProdutor.id).expect(200);
    assert.ok(!(await visiveis('outro')).includes(DELE), 'quem deu, tira');

    // E o ramo CURINGA: o administrador revoga a que ele mesmo deu (e revogaria
    // qualquer outra). Sem ele, o 403 acima seria compatível com uma rota fechada.
    await revogar('admin', doAdmin.id).expect(200);
    assert.ok(!(await visiveis('quarto')).includes(DELE));
  });

  it('o `view` que o produtor deu NÃO vira `view_share`', async () => {
    // A RAIZ NOVA NÃO PODE AFROUXAR A DISTINÇÃO ENTRE OS DOIS NÍVEIS, que é a única
    // coisa que os separa: quem recebeu `view` vê e não repassa, venha a concessão de
    // quem vier.
    const layer = DELE;
    // O beneficiário recebeu `view` do produtor no primeiro caso, e o piso é ele VER:
    // sem isso, o 403 abaixo seria o de alguém sem acesso nenhum.
    assert.ok((await visiveis('beneficiario')).includes(layer), 'piso: ele vê o recurso');

    await conceder('beneficiario', layer, {
      granteeId: atores.outro.id, grantLevel: 'view',
    }).expect(403);

    // A DISCRIMINAÇÃO, no mesmo instante: o produtor concedente repassa a um terceiro
    // com 201. Sem ela, o 403 acima seria o de uma rota que passou a negar tudo.
    const paraOutro = (await conceder('produtor', layer, {
      granteeId: atores.outro.id, grantLevel: 'view_share',
    }).expect(201)).body.data;
    assert.equal(paraOutro.parent_grant_id, null, 'e continua sendo de RAIZ');
    // E quem recebeu `view_share` DO produtor repassa de fato, derivando dele.
    const derivada = (await conceder('outro', layer, {
      granteeId: atores.beneficiario.id, grantLevel: 'view',
    }).expect(201)).body.data;
    assert.equal(
      derivada.parent_grant_id, paraOutro.id,
      'a cadeia continua sendo uma árvore: o filho pendura no `view_share` de onde veio',
    );
  });

  it('INVERTIDO: o REBAIXAMENTO pela rota de administração DERRUBA a concessão-raiz', async () => {
    // ESTE CASO AFIRMAVA O CONTRÁRIO até 2026-08-21, e a inversão é a decisão do dono:
    // a concessão de raiz vive enquanto quem a deu tiver de onde tirá-la. O que ele
    // preservou do caso antigo é o método — o piso (a concessão é de RAIZ), e a medição
    // na PORTA (`GET /resource-access/visible`) e não só na tabela. Uma linha com
    // `revoked_at` preenchido é compatível com um predicado de leitura que a ignore.
    const produtor = await ator('rebRota', orgA);
    const beneficiario = await ator('benRota');

    const criada = (await conceder(produtor, DELE, {
      granteeId: atores[beneficiario].id, grantLevel: 'view',
    }).expect(201)).body.data;
    assert.equal(criada.parent_grant_id, null, 'piso: é concessão de RAIZ');
    assert.ok((await visiveis(beneficiario)).includes(DELE), 'piso: o beneficiário VÊ na porta');

    // REBAIXAMENTO PELA ROTA, e não por SQL: é onde o gancho vive. A conta continua
    // ATIVA — não é uma desativação disfarçada, e o caso seguinte prova que a conta viva
    // é exatamente o que fazia o predicado sozinho não bastar.
    await editarUsuario('admin', atores[produtor].id, { role: 'user' }).expect(200);
    const depois = await papelGravado(atores[produtor].id);
    assert.equal(depois.role, 'user', 'piso do ato: o papel foi de fato gravado');
    assert.equal(depois.producer_org_id, null, 'e o escopo de produção caiu junto');

    const linha = await linhaDaConcessao(criada.id);
    assert.ok(linha.revoked_at !== null, 'a concessão-raiz do rebaixado foi REVOGADA');
    assert.equal(
      linha.revoked_by, atores.admin.id,
      'e quem consta é o administrador que rebaixou, não o rebaixado',
    );
    assert.ok(
      !(await visiveis(beneficiario)).includes(DELE),
      'e o beneficiário deixa de ver NA PORTA, que é o que a revogação promete',
    );

    // O PISO DA TRILHA: a poda deixa rastro, e com a origem PRÓPRIA. Sem `origem`, a
    // leitura seria "o administrador revogou uma concessão que ele nunca deu", e nada
    // explicaria a autoridade dele para isso.
    const trilha = await trilhaDaPoda(criada.id);
    assert.equal(trilha.length, 1, 'uma linha de trilha para a concessão derrubada');
    assert.equal(trilha[0].action, 'PERMISSION_REVOKE');
    assert.equal(trilha[0].details.origem, 'USER_DEMOTION');
    assert.equal(trilha[0].details.granteeId, atores[beneficiario].id);
  });

  it('o PREDICADO não é quem derruba: rebaixar por SQL cru deixa a concessão viva', async () => {
    // A DISCRIMINAÇÃO QUE SEPARA O PAR, e o motivo de este caso sobreviver à inversão.
    // Ele é o caso antigo inteiro, com o mesmo método e a mesma medição; o que mudou foi
    // a pergunta que ele responde. Ele mede o PREDICADO sozinho (`fn_principal_vivo`
    // pergunta se a CONTA está viva, e rebaixar não desativa ninguém), e o caso acima
    // mede o GANCHO. Sem ele, um verde lá seria compatível com uma poda que nasceu do
    // lado do SQL, alcançando também a reativação e a desativação de OM — outro
    // comportamento, com a mesma cara.
    const produtor = await ator('rebSql', orgA);
    const beneficiario = await ator('benSql');

    const criada = (await conceder(produtor, DELE, {
      granteeId: atores[beneficiario].id, grantLevel: 'view',
    }).expect(201)).body.data;
    assert.equal(criada.parent_grant_id, null, 'piso: é concessão de RAIZ');
    assert.ok((await visiveis(beneficiario)).includes(DELE), 'piso: o beneficiário vê');

    await db.query(
      `UPDATE users SET role = 'user', producer_org_id = NULL WHERE id = $1`,
      [atores[produtor].id],
    );

    const { rows: produz } = await db.query(
      `SELECT fn_can_produce_resource($1::uuid, 'tileset', $2) AS ok`,
      [atores[produtor].id, DELE],
    );
    assert.equal(produz[0].ok, false, 'o concedente deixou de produzir');
    const { rows: vivo } = await db.query(
      'SELECT fn_principal_vivo($1::uuid) AS ok', [atores[produtor].id],
    );
    assert.equal(vivo[0].ok, true, 'e continua VIVO: é a conta que ela mede, não a autoridade');

    assert.equal(
      (await linhaDaConcessao(criada.id)).revoked_at, null,
      'nenhuma linha foi revogada: quem revoga é o serviço, e ele não foi chamado',
    );
    assert.ok(
      (await visiveis(beneficiario)).includes(DELE),
      'e o beneficiário CONTINUA vendo: a raiz não é reavaliada contra a autoridade',
    );
  });

  it('DISCRIMINAÇÃO: um PUT que não toca papel nem escopo não poda nada', async () => {
    const produtor = await ator('rebNome', orgA);
    const beneficiario = await ator('benNome');

    const criada = (await conceder(produtor, DELE, {
      granteeId: atores[beneficiario].id, grantLevel: 'view',
    }).expect(201)).body.data;
    assert.equal(criada.parent_grant_id, null, 'piso: é concessão de RAIZ');

    await editarUsuario('admin', atores[produtor].id, { nome: 'Nome Trocado' }).expect(200);

    // O PISO DO ATO, e sem ele o caso inteiro é vazio: um PUT que não mudasse NADA
    // passaria nesta asserção de forma idêntica, e "não podou" não significaria coisa
    // nenhuma. O que se afirma é que uma edição EFETIVA, fora dos dois eixos de
    // autoridade, não derruba acesso.
    const depois = await papelGravado(atores[produtor].id);
    assert.equal(depois.nome, 'Nome Trocado', 'piso: a edição teve efeito');
    assert.equal(depois.role, 'producer', 'e o papel não se mexeu');
    assert.equal(depois.producer_org_id, orgA, 'nem o escopo de produção');

    assert.equal(
      (await linhaDaConcessao(criada.id)).revoked_at, null,
      'a concessão continua viva',
    );
    assert.ok((await visiveis(beneficiario)).includes(DELE), 'e o beneficiário continua vendo');
    assert.equal((await trilhaDaPoda(criada.id)).length, 0, 'e a poda não deixou rastro nenhum');
  });

  it('DISCRIMINAÇÃO: PROMOVER não poda, nem quando a promoção LIMPA o escopo de produção', async () => {
    // O CASO MAIS AFIADO DA DEFINIÇÃO, e a razão de ela não poder ser "o escopo mudou":
    // promover um produtor a administrador APAGA `producer_org_id` (o CHECK bicondicional
    // não deixa um admin carregar escopo), então uma regra escrita sobre a coluna leria a
    // promoção como perda e derrubaria o acervo no ato que AUMENTA a autoridade. Quem
    // termina com acesso global de dado não perdeu fundamento nenhum: `admin` e
    // `credenciado` concedem qualquer recurso privado.
    const produtor = await ator('rebProm', orgA);
    const beneficiario = await ator('benProm');

    const criada = (await conceder(produtor, DELE, {
      granteeId: atores[beneficiario].id, grantLevel: 'view',
    }).expect(201)).body.data;
    assert.equal(criada.parent_grant_id, null, 'piso: é concessão de RAIZ');
    assert.ok((await visiveis(beneficiario)).includes(DELE), 'piso: o beneficiário vê');

    await editarUsuario('admin', atores[produtor].id, { role: 'admin' }).expect(200);
    const promovido = await papelGravado(atores[produtor].id);
    assert.equal(promovido.role, 'admin');
    assert.equal(
      promovido.producer_org_id, null,
      'piso: a promoção LIMPOU o escopo, que é exatamente o que uma regra ingênua leria como perda',
    );
    assert.equal((await linhaDaConcessao(criada.id)).revoked_at, null, 'e nada foi podado');
    assert.ok((await visiveis(beneficiario)).includes(DELE), 'o beneficiário continua vendo');

    // O MOVIMENTO LATERAL entre os DOIS papéis de dado global também não poda: nenhum
    // dos dois contém o outro, e os dois concedem o acervo privado inteiro.
    await editarUsuario('admin', atores[produtor].id, { role: 'credenciado' }).expect(200);
    assert.equal((await papelGravado(atores[produtor].id)).role, 'credenciado');
    assert.equal((await linhaDaConcessao(criada.id)).revoked_at, null, 'lateral também não poda');
    assert.ok((await visiveis(beneficiario)).includes(DELE));

    // FECHA POR CIMA, no MESMO ator e pela MESMA rota: sair do eixo global PODA. Sem
    // esta linha, os três verdes acima seriam compatíveis com um gancho que nunca roda.
    await editarUsuario('admin', atores[produtor].id, { role: 'user' }).expect(200);
    assert.ok(
      (await linhaDaConcessao(criada.id)).revoked_at !== null,
      'o mesmo PUT, ao tirar o acesso global de dado, derruba',
    );
    assert.ok(!(await visiveis(beneficiario)).includes(DELE));
  });

  it('trocar a OM de produção PODA: em relação ao acervo antigo, deixou de produzir', async () => {
    // A DECISÃO ESCRITA: `omAntes !== omDepois`, e não `omDepois === null`. A pessoa
    // continua sendo Produtor e continua podendo conceder de raiz — só que da OM B, e a
    // concessão viva é sobre um tileset da OM A, que ela não mantém mais.
    const produtor = await ator('rebOm', orgA);
    const beneficiario = await ator('benOm');

    const criada = (await conceder(produtor, DELE, {
      granteeId: atores[beneficiario].id, grantLevel: 'view',
    }).expect(201)).body.data;
    assert.equal(criada.parent_grant_id, null, 'piso: é concessão de RAIZ');
    assert.ok((await visiveis(beneficiario)).includes(DELE), 'piso: o beneficiário vê');

    await editarUsuario('admin', atores[produtor].id, { producer_org_id: orgB }).expect(200);
    const depois = await papelGravado(atores[produtor].id);
    assert.equal(depois.role, 'producer', 'piso: ele CONTINUA produtor, e não foi rebaixado de papel');
    assert.equal(depois.producer_org_id, orgB, 'só que de outra OM');

    assert.ok(
      (await linhaDaConcessao(criada.id)).revoked_at !== null,
      'e a concessão sobre o acervo da OM antiga cai',
    );
    assert.ok(!(await visiveis(beneficiario)).includes(DELE), 'medido na porta');
  });

  it('DISCRIMINAÇÃO: quem tem outro caminho vivo é REPAI-ADO, não derrubado', async () => {
    // A PRESERVAÇÃO DE ALCANÇABILIDADE (D3) é de `podarPorRaizes`, e este caso prova que
    // ela vale TAMBÉM por este caminho novo — reusar a função não garante que o chamador
    // novo lhe entregue as raízes certas: um chamador que passasse a subárvore inteira
    // como raiz teria três listas com a mesma cara e derrubaria o neto.
    const produtor = await ator('rebRepai', orgA);
    const meio = await ator('meioRepai');
    const fim = await ator('fimRepai');

    const doProdutor = (await conceder(produtor, DELE, {
      granteeId: atores[meio].id, grantLevel: 'view_share',
    }).expect(201)).body.data;
    // A ORDEM É O PISO DESTE CASO: a derivada nasce ANTES do segundo caminho, então ela
    // pendura no `view_share` do produtor, que é a raiz que vai cair. Criar o caminho do
    // administrador primeiro deixaria a paternidade indefinida e o caso mediria outra
    // coisa (um neto que a poda nem alcança).
    const derivada = (await conceder(meio, DELE, {
      granteeId: atores[fim].id, grantLevel: 'view',
    }).expect(201)).body.data;
    assert.equal(
      derivada.parent_grant_id, doProdutor.id,
      'piso: o neto pendura na raiz do produtor',
    );

    const doAdmin = (await supertest(app)
      .post(`/api/v1/resource-access/tileset/${DELE}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ granteeId: atores[meio].id, grantLevel: 'view_share' })
      .expect(201)).body.data;
    assert.ok((await visiveis(fim)).includes(DELE), 'piso: o neto vê');

    await editarUsuario('admin', atores[produtor].id, { role: 'user' }).expect(200);

    assert.ok(
      (await linhaDaConcessao(doProdutor.id)).revoked_at !== null,
      'a raiz do rebaixado cai',
    );
    const neto = await linhaDaConcessao(derivada.id);
    assert.equal(neto.revoked_at, null, 'mas o neto NÃO cai junto');
    assert.equal(
      neto.parent_grant_id, doAdmin.id,
      'ele foi RE-PENDURADO no outro caminho vivo do mesmo concedente',
    );
    assert.ok((await visiveis(fim)).includes(DELE), 'e continua vendo NA PORTA');
    assert.ok((await visiveis(meio)).includes(DELE), 'assim como o intermediário, pelo caminho do admin');

    // A TRILHA DISTINGUE AS DUAS CLASSES, e é o que responde "por que Fulano MANTEVE":
    // a queda é `PERMISSION_REVOKE`, o resgate é `PERMISSION_REPARENT`, os dois com a
    // origem nova.
    const trilhaDoNeto = await trilhaDaPoda(derivada.id);
    assert.equal(trilhaDoNeto.length, 1, 'uma linha sobre o neto');
    assert.equal(trilhaDoNeto[0].action, 'PERMISSION_REPARENT');
    assert.equal(trilhaDoNeto[0].details.kind, 'reparent');
    assert.equal(trilhaDoNeto[0].details.parentGrantId, doAdmin.id);
  });
});
