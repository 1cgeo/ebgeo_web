// Path: tests/integration/resource-access-listagem-crua.test.js
//
// R1 — O BURACO, ESCRITO ANTES DE SER ABERTO (F0) E MEDIDO DEPOIS (F1).
//
// `catalog.routes.js` monta `router.get('/', auth, ctrl.list(table))`: leitura de
// catálogo exige token e mais nada. Enquanto todo recurso é público isso é
// correto e não tem consequência. No instante em que `access_level = 'private'`
// passar a existir (fase F1) e alguém marcar uma linha (fase F2), esta MESMA rota
// devolve o recurso privado para QUALQUER usuário autenticado, contornando o
// `/api/config` inteiro — que é onde todo o resto do desenho coloca o filtro.
//
// Este arquivo NASCE VERDE afirmando o estado de hoje, e o valor está exatamente
// nisso: o buraco fica escrito, com o número de linhas que a rota devolve, ANTES
// de a coluna existir. A fase F2 reescreve os casos marcados abaixo para a
// asserção inversa; um arquivo que aparecesse só depois não provaria que alguém
// pensou no problema antes de criá-lo.
//
// O CONTROLE DE DISCRIMINAÇÃO é o par: "usuário comum vê" só significa alguma
// coisa ao lado de "e vê exatamente a mesma coisa que o admin". Sem a segunda
// metade, a primeira passaria idêntica com a rota devolvendo lista vazia, com a
// fixture falhando, ou com 500 mascarado.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';

/**
 * As quatro rotas de catálogo, todas com marca de acesso.
 *
 * `basemaps` entrou na lista com a migração 021. A marca ela já tinha desde a 017 e
 * o filtro público-por-padrão já valia; o que faltava era o tipo de CONCESSÃO, sem
 * o qual um basemap privado sumia para todo mundo e não havia como devolvê-lo a
 * ninguém. Antes disso este arquivo media três rotas e a quarta ficava sem par
 * negativo nenhum.
 */
const ROTAS = [
  ['basemaps', 'basemaps'],
  ['tilesets', 'tilesets'],
  ['data-layers', 'data_layers'],
  ['analysis-layers', 'analysis_layers'],
];

describe('R1 — listagem crua de catálogo, o estado ANTES de "privado" existir', () => {
  let app, db, adminToken, userToken;
  const sufixo = randomUUID().slice(0, 8);
  const idDe = (rota) => `rlc-${rota}-${sufixo}`;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const admin = await createAdminUser(db, { username: `rlc_admin_${sufixo}` });
    const user = await createUser(db, { username: `rlc_user_${sufixo}` });
    adminToken = await loginUser(app, admin.username, admin.password);
    userToken = await loginUser(app, user.username, user.password);

    for (const [rota, tabela] of ROTAS) {
      await db.query(
        `INSERT INTO ${tabela} (id, name, description, config, sort_order)
         VALUES ($1, $2, $3, $4::jsonb, 0)`,
        [idDe(rota), `Recurso ${rota}`, 'fixture de F0', JSON.stringify({ url: `/x/${rota}` })]
      );
    }
  });

  after(async () => {
    for (const [rota, tabela] of ROTAS) {
      await db.query(`DELETE FROM ${tabela} WHERE id = $1`, [idDe(rota)]);
    }
    await teardownTestEnv(db);
  });

  const como = (token, m, p) => supertest(app)[m](p).set('Authorization', `Bearer ${token}`);

  it('a rota exige token: sem Authorization é 401, nas quatro', async () => {
    let exercidas = 0;
    for (const [rota] of ROTAS) {
      await supertest(app).get(`/api/v1/${rota}`).expect(401);
      exercidas += 1;
    }
    assert.equal(exercidas, 4, 'guarda: as quatro rotas precisam ter sido exercidas');
  });

  // ESTE É O CASO QUE A FASE F2 REESCREVE. Hoje ele afirma o buraco; depois de F2
  // a linha privada precisa SUMIR daqui para o usuário comum, e o admin continuar
  // vendo-a, com a contagem diferindo de exatamente 1.
  it('HOJE (pré-F1): usuário comum recebe da rota crua EXATAMENTE o que o admin recebe', async () => {
    let exercidas = 0;
    for (const [rota] of ROTAS) {
      const doAdmin = await como(adminToken, 'get', `/api/v1/${rota}`).expect(200);
      const doUsuario = await como(userToken, 'get', `/api/v1/${rota}`).expect(200);

      const idsAdmin = doAdmin.body.data.map((r) => r.id).sort();
      const idsUsuario = doUsuario.body.data.map((r) => r.id).sort();

      // Discriminação: a fixture desta suíte precisa estar nas DUAS listas, senão
      // "as listas são iguais" seria a igualdade de dois conjuntos vazios.
      assert.ok(idsAdmin.includes(idDe(rota)), `a fixture ${idDe(rota)} precisa aparecer para o admin`);
      assert.ok(idsUsuario.includes(idDe(rota)), `a fixture ${idDe(rota)} aparece HOJE para o usuário comum (R1)`);
      assert.deepEqual(idsUsuario, idsAdmin, `${rota}: hoje as duas listas são idênticas — não há filtro de acesso`);
      exercidas += 1;
    }
    assert.equal(exercidas, 4);
  });

  // A partir de F1 a coluna EXISTE, então o buraco deixa de ser previsão e passa a
  // ser mensurável: dá para marcar uma linha como privada e ver a rota entregá-la
  // a quem não deveria. É o que este caso faz. Ele fica VERDE em F1 (afirmando o
  // vazamento) e é reescrito em F2 para a asserção inversa, quando o filtro entrar.
  //
  // Medir vale mais que prever: um teste que só dissesse "quando a coluna existir,
  // vai vazar" nunca seria confrontado com o produto.
  it('a coluna access_level existe nas quatro tabelas (F1 entrou)', async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'access_level'
          AND table_name = ANY($1::text[])`,
      [ROTAS.map(([, t]) => t)]
    );
    assert.deepEqual(
      rows.map((r) => r.table_name).sort(),
      ROTAS.map(([, t]) => t).sort(),
      'a migração 017 precisa ter posto access_level nas quatro tabelas de catálogo'
    );
  });

  it('R1 FECHADO: marcada privada, a linha SOME para o usuario comum e FICA para o admin', async () => {
    let medidas = 0;
    for (const [rota, tabela] of ROTAS) {
      const antesUsuario = (await como(userToken, 'get', `/api/v1/${rota}`).expect(200))
        .body.data.map((r) => r.id);
      assert.ok(antesUsuario.includes(idDe(rota)), 'guarda: publica, a linha aparece (mede o DELTA)');

      await db.query(`UPDATE ${tabela} SET access_level = 'private' WHERE id = $1`, [idDe(rota)]);
      try {
        const doUsuario = (await como(userToken, 'get', `/api/v1/${rota}`).expect(200)).body.data.map((r) => r.id);
        const doAdmin = (await como(adminToken, 'get', `/api/v1/${rota}`).expect(200)).body.data.map((r) => r.id);

        assert.ok(!doUsuario.includes(idDe(rota)), `${rota}: o usuario comum NAO pode ver a linha privada`);
        assert.ok(doAdmin.includes(idDe(rota)), `${rota}: o admin continua vendo`);
        assert.equal(
          doAdmin.length - doUsuario.length, 1,
          `${rota}: a diferenca entre as duas listas precisa ser de EXATAMENTE uma linha`
        );

        // GET /:id fecha junto. 404, nao 403: um recurso que o chamador nao
        // enxerga precisa ser indistinguivel de um que nao existe.
        await como(userToken, 'get', `/api/v1/${rota}/${idDe(rota)}`).expect(404);
        await como(adminToken, 'get', `/api/v1/${rota}/${idDe(rota)}`).expect(200);
        medidas += 1;
      } finally {
        await db.query(`UPDATE ${tabela} SET access_level = 'public' WHERE id = $1`, [idDe(rota)]);
      }
    }
    assert.equal(medidas, 4, 'guarda: as quatro rotas precisam ter sido medidas');
  });

  it('a rota de visibilidade e de ADMIN, e o usuario comum recebe 403', async () => {
    await como(userToken, 'patch', `/api/v1/resource-access/tileset/${idDe('tilesets')}/visibility`)
      .send({ accessLevel: 'private' }).expect(403);
    // Discriminacao: o admin passa no MESMO corpo.
    await como(adminToken, 'patch', `/api/v1/resource-access/tileset/${idDe('tilesets')}/visibility`)
      .send({ accessLevel: 'private' }).expect(200);
    await como(adminToken, 'patch', `/api/v1/resource-access/tileset/${idDe('tilesets')}/visibility`)
      .send({ accessLevel: 'public' }).expect(200);
  });
});
