// Path: tests/integration/clone-visitante-publico.test.js
// O visitante ANÔNIMO de link público leva 403 POR GATE, e não 500 por acidente de tipo.
//
// O ESTADO ANTERIOR, e é ele que dá nome ao caso: o visitante passava `auth` (a confinação
// o aprova, porque o atlas da rota É o do token dele) e passava
// `requireAtlasPermission('read')` (o ramo `isPublic` de `resolvePermission`), e só morria
// no INSERT, com `owner_id = 'public-<uuid>'` num cast `::uuid` — SQLSTATE 22P02, que o
// `errorHandler` não mapeia. A diferença entre "esta ação precisa de conta" e "erro interno
// do servidor" é a mensagem que a pessoa lê.
//
// A DISCRIMINAÇÃO é a decisão do dono e não pode faltar: o portador do MESMO link que está
// LOGADO continua clonando. Sem essa metade, um gate que simplesmente recusasse todo mundo
// passaria verde e teria fechado uma porta legítima.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, loginUser, makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';

const SFX = randomUUID().slice(0, 8);

describe('clone por portador de link público', () => {
  let app, db, dono, forasteiro, tokenPublico, tokenForasteiro, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db, { username: `cvp_dono_${SFX}` });
    forasteiro = await createUser(db, { username: `cvp_fora_${SFX}` });
    tokenForasteiro = await loginUser(app, forasteiro.username, forasteiro.password);

    atlas = await createAtlas(db, dono.id, { name: `CVP ${SFX}` });
    await createMap(db, atlas.id, { name: 'Mapa' });

    const link = await makeAtlasPublic(db, atlas.id);
    tokenPublico = await getPublicToken(app, link);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const contarAtlas = async () => {
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM atlas`);
    return rows[0].n;
  };

  it('PISO: o token de visitante ALCANÇA o atlas (a recusa é do clone, não do link)', async () => {
    // Sem este piso, um 403 no clone seria indistinguível de um token inválido, e o caso
    // passaria verde mesmo com o link público quebrado.
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${tokenPublico}`)
      .expect(200);
  });

  it('o visitante ANÔNIMO recebe 403 e NENHUMA linha de atlas é criada', async () => {
    const antes = await contarAtlas();

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/clone`)
      .set('Authorization', `Bearer ${tokenPublico}`)
      .send({});

    assert.equal(res.status, 403, `esperava 403, veio ${res.status}`);
    // NÃO é 500: o caso existe porque a resposta anterior era um 400/500 de cast.
    assert.notEqual(res.status, 500);
    assert.match(res.body?.error?.message ?? '', /conta/i);

    // Uma meia-linha criada antes do estouro seria pega aqui, e era o estado de hoje.
    assert.equal(await contarAtlas(), antes);
  });

  it('DISCRIMINAÇÃO: o portador LOGADO do mesmo link clona, e o clone nasce com dono', async () => {
    // O único vínculo dele com o atlas é o link público (nenhuma linha em `atlas_shares`).
    const antes = await contarAtlas();
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/clone`)
      .set('Authorization', `Bearer ${tokenForasteiro}`)
      .send({})
      .expect(201);

    assert.equal(await contarAtlas(), antes + 1);
    const { rows } = await db.query(`SELECT owner_id FROM atlas WHERE id = $1`, [res.body.data.id]);
    assert.equal(rows[0].owner_id, forasteiro.id);
  });

  it('a ordem dos gates é contrato: o atlas do PRÓPRIO link, apagado, responde 404 e não 403', async () => {
    // O SUJEITO DESTE CASO FOI TROCADO, e a troca é a coisa toda. A versão anterior pedia o
    // clone de um `randomUUID()` com o token público e aceitava `[403, 404]` — uma disjunção
    // que passa nos dois mundos e portanto não prende nenhum. Pior: aquele sujeito NUNCA
    // alcança o par de gates. `confineVisitorPrincipal` (`middleware/auth.js`) devolve 403
    // dentro do próprio `auth` quando o atlas da rota não é o do token, então o caso não
    // podia discriminar nem em princípio: inverter a ordem dos dois middlewares deixava-o
    // VERDE (medido).
    //
    // O ÚNICO sujeito que chega aos dois gates com um token público é o atlas DO PRÓPRIO
    // LINK, apagado: a confinação aprova (o id bate), `requireAtlasPermission` filtra por
    // `deleted_at IS NULL` e responde 404, e `requireAccountPrincipal` nunca roda. Com a
    // ordem invertida a resposta seria 403, revelando que a ação exige conta sobre um atlas
    // que, para este chamador, deixou de existir.
    await db.query(`UPDATE atlas SET deleted_at = NOW() WHERE id = $1`, [atlas.id]);
    try {
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/clone`)
        .set('Authorization', `Bearer ${tokenPublico}`)
        .send({});
      assert.equal(res.status, 404, `esperava 404, veio ${res.status}`);
    } finally {
      await db.query(`UPDATE atlas SET deleted_at = NULL WHERE id = $1`, [atlas.id]);
    }

    // PISO da restauração: sem ela um `finally` quebrado deixaria o próximo caso medindo
    // outro estado, e o vermelho apareceria longe daqui.
    const { rows } = await db.query(`SELECT deleted_at FROM atlas WHERE id = $1`, [atlas.id]);
    assert.equal(rows[0].deleted_at, null);
  });
});
