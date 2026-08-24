// Path: tests/integration/resource-grants-inventario.test.js
//
// O INVENTÁRIO DE CONCESSÕES POR ATOR, e a EXTENSÃO de prazo de uma concessão viva.
//
// AS DUAS PONTAS QUE FALTAVAM. Até aqui só existia listagem POR RECURSO
// (`GET /:type/:id/grants`), com um gate de compartilhar. A consequência era dupla e
// silenciosa: quem CONCEDE precisava LEMBRAR o que concedeu para poder revogar (uma
// autoridade que não se enumera é uma autoridade que não se desfaz), e quem RECEBEU não
// tinha como sequer perguntar o que tem — nem sabia quando aquilo vence.
//
// A METADE QUE MAIS ENGANA É `received` POR GRUPO. A delegação por coletivo NÃO cria linha
// em `resource_grants` para o membro: ele alcança o que foi concedido AO GRUPO. Uma
// listagem escrita só sobre `grantee_id` compila, devolve linhas, parece certa, e responde
// "você não recebeu nada" a quem recebeu tudo por essa porta. É a lista fechada da
// constituição na forma de metade de um eixo, e é por isso que este arquivo mede os DOIS
// caminhos no mesmo corpo.
//
// A TERCEIRA ENTREGA, o PATCH de prazo, existe porque RENOVAR era impossível: a segunda
// concessão do mesmo par devolve 409, e o único caminho restante era revogar antes — mas
// revogar PODA a subárvore, e a poda não volta. Renovar destruía o acesso de terceiros que
// a renovação existia para preservar.
//
// O TETO QUE SURPREENDE, e ele é o achado que este arquivo registra: o teto da casa numa
// EXTENSÃO não é `NOW() + 1 ano`, é `created_at + 1 ano`. Quem manda é
// `resource_grants_expires_at_check`, que ancora as duas pontas em `created_at` porque um
// CHECK ancorado no relógio ficaria falso amanhã e travaria qualquer UPDATE na linha. Ou
// seja: uma LINHA de concessão nunca dura mais de um ano contado do nascimento, e estender
// é gastar o que sobra desse orçamento. Copiar o literal do INSERT produziria 23514 em
// toda concessão com mais de alguns meses, e o caso `orçamento da linha` abaixo é o que
// prende isso.
//
// NADA AQUI DORME NEM DEPENDE DE JANELA DE TEMPO: os deslocamentos são francos (dias), e
// os prazos efetivos são comparados contra o valor que o próprio banco guardou.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, loginUser, createAccessGroup, addAccessGroupMember,
} from '../helpers/fixtures.js';

const DIA_MS = 24 * 60 * 60 * 1000;
const emDias = (n) => new Date(Date.now() + n * DIA_MS).toISOString();

describe('inventário de concessões por ator, e a extensão de prazo', () => {
  let app, db;
  let admin, concedente, beneficiario, membroDoGrupo, forasteiro;
  const token = {};
  let grupo, grantRaiz, grantPessoal, grantDeGrupo;
  const sufixo = randomUUID().slice(0, 8);
  const TILESET = `inv-${sufixo}`;
  const TILESET_MORTO = `inv-morto-${sufixo}`;

  const conceder = async (quem, resourceId, corpo, esperado = 201) => {
    const res = await supertest(app)
      .post(`/api/v1/resource-access/tileset/${resourceId}/grants`)
      .set('Authorization', `Bearer ${token[quem]}`)
      .send(corpo)
      .expect(esperado);
    return res.body.data;
  };

  const issued = async (quem) => (await supertest(app)
    .get('/api/v1/resource-access/grants/issued')
    .set('Authorization', `Bearer ${token[quem]}`)
    .expect(200)).body.data.grants;

  const received = async (quem) => (await supertest(app)
    .get('/api/v1/resource-access/grants/received')
    .set('Authorization', `Bearer ${token[quem]}`)
    .expect(200)).body.data.grants;

  const estender = async (quem, grantId, expiresAt, esperado = 200) => {
    const res = await supertest(app)
      .patch(`/api/v1/resource-access/grants/${grantId}`)
      .set('Authorization', `Bearer ${token[quem]}`)
      .send({ expiresAt })
      .expect(esperado);
    return res.body;
  };

  const linhaDoGrant = async (grantId) => {
    const { rows } = await db.query(
      'SELECT id, created_at, expires_at, revoked_at FROM resource_grants WHERE id = $1',
      [grantId]
    );
    return rows[0];
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    // CADA UM COM `nome` PRÓPRIO, e isto não é enfeite de fixture: o default do helper é
    // 'Test User' para todo mundo, e com ele as asserções de `granteeName`/`grantorName`
    // passariam idênticas mesmo se a consulta trouxesse a pessoa ERRADA.
    admin = await createAdminUser(db, { username: `inv_admin_${sufixo}`, nome: `Adm ${sufixo}` });
    concedente = await createUser(db, { username: `inv_conc_${sufixo}`, nome: `Conc ${sufixo}` });
    beneficiario = await createUser(db, { username: `inv_ben_${sufixo}`, nome: `Ben ${sufixo}` });
    membroDoGrupo = await createUser(db, { username: `inv_membro_${sufixo}`, nome: `Membro ${sufixo}` });
    forasteiro = await createUser(db, { username: `inv_fora_${sufixo}`, nome: `Fora ${sufixo}` });
    for (const [nome, u] of Object.entries({
      admin, concedente, beneficiario, membroDoGrupo, forasteiro,
    })) {
      token[nome] = await loginUser(app, u.username, u.password);
    }

    for (const id of [TILESET, TILESET_MORTO]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, sort_order, access_level)
         VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
        [id, `Tileset ${id}`]
      );
    }

    // O GRUPO É DO CONCEDENTE, porque conceder a um coletivo exige grupo PRÓPRIO
    // (`fn_can_administer_group`): o eixo do módulo de grupo é posse desde 2026-08-20.
    grupo = await createAccessGroup(db, concedente.id, { name: `Grupo inv ${sufixo}` });
    await addAccessGroupMember(db, grupo.id, membroDoGrupo.id, concedente.id);

    // A ÁRVORE: admin dá `view_share` de RAIZ ao concedente (prazo curto, 20 dias, para
    // ser o TETO mensurável mais adiante); o concedente repassa a uma pessoa e a um grupo.
    grantRaiz = await conceder('admin', TILESET, {
      granteeId: concedente.id, grantLevel: 'view_share', expiresAt: emDias(20),
    });
    grantPessoal = await conceder('concedente', TILESET, {
      granteeId: beneficiario.id, grantLevel: 'view',
    });
    grantDeGrupo = await conceder('concedente', TILESET, {
      granteeGroupId: grupo.id, grantLevel: 'view',
    });
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id IN ($1, $2)',
      [TILESET, TILESET_MORTO]);
    await db.query('DELETE FROM access_group_members WHERE group_id = $1', [grupo.id]);
    await db.query('DELETE FROM access_groups WHERE id = $1', [grupo.id]);
    await db.query('DELETE FROM tilesets WHERE id IN ($1, $2)', [TILESET, TILESET_MORTO]);
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // issued
  // ==========================================================================
  it('`issued` lista o que EU concedi, com o beneficiário nomeado e o tipo dele', async () => {
    const linhas = await issued('concedente');
    assert.equal(linhas.length, 2, 'o concedente fez DUAS concessões: uma a pessoa, uma a grupo');

    const pessoa = linhas.find((l) => l.id === grantPessoal.id);
    assert.ok(pessoa, 'a concessão a pessoa precisa aparecer');
    assert.equal(pessoa.granteeKind, 'user');
    assert.equal(pessoa.granteeId, beneficiario.id);
    assert.equal(pessoa.granteeName, `Ben ${sufixo}`);
    assert.equal(pessoa.resourceType, 'tileset');
    assert.equal(pessoa.resourceId, TILESET);
    assert.equal(pessoa.resourceName, `Tileset ${TILESET}`);
    assert.equal(pessoa.level, 'view');
    assert.ok(pessoa.expiresAt, 'o prazo viaja: sem ele a tela não sabe o que renovar');

    // O COLETIVO NÃO PODE SER DE SEGUNDA CLASSE. `granteeKind` é o discriminante, e
    // `granteeId` carrega o id DAQUILO que ele diz — colapsar as duas colunas sem o
    // rótulo faria um filtro por pessoa casar grupo por coincidência de id.
    const coletivo = linhas.find((l) => l.id === grantDeGrupo.id);
    assert.ok(coletivo, 'a concessão a grupo precisa aparecer');
    assert.equal(coletivo.granteeKind, 'group');
    assert.equal(coletivo.granteeId, grupo.id);
    assert.equal(coletivo.granteeName, `Grupo inv ${sufixo}`);
  });

  it('`issued` de quem nunca concedeu é lista VAZIA, e não erro', async () => {
    // O envelope precisa ser o mesmo dos dois lados: o cliente não deve ter um caminho de
    // renderização para "nada" e outro para "falhou". E este é o par negativo do caso
    // acima — sem ele, "duas linhas" também seria o que se mede se a consulta ignorasse o
    // `granted_by` e devolvesse a tabela inteira.
    assert.deepEqual(await issued('forasteiro'), []);
    assert.deepEqual(await issued('beneficiario'), [],
      'quem só RECEBEU não concedeu nada: os dois inventários são eixos diferentes');
  });

  it('`issued` do administrador traz a raiz que ele deu, e não a dos outros', async () => {
    const linhas = await issued('admin');
    assert.deepEqual(linhas.map((l) => l.id), [grantRaiz.id],
      'o inventário é por AUTORIA (`granted_by`), e o papel global não o alarga: um '
      + 'administrador que visse tudo transformaria a tela em enumeração do sistema');
  });

  // ==========================================================================
  // received
  // ==========================================================================
  it('`received` traz a concessão DIRETA, com quem concedeu e sem grupo', async () => {
    const linhas = await received('beneficiario');
    assert.equal(linhas.length, 1);
    const l = linhas[0];
    assert.equal(l.id, grantPessoal.id);
    assert.equal(l.grantorId, concedente.id);
    assert.equal(l.grantorName, `Conc ${sufixo}`);
    assert.equal(l.resourceName, `Tileset ${TILESET}`);
    assert.equal(l.level, 'view');
    assert.equal(l.viaGroup, null, 'concessão direta não tem grupo no caminho');
  });

  it('`received` traz o que chegou POR GRUPO, e NOMEIA o grupo', async () => {
    // O CASO QUE JUSTIFICA A ROTA. O membro NÃO tem linha em `resource_grants`: a dele é a
    // linha do GRUPO. Uma listagem por `grantee_id` responderia "você não recebeu nada".
    const linhas = await received('membroDoGrupo');
    assert.equal(linhas.length, 1);
    const l = linhas[0];
    assert.equal(l.id, grantDeGrupo.id);
    assert.equal(l.grantorId, concedente.id);
    // `viaGroup` não é enfeite: sair do grupo (ou o dono apagá-lo) derruba este acesso sem
    // que ninguém tenha revogado nada, e a pessoa precisa saber de onde ele vem.
    assert.deepEqual(l.viaGroup, { id: grupo.id, name: `Grupo inv ${sufixo}` });
  });

  it('`received` de quem não recebeu nada é lista VAZIA', async () => {
    assert.deepEqual(await received('forasteiro'), []);
  });

  it('`received` do concedente traz a RAIZ que ele recebeu do administrador', async () => {
    const linhas = await received('concedente');
    assert.deepEqual(linhas.map((l) => l.id), [grantRaiz.id]);
    assert.equal(linhas[0].level, 'view_share');
    assert.equal(linhas[0].grantorId, admin.id);
  });

  it('nenhum dos dois inventários vaza e-mail', async () => {
    // A REGRA DA CASA É O PAR nome/username, e nada mais. O e-mail é o único campo de
    // `users` que identifica a pessoa FORA do sistema, e uma tela de permissão é
    // justamente onde alguém teria a ideia de "melhorar a identificação".
    const corpo = JSON.stringify([await issued('concedente'), await received('membroDoGrupo')]);
    assert.ok(!corpo.includes('@'), `algum campo trouxe e-mail: ${corpo}`);
  });

  it('concessão VENCIDA e concessão REVOGADA somem dos dois inventários', async () => {
    // "VIVA" INCLUI O PRAZO. A morte por vencimento mora no predicado e nunca numa
    // varredura, então uma listagem que só olhasse `revoked_at` mostraria como viva uma
    // concessão que já não entrega acesso — e ofereceria um botão para desfazer o que o
    // relógio já desfez.
    const efemera = await conceder('concedente', TILESET, {
      granteeId: forasteiro.id, grantLevel: 'view',
    });
    assert.ok((await issued('concedente')).some((l) => l.id === efemera.id),
      'piso: a concessão precisa APARECER antes de vencer, senão o sumiço abaixo não mede nada');
    assert.ok((await received('forasteiro')).some((l) => l.id === efemera.id));

    await db.query(
      `UPDATE resource_grants
          SET created_at = NOW() - INTERVAL '2 days', expires_at = NOW() - INTERVAL '1 day'
        WHERE id = $1`,
      [efemera.id]
    );
    assert.ok(!(await issued('concedente')).some((l) => l.id === efemera.id));
    assert.deepEqual(await received('forasteiro'), []);

    // E O CONTROLE DA REVERSÃO: devolvendo o prazo, ela volta. Sem esta perna, "sumiu"
    // também seria o que se mede se a consulta tivesse parado de casar qualquer coisa.
    await db.query("UPDATE resource_grants SET expires_at = NOW() + INTERVAL '1 day' WHERE id = $1",
      [efemera.id]);
    assert.ok((await issued('concedente')).some((l) => l.id === efemera.id));

    // Agora a revogação, que é o outro estado de morte e é DIFERENTE do vencimento.
    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${efemera.id}`)
      .set('Authorization', `Bearer ${token.concedente}`)
      .expect(200);
    assert.ok(!(await issued('concedente')).some((l) => l.id === efemera.id));
    assert.deepEqual(await received('forasteiro'), []);
  });

  it('recurso APAGADO não aparece como se estivesse vivo', async () => {
    const doMorto = await conceder('admin', TILESET_MORTO, {
      granteeId: beneficiario.id, grantLevel: 'view',
    });
    assert.ok((await received('beneficiario')).some((l) => l.id === doMorto.id),
      'piso: com o recurso vivo a concessão aparece');

    // O catálogo é SOFT-delete, então a concessão sobrevive ao recurso. Listá-la seria
    // descrever um acesso a uma coisa que já não existe — e no 360, que é hard-delete, nem
    // nome haveria para mostrar. A direção do erro aqui é ESCONDER linha morta.
    await db.query('UPDATE tilesets SET active = false WHERE id = $1', [TILESET_MORTO]);
    assert.ok(!(await received('beneficiario')).some((l) => l.id === doMorto.id));
    assert.ok(!(await issued('admin')).some((l) => l.id === doMorto.id));

    await db.query('UPDATE tilesets SET active = true WHERE id = $1', [TILESET_MORTO]);
    assert.ok((await received('beneficiario')).some((l) => l.id === doMorto.id),
      'controle da reversão: reativando o recurso a concessão volta, então o sumiço foi o `active`');
    await db.query('DELETE FROM resource_grants WHERE id = $1', [doMorto.id]);
  });

  // ==========================================================================
  // PATCH — estender o prazo
  // ==========================================================================
  it('o AUTOR estende, e a resposta é o prazo EFETIVO guardado no banco', async () => {
    const alvo = await conceder('admin', TILESET, {
      granteeId: membroDoGrupo.id, grantLevel: 'view', expiresAt: emDias(5),
    });
    const { data } = await estender('admin', alvo.id, emDias(30));
    const linha = await linhaDoGrant(alvo.id);
    assert.equal(new Date(data.expiresAt).getTime(), new Date(linha.expires_at).getTime(),
      'a resposta precisa ser o que o banco guardou, e não o que o cliente pediu');
    assert.ok(new Date(linha.expires_at).getTime() > Date.now() + 29 * DIA_MS,
      'a concessão de raiz não tem pai, então os 30 dias passam inteiros');
    await db.query('DELETE FROM resource_grants WHERE id = $1', [alvo.id]);
  });

  it('o teto do PAI corta, e a resposta diz o valor CORTADO', async () => {
    // ESTE É O CASO QUE A ROTA EXISTE PARA SERVIR À TELA. Filho nunca sobrevive a quem o
    // autorizou: o pai (a raiz do concedente) vence em 20 dias, então um pedido de 180
    // volta cortado — e a tela precisa poder dizer 20, não 180.
    const pai = await linhaDoGrant(grantRaiz.id);
    const { data } = await estender('concedente', grantPessoal.id, emDias(180));
    assert.equal(
      new Date(data.expiresAt).getTime(), new Date(pai.expires_at).getTime(),
      'o efetivo precisa ser EXATAMENTE o prazo do pai; asserir só o 200 deixaria passar '
      + 'um clamp que cortou no lugar errado'
    );
    const filho = await linhaDoGrant(grantPessoal.id);
    assert.equal(new Date(filho.expires_at).getTime(), new Date(pai.expires_at).getTime());
  });

  it('o teto da CASA numa extensão conta de `created_at`, não de agora', async () => {
    // O ACHADO QUE CONTRADIZ A INTUIÇÃO (e o `LEAST` do INSERT). O CHECK da tabela ancora
    // as duas pontas em `created_at`, porque um CHECK ancorado no relógio ficaria falso
    // amanhã e travaria QUALQUER update na linha. Consequência: uma linha de concessão
    // nunca dura mais de um ano contado do NASCIMENTO, e estender gasta o que sobra desse
    // orçamento. Copiar o `NOW() + 1 year` do INSERT produziria 23514 aqui.
    const alvo = await conceder('admin', TILESET, {
      granteeId: forasteiro.id, grantLevel: 'view',
    });
    await db.query(
      `UPDATE resource_grants
          SET created_at = NOW() - INTERVAL '300 days', expires_at = NOW() + INTERVAL '1 day'
        WHERE id = $1`,
      [alvo.id]
    );

    const { data } = await estender('admin', alvo.id, emDias(300));
    const linha = await linhaDoGrant(alvo.id);
    const orcamento = new Date(linha.created_at).getTime() + 365 * DIA_MS;
    assert.equal(new Date(data.expiresAt).getTime(), orcamento,
      'o efetivo é `created_at + 1 ano`, e não os 300 dias pedidos nem `NOW() + 1 ano`');
    assert.ok(new Date(data.expiresAt).getTime() < Date.now() + 300 * DIA_MS,
      'o corte precisa ser observável: o pedido ficou acima do orçamento da linha');
    await db.query('DELETE FROM resource_grants WHERE id = $1', [alvo.id]);
  });

  it('o ADMINISTRADOR estende a concessão alheia; quem não é autor nem administra, NÃO', async () => {
    // O GATE É O MESMO DA REVOGAÇÃO (`requireGrantRevoker`), reusado e não copiado: quem
    // pode desfazer pode prorrogar. O ramo largo pergunta por UM papel; o estreito não
    // pergunta por papel nenhum, pergunta por AUTORIA.
    // O alvo é de OUTRA pessoa (o concedente), com prazo bem abaixo do teto do pai, para
    // que o efeito da extensão seja observável e não caia no clamp.
    const alheia = await conceder('concedente', TILESET, {
      granteeId: forasteiro.id, grantLevel: 'view', expiresAt: emDias(5),
    });
    const antes = await linhaDoGrant(alheia.id);
    const daqui = emDias(10);

    // O BENEFICIÁRIO da própria concessão é o sujeito mais tentador e continua fora: ele
    // renovaria o próprio acesso indefinidamente, sem passar por quem o concedeu.
    await estender('forasteiro', alheia.id, daqui, 403);
    await estender('membroDoGrupo', alheia.id, daqui, 403);
    const depoisDoNegativo = await linhaDoGrant(alheia.id);
    assert.equal(
      new Date(depoisDoNegativo.expires_at).getTime(), new Date(antes.expires_at).getTime(),
      'o 403 precisa ser recusa de ESCRITA, e não só de resposta'
    );

    // O POSITIVO DO MESMO PAR, sem o qual os dois 403 acima também seriam o que se mede se
    // a rota não existisse. O administrador alcança a linha por PAPEL, e o concedente
    // alcançaria a mesma linha por AUTORIA — são os dois ramos do gate.
    const { data } = await estender('admin', alheia.id, daqui);
    assert.ok(new Date(data.expiresAt).getTime() > new Date(antes.expires_at).getTime());
    await db.query('DELETE FROM resource_grants WHERE id = $1', [alheia.id]);
  });

  it('estender um filho JÁ no teto do pai devolve o prazo ATUAL, sem erro', async () => {
    // O CASO DE BORDA QUE A TELA PRECISA SABER LER. A concessão a grupo nasceu clampada no
    // prazo do pai; pedir mais um dia é um pedido legítimo (passa do prazo atual), o
    // `LEAST` o corta de volta e a resposta é o prazo que já valia. Não é erro: é a
    // resposta certa, e é a mesma mecânica do corte pelo teto do pai — a diferença é que
    // aqui o corte não sobrou nada. Uma tela que leia o 200 como "renovado por mais um
    // dia" mentiria; por isso a resposta é o EFETIVO.
    const pai = await linhaDoGrant(grantRaiz.id);
    const antes = await linhaDoGrant(grantDeGrupo.id);
    assert.equal(new Date(antes.expires_at).getTime(), new Date(pai.expires_at).getTime(),
      'piso: a concessão a grupo precisa estar exatamente no teto do pai');

    const { data } = await estender(
      'concedente', grantDeGrupo.id,
      new Date(new Date(antes.expires_at).getTime() + DIA_MS).toISOString()
    );
    assert.equal(new Date(data.expiresAt).getTime(), new Date(antes.expires_at).getTime());
  });

  it('não se estende o que foi revogado, nem se ENCURTA o prazo', async () => {
    const alvo = await conceder('admin', TILESET, {
      granteeId: forasteiro.id, grantLevel: 'view', expiresAt: emDias(10),
    });

    // ENCURTAR não é operação desta rota: a data para trás deixaria toda a subárvore
    // vencendo DEPOIS do pai, e manter a invariante exigiria descer o aparo por ela.
    await estender('admin', alvo.id, emDias(5), 409);
    const intacta = await linhaDoGrant(alvo.id);
    assert.ok(new Date(intacta.expires_at).getTime() > Date.now() + 9 * DIA_MS,
      'a recusa de encurtar não pode ter escrito nada');

    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${alvo.id}`)
      .set('Authorization', `Bearer ${token.admin}`)
      .expect(200);
    // Estender uma revogada seria desfazer uma revogação por uma rota de PRAZO.
    await estender('admin', alvo.id, emDias(60), 409);
  });

  it('concessão inexistente é 404, e prazo fora da borda é 422', async () => {
    await estender('admin', randomUUID(), emDias(10), 404);
    // A borda cobra o teto de um ano e a data no futuro; o teto que VALE é o do UPDATE, e
    // é mais estreito. Este 422 é sanidade, não a regra.
    await estender('admin', grantPessoal.id, emDias(400), 422);
    await estender('admin', grantPessoal.id, emDias(-1), 422);
  });

  it('a extensão deixa TRILHA, com o pedido e o efetivo lado a lado', async () => {
    // A DIFERENÇA ENTRE OS DOIS É A INFORMAÇÃO: ela registra que um teto incidiu, e sem
    // ela a trilha não distingue "pediu 20 dias" de "pediu 180 e levou 20".
    const { rows } = await db.query(
      `SELECT details FROM audit_trail
        WHERE action = 'SHARING_CHANGE' AND target_id = $1
          AND details ? 'expiresAtAnterior'
        ORDER BY created_at DESC LIMIT 1`,
      [TILESET]
    );
    assert.equal(rows.length, 1, 'a extensão precisa ter deixado linha de trilha');
    const d = rows[0].details;
    assert.ok(d.grantId, 'a linha nomeia QUAL concessão foi estendida');
    assert.ok(d.expiresAtPedido, 'o pedido fica registrado');
    assert.ok(d.expiresAt, 'o efetivo fica registrado');
    assert.equal(d.resourceType, 'tileset');
  });
});
