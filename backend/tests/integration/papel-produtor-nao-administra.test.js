// Path: tests/integration/papel-produtor-nao-administra.test.js
//
// O PRODUTOR NÃO É UM MEIO-ADMINISTRADOR.
//
// Os quatro papéis globais NÃO SÃO UMA ESCADA, e o `producer` é o que mais convida
// ao erro: ele escreve, e "escreve" é a palavra que faz alguém supor autoridade.
// Ele mantém o acervo de UMA OM e mais nada — não lista usuários, não lê a trilha de
// auditoria, não abre atlas alheio, não desatola a lixeira de outra pessoa e não
// vira 'admin' no cliente.
//
// A regressão que este arquivo existe para impedir tem forma conhecida: alguém
// escreve `if (role !== 'user')` ou `role === 'admin' || role === 'producer'` num
// gate de administração, porque o produtor "também escreve". A varredura estrutural
// (tests/unit/papel-global-censo.test.js) pega o literal; este arquivo pega o
// COMPORTAMENTO, que é a metade que a varredura não alcança.
//
// E O CASO QUE DÁ SENTIDO À DECISÃO I DA ESPECIFICAÇÃO: `producer_org_id` viaja no
// JWT, mas o crachá que vale é o do BANCO. Um token assinado com a chave certa e
// declarando um escopo que a conta não tem abre exatamente nada — é o mesmo
// resultado que `sv360-privado.test.js` já mede para o papel `admin` forjado.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import config from '../../src/config.js';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, createAtlas, loginUser,
} from '../helpers/fixtures.js';
import { toFrontendRole } from '../../src/utils/roles.js';

describe('O Produtor escreve acervo e não administra o sistema', () => {
  let app, db, admin, comum, produtor, atlasDoAdmin, atlasApagado;
  let tokenAdmin, tokenComum, tokenProdutor;
  let orgA, orgB;
  const sufixo = randomUUID().slice(0, 8);
  const BASEMAP_A = `nadm-a-${sufixo}`;
  const BASEMAP_B = `nadm-b-${sufixo}`;
  // O eixo de VISIBILIDADE (público/privado) só existe para os QUATRO tipos que
  // recebem concessão (`RESOURCE_TYPES`), e `basemap` não é um deles: a rota
  // `/resource-access/:type/...` recusa `basemap` com 422 na borda, antes de qualquer
  // gate. Por isso o caso de `requireAdmin` usa um tileset.
  const TILESET_A = `nadm-t-${sufixo}`;
  const TILESET_B = `nadm-tb-${sufixo}`;

  const forja = (claims) => jwt.sign(claims, config.jwt.secret, { algorithm: 'HS256', expiresIn: '5m' });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const criaOrg = async (rotulo) => (await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM ${rotulo} ${sufixo}`, `om-nadm-${rotulo}-${sufixo}`, `${rotulo}${sufixo.slice(0, 3)}`]
    )).rows[0].id;
    orgA = await criaOrg('a');
    orgB = await criaOrg('b');

    admin = await createAdminUser(db, { username: `nadm_admin_${sufixo}` });
    comum = await createUser(db, { username: `nadm_comum_${sufixo}` });
    produtor = await createProducerUser(db, orgA, { username: `nadm_prod_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    tokenComum = await loginUser(app, comum.username, comum.password);
    tokenProdutor = await loginUser(app, produtor.username, produtor.password);

    atlasDoAdmin = await createAtlas(db, admin.id, { name: `Atlas do admin ${sufixo}` });
    atlasApagado = await createAtlas(db, comum.id, { name: `Atlas apagado ${sufixo}` });
    await db.query('UPDATE atlas SET deleted_at = NOW() WHERE id = $1', [atlasApagado.id]);

    for (const [id, org] of [[BASEMAP_A, orgA], [BASEMAP_B, orgB]]) {
      await db.query(
        `INSERT INTO basemaps (id, name, config, sort_order, owner_org_id)
         VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, $3::uuid)`,
        [id, `Basemap ${id}`, org]
      );
    }
    for (const [id, org] of [[TILESET_A, orgA], [TILESET_B, orgB]]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, sort_order, owner_org_id)
         VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, $3::uuid)`,
        [id, `Tileset ${id}`, org]
      );
    }
  });

  after(async () => {
    await db.query('DELETE FROM basemaps WHERE id = ANY($1::text[])', [[BASEMAP_A, BASEMAP_B]]);
    await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])', [[TILESET_A, TILESET_B]]);
    await db.query('DELETE FROM atlas WHERE id = ANY($1::uuid[])', [[atlasDoAdmin.id, atlasApagado.id]]);
    await db.query('DELETE FROM users WHERE producer_org_id = ANY($1::uuid[])', [[orgA, orgB]]);
    await db.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[orgA, orgB]]);
    await teardownTestEnv(db);
  });

  it('piso: o produtor É produtor — ele escreve o acervo da OM dele', async () => {
    // Sem este piso, todos os 403 abaixo também são o que se mede numa conta
    // simplesmente sem poder nenhum, e o arquivo não distinguiria "produtor recusado
    // na administração" de "fixture quebrada".
    await supertest(app)
      .put(`/api/v1/basemaps/${BASEMAP_A}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ name: `Editado ${sufixo}` })
      .expect(200);
  });

  it('NEGATIVO — `requireAdmin` recusa o produtor nas superfícies de administração', async () => {
    // A TRILHA SAIU DESTA LISTA EM 2026-08-21, e a saída é uma decisão, não um
    // relaxamento: `GET /api/v1/audit` trocou `requireAdmin` por `requireAuditReader`,
    // que dá ao produtor a trilha DA PRÓPRIA OM e nada além dela. Quem afirma o recorte
    // (e que ele não é parâmetro do cliente) é `auditoria-por-om.test.js`; quem afirma
    // os quatro ramos do gate é `auditoria-gate.test.js`. O que continua medido AQUI é a
    // espinha do arquivo: administrar o sistema é outra coisa, e `GET /users` é o par
    // que prova que a recusa não sumiu junto.
    for (const rota of ['/api/v1/users']) {
      await supertest(app).get(rota).set('Authorization', `Bearer ${tokenProdutor}`).expect(403);
      // O par, na mesma rota e no mesmo instante.
      await supertest(app).get(rota).set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    }
  });

  it('MAS a VISIBILIDADE saiu desta lista: ela é manutenção de acervo, não administração', async () => {
    // ESTE CASO INVERTEU EM 2026-08-20, POR DECISÃO DO DONO, e ele afirmava por escrito
    // o contrário ("marcar visibilidade é administração do catálogo, não manutenção de
    // acervo"). O gate deixou de ser `requireAdmin` e passou a ser
    // `requireResourceMaintainer`, com o recorte fino no `WHERE` da própria escrita.
    //
    // A ESCADA TEM DOIS DEGRAUS e este caso mede os dois: 200 na OM DELE, 404 na OM do
    // vizinho (nunca 403, senão a recusa confirmaria a existência da linha). O que
    // continua verdadeiro é a espinha do arquivo, medida no caso acima: o produtor não
    // lista usuários e não lê a trilha.
    const antesA = (await db.query('SELECT access_level FROM tilesets WHERE id = $1', [TILESET_A]))
      .rows[0].access_level;
    assert.equal(antesA, 'public', 'piso: a linha da OM dele começa pública');

    await supertest(app)
      .patch(`/api/v1/resource-access/tileset/${TILESET_A}/visibility`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ accessLevel: 'private' })
      .expect(200);
    assert.equal(
      (await db.query('SELECT access_level FROM tilesets WHERE id = $1', [TILESET_A]))
        .rows[0].access_level,
      'private',
      'e a LINHA muda: um 200 sozinho passaria numa rota que responde e não escreve'
    );

    // A DISCRIMINAÇÃO: a linha da OM B, com o MESMO corpo e o MESMO token.
    await supertest(app)
      .patch(`/api/v1/resource-access/tileset/${TILESET_B}/visibility`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .send({ accessLevel: 'private' })
      .expect(404);
    assert.equal(
      (await db.query('SELECT access_level FROM tilesets WHERE id = $1', [TILESET_B]))
        .rows[0].access_level,
      'public',
      'e ela fica INTACTA — um 404 que já escreveu passaria num teste só de status'
    );

    // E o usuário comum continua sem tocar o eixo: 403 no gate grosso, porque ele não
    // mantém acervo nenhum.
    await supertest(app)
      .patch(`/api/v1/resource-access/tileset/${TILESET_A}/visibility`)
      .set('Authorization', `Bearer ${tokenComum}`)
      .send({ accessLevel: 'public' })
      .expect(403);

    // O administrador continua alcançando as duas, que é o par que prova que a rota
    // funciona e que o recorte é por OM, não por rota quebrada.
    await supertest(app)
      .patch(`/api/v1/resource-access/tileset/${TILESET_A}/visibility`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ accessLevel: 'public' })
      .expect(200);
    await supertest(app)
      .patch(`/api/v1/resource-access/tileset/${TILESET_B}/visibility`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ accessLevel: 'public' })
      .expect(200);
  });

  it('NEGATIVO — o produtor não vira dono de atlas alheio', async () => {
    await supertest(app)
      .get(`/api/v1/atlas/${atlasDoAdmin.id}`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .expect(404);
    await supertest(app)
      .get(`/api/v1/atlas/${atlasDoAdmin.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
  });

  it('NEGATIVO — a LIXEIRA GLOBAL continua sendo do administrador', async () => {
    // `GET /atlas/trash` responde 200 para todo mundo, e a diferença não é o status:
    // é o ESCOPO. O administrador vê os apagados de qualquer dono; o produtor vê só
    // os dele. Medir o status aqui não provaria nada, então a asserção é sobre o
    // conteúdo da lista.
    const doProdutor = await supertest(app)
      .get('/api/v1/atlas/trash').set('Authorization', `Bearer ${tokenProdutor}`).expect(200);
    assert.ok(
      !doProdutor.body.data.some((a) => a.id === atlasApagado.id),
      'o atlas apagado de outra pessoa não aparece para o produtor'
    );

    const doAdmin = await supertest(app)
      .get('/api/v1/atlas/trash').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    assert.ok(
      doAdmin.body.data.some((a) => a.id === atlasApagado.id),
      'e aparece para o administrador — o par que prova que a lista não está vazia por acidente'
    );

    // E restaurar o atlas de outra pessoa não é do produtor. 404 e não 403, pela
    // escada da casa: `RESTORE_ATLAS` casa por (id, dono), então zero linhas — o
    // atlas alheio é indistinguível de um que não existe.
    await supertest(app)
      .post(`/api/v1/atlas/${atlasApagado.id}/restore`)
      .set('Authorization', `Bearer ${tokenProdutor}`)
      .expect(404);
    const { rows } = await db.query('SELECT deleted_at FROM atlas WHERE id = $1', [atlasApagado.id]);
    assert.ok(rows[0].deleted_at, 'e o atlas continua apagado — a recusa é sem efeito');

    // O par que prova que a rota funciona: o administrador desatola.
    await supertest(app)
      .post(`/api/v1/atlas/${atlasApagado.id}/restore`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    const { rows: depois } = await db.query('SELECT deleted_at FROM atlas WHERE id = $1', [atlasApagado.id]);
    assert.equal(depois[0].deleted_at, null);
    await db.query('UPDATE atlas SET deleted_at = NOW() WHERE id = $1', [atlasApagado.id]);
  });

  it('NEGATIVO — `toFrontendRole` não promove o produtor', () => {
    assert.equal(toFrontendRole(null, 'producer'), 'viewer');
    assert.equal(toFrontendRole('read', 'producer'), 'viewer');
    assert.equal(
      toFrontendRole('write', 'producer'), 'editor',
      'a permissão POR ATLAS continua mandando: os dois eixos não se cruzam'
    );
    assert.equal(toFrontendRole('manage', 'producer'), 'manager');
    // Discriminação: o admin global continua curto-circuitando.
    assert.equal(toFrontendRole(null, 'admin'), 'admin');
  });

  it('O CRACHÁ NO TOKEN NÃO É O CRACHÁ: `producer_org_id` forjado não abre nada', async () => {
    // O ANÁLOGO DIRETO DE "O TOKEN SOZINHO NÃO É MAIS ADMIN" (sv360-privado.test.js).
    // `flexibleAuth` não reconcilia e o `auth` estrito adota o escopo do BANCO, mas a
    // garantia de verdade não é nenhum dos dois: é `fn_can_produce_resource`, que
    // resolve papel e escopo a partir do UUID. Um token bem assinado é, no máximo,
    // uma afirmação sobre quem assina.

    // (a) Uma conta que NÃO é produtora, com a claim inventada.
    const comumComCracha = forja({
      sub: comum.id, role: 'user', producer_org_id: orgA,
      organization_id: orgA,
    });
    await supertest(app)
      .put(`/api/v1/basemaps/${BASEMAP_A}`)
      .set('Authorization', `Bearer ${comumComCracha}`)
      .send({ name: 'forjado' })
      .expect(403);

    // (b) O produtor REAL, com o escopo trocado para a OM do vizinho. Ele continua
    // alcançando só a OM que o banco lhe dá.
    const produtorTrocado = forja({
      sub: produtor.id, role: 'producer', producer_org_id: orgB,
      organization_id: orgB,
    });
    const antesB = (await db.query('SELECT name FROM basemaps WHERE id = $1', [BASEMAP_B])).rows[0].name;
    await supertest(app)
      .put(`/api/v1/basemaps/${BASEMAP_B}`)
      .set('Authorization', `Bearer ${produtorTrocado}`)
      .send({ name: 'escopo trocado no token' })
      .expect(404);
    assert.equal(
      (await db.query('SELECT name FROM basemaps WHERE id = $1', [BASEMAP_B])).rows[0].name, antesB,
      'a linha do vizinho não muda nem com a claim apontando para ela'
    );

    // (c) O par POSITIVO: o MESMO token forjado ainda escreve o que a conta de fato
    // produz. Sem ele, "404 em tudo" seria indistinguível de um token quebrado.
    await supertest(app)
      .put(`/api/v1/basemaps/${BASEMAP_A}`)
      .set('Authorization', `Bearer ${produtorTrocado}`)
      .send({ name: `Escrito com o token trocado ${sufixo}` })
      .expect(200);

    // (d) E o `role: 'admin'` forjado sobre uma conta comum não administra: o
    // `auth` estrito adota o papel vivo do banco.
    const comumComAdmin = forja({ sub: comum.id, role: 'admin', organization_id: orgA });
    await supertest(app).get('/api/v1/users').set('Authorization', `Bearer ${comumComAdmin}`).expect(403);
    // O par: o token do administrador de verdade passa.
    await supertest(app).get('/api/v1/users').set('Authorization', `Bearer ${tokenAdmin}`).expect(200);
    // E o usuário comum não ganhou nada de escrita pelo caminho.
    await supertest(app)
      .put(`/api/v1/basemaps/${BASEMAP_A}`)
      .set('Authorization', `Bearer ${tokenComum}`)
      .send({ name: 'comum' })
      .expect(403);
  });
});
