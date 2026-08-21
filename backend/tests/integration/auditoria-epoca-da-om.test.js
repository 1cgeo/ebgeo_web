// Path: tests/integration/auditoria-epoca-da-om.test.js
//
// A TRILHA ANTIGA SEGUE A OM DA ÉPOCA, NUNCA A ATUAL — e este arquivo é a MEDIÇÃO que
// justifica a coluna denormalizada `audit_trail.target_org_id`.
//
// A pergunta que o lote teve de decidir: quando um recurso TROCA de OM, a história dele
// acompanha? A resposta é NÃO, e a razão é o que uma trilha é: o registro de quem
// respondeu por um ato QUANDO ele aconteceu. Se a leitura resolvesse a OM por junta com
// `owner_org_id`, transferir a linha amanhã reescreveria o passado — o produtor que
// mantinha o recurso perderia de vista o que ele próprio fez, e o produtor novo herdaria
// uma história que não é dele. É a mesma razão de `target_name` guardar o nome de então.
//
// A TRANSFERÊNCIA É FEITA POR SQL DIRETO, e isso está declarado em vez de escondido:
// não existe rota administrativa de transferência de `owner_org_id` (o comentário de
// `createCatalogItem` diz que "transferir é ação própria, de administrador", e a ação
// não foi escrita ainda). Num teste de integração o UPDATE direto é aceitável porque o
// que se mede não é o caminho da transferência, e sim o que a trilha faz DEPOIS dela.
//
// O CONTROLE NEGATIVO deste arquivo, para quem for mexer no desenho: trocar a coluna por
// uma junta com `owner_org_id` na leitura INVERTE os dois números medidos abaixo — o
// produtor da OM-A passa a ver zero e o da OM-B passa a ver tudo.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createAdminUser, createProducerUser, loginUser } from '../helpers/fixtures.js';

describe('Auditoria — a história segue a OM da ÉPOCA, não a atual', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  let orgA, orgB;

  const ALVO = `aud-epoca-${sufixo}`;

  const linhasDe = async (quem) => {
    const res = await supertest(app)
      .get(`/api/v1/audit?targetId=${ALVO}`)
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .expect(200);
    return res.body.data.data;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const criaOrg = async (rotulo) => (await db.query(
      'INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id',
      [`OM epoca ${rotulo} ${sufixo}`, `om-ep-${rotulo}-${sufixo}`, `${rotulo}${sufixo.slice(0, 3)}`],
    )).rows[0].id;
    orgA = await criaOrg('a');
    orgB = await criaOrg('b');

    atores.admin = await createAdminUser(db, { username: `ep_admin_${sufixo}` });
    atores.produtorA = await createProducerUser(db, orgA, { username: `ep_prod_a_${sufixo}` });
    atores.produtorB = await createProducerUser(db, orgB, { username: `ep_prod_b_${sufixo}` });
    for (const nome of Object.keys(atores)) {
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }

    // FASE 1 — o recurso nasce e é editado SOB A OM-A. Ele nasce pela rota do produtor
    // da OM-A, que é quem o mantém: assim a OM carimbada vem do caminho real de escrita.
    await supertest(app).post('/api/v1/tilesets')
      .set('Authorization', `Bearer ${tokens.produtorA}`)
      .send({ id: ALVO, name: 'Época v1', config: { url: '/x' } })
      .expect(201);
    await supertest(app).put(`/api/v1/tilesets/${ALVO}`)
      .set('Authorization', `Bearer ${tokens.produtorA}`)
      .send({ name: 'Época v2' })
      .expect(200);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('piso: sob a OM-A, o produtor dela vê as DUAS linhas (criação e edição)', async () => {
    const linhas = await linhasDe('produtorA');
    assert.equal(linhas.length, 2, 'a criação e a edição precisam estar na trilha da OM-A');
    assert.deepEqual(
      linhas.map((l) => l.action).sort(), ['CATALOG_CREATE', 'CATALOG_UPDATE'],
    );
    assert.deepEqual([...new Set(linhas.map((l) => l.target_org_id))], [orgA]);

    // O piso do lado de lá, no mesmo instante: a OM-B ainda não tem nada.
    assert.deepEqual(await linhasDe('produtorB'), [], 'a OM-B não participou de nada ainda');
  });

  it('depois da TRANSFERÊNCIA, a OM-A mantém as 2 antigas e a OM-B recebe SÓ a nova', async () => {
    await db.query('UPDATE tilesets SET owner_org_id = $1::uuid WHERE id = $2', [orgB, ALVO]);

    // Um ato NOVO, agora sob a OM-B. O ator é o administrador porque o produtor da OM-A
    // já não mantém a linha — e essa recusa é, ela mesma, o eixo de produção funcionando.
    await supertest(app).put(`/api/v1/tilesets/${ALVO}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ name: 'Época v3' })
      .expect(200);

    const daA = await linhasDe('produtorA');
    assert.equal(daA.length, 2, 'a história antiga NÃO migrou: a OM-A continua com as 2 linhas dela');
    assert.deepEqual(daA.map((l) => l.action).sort(), ['CATALOG_CREATE', 'CATALOG_UPDATE']);

    const daB = await linhasDe('produtorB');
    assert.equal(daB.length, 1, 'a OM-B responde só pelo que aconteceu DEPOIS da transferência');
    assert.equal(daB[0].action, 'CATALOG_UPDATE');
    assert.equal(daB[0].target_org_id, orgB);

    // O administrador continua vendo as três, que é o que prova que nada sumiu: se a
    // soma não fechasse, os dois números acima poderiam vir de uma linha perdida.
    const todas = await linhasDe('admin');
    assert.equal(todas.length, 3, 'nenhuma linha se perdeu; o que muda é quem a enxerga');
  });
});
