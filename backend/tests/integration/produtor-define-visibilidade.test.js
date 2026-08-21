// Path: tests/integration/produtor-define-visibilidade.test.js
//
// MARCAR PÚBLICO OU PRIVADO É MANUTENÇÃO DE ACERVO, NÃO ADMINISTRAÇÃO DO SISTEMA.
//
// A rota `PATCH /resource-access/:type/:id/visibility` era `requireAdmin`, e a decisão
// do dono (2026-08-20) a moveu para o eixo de PRODUÇÃO: quem mantém o que a OM produziu
// decide o que dela é público. O eixo de CONCESSÃO continua à parte — tornar privado
// não concede nada a ninguém, e conceder não muda a visibilidade.
//
// A ESCADA TEM DOIS DEGRAUS, e cada um responde uma coisa: `requireResourceMaintainer`
// recusa cedo (403) quem não mantém acervo NENHUM, e o `WHERE` da própria escrita
// (`fn_can_produce_resource`) decide QUAL linha é dele, devolvendo 404 para a de outra
// OM. Um gate fino no lugar do grosso responderia 403 sobre recurso de outra OM e
// confirmaria a existência do que o 404 esconde.
//
// TODO STATUS VEM COM A LINHA CONFERIDA NO BANCO. Um 404 que já escreveu passa
// idêntico num teste que mede só o status, e é o modo de falha mais barato de acreditar
// quando o gate mora no `WHERE`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createProducerUser, loginUser,
} from '../helpers/fixtures.js';

describe('F17 — o produtor define a visibilidade do acervo da OM dele', () => {
  let app, db;
  const sufixo = randomUUID().slice(0, 8);
  const atores = {};
  const tokens = {};
  let orgA, orgB;

  const DELE = `vis-a-${sufixo}`;
  const DO_VIZINHO = `vis-b-${sufixo}`;
  const INSTITUCIONAL = `vis-inst-${sufixo}`;

  /** PATCH da visibilidade de um tileset, como `quem`. */
  const marcar = (quem, id, accessLevel) => supertest(app)
    .patch(`/api/v1/resource-access/tileset/${id}/visibility`)
    .set('Authorization', `Bearer ${tokens[quem]}`)
    .send({ accessLevel });

  const nivelDe = async (id) => (await db.query(
    'SELECT access_level FROM tilesets WHERE id = $1', [id],
  )).rows[0].access_level;

  /** Os ids de tileset que `quem` enxerga no payload aditivo (só privado). */
  async function privadosVisiveis(quem) {
    const res = await supertest(app)
      .get('/api/v1/resource-access/visible')
      .set('Authorization', `Bearer ${tokens[quem]}`)
      .expect(200);
    return res.body.data.tilesets.map((t) => t.id);
  }

  /** Os ids de tileset do documento PÚBLICO de boot. */
  async function tilesetsDoConfig() {
    const res = await supertest(app).get('/api/config').expect(200);
    return (res.body.data ?? res.body).tilesets.map((t) => t.id);
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const criaOrg = async (rotulo) => (await db.query(
      `INSERT INTO organizations (nome, slug, sigla) VALUES ($1, $2, $3) RETURNING id`,
      [`OM vis ${rotulo} ${sufixo}`, `om-vis-${rotulo}-${sufixo}`, `${rotulo}${sufixo.slice(0, 3)}`],
    )).rows[0].id;
    orgA = await criaOrg('a');
    orgB = await criaOrg('b');

    atores.admin = await createAdminUser(db, { username: `vis_admin_${sufixo}` });
    atores.credenciado = await createUser(db, {
      username: `vis_cred_${sufixo}`, role: 'credenciado',
    });
    atores.comum = await createUser(db, { username: `vis_comum_${sufixo}` });
    atores.produtor = await createProducerUser(db, orgA, { username: `vis_prod_${sufixo}` });
    for (const nome of Object.keys(atores)) {
      tokens[nome] = await loginUser(app, atores[nome].username, atores[nome].password);
    }

    for (const [id, org] of [[DELE, orgA], [DO_VIZINHO, orgB], [INSTITUCIONAL, null]]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, sort_order, owner_org_id)
         VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, $3::uuid)`,
        [id, `Tileset ${id}`, org],
      );
    }
  });

  after(async () => {
    await db.query('DELETE FROM resource_grants WHERE resource_id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM tilesets WHERE id LIKE $1', [`%${sufixo}%`]);
    await db.query('DELETE FROM users WHERE producer_org_id = ANY($1::uuid[])', [[orgA, orgB]]);
    await db.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [[orgA, orgB]]);
    await teardownTestEnv(db);
  });

  it('o produtor marca privado o recurso da OM DELE, e a LINHA muda', async () => {
    // O PISO SÃO DOIS FATOS, e sem os dois o 200 abaixo também é o que se mede numa
    // fixture que já nascia privada ou numa conta que não produz nada.
    assert.equal(await nivelDe(DELE), 'public', 'piso: a linha começa pública');
    await supertest(app)
      .put(`/api/v1/tilesets/${DELE}`)
      .set('Authorization', `Bearer ${tokens.produtor}`)
      .send({ name: `Editado ${sufixo}` })
      .expect(200);

    await marcar('produtor', DELE, 'private').expect(200);
    assert.equal(await nivelDe(DELE), 'private', 'a linha da OM dele MUDOU');

    // A DISCRIMINAÇÃO: o mesmo token, o mesmo corpo, sobre a linha do vizinho e sobre a
    // institucional (`owner_org_id` NULL). 404 nas duas, e as duas INTACTAS depois.
    for (const id of [DO_VIZINHO, INSTITUCIONAL]) {
      await marcar('produtor', id, 'private').expect(404);
      assert.equal(await nivelDe(id), 'public', `${id} continua intacta depois do 404`);
    }

    // E o ADMINISTRADOR alcança as três, que é o par que prova que a rota funciona e
    // que o recorte é por OM e não por rota quebrada.
    for (const id of [DELE, DO_VIZINHO, INSTITUCIONAL]) {
      await marcar('admin', id, 'private').expect(200);
      assert.equal(await nivelDe(id), 'private');
    }
    // Volta ao estado inicial das duas de CONTROLE; a linha da OM dele fica PRIVADA,
    // que é o piso do caso seguinte.
    for (const id of [DO_VIZINHO, INSTITUCIONAL]) {
      await marcar('admin', id, 'public').expect(200);
      assert.equal(await nivelDe(id), 'public');
    }
    assert.equal(await nivelDe(DELE), 'private');
  });

  it('o credenciado, que LÊ todo o privado, continua sem tocar este eixo', async () => {
    // O PISO É ELE ENXERGAR O RECURSO. Sem isso, o 403 abaixo é o de alguém que não
    // conhece a linha, e o caso não distinguiria "papel que lê tudo e não escreve" de
    // "fixture invisível".
    assert.equal(await nivelDe(DELE), 'private', 'piso: a linha está privada');
    assert.ok(
      (await privadosVisiveis('credenciado')).includes(DELE),
      'piso: o credenciado enxerga o recurso privado, por papel global de DADO',
    );

    await marcar('credenciado', DELE, 'public').expect(403);
    assert.equal(await nivelDe(DELE), 'private', 'e a recusa é sem efeito');

    // O usuário comum leva o MESMO 403, e pelo mesmo gate grosso: nenhum dos dois
    // mantém acervo.
    await marcar('comum', DELE, 'public').expect(403);
    assert.equal(await nivelDe(DELE), 'private');

    // A DISCRIMINAÇÃO, no mesmo instante e com o mesmo corpo: o produtor da OM dona
    // passa. Sem ela, "403 para o credenciado" seria compatível com uma rota fechada
    // para todo mundo menos o administrador — que é exatamente o estado anterior.
    await marcar('produtor', DELE, 'public').expect(200);
    assert.equal(await nivelDe(DELE), 'public');
  });

  it('o flip do produtor vale no caminho de LEITURA, não só na coluna', async () => {
    // ESTE CASO MEDE O EFEITO NO PREDICADO E A INVALIDAÇÃO DO MEMO. Uma escrita que
    // gravasse a coluna sem invalidar o cache do `/api/config` passaria nos dois casos
    // acima e falha neste.
    assert.equal(await nivelDe(DELE), 'public', 'piso: a linha está pública');
    assert.ok(
      (await tilesetsDoConfig()).includes(DELE),
      'piso: o documento de boot, que é público e memoizado, entrega o recurso',
    );

    await marcar('produtor', DELE, 'private').expect(200);

    assert.ok(
      !(await tilesetsDoConfig()).includes(DELE),
      'depois do flip o documento público deixa de entregá-lo — o memo foi invalidado',
    );
    // A DISCRIMINAÇÃO: quem tem direito continua alcançando o recurso pelo payload
    // aditivo. Sem ela, "sumiu do config" seria compatível com o recurso ter sido
    // desativado ou apagado pelo caminho.
    assert.ok(
      (await privadosVisiveis('produtor')).includes(DELE),
      'e o produtor continua enxergando, pelo ramo de PRODUÇÃO do predicado',
    );
    assert.ok(
      !(await privadosVisiveis('comum')).includes(DELE),
      'enquanto o usuário comum não recebe o recurso por caminho nenhum',
    );

    // O CONTROLE DA REVERSÃO: publicar de novo devolve o item ao documento de boot.
    await marcar('produtor', DELE, 'public').expect(200);
    assert.ok((await tilesetsDoConfig()).includes(DELE));
  });
});
