// Path: tests/integration/atlas-emprestimo-repasse-autorizado.test.js
//
// ANEXAR UM RECURSO A UM ATLAS É REPASSÁ-LO, e por isso exige autoridade de REPASSE.
//
// O DEFEITO QUE ESTE ARQUIVO FECHA, medido no disco e composto só de gates que,
// isolados, estavam certos:
//
//   1. `POST /atlas/:atlasId/resources` exigia `manage` no atlas e
//      `assertCanSeeResource`, que chama `fn_can_see_resource` — e essa função não
//      distingue NÍVEL de concessão. Quem tinha apenas `view`, o nível cuja definição
//      é "vê e NÃO repassa", emprestava o recurso ao atlas dele.
//   2. `requireResourceShare` recusa `view` para RECONCEDER, mas o caminho do
//      empréstimo não passava por ele: a distinção `view`/`view_share` continuava
//      escrita, e contornada.
//   3. `POST /atlas/:atlasId/sharing/public` exige só `manage` e liga `is_public`.
//   4. `requireAtlasScopeWhenPresent` roda `requireAtlasPermission('read')`, e `read`
//      resolve para userId NULO num atlas público; o braço de empréstimo de
//      `fn_granted_resource_ids` não pergunta nada sobre o usuário.
//
// A soma das quatro entregava um recurso PRIVADO a um chamador SEM CREDENCIAL
// NENHUMA, e a cadeia inteira começava em alguém que só tinha `view`.
//
// A CORREÇÃO É NA PORTA DE ENTRADA, NÃO NA DE SAÍDA. O nível `read` do passo 4
// continua igual: o visitante de link público herdar o empréstimo é decisão registrada
// (R4). O que mudou é que a cadeia só pode COMEÇAR em quem podia repassar — papel
// global de dado, produção daquele recurso, ou concessão `view_share`. Publicar o
// atlas depois vira ato deliberado de quem já tinha essa autoridade, que é defensável;
// antes, era escalonamento silencioso de `view` para acesso anônimo.
//
// CADA NEGATIVO CARREGA O POSITIVO DO MESMO PAR — mesmo ator, mesmo corpo, mesma rota,
// mudando só o que está sob medição. Sem isso, um 403 também é o que se mede quando a
// fixture nasceu errada.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, createAtlas, createShare, loginUser,
  makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';

describe('F9 — anexar exige autoridade de REPASSE, não mera visibilidade', () => {
  let app, db, orgId;
  let admin, dono, gestorView, produtor;
  let tokenAdmin, tokenDono, tokenGestorView, tokenProdutor;
  let atlasPrivado, atlasPublico, atlasDoProdutor, tokenVisitante;
  let projeto360Id;
  const sufixo = randomUUID().slice(0, 8);
  const TILESET = `rep-inst-${sufixo}`;          // institucional (owner_org_id NULL)
  const TILESET_OM = `rep-om-${sufixo}`;         // mantido pela OM do produtor
  const SLUG_360 = `rep360-${sufixo}`;

  // --- helpers --------------------------------------------------------------
  const anexar = (token, atlasId, resourceType, resourceId) => supertest(app)
    .post(`/api/v1/atlas/${atlasId}/resources`)
    .set('Authorization', `Bearer ${token}`)
    .send({ resourceType, resourceId });

  const conceder = (type, resourceId, granteeId, grantLevel) => supertest(app)
    .post(`/api/v1/resource-access/${type}/${resourceId}/grants`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ granteeId, grantLevel });

  /** A lista NUA de slugs do 360 que este chamador enxerga (contrato congelado). */
  const slugs360 = async (token, atlasId) => {
    const req = supertest(app).get('/api/v1/sv360/projects');
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (atlasId) req.query({ atlasId });
    const { body } = await req.expect(200);
    return (Array.isArray(body) ? body : body.projects).map((p) => p.slug);
  };

  const emprestimosVivos = async (atlasId, resourceId) => {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM atlas_resources
        WHERE atlas_id = $1 AND resource_id = $2 AND removed_at IS NULL`,
      [atlasId, resourceId]
    );
    return rows[0].n;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const { rows: orgs } = await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM repasse ${sufixo}`, `omrep-${sufixo}`, `R${sufixo.slice(0, 4)}`]
    );
    orgId = orgs[0].id;

    admin = await createAdminUser(db, { username: `rep_admin_${sufixo}` });
    dono = await createUser(db, { username: `rep_dono_${sufixo}` });
    gestorView = await createUser(db, { username: `rep_gestor_${sufixo}` });
    // O ESCOPO DE PRODUÇÃO é `producer_org_id`, escrito só por administrador; a
    // LOTAÇÃO (`organization_id`) continua a default e não autoriza nada (F8).
    produtor = await createProducerUser(db, orgId, { username: `rep_prod_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenDono = await loginUser(app, dono.username, dono.password);
    tokenGestorView = await loginUser(app, gestorView.username, gestorView.password);
    tokenProdutor = await loginUser(app, produtor.username, produtor.password);

    atlasPrivado = await createAtlas(db, dono.id, { name: `Atlas repasse ${sufixo}` });
    atlasPublico = await createAtlas(db, dono.id, { name: `Atlas publico ${sufixo}` });
    atlasDoProdutor = await createAtlas(db, produtor.id, { name: `Atlas produtor ${sufixo}` });
    await createShare(db, atlasPrivado.id, gestorView.id, 'manage', dono.id);
    await createShare(db, atlasPublico.id, gestorView.id, 'manage', dono.id);
    const link = await makeAtlasPublic(db, atlasPublico.id);
    tokenVisitante = await getPublicToken(app, link);

    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [TILESET, `Tileset institucional ${sufixo}`]
    );
    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level, owner_org_id)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private', $3)`,
      [TILESET_OM, `Tileset da OM ${sufixo}`, orgId]
    );
    const { rows: p } = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level,
                                   center_lat, center_long, photo_count)
       VALUES ($1, $2, $3, $4, 'enabled', 'private', -29.5, -50.5, 1) RETURNING id`,
      [orgId, SLUG_360, `Panorama privado ${sufixo}`, `${orgId}__${SLUG_360}.db`]
    );
    projeto360Id = p[0].id;

    // O DONO recebe `view_share` nos dois recursos: ele é a autoridade de repasse
    // deste arquivo, e (D4) é a concessão DELE que sustenta o empréstimo depois.
    await conceder('tileset', TILESET, dono.id, 'view_share').expect(201);
    await conceder('sv360_project', projeto360Id, dono.id, 'view_share').expect(201);
    // O co-Gestor recebe `view`: ele VÊ os dois e não pode repassar nenhum.
    await conceder('tileset', TILESET, gestorView.id, 'view').expect(201);
    await conceder('sv360_project', projeto360Id, gestorView.id, 'view').expect(201);
    // O produtor VÊ o tileset institucional por concessão, e o da própria OM por
    // produção — a distinção é o que o segundo bloco mede.
    await conceder('tileset', TILESET, produtor.id, 'view').expect(201);
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE resource_id = ANY($1::text[])',
      [[TILESET, TILESET_OM, projeto360Id]]);
    await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])',
      [[TILESET, TILESET_OM, projeto360Id]]);
    await db.query('DELETE FROM sv360.projects WHERE id = $1', [projeto360Id]);
    await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])', [[TILESET, TILESET_OM]]);
    await db.query('DELETE FROM atlas WHERE id = ANY($1::uuid[])',
      [[atlasPrivado.id, atlasPublico.id, atlasDoProdutor.id]]);
    await teardownTestEnv(db);
  });

  // ==========================================================================
  // `view` NÃO EMPRESTA, `view_share` EMPRESTA
  // ==========================================================================

  it('quem tem só `view` recebe 403 ao anexar, mesmo com `manage` no atlas', async () => {
    // O piso: ele ENXERGA o recurso, então o 403 não é o 404 de `assertCanSeeResource`
    // com outra roupa. Sem esta linha, o caso passaria idêntico com uma fixture que
    // nunca concedeu nada.
    const visivel = await supertest(app)
      .get(`/api/v1/tilesets/${TILESET}`)
      .set('Authorization', `Bearer ${tokenGestorView}`)
      .expect(200);
    assert.equal(visivel.body.data.id, TILESET, 'piso: o co-Gestor vê o recurso');

    const res = await anexar(tokenGestorView, atlasPrivado.id, 'tileset', TILESET).expect(403);
    assert.match(res.body.error.message, /compartilhar/i);
    assert.equal(
      await emprestimosVivos(atlasPrivado.id, TILESET), 0,
      'o 403 precisa ser sem efeito — nada foi emprestado'
    );
  });

  it('e o MESMO ator, com `view_share` no lugar do `view`, recebe 201 no mesmo corpo', async () => {
    // A ÚNICA COISA QUE MUDA É O NÍVEL. Trocar de ator ou de corpo deixaria a
    // comparação medir outra coisa, e é por isso que a concessão antiga é REVOGADA em
    // vez de somada: com as duas vivas, o `some(view_share)` responderia verdadeiro
    // sem que a diferença tivesse sido isolada.
    const { rows } = await db.query(
      `SELECT id FROM resource_grants
        WHERE resource_id = $1 AND grantee_id = $2 AND revoked_at IS NULL`,
      [TILESET, gestorView.id]
    );
    assert.equal(rows.length, 1, 'piso: uma concessão viva de `view` a revogar');
    await supertest(app).delete(`/api/v1/resource-access/grants/${rows[0].id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`).expect(200);

    await conceder('tileset', TILESET, gestorView.id, 'view_share').expect(201);

    const res = await anexar(tokenGestorView, atlasPrivado.id, 'tileset', TILESET).expect(201);
    assert.equal(res.body.data.resource_id, TILESET);
    assert.equal(await emprestimosVivos(atlasPrivado.id, TILESET), 1);
  });

  it('a ORDEM dos dois gates é contrato: 404 para o que não se vê, 403 para o que não se repassa', async () => {
    // Um recurso que este ator NÃO enxerga precisa continuar indistinguível de um que
    // não existe: se o gate novo rodasse antes, o 403 confirmaria a existência do que o
    // 404 esconde, e a rota viraria um oráculo de inventário.
    await anexar(tokenGestorView, atlasPrivado.id, 'tileset', TILESET_OM).expect(404);
    await anexar(tokenGestorView, atlasPrivado.id, 'tileset', `nao-existe-${sufixo}`).expect(404);
  });

  // ==========================================================================
  // O PRODUTOR EMPRESTA O QUE MANTÉM — E SÓ O QUE MANTÉM
  // ==========================================================================

  it('o produtor empresta o recurso da própria OM sem concessão nenhuma', async () => {
    // Exigir que um administrador conceda ao produtor acesso ao que a OM dele produziu
    // inverte a relação (o argumento está por extenso na migração 019), e criaria uma
    // concessão a renovar todo ano para o mantenedor enxergar o próprio acervo.
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM resource_grants
        WHERE resource_id = $1 AND grantee_id = $2 AND revoked_at IS NULL`,
      [TILESET_OM, produtor.id]
    );
    assert.equal(rows[0].n, 0, 'piso: ele não tem concessão nenhuma neste recurso');

    await anexar(tokenProdutor, atlasDoProdutor.id, 'tileset', TILESET_OM).expect(201);
  });

  it('e NÃO empresta o institucional, que ele vê por concessão `view` e não mantém', async () => {
    // O par negativo do mesmo ator, na mesma rota e no mesmo atlas: o que muda é de
    // quem é o recurso. `owner_org_id` NULL é acervo institucional, e nenhum produtor
    // o mantém.
    const res = await anexar(tokenProdutor, atlasDoProdutor.id, 'tileset', TILESET).expect(403);
    assert.match(res.body.error.message, /compartilhar/i);
    assert.equal(await emprestimosVivos(atlasDoProdutor.id, TILESET), 0);
  });

  // ==========================================================================
  // A CADEIA ANÔNIMA — o extremo do eixo
  // ==========================================================================

  it('sem autoridade de repasse não há empréstimo, e o ANÔNIMO nada recebe do atlas público', async () => {
    // O piso do outro lado: o anônimo JÁ alcança o atlas (ele é `is_public`), então o
    // que o detém não é o gate de atlas — é a ausência do empréstimo.
    await anexar(tokenGestorView, atlasPublico.id, 'sv360_project', projeto360Id).expect(403);
    assert.equal(await emprestimosVivos(atlasPublico.id, projeto360Id), 0);

    // SEM CREDENCIAL NENHUMA, com o UUID do atlas público na URL.
    assert.ok(
      !(await slugs360(null, atlasPublico.id)).includes(SLUG_360),
      'o panorama privado não pode chegar a um chamador anônimo'
    );
    // E pela outra superfície, com o crachá do visitante de link público.
    const visivel = await supertest(app)
      .get(`/api/v1/resource-access/visible?atlasId=${atlasPublico.id}`)
      .set('Authorization', `Bearer ${tokenVisitante}`)
      .expect(200);
    assert.ok(!visivel.body.data.views360.map((v) => v.id).includes(projeto360Id));
  });

  it('com autoridade de repasse o empréstimo existe, e o anônimo o herda — CONSEQUÊNCIA ACEITA (R4)', async () => {
    // O positivo do mesmo par, e ele NÃO é um contra-exemplo: é a decisão registrada.
    // O visitante de link público herda o que o atlas empresta, e o que torna isso
    // defensável é a cadeia começar em quem podia repassar. Medir só o negativo acima
    // deixaria "o anônimo nunca vê nada" indistinguível de "o eixo está desligado".
    await anexar(tokenDono, atlasPublico.id, 'sv360_project', projeto360Id).expect(201);

    assert.ok((await slugs360(null, atlasPublico.id)).includes(SLUG_360));
    const visivel = await supertest(app)
      .get(`/api/v1/resource-access/visible?atlasId=${atlasPublico.id}`)
      .set('Authorization', `Bearer ${tokenVisitante}`)
      .expect(200);
    assert.ok(visivel.body.data.views360.map((v) => v.id).includes(projeto360Id));

    // A DISCRIMINAÇÃO: sem o atlas em foco, o mesmo anônimo continua sem o panorama.
    assert.ok(!(await slugs360(null, null)).includes(SLUG_360));
  });

  // ==========================================================================
  // CACHE — resposta que dependeu de concessão ou de empréstimo
  // ==========================================================================

  it('as listagens de catálogo e o payload aditivo marcam escopo de cache', async () => {
    // Cabeçalho AUSENTE autoriza um proxy compartilhado a guardar por HEURÍSTICA, e
    // estes corpos variam por papel, produção, concessão e empréstimo. A isenção do RFC
    // 9111 para `Authorization` não cobre o caso: `flexibleAuth` também lê o cookie
    // `token`, e a requisição por cookie chega sem aquele cabeçalho.
    const lista = await supertest(app).get('/api/v1/tilesets')
      .set('Authorization', `Bearer ${tokenDono}`).expect(200);
    assert.match(lista.headers['cache-control'], /^private, no-cache$/);
    assert.match(lista.headers.vary ?? '', /Cookie/);

    const item = await supertest(app).get(`/api/v1/tilesets/${TILESET}`)
      .set('Authorization', `Bearer ${tokenDono}`).expect(200);
    assert.match(item.headers['cache-control'], /^private, no-cache$/);

    const aditivo = await supertest(app).get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokenDono}`).expect(200);
    assert.match(aditivo.headers['cache-control'], /^private, no-cache$/);
    assert.match(aditivo.headers.vary ?? '', /Authorization/);

    // O PAR POSITIVO do outro lado do predicado: a mesma peça deixa passar sem
    // cabeçalho a resposta que NÃO dependeu de quem pediu. Sem este caso, um
    // `setHeader` incondicional passaria os três de cima e fecharia o cache de CDN do
    // caminho anônimo, que é o que o 360 preserva de propósito.
    const anonimo = await supertest(app).get('/api/v1/sv360/projects').expect(200);
    assert.equal(anonimo.headers['cache-control'], undefined);
  });
});
