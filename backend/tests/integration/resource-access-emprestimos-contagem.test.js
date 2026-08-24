// Path: tests/integration/resource-access-emprestimos-contagem.test.js
//
// `GET /resource-access/:type/:id/lending-atlases` — QUANTOS atlas emprestam este recurso.
//
// POR QUE A ROTA EXISTE. A tela "quem tem acesso" lista `resource_grants` e só, enquanto o
// predicado entrega o recurso também a quem abre um atlas que o empresta — inclusive ao
// visitante de link público, que não tem conta para aparecer em lista nenhuma. O aviso da
// tela dizia isso QUALITATIVAMENTE, e a ausência do número era medida: `atlasesLendingResource`
// respondia desde sempre, mas era interna, sem gate, criada para endereçar sala de WS, e um
// número que nenhuma rota entrega é um número inventado.
//
// AS DUAS PROPRIEDADES QUE ESTE ARQUIVO MEDE, e são as duas metades de "promover a interna":
//
//   1. O GATE. `requireResourceShare`, o mesmo da listagem de concessões do mesmo modal: quem
//      pode COMPARTILHAR o recurso (papel global de dado, produção, ou `view_share` vivo).
//      Quem tem só `view` — o nível cuja definição é "vê e NÃO repassa" — leva 403, e o
//      forasteiro também. O par completo está aqui porque o negativo sozinho passaria
//      idêntico se a rota não existisse.
//   2. O RECORTE DO CORPO. Sai `{ count }` e nada mais. QUAIS atlas emprestam é fato sobre
//      projetos de terceiros, e quem pode repassar um recurso não herda por isso o direito de
//      enumerar quem o usa. A asserção é sobre as CHAVES da resposta, não sobre o número:
//      um id que voltasse a viajar teria de derrubar um teste.
//
// E A VIVACIDADE, que é o que separa contagem de histórico: o empréstimo desfeito
// (`removed_at`) e o atlas na lixeira (`deleted_at`) saem da conta. Ela é herdada de
// `ATLASES_LENDING_RESOURCE` porque a rota CONTA a mesma lista em vez de escrever um
// `COUNT(*)` próprio — duas definições dariam um número que discorda de quem o aviso ao vivo
// acorda.
//
// CONTROLE NEGATIVO, conferido revertendo de fato:
//   - trocar `requireResourceShare` por `auth` deixa o caso do `view` e o do forasteiro
//     vermelhos;
//   - devolver a lista em vez do número (`{ atlasIds }`) derruba o caso do recorte;
//   - apagar a rota derruba todos, o piso inclusive.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, loginUser } from '../helpers/fixtures.js';

describe('contagem de atlas que emprestam um recurso', () => {
  let app, db, admin, repassador, sóVe, forasteiro;
  const token = {};
  let atlasA, atlasB, atlasNaLixeira;
  const sufixo = randomUUID().slice(0, 8);
  const TILESET = `cont-${sufixo}`;
  const OUTRO = `cont-outro-${sufixo}`;

  const contar = async (quem, type = 'tileset', id = TILESET, status = 200) => {
    const req = supertest(app).get(`/api/v1/resource-access/${type}/${id}/lending-atlases`);
    if (quem) req.set('Authorization', `Bearer ${token[quem]}`);
    return (await req.expect(status)).body;
  };

  const emprestar = (atlasId, resourceId = TILESET) => supertest(app)
    .post(`/api/v1/atlas/${atlasId}/resources`)
    .set('Authorization', `Bearer ${token.repassador}`)
    .send({ resourceType: 'tileset', resourceId })
    .expect(201);

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    admin = await createAdminUser(db, { username: `cont_admin_${sufixo}` });
    repassador = await createUser(db, { username: `cont_share_${sufixo}` });
    sóVe = await createUser(db, { username: `cont_view_${sufixo}` });
    forasteiro = await createUser(db, { username: `cont_fora_${sufixo}` });
    for (const [nome, u] of Object.entries({ admin, repassador, sóVe, forasteiro })) {
      token[nome] = await loginUser(app, u.username, u.password);
    }

    for (const id of [TILESET, OUTRO]) {
      await db.query(
        `INSERT INTO tilesets (id, name, config, sort_order, access_level)
         VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
        [id, `Tileset ${id}`]
      );
    }

    // OS DOIS NÍVEIS, sobre o MESMO recurso: é a diferença entre eles que o gate mede.
    for (const [quem, nivel] of [[repassador, 'view_share'], [sóVe, 'view']]) {
      await supertest(app)
        .post(`/api/v1/resource-access/tileset/${TILESET}/grants`)
        .set('Authorization', `Bearer ${token.admin}`)
        .send({ granteeId: quem.id, grantLevel: nivel })
        .expect(201);
    }
    // E o recurso VIZINHO, que só existe para provar o recorte por par (tipo, id): sem a
    // concessão, anexá-lo devolveria 404 no gate de ver o recurso.
    await supertest(app)
      .post(`/api/v1/resource-access/tileset/${OUTRO}/grants`)
      .set('Authorization', `Bearer ${token.admin}`)
      .send({ granteeId: repassador.id, grantLevel: 'view_share' })
      .expect(201);

    atlasA = await createAtlas(db, repassador.id, { name: `A cont ${sufixo}` });
    atlasB = await createAtlas(db, repassador.id, { name: `B cont ${sufixo}` });
    atlasNaLixeira = await createAtlas(db, repassador.id, { name: `Lixo cont ${sufixo}` });
  });

  after(async () => {
    await db.query('DELETE FROM atlas_resources WHERE resource_id IN ($1, $2)', [TILESET, OUTRO]);
    await db.query('DELETE FROM resource_grants WHERE resource_id IN ($1, $2)', [TILESET, OUTRO]);
    await db.query('DELETE FROM tilesets WHERE id IN ($1, $2)', [TILESET, OUTRO]);
    await db.query('DELETE FROM atlas WHERE id = ANY($1::uuid[])',
      [[atlasA.id, atlasB.id, atlasNaLixeira.id]]);
    await teardownTestEnv(db);
  });

  it('zero é uma resposta, e não um erro: recurso que ninguém empresta', async () => {
    // O PISO DO ARQUIVO INTEIRO. Sem ele, uma rota que devolvesse sempre zero passaria em
    // todo caso de "sumiu" abaixo, e uma que nunca respondesse passaria em nenhum.
    const corpo = await contar('repassador');
    assert.deepEqual(corpo.data, { count: 0 });
  });

  it('conta os empréstimos VIVOS, e o corpo carrega SÓ o número', async () => {
    await emprestar(atlasA.id);
    await emprestar(atlasB.id);
    await emprestar(atlasNaLixeira.id);
    // O RECURSO VIZINHO é o controle do RECORTE: o par (tipo, id) precisa ser exato, senão
    // a contagem passaria a somar empréstimos de outra coisa.
    await emprestar(atlasA.id, OUTRO);

    const corpo = await contar('repassador');
    assert.deepEqual(corpo.data, { count: 3 });

    // O CORPO NÃO PODE CARREGAR OS IDS. A asserção é sobre as CHAVES: um `atlasIds` que
    // voltasse a viajar (por conveniência de tela, um dia) tem de ficar vermelho aqui.
    assert.deepEqual(Object.keys(corpo.data), ['count']);
  });

  it('atlas na LIXEIRA e empréstimo DESFEITO saem da conta', async () => {
    await supertest(app)
      .delete(`/api/v1/atlas/${atlasNaLixeira.id}`)
      .set('Authorization', `Bearer ${token.repassador}`)
      .expect(204);
    assert.deepEqual((await contar('repassador')).data, { count: 2 });

    await supertest(app)
      .delete(`/api/v1/atlas/${atlasB.id}/resources/tileset/${TILESET}`)
      .set('Authorization', `Bearer ${token.repassador}`)
      .expect(200);
    assert.deepEqual((await contar('repassador')).data, { count: 1 });
  });

  it('o gate é o de COMPARTILHAR: `view` não passa, forasteiro não passa', async () => {
    // `view` é o nível cuja definição é "vê e NÃO repassa": quem só recebeu acesso não
    // precisa saber em quantos projetos alheios o recurso circula.
    await contar('sóVe', 'tileset', TILESET, 403);
    await contar('forasteiro', 'tileset', TILESET, 403);
    await contar(null, 'tileset', TILESET, 401);

    // O POSITIVO DO MESMO PAR, sem o qual os três acima passariam idênticos se a rota
    // tivesse sumido: quem tem `view_share` e quem tem papel global recebem 200.
    assert.equal((await contar('repassador')).data.count, 1);
    assert.equal((await contar('admin')).data.count, 1);
  });

  it('tipo fora da whitelist morre na BORDA (422), não num 500 do predicado', async () => {
    // A ordem `validate` -> gate é a mesma das rotas irmãs, e pelo mesmo motivo:
    // `fn_can_produce_resource` LEVANTA para tipo desconhecido.
    await contar('repassador', 'tipo_inventado', TILESET, 422);
  });
});
