// Path: tests/integration/papel-produtor-catalogo.test.js
//
// O PRODUTOR MANTÉM O ACERVO DA PRÓPRIA OM, E SÓ ELE.
//
// `users.producer_org_id` é o CRACHÁ DE PRODUÇÃO: um administrador o concede, ele
// aponta para UMA organização e vale para TODOS os tipos de recurso daquela OM.
// Ele não se confunde com `users.organization_id`, que é LOTAÇÃO auto-declarada no
// auto-cadastro e desde esta fase não autoriza nada.
//
// A ESCRITA DO CATÁLOGO DEIXOU DE SER `requireAdmin` e passou a ser "administrador
// OU produtor". O gate é DUPLO e nenhum lado repete o predicado do outro:
//   - `requireCatalogProducer` (middleware) recusa cedo quem não produz nada;
//   - QUAL linha o produtor alcança é decidido por `fn_can_produce_resource` dentro
//     do `WHERE` da própria escrita, o que fecha a janela entre ler o dono e mutar.
//
// O QUE ESTE ARQUIVO MEDE, sempre com o par no mesmo corpo:
//   - o produtor edita a linha da OM dele e NÃO alcança a de outra OM;
//   - a linha INSTITUCIONAL (`owner_org_id NULL`) é só do administrador;
//   - a criação FORÇA `owner_org_id` ao escopo do produtor, ignorando o corpo;
//   - ninguém transfere `owner_org_id` por estas rotas;
//   - AS QUATRO TABELAS, não uma: `makeCatalogRouter` fabrica quatro routers do mesmo
//     código, e testar `tilesets` sozinho já reproduziria o buraco que
//     `catalog-tables.test.js` teve de fechar uma vez.
//
// UMA NOTA SOBRE O STATUS DA RECUSA, porque ele surpreende. A linha de outra OM
// responde 404, não 403, e isso é a escada de indistinguibilidade da casa: um
// recurso que o ator não deveria estar mexendo é indistinguível de um que não
// existe, e o 403 confirmaria a existência. A consequência honesta é que a mesma
// resposta cobre "não existe", "não é sua" e "está soft-deletada". As asserções
// abaixo nunca se contentam com o status: elas releem a LINHA, porque um 403 (ou um
// 404) que já escreveu passa em teste de status.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createProducerUser, loginUser } from '../helpers/fixtures.js';

// AS QUATRO tabelas de catálogo e a rota de cada uma. A lista é escrita à mão de
// propósito: derivá-la de `CATALOG_TABLES` faria o teste concordar com o código por
// construção, e o que se quer aqui é a segunda opinião sobre quantas são.
//
// A SEGUNDA OPINIÃO SÓ VALE SE ALGUÉM A COBRAR, e por muito tempo ninguém cobrava:
// apagar uma linha desta lista passava verde, porque nenhum caso afirmava o
// tamanho dela. O `assert` do primeiro caso é o que fecha isso.
const TABELAS = [
  { tabela: 'basemaps', rota: 'basemaps' },
  { tabela: 'data_layers', rota: 'data-layers' },
  { tabela: 'analysis_layers', rota: 'analysis-layers' },
  { tabela: 'tilesets', rota: 'tilesets' },
];

describe('O Produtor escreve o catálogo da própria OM, e só ele', () => {
  let app, db, admin, comum, produtorA, produtorB;
  let tokenAdmin, tokenComum, tokenA, tokenB;
  let orgA, orgB;
  const sufixo = randomUUID().slice(0, 8);

  /** id da linha de cada tabela, por dono. */
  const idDe = (tabela, dono) => `cat-${dono}-${tabela.replace(/_/g, '')}-${sufixo}`;

  const linha = async (tabela, id) => (await db.query(
    `SELECT id, name, active, owner_org_id FROM ${tabela} WHERE id = $1`, [id]
  )).rows[0];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const criaOrg = async (rotulo) => (await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM ${rotulo} ${sufixo}`, `om-${rotulo}-${sufixo}`, `${rotulo}${sufixo.slice(0, 3)}`]
    )).rows[0].id;
    orgA = await criaOrg('a');
    orgB = await criaOrg('b');

    admin = await createAdminUser(db, { username: `prod_admin_${sufixo}` });
    comum = await createUser(db, { username: `prod_comum_${sufixo}` });
    produtorA = await createProducerUser(db, orgA, { username: `prod_a_${sufixo}` });
    produtorB = await createProducerUser(db, orgB, { username: `prod_b_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenComum = await loginUser(app, comum.username, comum.password);
    tokenA = await loginUser(app, produtorA.username, produtorA.password);
    tokenB = await loginUser(app, produtorB.username, produtorB.password);

    // Três linhas por tabela: uma da OM A, uma da OM B e uma INSTITUCIONAL (sem OM).
    for (const { tabela } of TABELAS) {
      for (const [dono, org] of [['a', orgA], ['b', orgB], ['inst', null]]) {
        await db.query(
          `INSERT INTO ${tabela} (id, name, config, sort_order, owner_org_id)
           VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, $3::uuid)`,
          [idDe(tabela, dono), `Linha ${dono} ${tabela}`, org]
        );
      }
    }
  });

  after(async () => {
    for (const { tabela } of TABELAS) {
      await db.query(`DELETE FROM ${tabela} WHERE id LIKE $1`, [`%${sufixo}`]);
    }
    await db.query('DELETE FROM users WHERE producer_org_id = ANY($1::uuid[])', [[orgA, orgB]]);
    await db.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[orgA, orgB]]);
    await teardownTestEnv(db);
  });

  it('piso: quem não produz nem administra é recusado na porta, nas QUATRO rotas', async () => {
    // O gate de ROTA, antes de qualquer linha: um usuário comum não passa em
    // `requireCatalogProducer`. Sem este piso, os casos seguintes não distinguiriam
    // "o produtor alcança a linha certa" de "a rota aceita qualquer um".
    assert.equal(TABELAS.length, 4, 'guarda: a lista escrita à mão precisa cobrar o próprio tamanho');
    for (const { tabela, rota } of TABELAS) {
      await supertest(app)
        .put(`/api/v1/${rota}/${idDe(tabela, 'a')}`)
        .set('Authorization', `Bearer ${tokenComum}`)
        .send({ name: 'não' })
        .expect(403);
    }
  });

  it('edita a linha da PRÓPRIA OM e não alcança a de outra — nas QUATRO tabelas', async () => {
    for (const { tabela, rota } of TABELAS) {
      const meu = idDe(tabela, 'a');
      const alheio = idDe(tabela, 'b');
      const nomeAlheioAntes = (await linha(tabela, alheio)).name;

      // POSITIVO: a própria OM.
      await supertest(app)
        .put(`/api/v1/${rota}/${meu}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: `Editado por A ${sufixo}` })
        .expect(200);
      assert.equal((await linha(tabela, meu)).name, `Editado por A ${sufixo}`, `${tabela}: a própria linha muda`);

      // NEGATIVO, no mesmo corpo: a linha da OM B.
      await supertest(app)
        .put(`/api/v1/${rota}/${alheio}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Invasão' })
        .expect(404);
      assert.equal(
        (await linha(tabela, alheio)).name, nomeAlheioAntes,
        `${tabela}: a recusa precisa ser SEM EFEITO, não só sem 200`
      );

      // E o simétrico, que é o controle de que a assimetria é do dono e não do ator:
      // o produtor B alcança a linha B e não a linha A.
      await supertest(app)
        .put(`/api/v1/${rota}/${alheio}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: `Editado por B ${sufixo}` })
        .expect(200);
      await supertest(app)
        .put(`/api/v1/${rota}/${meu}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Invasão' })
        .expect(404);
    }
  });

  it('a linha INSTITUCIONAL (`owner_org_id NULL`) é só do administrador', async () => {
    // O DEGRAU QUE ESTA FASE CRIA E QUE NINGUÉM VAI LEMBRAR: acervo legado e
    // institucional não tem OM produtora, então nenhum produtor o mantém. Se
    // `fn_can_produce_resource` tratasse NULL como curinga, todo produtor herdaria
    // o acervo antigo do sistema inteiro numa migração só.
    for (const { tabela, rota } of TABELAS) {
      const inst = idDe(tabela, 'inst');
      const antes = (await linha(tabela, inst)).name;

      await supertest(app)
        .put(`/api/v1/${rota}/${inst}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Do produtor' })
        .expect(404);
      assert.equal((await linha(tabela, inst)).name, antes, `${tabela}: institucional intacta`);

      // O par: o administrador escreve.
      await supertest(app)
        .put(`/api/v1/${rota}/${inst}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ name: `Institucional editada ${sufixo}` })
        .expect(200);
      assert.equal((await linha(tabela, inst)).name, `Institucional editada ${sufixo}`);
    }
  });

  it('a CRIAÇÃO força `owner_org_id` ao escopo do produtor, ignorando o corpo', async () => {
    // A ASSERÇÃO É SOBRE A LINHA, e não sobre a resposta: `owner_org_id` fica fora
    // das oito colunas que a rota devolve (`catalog-tabelas-paridade.test.js` amarra
    // aquela lista), então acreditar no corpo da resposta mediria outra coisa.
    for (const { tabela, rota } of TABELAS) {
      const novo = `cat-novo-${tabela.replace(/_/g, '')}-${sufixo}`;
      await supertest(app)
        .post(`/api/v1/${rota}`)
        .set('Authorization', `Bearer ${tokenA}`)
        // O CORPO MENTE DE PROPÓSITO: manda a OM do vizinho. `owner_org_id` não é
        // campo do schema de criação, então ele é descartado na borda (stripUnknown)
        // e o serviço carimba o escopo lido do BANCO. Se algum dia alguém o
        // acrescentar ao Joi "por conveniência", este caso fica vermelho.
        .send({ id: novo, name: 'Nascido do produtor A', owner_org_id: orgB })
        .expect(201);

      const criada = await linha(tabela, novo);
      assert.equal(criada.owner_org_id, orgA, `${tabela}: carimbo do produtor, nunca o do corpo`);
    }
  });

  it('o ADMINISTRADOR cria acervo INSTITUCIONAL, e nem ele carimba OM pelo corpo', async () => {
    // O par do caso anterior. `owner_org_id` não é lido do request PARA NINGUÉM: um
    // administrador criando com a OM no corpo criaria uma linha cuja OM dona veio da
    // rede, e transferir acervo é ação própria, auditável, fora deste escopo.
    for (const { tabela, rota } of TABELAS) {
      const novo = `cat-novoinst-${tabela.replace(/_/g, '')}-${sufixo}`;
      await supertest(app)
        .post(`/api/v1/${rota}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ id: novo, name: 'Institucional novo', owner_org_id: orgA })
        .expect(201);
      assert.equal((await linha(tabela, novo)).owner_org_id, null, `${tabela}: administrador cria sem OM`);
    }
  });

  it('NINGUÉM transfere `owner_org_id` por estas rotas — nem o produtor, nem o admin', async () => {
    for (const { tabela, rota } of TABELAS) {
      const meu = idDe(tabela, 'a');
      assert.equal((await linha(tabela, meu)).owner_org_id, orgA, 'piso: a linha começa na OM A');

      await supertest(app)
        .put(`/api/v1/${rota}/${meu}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'tentando mudar de dono', owner_org_id: orgB })
        .expect(200);
      assert.equal((await linha(tabela, meu)).owner_org_id, orgA, `${tabela}: produtor não transfere`);

      await supertest(app)
        .put(`/api/v1/${rota}/${meu}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ name: 'admin tentando mudar de dono', owner_org_id: orgB })
        .expect(200);
      assert.equal(
        (await linha(tabela, meu)).owner_org_id, orgA,
        `${tabela}: nem o administrador transfere por aqui — transferência é rota própria (PATCH /:id/owner-org)`
      );
    }
  });

  it('a ROTA PRÓPRIA (PATCH /:id/owner-org) transfere, e só o administrador a alcança', async () => {
    for (const { tabela, rota } of TABELAS) {
      const alvo = idDe(tabela, 'a');
      // Piso: a linha começa na OM A (o caso anterior a devolveu intacta).
      assert.equal((await linha(tabela, alvo)).owner_org_id, orgA, `${tabela}: piso na OM A`);

      // O PRODUTOR NÃO ALCANÇA a rota: 403 por `requireAdmin`, e a linha não se move.
      await supertest(app)
        .patch(`/api/v1/${rota}/${alvo}/owner-org`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ owner_org_id: orgB })
        .expect(403);
      assert.equal((await linha(tabela, alvo)).owner_org_id, orgA, `${tabela}: produtor não move`);

      // O ADMINISTRADOR TRANSFERE de A para B.
      await supertest(app)
        .patch(`/api/v1/${rota}/${alvo}/owner-org`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ owner_org_id: orgB })
        .expect(200);
      assert.equal((await linha(tabela, alvo)).owner_org_id, orgB, `${tabela}: admin move para B`);

      // E DEVOLVE AO INSTITUCIONAL com `owner_org_id: null` (destino legítimo, não campo vazio).
      await supertest(app)
        .patch(`/api/v1/${rota}/${alvo}/owner-org`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ owner_org_id: null })
        .expect(200);
      assert.equal((await linha(tabela, alvo)).owner_org_id, null, `${tabela}: admin devolve ao institucional`);

      // OM inexistente é 400, não 500 de FK crua.
      await supertest(app)
        .patch(`/api/v1/${rota}/${alvo}/owner-org`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ owner_org_id: randomUUID() })
        .expect(400);

      // Id que não existe é 404.
      await supertest(app)
        .patch(`/api/v1/${rota}/nao-existe-${sufixo}/owner-org`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ owner_org_id: orgA })
        .expect(404);

      // RESTAURA A LINHA 'a' À OM A, porque os casos seguintes deste describe a
      // reusam como fixture no piso da OM A (soft-delete e leitura/escrita do produtor).
      // Fechar isto aqui exercita de novo o caminho de transferência.
      await supertest(app)
        .patch(`/api/v1/${rota}/${alvo}/owner-org`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ owner_org_id: orgA })
        .expect(200);
      assert.equal((await linha(tabela, alvo)).owner_org_id, orgA, `${tabela}: restaurada à OM A`);
    }
  });

  it('o soft-delete segue o mesmo dono, e a RESSURREIÇÃO não muda de mãos', async () => {
    // O id de catálogo é um SLUG GLOBAL (PK simples), e a criação RESSUSCITA um id
    // soft-deletado com overwrite total. Sem gate na ressurreição, o produtor de uma
    // OM digitaria o id que outra apagou e sairia dono por sobrescrita — que é a
    // forma de tomar acervo alheio sem nunca receber um 200 indevido.
    const { tabela, rota } = TABELAS[3]; // tilesets
    const alvo = idDe(tabela, 'a');

    await supertest(app)
      .delete(`/api/v1/${rota}/${alvo}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
    assert.equal((await linha(tabela, alvo)).active, true, 'a linha do vizinho continua viva');

    await supertest(app)
      .delete(`/api/v1/${rota}/${alvo}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(204);
    assert.equal((await linha(tabela, alvo)).active, false, 'o dono apaga a própria');

    // A ressurreição pelo VIZINHO é recusada, e com a mesma mensagem do conflito
    // vivo: "está tomado" é tudo o que o chamador pode aprender.
    await supertest(app)
      .post(`/api/v1/${rota}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ id: alvo, name: 'Tomado' })
      .expect(409);
    const depois = await linha(tabela, alvo);
    assert.equal(depois.owner_org_id, orgA, 'e a OM dona não mudou');
    assert.equal(depois.active, false, 'nem a linha voltou à vida');

    // O par: o DONO ressuscita, e continua dono.
    await supertest(app)
      .post(`/api/v1/${rota}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ id: alvo, name: `Ressuscitado ${sufixo}` })
      .expect(201);
    const viva = await linha(tabela, alvo);
    assert.equal(viva.active, true);
    assert.equal(viva.owner_org_id, orgA);
  });

  it('LEITURA e ESCRITA concordam: o produtor VÊ a própria linha privada', async () => {
    // A INCOERÊNCIA QUE ESTE CASO IMPEDE é específica e já foi medida: sem o ramo de
    // produção no predicado de LEITURA, o produtor levava 404 no `GET` da própria
    // camada privada e 200 no `PUT` da mesma linha — o recurso existia para escrever
    // e não existia para ler. Um painel construído sobre isso mostra a lista vazia e
    // salva sem erro.
    const { tabela, rota } = TABELAS[2]; // analysis_layers
    const meu = idDe(tabela, 'a');
    await db.query(`UPDATE ${tabela} SET access_level = 'private' WHERE id = $1`, [meu]);
    try {
      await supertest(app)
        .get(`/api/v1/${rota}/${meu}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const lista = await supertest(app)
        .get(`/api/v1/${rota}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      assert.ok(lista.body.data.some((r) => r.id === meu), 'e ela aparece na listagem dele');

      // Os dois pares negativos: o produtor VIZINHO e o usuário comum não a veem.
      await supertest(app)
        .get(`/api/v1/${rota}/${meu}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      await supertest(app)
        .get(`/api/v1/${rota}/${meu}`)
        .set('Authorization', `Bearer ${tokenComum}`)
        .expect(404);

      // E O TERCEIRO CAMINHO DE LEITURA, que é onde a incoerência estava: o PAYLOAD
      // ADITIVO (`/resource-access/visible`), com que o mapa boota. Enquanto ele não
      // tinha o ramo de produção, a linha existia no painel que a edita e faltava no
      // documento que o cliente monta — sem erro em lugar nenhum, e com as duas
      // suítes verdes. Os três caminhos precisam concordar, e este é o par que cobra.
      const visiveis = async (token) => (await supertest(app)
        .get('/api/v1/resource-access/visible')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)).body.data;
      assert.ok(
        (await visiveis(tokenA)).analysisLayers.some((r) => r.id === meu),
        'o produtor precisa achar a própria camada privada no payload aditivo'
      );
      assert.ok(
        !(await visiveis(tokenB)).analysisLayers.some((r) => r.id === meu),
        'e o produtor da outra OM não'
      );
    } finally {
      await db.query(`UPDATE ${tabela} SET access_level = 'public' WHERE id = $1`, [meu]);
    }
    // E o controle da reversão: pública, o vizinho volta a enxergar.
    await supertest(app)
      .get(`/api/v1/${rota}/${meu}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
  });

  it('o CRACHÁ é lido do BANCO: revogar a produção vale na hora, com o MESMO token', async () => {
    // `flexibleAuth` não reconcilia e o token vive até 15 min, então o escopo NÃO
    // pode ser lido do JWT no gate. Rebaixar o produtor precisa fechar a escrita na
    // requisição seguinte, não na próxima renovação.
    const { tabela, rota } = TABELAS[0]; // basemaps
    const meu = idDe(tabela, 'a');

    await supertest(app)
      .put(`/api/v1/${rota}/${meu}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: `piso ${sufixo}` })
      .expect(200);

    await db.query("UPDATE users SET role = 'user', producer_org_id = NULL WHERE id = $1", [produtorA.id]);
    try {
      await supertest(app)
        .put(`/api/v1/${rota}/${meu}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'depois do rebaixamento' })
        .expect(403);
      assert.equal((await linha(tabela, meu)).name, `piso ${sufixo}`, 'e sem efeito');
    } finally {
      await db.query(
        "UPDATE users SET role = 'producer', producer_org_id = $2::uuid WHERE id = $1",
        [produtorA.id, orgA]
      );
    }
    // O controle da reversão: repromovido, ele volta a escrever com o mesmo token.
    await supertest(app)
      .put(`/api/v1/${rota}/${meu}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: `de volta ${sufixo}` })
      .expect(200);
  });
});
