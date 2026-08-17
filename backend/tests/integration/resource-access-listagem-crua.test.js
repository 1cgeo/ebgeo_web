// Path: tests/integration/resource-access-listagem-crua.test.js
//
// R1 — O BURACO REGISTRADO POR ESCRITO ANTES DE SER ABERTO (fase F0).
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

/** As três rotas que servem os tipos de recurso que ganham marca de acesso. */
const ROTAS = [
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

  it('a rota exige token: sem Authorization é 401, nas três', async () => {
    let exercidas = 0;
    for (const [rota] of ROTAS) {
      await supertest(app).get(`/api/v1/${rota}`).expect(401);
      exercidas += 1;
    }
    assert.equal(exercidas, 3, 'guarda: as três rotas precisam ter sido exercidas');
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
    assert.equal(exercidas, 3);
  });

  it('a coluna access_level ainda NÃO existe: este arquivo documenta o pré-estado', async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'access_level'
          AND table_name = ANY($1::text[])`,
      [ROTAS.map(([, t]) => t)]
    );
    // Quando a fase F1 entrar, este caso vira vermelho de propósito: é o sinal de
    // que os casos marcados acima precisam ser reescritos para a asserção inversa.
    assert.deepEqual(
      rows.map((r) => r.table_name).sort(), [],
      'access_level já existe — a fase F1 entrou. Reescreva os casos marcados neste arquivo (R1).'
    );
  });
});
