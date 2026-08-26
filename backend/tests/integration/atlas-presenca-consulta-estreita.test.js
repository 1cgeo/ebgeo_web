// Path: tests/integration/atlas-presenca-consulta-estreita.test.js
//
// A PRESENCA PEDE SO OS IDS, e o alcance que ela enxerga continua sendo o mesmo do cartao.
//
// O DEFEITO. `listUserAtlasPresence` rodava `LIST_USER_ATLAS` inteiro, que e `SELECT a.*`
// mais `JOIN users` mais `ORDER BY`. O laco que consome o resultado le UM campo:
// `atlas.id`. Tudo o mais (o `settings` jsonb, `map_order`, `description`, os dois campos
// do dono) atravessava a rede para ser descartado. E a mesma consulta ja saiu por
// `GET /atlas`, e o poll de presenca a repetia a cada 20 s, por aba aberta.
//
// O PESO, MEDIDO no banco de desenvolvimento em 2026-08-25 (10 atlas vivos, de 19 linhas):
//   `sum(pg_column_size(a.*))`        5984 bytes
//   `sum(pg_column_size(a.id))`        160 bytes
//   `sum(pg_column_size(a.settings))` 4504 bytes
// O `settings` sozinho e 75% da linha, e `a.id` e 2,7% dela. O eixo aqui e o PESO da
// linha, nunca a contagem de consultas: a presenca continua custando as mesmas duas
// consultas por requisicao (o estado vivo de autorizacao, mais esta).
//
// POR QUE O PREDICADO E COPIADO EM VEZ DE REAPROVEITADO. `LIST_USER_ATLAS` sai INTEIRA
// pela rota `GET /atlas` e cinco superficies do cliente a consomem, entao enumerar
// colunas la seria adivinhar quais campos elas leem, e um campo esquecido vira
// `undefined` silencioso no cliente, nunca erro. A consulta nova fica ao lado, e o preco
// dessa copia e o risco de DIVERGIR: um predicado diferente faria a presenca aparecer em
// atlas que o cartao nao desenha, ou sumir de atlas que ele desenha. Os tres casos de
// alcance abaixo sao o que vigia isso, e o caso do GRUPO e o que pega a divergencia
// classica — o membro por grupo, que um JOIN cru sobre `atlas_shares` nao ve.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createShare, loginUser,
  createAccessGroup, addAccessGroupMember, createGroupShare,
} from '../helpers/fixtures.js';
import { installPoolQueryCounter } from '../helpers/query-counter.js';
import { joinRoom, leaveRoom } from '../../src/modules/collab/collab.rooms.js';
import { query as queryDoApp } from '../../src/database/index.js';

const SFX = randomUUID().slice(0, 8);

/** A consulta larga do cartao, que a presenca nao pode mais disparar. */
const CONSULTA_LARGA = /^SELECT a\.\*, u\.nome as owner_nome/i;
/** A consulta estreita que a substitui. */
const CONSULTA_ESTREITA = /^SELECT a\.id FROM atlas a/i;

/** Um socket de sala, com a forma que `getRoomUsers` le. */
const socketFalso = (clientId, usuario) => ({
  readyState: 1,
  userId: usuario.id,
  clientId,
  userName: usuario.nome,
  userPosto: null,
});

describe('a presenca nao arrasta a linha inteira do atlas', () => {
  let app, db, contador;
  let dono, donoToken, leitor, leitorToken, membro, membroToken, estranho, estranhoToken;
  let atlas, atlasDeGrupo;

  const presenca = (token) => supertest(app)
    .get('/api/v1/atlas/presence')
    .set('Authorization', `Bearer ${token}`)
    .expect(200)
    .then((res) => res.body.data);

  const lista = (estado) => estado.statements.join(' | ');

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    dono = await createUser(db, { username: `pres_dono_${SFX}`, nome: 'Ana Dona' });
    leitor = await createUser(db, { username: `pres_leitor_${SFX}`, nome: 'Beto Leitor' });
    membro = await createUser(db, { username: `pres_membro_${SFX}`, nome: 'Caio Membro' });
    estranho = await createUser(db, { username: `pres_estranho_${SFX}`, nome: 'Dino Estranho' });
    donoToken = await loginUser(app, dono.username, dono.password);
    leitorToken = await loginUser(app, leitor.username, leitor.password);
    membroToken = await loginUser(app, membro.username, membro.password);
    estranhoToken = await loginUser(app, estranho.username, estranho.password);

    atlas = await createAtlas(db, dono.id, { name: `Presenca ${SFX}` });
    await createShare(db, atlas.id, leitor.id, 'read', dono.id);

    // O alcance por GRUPO: nenhuma linha de `atlas_shares` aponta para o membro.
    atlasDeGrupo = await createAtlas(db, dono.id, { name: `Presenca grupo ${SFX}` });
    const grupo = await createAccessGroup(db, dono.id, { name: `Coletivo ${SFX}` });
    await addAccessGroupMember(db, grupo.id, membro.id, dono.id);
    await createGroupShare(db, atlasDeGrupo.id, grupo.id, 'read', dono.id);

    // O contador entra DEPOIS das fixturas, que escrevem e legitimamente.
    contador = installPoolQueryCounter();
  });

  after(async () => {
    if (contador) contador.restore();
    await teardownTestEnv(db);
  });

  it('discriminacao: o contador ENXERGA a consulta larga quando ela roda', async () => {
    // Sem este caso, a lista vazia do teste seguinte passaria verde tambem com o
    // contador cego, ou com o padrao escrito errado.
    contador.reset();
    await queryDoApp(
      'SELECT a.*, u.nome as owner_nome FROM atlas a JOIN users u ON u.id = a.owner_id WHERE a.id = $1',
      [atlas.id]
    );
    assert.equal(
      contador.state.statements.filter((s) => CONSULTA_LARGA.test(s)).length, 1,
      'o padrao da consulta larga precisa casar de verdade'
    );
  });

  it('GET /atlas/presence nao roda mais `SELECT a.*` e pede so os ids', async () => {
    contador.reset();
    await presenca(donoToken);

    assert.deepEqual(
      contador.state.statements.filter((s) => CONSULTA_LARGA.test(s)), [],
      `a presenca le UM campo e nao pode pedir a linha inteira: ${lista(contador.state)}`
    );
    assert.equal(
      contador.state.statements.filter((s) => CONSULTA_ESTREITA.test(s)).length, 1,
      `a presenca precisa rodar a consulta estreita, uma vez: ${lista(contador.state)}`
    );
  });

  // ==========================================================================
  // Paridade de alcance: o predicado copiado tem de ver o MESMO conjunto.
  // ==========================================================================
  it('o dono ve quem esta conectado ao seu atlas', async () => {
    const aba = socketFalso(`c-${randomUUID().slice(0, 8)}`, leitor);
    joinRoom(atlas.id, aba);
    try {
      const p = await presenca(donoToken);
      assert.equal(p[atlas.id]?.length, 1);
      assert.equal(p[atlas.id][0].id, String(leitor.id));
    } finally {
      leaveRoom(atlas.id, aba);
    }
  });

  it('quem entra por COMPARTILHAMENTO DIRETO tambem ve', async () => {
    const aba = socketFalso(`c-${randomUUID().slice(0, 8)}`, dono);
    joinRoom(atlas.id, aba);
    try {
      const p = await presenca(leitorToken);
      assert.equal(p[atlas.id]?.length, 1, 'o leitor alcanca o atlas, logo alcanca a presenca dele');
    } finally {
      leaveRoom(atlas.id, aba);
    }
  });

  it('quem entra por GRUPO ve, e e este o caso que um predicado divergente perde', async () => {
    const aba = socketFalso(`c-${randomUUID().slice(0, 8)}`, dono);
    joinRoom(atlasDeGrupo.id, aba);
    try {
      const p = await presenca(membroToken);
      assert.equal(
        p[atlasDeGrupo.id]?.length, 1,
        'o alcance vem de fn_user_atlas_shares, que soma o braco de grupo'
      );
    } finally {
      leaveRoom(atlasDeGrupo.id, aba);
    }
  });

  it('o estranho nao ve presenca nenhuma', async () => {
    const aba = socketFalso(`c-${randomUUID().slice(0, 8)}`, dono);
    joinRoom(atlas.id, aba);
    try {
      const p = await presenca(estranhoToken);
      assert.equal(p[atlas.id], undefined, 'a consulta estreita ainda e o filtro de escopo');
      assert.deepEqual(Object.keys(p), []);
    } finally {
      leaveRoom(atlas.id, aba);
    }
  });
});
