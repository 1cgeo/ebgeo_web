// Path: tests/integration/concessao-identidade-militar.test.js
//
// AS DUAS LISTAS QUE NOMEIAM PESSOA FORA DO COMPARTILHAMENTO DE ATLAS passaram a identificar na
// forma militar em 2026-09-20: "quem tem acesso a este recurso"
// (`GET /resource-access/:type/:id/grants`) e "quem está neste grupo"
// (`GET /access-groups/:id/members`).
//
// POR QUE ELAS, E NO MESMO ARQUIVO. As duas são alimentadas pela MESMA busca de pessoas
// (`GET /users/search`), que desde a mesma data responde `nome_guerra`, posto abreviado e sigla
// da OM, e casa o nome de guerra. Enquanto a busca oferecia "Cap Andrade" e a lista logo acima
// escrevia "Maria Clara de Andrade", a pessoa escolhida TROCAVA de nome ao entrar na lista, na
// mesma janela e no mesmo segundo. Medir uma e não a outra deixaria a segunda livre para
// divergir no dia seguinte, que foi exatamente o que aconteceu com o bloco do dono na tela de
// compartilhamento (ver `compartilhamento-identidade-militar.test.js`, o irmão deste).
//
// SÃO DOIS SUJEITOS NA LINHA DA CONCESSÃO, e os dois são cobrados: o BENEFICIÁRIO (o nome
// grande) e o CONCEDENTE (a frase "recebido de X", mais a nota de quem não pode revogar). O
// segundo é o que se esquece, e esquecê-lo escreveria as duas formas de nomear gente a dois
// centímetros uma da outra.
//
// CADA POSITIVO TEM O NEGATIVO DO MESMO PAR. Uma consulta que devolvesse os campos sempre nulos
// passaria em qualquer teste que só conferisse a PRESENÇA da chave; um `JOIN` no lugar do
// `LEFT JOIN` passaria em qualquer teste que só olhasse a linha de quem TEM posto e OM. A
// direção do erro aqui é a pior possível numa tela de permissão: a linha SOME, e quem sumiu
// continua com acesso e sem superfície por onde ser revogado.
//
// E O QUE NÃO PODE VIAJAR também é cobrado: nem e-mail nem papel global entram nestas duas
// listagens, que respondem "quem tem acesso" e "quem está no grupo", e não "quem é esta conta".

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

const tag = randomUUID().replace(/-/g, '').slice(0, 10);

/** Um fragmento que só existe no NOME DE GUERRA de quem o recebe. */
const MARCA_GUERRA = `Zurita${tag}`;

describe('as listagens de concessão e de grupo identificam pela forma militar', () => {
  let app, db;
  let admin, adminTok, beneficiario, semNada, semSigla;
  let omComSigla, omSemSigla;
  let camada, grupo;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    // O posto de nome inconfundível: "Primeiro Tenente" não se parece com "1º Ten" por acidente
    // de prefixo, então um teste que confunda as duas formas fica vermelho.
    const { rows: postos } = await db.query(
      "SELECT id FROM ranks WHERE nome = 'Primeiro Tenente' LIMIT 1"
    );
    assert.ok(postos[0], 'fixture: o posto semeado "Primeiro Tenente" tem de existir');
    const { rows: postosMaj } = await db.query(
      "SELECT id FROM ranks WHERE nome = 'Major' LIMIT 1"
    );
    assert.ok(postosMaj[0], 'fixture: o posto semeado "Major" tem de existir');

    const { rows: comSigla } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla)
       VALUES ($1, $2, $3) RETURNING id, nome, sigla`,
      [`Centro de Geoinformacao ${tag}`, `cgeo-${tag}`, `CGEO${tag}`]
    );
    omComSigla = comSigla[0];

    // A OM SEM SIGLA É O RAMO DA QUEDA, e ele não é hipotético: `organizations.sigla` é anulável
    // e o painel de Pessoal deixa o campo em branco. Sem o `COALESCE` a linha apareceria SEM
    // unidade nenhuma, que é pior que a unidade comprida.
    const { rows: semSiglaOrg } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla)
       VALUES ($1, $2, NULL) RETURNING id, nome`,
      [`Batalhao Sem Sigla ${tag}`, `bss-${tag}`]
    );
    omSemSigla = semSiglaOrg[0];

    // QUEM CONCEDE é o administrador, e ele também é nomeado na linha (a frase "recebido de").
    admin = await createAdminUser(db, {
      username: `cim_admin_${tag}`,
      nome: `Bruno Sa de Oliveira ${tag}`,
      rank_id: postosMaj[0].id,
      organization_id: omComSigla.id,
    });
    await db.query('UPDATE users SET nome_guerra = $1 WHERE id = $2', ['Oliveira', admin.id]);
    adminTok = await loginUser(app, admin.username, admin.password);

    beneficiario = await createUser(db, {
      username: `cim_alvo_${tag}`,
      nome: `Joao Batista de Souza ${tag}`,
      rank_id: postos[0].id,
      organization_id: omComSigla.id,
    });
    await db.query('UPDATE users SET nome_guerra = $1 WHERE id = $2', [MARCA_GUERRA, beneficiario.id]);

    // O CONTROLE: conta sem posto, sem OM e sem nome de guerra. As três colunas são anuláveis, e
    // uma conta administrativa recém-criada é exatamente assim.
    semNada = await createUser(db, {
      username: `cim_nada_${tag}`,
      nome: `Pessoa Sem Nada ${tag}`,
      rank_id: null,
      organization_id: null,
    });

    semSigla = await createUser(db, {
      username: `cim_sigla_${tag}`,
      nome: `Pessoa Sem Sigla ${tag}`,
      organization_id: omSemSigla.id,
    });

    camada = `cim-${tag}`;
    await db.query(
      `INSERT INTO data_layers (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [camada, `Camada ${camada}`]
    );

    const grupoRes = await supertest(app)
      .post('/api/v1/access-groups')
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ name: `Grupo militar ${tag}` })
      .expect(201);
    grupo = grupoRes.body.data;

    for (const alvo of [beneficiario, semNada, semSigla]) {
      await supertest(app)
        .post(`/api/v1/access-groups/${grupo.id}/members`)
        .set('Authorization', `Bearer ${adminTok}`)
        .send({ userId: alvo.id })
        .expect(200);
      await supertest(app)
        .post(`/api/v1/resource-access/data_layer/${camada}/grants`)
        .set('Authorization', `Bearer ${adminTok}`)
        .send({ granteeId: alvo.id, grantLevel: 'view' })
        .expect(201);
    }
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [camada]);
    await db.query('DELETE FROM data_layers WHERE id = $1', [camada]);
    await db.query('DELETE FROM access_groups WHERE name LIKE $1', [`%${tag}%`]);
    await teardownTestEnv(db);
  });

  /** As concessões vivas da camada, como a tela "quem tem acesso" as recebe. */
  const listarConcessoes = () => supertest(app)
    .get(`/api/v1/resource-access/data_layer/${camada}/grants`)
    .set('Authorization', `Bearer ${adminTok}`)
    .expect(200);

  /** O roster do grupo, como a tabela de membros o recebe. */
  const listarMembros = () => supertest(app)
    .get(`/api/v1/access-groups/${grupo.id}/members`)
    .set('Authorization', `Bearer ${adminTok}`)
    .expect(200);

  // ── GET /resource-access/:type/:id/grants ────────────────────────────────
  describe('a lista "quem tem acesso" a um recurso', () => {
    it('o BENEFICIÁRIO carrega posto abreviado, nome de guerra e a sigla da OM', async () => {
      const res = await listarConcessoes();
      const linha = res.body.data.find((g) => g.grantee_id === beneficiario.id);

      assert.ok(linha, 'premissa: a concessão ao beneficiário está na lista');
      assert.equal(linha.grantee_nome_guerra, MARCA_GUERRA);
      assert.equal(linha.grantee_posto_graduacao, '1º Ten', 'o posto vem abreviado');
      assert.equal(linha.grantee_organizacao_militar_sigla, omComSigla.sigla);
      assert.equal(linha.grantee_organizacao_militar, omComSigla.nome);
      // Os campos ANTIGOS ficam: `nome` é a queda de quem não tem nome de guerra e `username` é
      // o que desempata homônimo. Acrescentar não é substituir.
      assert.equal(linha.grantee_nome, `Joao Batista de Souza ${tag}`);
      assert.equal(linha.grantee_username, beneficiario.username);
    });

    it('o CONCEDENTE carrega posto e nome de guerra, e NÃO carrega unidade', async () => {
      // A frase "recebido de X" é oração dentro da linha, não identificação: a unidade dele
      // engordaria a linha sem responder nada que a linha pergunte. O que ela precisa é não
      // nomear a mesma pessoa de dois jeitos na mesma janela.
      const res = await listarConcessoes();
      const linha = res.body.data.find((g) => g.grantee_id === beneficiario.id);

      assert.equal(linha.granted_by, admin.id);
      assert.equal(linha.granted_by_nome_guerra, 'Oliveira');
      assert.equal(linha.granted_by_posto_graduacao, 'Maj');
      assert.equal(linha.granted_by_nome, `Bruno Sa de Oliveira ${tag}`);
      assert.equal(linha.granted_by_organizacao_militar_sigla, undefined,
        'a unidade do concedente NÃO viaja: a frase da origem não a usa');
    });

    it('a OM SEM sigla cai para o nome por extenso, em vez de vir vazia', async () => {
      const res = await listarConcessoes();
      const linha = res.body.data.find((g) => g.grantee_id === semSigla.id);

      assert.ok(linha);
      assert.equal(linha.grantee_organizacao_militar_sigla, omSemSigla.nome);
      // DISCRIMINAÇÃO: o `COALESCE` não pode estar devolvendo o nome para TODO MUNDO, senão o
      // caso acima passaria por acidente.
      assert.notEqual(linha.grantee_organizacao_militar_sigla, omComSigla.sigla);
    });

    it('quem não tem posto, OM nem nome de guerra vem com os três NULOS, e VEM', async () => {
      // A DIREÇÃO DA FALHA IMPORTA, e aqui ela é a pior de todas: com um `JOIN` no lugar do
      // `LEFT JOIN`, esta linha SUMIRIA da tela "quem tem acesso" — a pessoa continuaria com
      // acesso ao recurso privado e o dono perderia a única superfície por onde revogá-lo.
      const res = await listarConcessoes();
      const linha = res.body.data.find((g) => g.grantee_id === semNada.id);

      assert.ok(linha, 'as três junções novas não podem derrubar uma linha de concessão');
      assert.equal(linha.grantee_nome_guerra, null);
      assert.equal(linha.grantee_posto_graduacao, null);
      assert.equal(linha.grantee_organizacao_militar_sigla, null);
      assert.equal(linha.grantee_nome, `Pessoa Sem Nada ${tag}`, 'e o nome fica, para a queda');
    });

    it('as TRÊS concessões continuam na lista: nenhuma junção nova perdeu linha', async () => {
      // O controle de CONTAGEM, que é o que os três casos acima não provam juntos: cada um
      // procura a SUA linha, e uma consulta que devolvesse só as três procuradas passaria em
      // todos. O número é absoluto porque a camada é desta suíte e nasceu neste arquivo.
      const res = await listarConcessoes();
      assert.equal(res.body.data.length, 3);
    });

    it('nem e-mail nem papel global viajam na linha', async () => {
      const res = await listarConcessoes();
      // Coleção vazia = zero asserções = verde vazio: o tamanho é asserido ANTES do laço.
      assert.equal(res.body.data.length, 3);
      for (const linha of res.body.data) {
        for (const proibido of ['email', 'grantee_email', 'granted_by_email',
          'role', 'grantee_role', 'granted_by_role']) {
          assert.equal(linha[proibido], undefined,
            `${proibido} não faz parte de "quem tem acesso"`);
        }
      }
    });
  });

  // ── GET /access-groups/:id/members ───────────────────────────────────────
  describe('o roster de um grupo de acesso', () => {
    it('cada membro carrega nome de guerra ao lado do posto que já vinha', async () => {
      const res = await listarMembros();
      const linha = res.body.data.find((m) => m.id === beneficiario.id);

      assert.ok(linha, 'premissa: o membro está no roster');
      assert.equal(linha.nome_guerra, MARCA_GUERRA);
      assert.equal(linha.posto_graduacao, '1º Ten', 'o posto continua vindo, e abreviado');
      assert.equal(linha.nome, `Joao Batista de Souza ${tag}`, 'e o civil fica para a queda');
      assert.equal(linha.username, beneficiario.username);
    });

    it('quem não tem nome de guerra vem NULO, e não com o nome civil copiado', async () => {
      // DISCRIMINAÇÃO: a queda é do CLIENTE, e ela precisa saber que não houve valor. Um
      // `COALESCE(nome_guerra, nome)` no servidor passaria no caso acima e tiraria do cliente
      // a única informação que distingue "chama-se assim" de "não preencheu".
      const res = await listarMembros();
      const linha = res.body.data.find((m) => m.id === semNada.id);

      assert.ok(linha, 'a coluna nova não pode derrubar quem não a preencheu');
      assert.equal(linha.nome_guerra, null);
      assert.equal(linha.posto_graduacao, null);
    });

    it('os TRÊS membros continuam no roster', async () => {
      const res = await listarMembros();
      assert.equal(res.body.data.length, 3);
    });

    it('nem e-mail nem papel global viajam no roster', async () => {
      const res = await listarMembros();
      // Mesma razão do irmão acima: laço sobre lista vazia não verifica nada.
      assert.equal(res.body.data.length, 3);
      for (const linha of res.body.data) {
        for (const proibido of ['email', 'role', 'is_active', 'password_hash']) {
          assert.equal(linha[proibido], undefined,
            `${proibido} não faz parte de "quem está no grupo"`);
        }
      }
    });
  });

  // ── GET /resource-access/grants/issued e /received (a aba Concessões) ─────────────
  describe('o INVENTÁRIO por ator manda as peças do rótulo militar', () => {
    // A MESMA concessão lia "Cap Andrade" no modal do recurso e o nome civil na aba Concessões,
    // porque só `LIST_GRANTS_FOR_RESOURCE` tinha ganho as peças. As duas irmãs mandam hoje
    // nome de guerra e posto abreviado; quem compõe o rótulo é o cliente, pelo compositor dele.
    it('concedidos por mim: o beneficiário vem com nome de guerra e posto, e o nome civil fica', async () => {
      const res = await supertest(app)
        .get('/api/v1/resource-access/grants/issued')
        .set('Authorization', `Bearer ${adminTok}`)
        .expect(200);
      const daCamada = res.body.data.grants.filter((g) => g.resourceId === camada);
      assert.equal(daCamada.length, 3, 'as três concessões da camada, contagem absoluta');

      const alvo = daCamada.find((g) => g.granteeId === beneficiario.id);
      assert.equal(alvo.granteeNomeGuerra, MARCA_GUERRA);
      assert.equal(typeof alvo.granteePostoGraduacao, 'string');
      assert.notEqual(alvo.granteePostoGraduacao, '');
      assert.equal(alvo.granteeName, `Joao Batista de Souza ${tag}`, 'o nome civil é o degrau de queda');

      // Quem não tem posto nem nome de guerra vem com as duas peças NULAS, e VEM: um INNER JOIN
      // em `ranks` faria a concessão sumir do inventário de quem a precisa revogar.
      const nada = daCamada.find((g) => g.granteeId === semNada.id);
      assert.ok(nada, 'a linha de quem não tem posto continua no inventário');
      assert.equal(nada.granteeNomeGuerra, null);
      assert.equal(nada.granteePostoGraduacao, null);

      assert.equal(alvo.email, undefined);
      assert.equal(alvo.granteeEmail, undefined);
    });

    it('recebidos por mim: quem concedeu vem com nome de guerra e posto', async () => {
      const tok = await loginUser(app, beneficiario.username, beneficiario.password);
      const res = await supertest(app)
        .get('/api/v1/resource-access/grants/received')
        .set('Authorization', `Bearer ${tok}`)
        .expect(200);
      const daCamada = res.body.data.grants.filter((g) => g.resourceId === camada);
      assert.equal(daCamada.length, 1);
      assert.equal(daCamada[0].grantorNomeGuerra, 'Oliveira');
      assert.equal(typeof daCamada[0].grantorPostoGraduacao, 'string');
      assert.notEqual(daCamada[0].grantorPostoGraduacao, '');
      assert.equal(daCamada[0].grantorName, `Bruno Sa de Oliveira ${tag}`);
    });
  });
});
