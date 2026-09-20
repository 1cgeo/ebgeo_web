// Path: tests/integration/ordem-das-listas-de-pessoa.repro.test.js
//
// A LISTA VEM NA ORDEM QUE A TELA ESCREVE, e o `ORDER BY` que vem antes de um LIMIT decide
// também QUEM aparece.
//
// CAUSA RAIZ. As telas passaram a nomear pessoa pela forma militar ("Cap Silva") em 2026-09-20,
// e três consultas continuaram ordenando pelo nome CIVIL: a lista de membros do cartão do atlas,
// a busca de pessoas e os membros de grupo. A lista ficava arrumada por uma chave que ninguém
// lê. Nas duas primeiras há um LIMIT depois do ORDER BY, então a chave errada também escolhia
// quais linhas sobravam.
//
// O QUE TORNA ESTE ARQUIVO CAPAZ DE REPROVAR: em toda fixture o nome civil e o nome de guerra
// ordenam em sentidos OPOSTOS, de propósito. Se alguém devolver `ORDER BY nome`, a sequência
// inverte e os casos ficam vermelhos; com nomes que ordenassem igual nos dois campos, passariam
// verdes com qualquer uma das chaves.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createShare, loginUser } from '../helpers/fixtures.js';

describe('as listas de pessoa vêm na ordem que a tela escreve', () => {
  const tag = randomUUID().slice(0, 8);
  let app, db, dono, donoTok, atlas, grupo;
  // `guerra` é o que a tela escreve; `civil` ordena ao CONTRÁRIO dele.
  const PESSOAS = [
    { chave: 'cap', posto: 'Capitão', guerra: `Alfa${tag}`, civil: `Zulmira ${tag}` },
    { chave: 'maj', posto: 'Major', guerra: `Zeta${tag}`, civil: `Amanda ${tag}` },
    { chave: 'ten', posto: 'Primeiro Tenente', guerra: `Mike${tag}`, civil: `Mario ${tag}` },
    { chave: 'civ', posto: null, guerra: null, civil: `Bruno ${tag}` },
  ];
  const ids = {};

  const rankId = async (nome) => {
    const { rows } = await db.query('SELECT id FROM ranks WHERE nome = $1 LIMIT 1', [nome]);
    assert.ok(rows[0], `fixture: o posto semeado "${nome}" tem de existir`);
    return rows[0].id;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db, { username: `ord_dono_${tag}`, nome: `Dono ${tag}` });
    donoTok = await loginUser(app, dono.username, dono.password);
    atlas = await createAtlas(db, dono.id, { name: `Ordem ${tag}` });

    const grupoRes = await supertest(app)
      .post('/api/v1/access-groups')
      .set('Authorization', `Bearer ${donoTok}`)
      .send({ name: `Grupo ordem ${tag}` })
      .expect(201);
    grupo = grupoRes.body.data;

    for (const p of PESSOAS) {
      const u = await createUser(db, {
        username: `ord_${p.chave}_${tag}`,
        nome: p.civil,
        rank_id: p.posto ? await rankId(p.posto) : null,
      });
      if (p.guerra) {
        await db.query('UPDATE users SET nome_guerra = $1 WHERE id = $2', [p.guerra, u.id]);
      }
      ids[p.chave] = u.id;
      await createShare(db, atlas.id, u.id, 'read', dono.id);
      await supertest(app)
        .post(`/api/v1/access-groups/${grupo.id}/members`)
        .set('Authorization', `Bearer ${donoTok}`)
        .send({ userId: u.id })
        .expect(200);
    }
  });

  after(async () => {
    await db.query('DELETE FROM access_groups WHERE id = $1', [grupo.id]);
    await teardownTestEnv(db);
  });

  it('cartão do atlas: o dono primeiro, depois a PRECEDÊNCIA, e quem não tem posto por último', async () => {
    const res = await supertest(app)
      .get('/api/v1/atlas/overview')
      .set('Authorization', `Bearer ${donoTok}`)
      .expect(200);
    const doAtlas = res.body.data.atlases.find((a) => a.id === atlas.id);
    assert.ok(doAtlas, 'o atlas do teste está no overview');
    const ordem = doAtlas.members.map((m) => m.id);

    // Major antes de Capitão antes de Primeiro Tenente, e o sem posto no fim. Pelo nome civil a
    // sequência seria Amanda (maj), Bruno (civ), Mario (ten), Zulmira (cap): o `civ` no MEIO.
    assert.deepEqual(ordem, [dono.id, ids.maj, ids.cap, ids.ten, ids.civ]);
    // A chave de ordenação é da consulta, não dado de pessoa: ela não viaja.
    assert.equal(doAtlas.members[1].posto_ordem, undefined);
  });

  it('busca de pessoas: pela grafia que a tela escreve, o nome de guerra', async () => {
    const res = await supertest(app)
      .get('/api/v1/users/search')
      .query({ q: tag })
      .set('Authorization', `Bearer ${donoTok}`)
      .expect(200);
    const achados = res.body.data.results ?? res.body.data;
    const ordem = achados.map((u) => u.id).filter((id) => Object.values(ids).includes(id));

    // Alfa (cap), Bruno (civ, cai para o civil), Mike (ten), Zeta (maj). Pelo nome civil seria
    // Amanda (maj), Bruno, Mario (ten), Zulmira (cap): o INVERSO nas duas pontas.
    assert.deepEqual(ordem, [ids.cap, ids.civ, ids.ten, ids.maj]);
  });

  it('membros de grupo: a mesma chave da busca', async () => {
    const res = await supertest(app)
      .get(`/api/v1/access-groups/${grupo.id}/members`)
      .set('Authorization', `Bearer ${donoTok}`)
      .expect(200);
    const ordem = res.body.data.map((m) => m.id);
    assert.deepEqual(ordem, [ids.cap, ids.civ, ids.ten, ids.maj]);
  });
});
