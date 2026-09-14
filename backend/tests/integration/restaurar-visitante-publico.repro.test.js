// Path: tests/integration/restaurar-visitante-publico.repro.test.js
//
// O IRMAO ESQUECIDO DE `clone-visitante-publico.test.js`, uma rota acima no mesmo arquivo.
//
// `POST /atlas/:atlasId/restore` e a unica rota de ESCRITA de `/atlas/:atlasId` sem
// `requireAtlasPermission`, e a ausencia e legitima e esta comentada na rota: o atlas esta
// com `deleted_at` posto, e aquele middleware so enxerga atlas vivo, entao a autoridade tem
// de morar no `WHERE` da consulta (`owner_id = $2`, mais o statement separado do
// administrador). Isso continua correto.
//
// O QUE FALTAVA ERA O PRINCIPAL. `restoreAtlas` passa `req.user.id` CRU, e o visitante de
// link publico carrega um `sub` sintetico `public-<uuid>` que nao e UUID nu. Ele passa o
// `auth` estrito (a confinacao o aprova, porque o atlas da rota E o do token dele) e chega
// ao controller, onde a string bate num `::uuid`: SQLSTATE 22P02.
//
// MEDIDO, e diferente do que o comentario irmao do `/clone` afirma: a borda MAPEIA 22P02
// (`middleware/error-handler.js`), entao o que sai e 400 "Valor mal formado (identificador ou
// tipo invalido)", nao 500. A gravidade e menor que a daquele caso e a classe e a mesma, e a
// distancia entre as duas frases e o defeito: 400 diz que o pedido veio torto, quando o que
// houve foi um principal sem conta pedindo uma acao que exige uma.
//
// NENHUM PRIVILEGIO E GANHO — o predicado de posse nunca casaria com aquela string. O que
// se ganha e a mensagem certa, que e exatamente a distincao que `requireAccountPrincipal`
// foi escrita para fazer no `/clone`, uma rota acima, e que esta nunca recebeu.
//
// A DISCRIMINACAO E OBRIGATORIA e e o caso positivo: o DONO continua restaurando. Um gate
// que recusasse todo mundo passaria verde nos dois casos negativos e teria fechado a unica
// porta que desfaz uma exclusao.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, loginUser, makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';

const SFX = randomUUID().slice(0, 8);

describe('restaurar atlas: o visitante de link publico', () => {
  let app, db, dono, tokenDono, tokenPublico, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db, { username: `rvp_dono_${SFX}` });
    tokenDono = await loginUser(app, dono.username, dono.password);

    atlas = await createAtlas(db, dono.id, { name: `RVP ${SFX}` });
    await createMap(db, atlas.id, { name: 'Mapa' });

    const link = await makeAtlasPublic(db, atlas.id);
    // O token nasce enquanto o atlas esta VIVO, que e a unica forma de ele existir: o
    // `FIND_ATLAS_BY_PUBLIC_LINK` exige `deleted_at IS NULL`. Ele vale uma hora, e a
    // exclusao pelo dono acontece dentro dessa janela.
    tokenPublico = await getPublicToken(app, link);
  });

  after(async () => teardownTestEnv(db));

  const estaVivo = async () => (await db.query(
    'SELECT deleted_at IS NULL AS vivo FROM atlas WHERE id = $1', [atlas.id]
  )).rows[0].vivo;

  const marcarExcluido = () => db.query(
    'UPDATE atlas SET deleted_at = NOW() WHERE id = $1', [atlas.id]
  );

  it('PISO: o token de visitante ALCANCA o atlas (a recusa e do restore, nao do link)', async () => {
    // Sem este piso, um 403 no restore seria indistinguivel de um token invalido, e o caso
    // passaria verde ate com o link publico quebrado.
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${tokenPublico}`)
      .expect(200);
  });

  it('o visitante ANONIMO recebe 403 por gate, e o atlas segue excluido', async () => {
    await marcarExcluido();
    assert.equal(await estaVivo(), false, 'piso: o atlas esta mesmo na lixeira');

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/restore`)
      .set('Authorization', `Bearer ${tokenPublico}`)
      .send({});

    // Antes do gate isto era 400 (22P02 traduzido), medido em 2026-09-13.
    assert.equal(res.status, 403, `esperava 403 por gate; veio ${res.status}`);
    assert.equal(await estaVivo(), false, 'nada foi restaurado');
  });

  it('e recebe 403 tambem com o atlas VIVO: a recusa e do principal, nao do estado', async () => {
    // O 22P02 nao dependia de o atlas estar na lixeira: o cast do parametro acontece antes
    // de qualquer linha ser comparada. Este caso mede a metade que se esquece.
    await db.query('UPDATE atlas SET deleted_at = NULL WHERE id = $1', [atlas.id]);

    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/restore`)
      .set('Authorization', `Bearer ${tokenPublico}`)
      .send({});

    assert.equal(res.status, 403, `esperava 403 por gate; veio ${res.status}`);
  });

  it('o DONO continua restaurando: o gate nao fechou a porta legitima', async () => {
    await marcarExcluido();

    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/restore`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({})
      .expect(200);

    assert.equal(await estaVivo(), true, 'o dono restaurou');
  });
});
