// Path: tests/integration/resource-grants-escalonamento.test.js
//
// OS DOIS NÍVEIS DE CONCESSÃO SÃO DE VERDADE (fase F3).
//
// `view` vê e NÃO repassa; `view_share` vê e repassa. É a única diferença entre
// eles, e sem um teste negativo ela é prosa: o caminho feliz de conceder passa
// idêntico nos dois casos.
//
// Cada negativo aqui vem com o positivo do MESMO par, no mesmo corpo, porque um
// 403 também é o que se mede quando a fixture não existe, quando o token está
// errado ou quando a rota está 500.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';
import * as svc from '../../src/modules/resource-access/resource-access.service.js';

describe('F3 — `view` não escala para `view_share`', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const LAYER = `esc-${sufixo}`;
  const atores = {};
  const tokens = {};

  const conceder = (quem, granteeId, grantLevel) => supertest(app)
    .post(`/api/v1/resource-access/data_layer/${LAYER}/grants`)
    .set('Authorization', `Bearer ${tokens[quem]}`)
    .send({ granteeId, grantLevel });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    for (const nome of ['admin', 'so_view', 'com_share', 'alvo1', 'alvo2', 'alvo3', 'estranho']) {
      atores[nome] = nome === 'admin'
        ? await createAdminUser(db, { username: `esc_admin_${sufixo}` })
        : await createUser(db, { username: `esc_${nome}_${sufixo}` });
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }

    await db.query(
      `INSERT INTO data_layers (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [LAYER, `Camada ${sufixo}`]
    );

    await conceder('admin', atores.so_view.id, 'view').expect(201);
    await conceder('admin', atores.com_share.id, 'view_share').expect(201);
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id = $1', [LAYER]);
    await db.query('DELETE FROM data_layers WHERE id = $1', [LAYER]);
    await teardownTestEnv(db);
  });

  it('quem tem `view` recebe 403 ao conceder; quem tem `view_share` recebe 201 no mesmo corpo', async () => {
    await conceder('so_view', atores.alvo1.id, 'view').expect(403);
    const ok = await conceder('com_share', atores.alvo1.id, 'view').expect(201);
    assert.equal(ok.body.data.grantee_id, atores.alvo1.id);
    assert.equal(ok.body.data.grant_level, 'view');
  });

  it('quem tem `view` também não LISTA quem tem acesso; quem tem `view_share` lista', async () => {
    // A lista nomeia pessoas, então ela é gateada por compartilhar e não por ver.
    await supertest(app)
      .get(`/api/v1/resource-access/data_layer/${LAYER}/grants`)
      .set('Authorization', `Bearer ${tokens.so_view}`)
      .expect(403);

    const res = await supertest(app)
      .get(`/api/v1/resource-access/data_layer/${LAYER}/grants`)
      .set('Authorization', `Bearer ${tokens.com_share}`)
      .expect(200);
    const beneficiarios = res.body.data.map((g) => g.grantee_id);
    assert.ok(beneficiarios.includes(atores.so_view.id), 'a lista precisa nomear quem tem acesso');
    assert.ok(beneficiarios.includes(atores.com_share.id));
    // E carrega o CONCEDENTE, que é o que a UI mostra como "recebido de".
    const doSoView = res.body.data.find((g) => g.grantee_id === atores.so_view.id);
    assert.equal(doSoView.granted_by, atores.admin.id);
    assert.equal(doSoView.granted_by_username, atores.admin.username);
  });

  it('quem não tem concessão nenhuma também não concede (nem vê a lista)', async () => {
    await conceder('estranho', atores.alvo2.id, 'view').expect(403);
    await supertest(app)
      .get(`/api/v1/resource-access/data_layer/${LAYER}/grants`)
      .set('Authorization', `Bearer ${tokens.estranho}`)
      .expect(403);
  });

  it('`view_share` concede `view_share` adiante, e a cadeia continua uma cadeia', async () => {
    const filho = await conceder('com_share', atores.alvo3.id, 'view_share').expect(201);
    // O neto: quem acabou de receber `view_share` concede.
    const tokenAlvo3 = await loginUser(app, atores.alvo3.username, atores.alvo3.password);
    const neto = await supertest(app)
      .post(`/api/v1/resource-access/data_layer/${LAYER}/grants`)
      .set('Authorization', `Bearer ${tokenAlvo3}`)
      .send({ granteeId: atores.alvo2.id, grantLevel: 'view' })
      .expect(201);
    assert.equal(neto.body.data.parent_grant_id, filho.body.data.id, 'o neto pendura no filho');
  });

  it('conceder duas vezes a mesma pessoa, do mesmo concedente, é 409', async () => {
    // D3 protege a concessão de OUTRO concedente, que carrega informação (dois
    // caminhos independentes). Duas linhas do MESMO concedente não carregam nada,
    // e a segunda só cria uma subárvore irmã que a revogação da primeira não
    // alcança — ou seja, um jeito silencioso de tornar a revogação incompleta.
    await conceder('admin', atores.estranho.id, 'view').expect(201);
    await conceder('admin', atores.estranho.id, 'view').expect(409);
    // Discriminação: OUTRO concedente sobre a MESMA pessoa continua passando.
    await conceder('com_share', atores.estranho.id, 'view').expect(201);
  });

  it('conceder a si mesmo é 409, e a beneficiário inexistente é 404', async () => {
    await conceder('com_share', atores.com_share.id, 'view').expect(409);
    await conceder('com_share', randomUUID(), 'view').expect(404);
    // Recurso inexistente: 404 também, e pelo mesmo gate — o ator não tem
    // concessão viva sobre um id que não existe, então o 403 vem antes. O que
    // importa é NÃO ser 201.
    await supertest(app)
      .post(`/api/v1/resource-access/data_layer/nao-existe-${sufixo}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ granteeId: atores.alvo1.id, grantLevel: 'view' })
      .expect(404);
  });

  it('a SEGUNDA barreira existe: o serviço recusa sozinho, sem o middleware na frente', async () => {
    // ESTE CASO EXISTE PORQUE O CONTROLE NEGATIVO O EXIGIU. Afrouxar a checagem
    // de `view_share` DENTRO de `grantResource` deixava a suíte inteira VERDE: o
    // middleware barrava antes, e a segunda barreira era um guarda que nada
    // media. Guarda não medido é guarda que ninguém percebe quebrar.
    //
    // Chamar o serviço direto é o que separa as duas camadas. `hasGlobalAccess:
    // false` é o cenário real de quem não é admin — passá-lo como `true` aqui
    // testaria o ramo errado.
    await assert.rejects(
      () => svc.grantResource({
        type: 'data_layer',
        resourceId: LAYER,
        granteeId: atores.alvo2.id,
        grantLevel: 'view',
        actor: atores.so_view,
        hasGlobalAccess: false,
        req: null,
      }),
      /compartilhar/i,
      'quem só tem `view` precisa ser recusado pelo próprio serviço'
    );

    // O positivo do mesmo par, pelo mesmo caminho: quem tem `view_share` passa.
    const criada = await svc.grantResource({
      type: 'data_layer',
      resourceId: LAYER,
      granteeId: atores.alvo2.id,
      grantLevel: 'view',
      actor: atores.com_share,
      hasGlobalAccess: false,
      req: null,
    });
    assert.equal(criada.grantee_id, atores.alvo2.id);
    assert.equal(criada.granted_by, atores.com_share.id);
  });

  it('nível fora dos dois valores morre na borda (422), e o corpo válido passa', async () => {
    await supertest(app)
      .post(`/api/v1/resource-access/data_layer/${LAYER}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ granteeId: atores.alvo1.id, grantLevel: 'owner' })
      .expect(422);
    // Sem `grantLevel` também: o default silencioso seria conceder o nível menor
    // sem ninguém perceber.
    await supertest(app)
      .post(`/api/v1/resource-access/data_layer/${LAYER}/grants`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ granteeId: atores.alvo1.id })
      .expect(422);
  });
});
