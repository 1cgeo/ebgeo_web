// Path: tests/integration/catalogo-cru-concessao.test.js
//
// A LISTAGEM CRUA DE CATÁLOGO, PELO EIXO DE CONCESSÃO E DE EMPRÉSTIMO.
//
// ESTE ARQUIVO NASCEU DE UM CONTROLE NEGATIVO QUE FALHOU. Ao medir o censo de
// superfícies, desliguei o ramo `fn_granted_resource_ids` de `accessPredicate`
// (`catalog.service.js`) e rodei a suíte inteira: ZERO casos ficaram vermelhos. Ou
// seja, o braço que faz um recurso privado CONCEDIDO aparecer em
// `GET /api/v1/tilesets` (e em `/data-layers`, `/analysis-layers`, `/basemaps`) não
// tinha um único teste. As suítes vizinhas mediam o eixo pelo payload aditivo
// (`/resource-access/visible`) e pelo `/api/config`, nunca pela rota crua — que é a
// que o painel de Administração consome.
//
// Um controle negativo que não fica vermelho não é uma boa notícia: é a medida de um
// buraco. `resource-access-listagem-crua.test.js` mede o eixo PÚBLICO/PRIVADO com
// admin e usuário comum; aqui se mede o que fica ENTRE os dois — o beneficiário de uma
// concessão e o membro de um atlas que empresta.
//
// E O SEGUNDO ACHADO, que veio junto: `?atlasId=` NÃO ERA GATEADO nem aqui nem em
// `GET /resource-access/visible`. `fn_granted_resource_ids` casa `ar.atlas_id` e não
// pergunta se o chamador participa daquele atlas, então bastava saber o UUID — que
// viaja em toda URL de compartilhamento — para receber tudo o que ele empresta. O
// JSDoc de `requireAtlasScopeWhenPresent` já dizia isso por extenso ("o UUID do atlas
// não é senha"); o middleware simplesmente não tinha sido aplicado a estas duas rotas.
// Os dois últimos blocos deste arquivo são o par que fixa a correção.
//
// A ESTRUTURA É SEMPRE UM PAR. Sem o positivo, "o forasteiro não vê" é o que se mede
// numa rota quebrada; sem o negativo, "o beneficiário vê" é o que se mede numa rota
// que não filtra nada.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';

describe('F9 — a listagem CRUA de catálogo pelo eixo de concessão e de empréstimo', () => {
  let app, db;
  let admin, dono, beneficiario, membro, forasteiro;
  let tokenAdmin, tokenDono, tokenBeneficiario, tokenMembro, tokenForasteiro;
  let atlasEmpresta, atlasSemNada;

  const sufixo = randomUUID().slice(0, 8);
  const CONCEDIDO = `cru-conc-${sufixo}`;
  const EMPRESTADO = `cru-emp-${sufixo}`;
  const PUBLICO = `cru-pub-${sufixo}`;

  // --- helpers ---------------------------------------------------------------
  const lista = async (token, atlasId, esperado = 200) => {
    const req = supertest(app).get('/api/v1/tilesets');
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (atlasId) req.query({ atlasId });
    const res = await req.expect(esperado);
    return esperado === 200 ? res.body.data.map((t) => t.id) : [];
  };
  const porId = (id, token, atlasId) => {
    const req = supertest(app).get(`/api/v1/tilesets/${id}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return atlasId ? req.query({ atlasId }) : req;
  };
  const visiveis = async (token, atlasId, esperado = 200) => {
    const req = supertest(app).get('/api/v1/resource-access/visible');
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (atlasId) req.query({ atlasId });
    const res = await req.expect(esperado);
    return esperado === 200 ? res.body.data.tilesets.map((t) => t.id) : [];
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `cru_admin_${sufixo}` });
    dono = await createUser(db, { username: `cru_dono_${sufixo}` });
    beneficiario = await createUser(db, { username: `cru_ben_${sufixo}` });
    membro = await createUser(db, { username: `cru_membro_${sufixo}` });
    forasteiro = await createUser(db, { username: `cru_fora_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenDono = await loginUser(app, dono.username, dono.password);
    tokenBeneficiario = await loginUser(app, beneficiario.username, beneficiario.password);
    tokenMembro = await loginUser(app, membro.username, membro.password);
    tokenForasteiro = await loginUser(app, forasteiro.username, forasteiro.password);

    // DOIS atlas do MESMO dono, e o forasteiro não participa de nenhum: é o par que
    // separa "o empréstimo é por atlas" de "o UUID do atlas abre".
    atlasEmpresta = await createAtlas(db, dono.id, { name: `Atlas empresta ${sufixo}` });
    atlasSemNada = await createAtlas(db, dono.id, { name: `Atlas seco ${sufixo}` });
    await createShare(db, atlasEmpresta.id, membro.id, 'read', dono.id);
    await createShare(db, atlasSemNada.id, membro.id, 'read', dono.id);

    for (const [id, nivel] of [
      [CONCEDIDO, 'private'], [EMPRESTADO, 'private'], [PUBLICO, 'public'],
    ]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, sort_order, access_level)
         VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, $3)`,
        [id, `Tileset ${id}`, nivel]
      );
    }

    // A concessão PESSOAL ao beneficiário.
    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${CONCEDIDO}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: beneficiario.id, grantLevel: 'view' })
      .expect(201);

    // O EMPRÉSTIMO: o dono recebe concessão (é o que o sustenta, D4) e anexa.
    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${EMPRESTADO}/grants`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ granteeId: dono.id, grantLevel: 'view_share' })
      .expect(201);
    await supertest(app)
      .post(`/api/v1/atlas/${atlasEmpresta.id}/resources`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({ resourceType: 'tileset', resourceId: EMPRESTADO })
      .expect(201);
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE resource_id = ANY($1::text[])',
      [[CONCEDIDO, EMPRESTADO, PUBLICO]]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])',
      [[CONCEDIDO, EMPRESTADO, PUBLICO]]);
    await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])',
      [[CONCEDIDO, EMPRESTADO, PUBLICO]]);
    await db.query('DELETE FROM atlas WHERE owner_id = $1', [dono.id]);
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // 1. CONCESSÃO PESSOAL na rota crua — o ramo que nenhum teste cobria
  // ==========================================================================

  it('CONCESSÃO — o beneficiário vê o privado concedido na listagem crua; o forasteiro não', async () => {
    const doBeneficiario = await lista(tokenBeneficiario, null);
    assert.ok(doBeneficiario.includes(CONCEDIDO), 'o concedido precisa aparecer para quem recebeu');

    const doForasteiro = await lista(tokenForasteiro, null);
    assert.ok(!doForasteiro.includes(CONCEDIDO), 'e não pode aparecer para quem não recebeu');

    // A DISCRIMINAÇÃO: os dois enxergam o PÚBLICO. Sem esta linha, "o forasteiro não
    // vê o concedido" também é o que se mede numa listagem vazia.
    assert.ok(doForasteiro.includes(PUBLICO), 'o público continua saindo para todo mundo');
    assert.ok(doBeneficiario.includes(PUBLICO));
  });

  it('CONCESSÃO — e o mesmo vale no GET por id, que é 404 (nunca 403) para quem não alcança', async () => {
    await porId(CONCEDIDO, tokenBeneficiario).expect(200);
    await porId(CONCEDIDO, tokenForasteiro).expect(404);
    // O par: o público responde 200 para os dois, então o 404 acima é do EIXO e não
    // da rota.
    await porId(PUBLICO, tokenForasteiro).expect(200);
  });

  it('CONCESSÃO — revogada, o beneficiário perde a linha de volta', async () => {
    const { rows } = await db.query(
      `SELECT id FROM resource_grants
        WHERE resource_id = $1 AND grantee_id = $2 AND revoked_at IS NULL`,
      [CONCEDIDO, beneficiario.id]
    );
    assert.equal(rows.length, 1, 'piso: a concessão precisa existir para poder ser revogada');
    await supertest(app)
      .delete(`/api/v1/resource-access/grants/${rows[0].id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    try {
      assert.ok(!(await lista(tokenBeneficiario, null)).includes(CONCEDIDO));
      await porId(CONCEDIDO, tokenBeneficiario).expect(404);
    } finally {
      await supertest(app)
        .post(`/api/v1/resource-access/tileset/${CONCEDIDO}/grants`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ granteeId: beneficiario.id, grantLevel: 'view' })
        .expect(201);
    }
    assert.ok((await lista(tokenBeneficiario, null)).includes(CONCEDIDO), 'reconcedida, volta');
  });

  // ==========================================================================
  // 2. EMPRÉSTIMO POR ATLAS na rota crua
  // ==========================================================================

  it('EMPRÉSTIMO — o membro vê o emprestado COM `?atlasId=`, e NÃO vê sem ele nem com outro atlas', async () => {
    assert.ok(!(await lista(tokenMembro, null)).includes(EMPRESTADO),
      'sem atlas em foco, o membro não tem concessão nenhuma');
    assert.ok(!(await lista(tokenMembro, atlasSemNada.id)).includes(EMPRESTADO),
      'o outro atlas do mesmo dono não empresta nada');
    assert.ok((await lista(tokenMembro, atlasEmpresta.id)).includes(EMPRESTADO),
      'com o atlas que empresta, aparece');
  });

  it('EMPRÉSTIMO — o GET por id segue a mesma regra, e o par 404/200 é do escopo', async () => {
    await porId(EMPRESTADO, tokenMembro).expect(404);
    await porId(EMPRESTADO, tokenMembro, atlasSemNada.id).expect(404);
    await porId(EMPRESTADO, tokenMembro, atlasEmpresta.id).expect(200);
  });

  // ==========================================================================
  // 3. O UUID DO ATLAS NÃO É SENHA — o gate que faltava nas duas rotas
  // ==========================================================================

  it('GATE — o FORASTEIRO com o UUID do atlas que empresta leva 404, e nunca o recurso', async () => {
    // O forasteiro não é membro de atlas nenhum. Antes de `requireAtlasScopeWhenPresent`
    // entrar nesta rota, o `atlasId` ia direto para `fn_granted_resource_ids`, que casa
    // `ar.atlas_id` e NÃO confere participação: saber o UUID entregava o empréstimo.
    await lista(tokenForasteiro, atlasEmpresta.id, 404);
    await porId(EMPRESTADO, tokenForasteiro, atlasEmpresta.id).expect(404);

    // O PAR POSITIVO, e é ele que impede a correção de virar "404 para todo mundo":
    // o MEMBRO passa pelo mesmo gate com o mesmo UUID.
    assert.ok((await lista(tokenMembro, atlasEmpresta.id)).includes(EMPRESTADO));

    // E o forasteiro continua vendo a listagem PÚBLICA quando não força escopo nenhum:
    // o gate só existe quando há atlas em foco.
    assert.ok((await lista(tokenForasteiro, null)).includes(PUBLICO));
  });

  it('GATE — o mesmo vale para `GET /resource-access/visible`, que tinha o mesmo buraco', async () => {
    await visiveis(tokenForasteiro, atlasEmpresta.id, 404);
    // Par positivo: o membro recebe o emprestado pelo mesmo caminho e com o mesmo UUID.
    assert.ok((await visiveis(tokenMembro, atlasEmpresta.id)).includes(EMPRESTADO));
    // E sem atlas em foco a rota continua respondendo 200 para qualquer um — "sem atlas
    // em foco" é o estado normal de quem acabou de entrar.
    assert.deepEqual(await visiveis(tokenForasteiro, null), []);
  });

  it('GATE — `atlasId` malformado morre em 422 na BORDA, nas duas rotas', async () => {
    await lista(tokenMembro, 'nao-e-uuid', 422);
    await visiveis(tokenMembro, 'nao-e-uuid', 422);
    // Discriminação: um UUID BEM-FORMADO de atlas inexistente é 404 (autorização), e
    // não 422 (borda). Os dois códigos dizem coisas diferentes e não podem se fundir.
    await lista(tokenMembro, randomUUID(), 404);
  });
});
