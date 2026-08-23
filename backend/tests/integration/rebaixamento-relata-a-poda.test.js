// Path: tests/integration/rebaixamento-relata-a-poda.test.js
//
// O PUT DE USUÁRIO RELATA O QUE ELE DESTRUIU.
//
// Trocar o papel global, ou a OM produtora, de quem concedeu acesso dispara
// `fundamentoDeRaizPerdido` + `podarPorRaizes` (origem `USER_DEMOTION`), e isso revoga
// TODA concessão viva daquela pessoa, com a subárvore. Até 2026-08-23 a rota devolvia só
// a linha atualizada: a aba de administração dizia "Usuário atualizado." depois de ter
// derrubado N acessos, e o administrador não tinha por onde saber. O agravante é que a
// poda dispara na simples desigualdade `omAntes !== omDepois`, então corrigir um erro de
// digitação na OM de um produtor destruía tudo o que ele havia concedido.
//
// O QUE ESTE ARQUIVO MEDE é o CONTRATO DE RESPOSTA, que é a metade nova:
// `grantsAffected`, `grantsReparented` e `fundamentoPerdido` no corpo do PUT, mais o
// `live_grant_count` que a LISTAGEM passou a carregar para que a tela consiga avisar ANTES
// do clique. O comportamento da poda em si (quem cai, quem é re-pendurado, o que a trilha
// registra) é de `produtor-concede-de-raiz.test.js` e não se repete aqui.
//
// TODO CASO CARREGA O PAR ASSERÇÃO/CONTROLE, e é o que separa "o número está certo" de "o
// número é sempre zero": os dois controles negativos (promover, e editar o nome) rodam
// contra atores que TÊM concessão viva, medida antes por `live_grant_count`. Um zero
// medido sobre quem nunca concedeu nada passaria verde com a propagação inteira apagada.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, loginUser,
} from '../helpers/fixtures.js';

describe('o PUT de usuário relata a poda que ele dispara', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  let orgA, orgB;

  const DA_OM_A = `poda-a-${sufixo}`;
  const OUTRO_DA_OM_A = `poda-a2-${sufixo}`;

  const conceder = (quem, id, corpo) => supertest(app)
    .post(`/api/v1/resource-access/tileset/${id}/grants`)
    .set('Authorization', `Bearer ${tokens[quem]}`)
    .send(corpo);

  const editarUsuario = (quem, userId, corpo) => supertest(app)
    .put(`/api/v1/users/${userId}`)
    .set('Authorization', `Bearer ${tokens[quem]}`)
    .send(corpo);

  /** A linha do usuário como a LISTAGEM da aba a entrega, que é de onde sai o aviso. */
  async function naListagem(userId) {
    const res = await supertest(app)
      .get('/api/v1/users?includeInactive=true')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .expect(200);
    return res.body.data.find((u) => u.id === userId);
  }

  const linhaDaConcessao = async (grantId) => (await db.query(
    'SELECT revoked_at, parent_grant_id FROM resource_grants WHERE id = $1::uuid',
    [grantId],
  )).rows[0];

  // Atores DESCARTÁVEIS, um jogo por caso: a poda é irreversível, e reusar os atores
  // faria um caso decidir o piso do seguinte.
  let seq = 0;
  async function ator(rotulo, producerOrgId = null) {
    seq += 1;
    const chave = `${rotulo}${seq}`;
    const u = producerOrgId
      ? await createProducerUser(db, producerOrgId, { username: `pd_${chave}_${sufixo}` })
      : await createUser(db, { username: `pd_${chave}_${sufixo}` });
    atores[chave] = u;
    tokens[chave] = await loginUser(app, u.username, u.password);
    return chave;
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const criaOrg = async (rotulo) => (await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM poda ${rotulo} ${sufixo}`, `om-poda-${rotulo}-${sufixo}`, `p${rotulo}${sufixo.slice(0, 2)}`],
    )).rows[0].id;
    orgA = await criaOrg('a');
    orgB = await criaOrg('b');

    atores.admin = await createAdminUser(db, { username: `pd_admin_${sufixo}` });
    tokens.admin = await loginUser(app, atores.admin.username, atores.admin.password);

    for (const id of [DA_OM_A, OUTRO_DA_OM_A]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, sort_order, owner_org_id, access_level)
         VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, $3::uuid, 'private')`,
        [id, `Tileset ${id}`, orgA],
      );
    }
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM tilesets WHERE id LIKE $1', [`%${sufixo}%`]);
    // POR NOME: metade dos atores termina REBAIXADA, e a limpeza por escopo de produção
    // não alcança quem acabou de perdê-lo.
    await db.query('DELETE FROM users WHERE username LIKE $1', [`pd\\_%\\_${sufixo}`]);
    await db.query('DELETE FROM users WHERE producer_org_id = ANY($1::uuid[])', [[orgA, orgB]]);
    await db.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[orgA, orgB]]);
    await teardownTestEnv(db);
  });

  it('REBAIXAR um produtor devolve a contagem do que caiu', async () => {
    const produtor = await ator('rebaixa', orgA);
    const beneficiario = await ator('ben');

    const criada = (await conceder(produtor, DA_OM_A, {
      granteeId: atores[beneficiario].id, grantLevel: 'view',
    }).expect(201)).body.data;

    // A PRÉVIA, que é o número com que a tela monta a confirmação ANTES do clique.
    assert.equal(
      (await naListagem(atores[produtor].id)).live_grant_count, 1,
      'a listagem sabe, antes do ato, quantas concessões vivas essa pessoa deu',
    );

    const corpo = (await editarUsuario('admin', atores[produtor].id, { role: 'user' })
      .expect(200)).body.data;

    assert.equal(corpo.role, 'user', 'piso do ato: o papel foi de fato gravado');
    assert.equal(corpo.grantsAffected, 1, 'e a resposta diz QUANTAS concessões caíram');
    assert.equal(corpo.grantsReparented, 0, 'nenhuma sobreviveu por outro caminho');
    assert.equal(
      corpo.fundamentoPerdido, 'escopo_de_producao',
      'e diz qual fundamento se perdeu, que é o que separa este ato de uma edição comum',
    );
    // O NÚMERO É DO BANCO, e não de um contador de conveniência: sem esta linha,
    // `grantsAffected: 1` seria compatível com uma constante.
    assert.ok(
      (await linhaDaConcessao(criada.id)).revoked_at !== null,
      'a concessão contada está de fato revogada',
    );
    assert.equal(
      (await naListagem(atores[produtor].id)).live_grant_count, 0,
      'e a prévia acompanha: não sobrou concessão viva para um próximo aviso',
    );
  });

  it('TROCAR a OM de quem continua produtor conta igual, e é o gesto que surpreende', async () => {
    // O GATILHO QUE PEGA O ADMINISTRADOR DE COSTAS: a poda dispara em
    // `omAntes !== omDepois`, então isto aqui é, na tela, a correção de um campo.
    const produtor = await ator('trocaOm', orgA);
    const um = await ator('benOmUm');
    const dois = await ator('benOmDois');

    for (const quem of [um, dois]) {
      await conceder(produtor, DA_OM_A, {
        granteeId: atores[quem].id, grantLevel: 'view',
      }).expect(201);
    }
    assert.equal((await naListagem(atores[produtor].id)).live_grant_count, 2, 'piso: duas vivas');

    const corpo = (await editarUsuario('admin', atores[produtor].id, { producer_org_id: orgB })
      .expect(200)).body.data;

    assert.equal(corpo.role, 'producer', 'piso: ele CONTINUA produtor');
    assert.equal(corpo.producer_org_id, orgB, 'só que de outra OM');
    assert.equal(corpo.grantsAffected, 2, 'as DUAS concessões caem, e a resposta as conta');
    assert.equal(corpo.fundamentoPerdido, 'escopo_de_producao');
  });

  it('CONTROLE NEGATIVO: PROMOVER não poda, e a contagem devolvida é ZERO', async () => {
    // O RAMO MAIS AFIADO: promover um produtor a administrador APAGA `producer_org_id`
    // (o CHECK bicondicional não deixa um admin carregar escopo), então uma regra escrita
    // sobre a coluna leria a promoção como perda e derrubaria o acervo no ato que AUMENTA
    // a autoridade.
    const produtor = await ator('promove', orgA);
    const beneficiario = await ator('benProm');

    const criada = (await conceder(produtor, DA_OM_A, {
      granteeId: atores[beneficiario].id, grantLevel: 'view',
    }).expect(201)).body.data;
    // O PISO QUE TORNA O ZERO SIGNIFICATIVO: havia o que podar.
    assert.equal(
      (await naListagem(atores[produtor].id)).live_grant_count, 1,
      'piso: esta pessoa TEM concessão viva, então um zero abaixo é uma afirmação',
    );

    const corpo = (await editarUsuario('admin', atores[produtor].id, { role: 'admin' })
      .expect(200)).body.data;

    assert.equal(corpo.role, 'admin');
    assert.equal(
      corpo.producer_org_id, null,
      'piso: a promoção LIMPOU o escopo, que é o que uma regra ingênua leria como perda',
    );
    assert.equal(corpo.grantsAffected, 0, 'nada foi revogado');
    assert.equal(corpo.grantsReparented, 0);
    assert.equal(corpo.fundamentoPerdido, null, 'e a resposta diz que não houve fundamento perdido');
    assert.equal(
      (await linhaDaConcessao(criada.id)).revoked_at, null,
      'a concessão continua viva, medida no banco e não só no contador',
    );
    assert.equal(
      (await naListagem(atores[produtor].id)).live_grant_count, 1,
      'e a prévia continua contando a concessão que não caiu',
    );

    // FECHA POR CIMA, no MESMO ator e pela MESMA rota: sair do eixo global PODA, e o
    // fundamento relatado é o OUTRO. Sem esta linha, os zeros acima seriam compatíveis
    // com uma propagação que nunca sai de zero.
    const depois = (await editarUsuario('admin', atores[produtor].id, { role: 'user' })
      .expect(200)).body.data;
    assert.equal(depois.grantsAffected, 1, 'o mesmo PUT, tirando o acesso global, derruba');
    assert.equal(depois.fundamentoPerdido, 'acesso_global_de_dado');
  });

  it('CONTROLE NEGATIVO: uma edição fora dos dois eixos devolve ZERO', async () => {
    const produtor = await ator('soNome', orgA);
    const beneficiario = await ator('benNome');

    await conceder(produtor, DA_OM_A, {
      granteeId: atores[beneficiario].id, grantLevel: 'view',
    }).expect(201);
    assert.equal((await naListagem(atores[produtor].id)).live_grant_count, 1, 'piso: há o que podar');

    const corpo = (await editarUsuario('admin', atores[produtor].id, { nome: 'Nome Trocado' })
      .expect(200)).body.data;

    assert.equal(corpo.nome, 'Nome Trocado', 'piso: a edição teve efeito');
    assert.equal(corpo.role, 'producer', 'e o par de autoridade não se mexeu');
    assert.equal(corpo.producer_org_id, orgA);
    assert.equal(corpo.grantsAffected, 0);
    assert.equal(corpo.grantsReparented, 0);
    assert.equal(corpo.fundamentoPerdido, null);
  });

  it('quem MANTEVE o acesso por outro caminho entra em `grantsReparented`', async () => {
    // SEM ESTE NÚMERO ao lado do outro, um `grantsAffected` menor que a prévia parece
    // poda incompleta. Ele é a contrapartida da preservação de alcançabilidade (D3).
    const produtor = await ator('repai', orgA);
    const meio = await ator('meioRepai');
    const fim = await ator('fimRepai');

    const doProdutor = (await conceder(produtor, DA_OM_A, {
      granteeId: atores[meio].id, grantLevel: 'view_share',
    }).expect(201)).body.data;
    // A ORDEM É O PISO: a derivada nasce ANTES do segundo caminho, então ela pendura na
    // raiz que vai cair.
    const derivada = (await conceder(meio, DA_OM_A, {
      granteeId: atores[fim].id, grantLevel: 'view',
    }).expect(201)).body.data;
    assert.equal(derivada.parent_grant_id, doProdutor.id, 'piso: o neto pendura na raiz do produtor');

    const doAdmin = (await conceder('admin', DA_OM_A, {
      granteeId: atores[meio].id, grantLevel: 'view_share',
    }).expect(201)).body.data;

    const corpo = (await editarUsuario('admin', atores[produtor].id, { role: 'user' })
      .expect(200)).body.data;

    assert.equal(corpo.grantsAffected, 1, 'só a raiz do rebaixado cai');
    assert.equal(corpo.grantsReparented, 1, 'e o neto conta como MANTIDO, não como derrubado');
    const neto = await linhaDaConcessao(derivada.id);
    assert.equal(neto.revoked_at, null, 'medido na linha: o neto não caiu');
    assert.equal(neto.parent_grant_id, doAdmin.id, 'foi re-pendurado no outro caminho vivo');
  });

  it('a listagem conta as concessões DADAS, não as recebidas', async () => {
    // A DISCRIMINAÇÃO QUE `live_grant_count` PRECISA TER: se ele contasse por
    // `grantee_id`, o aviso apareceria com o número de quem RECEBEU acesso, que não cai
    // em poda nenhuma deste ato.
    const quemDa = await ator('daConta', orgA);
    const quemRecebe = await ator('recebeConta');

    await conceder(quemDa, OUTRO_DA_OM_A, {
      granteeId: atores[quemRecebe].id, grantLevel: 'view',
    }).expect(201);

    assert.equal((await naListagem(atores[quemDa].id)).live_grant_count, 1, 'quem deu, conta 1');
    assert.equal(
      (await naListagem(atores[quemRecebe].id)).live_grant_count, 0,
      'quem recebeu, conta 0: ele não é fundamento de nada',
    );
  });
});
