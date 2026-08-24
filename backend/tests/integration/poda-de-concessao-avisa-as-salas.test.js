// Path: tests/integration/poda-de-concessao-avisa-as-salas.test.js
//
// OS CINCO PODADORES AVISAM, E ATÉ 2026-08-24 SÓ UM AVISAVA (achado M15, decisão do dono).
//
// `podarPorRaizes` tem cinco chamadores, e o aviso ao vivo morava no controller de
// resource-access, alcançável por exatamente um deles: a revogação deliberada. Os outros
// quatro podavam calados — apagar grupo, tirar membro, desativar conta (`USER_DELETE`) e
// REBAIXAR o papel de quem concedeu (`USER_DEMOTION`) —, e o sintoma era o pior tipo: o
// servidor já recusava a leitura do recurso, e a tela de quem estava com o atlas aberto
// continuava desenhando uma camada quebrada em vez de mostrar a camada ausente.
//
// O rebaixamento é o que mais custa nessa lacuna, e é aritmética: ele derruba de uma vez
// TUDO o que o produtor ou o administrador rebaixado distribuiu, para gente que não fez
// gesto nenhum e não tem por que recarregar a página.
//
// O QUE CADA CASO MEDE, e por que os quatro precisam de caso próprio: cada podador tem um
// conjunto de RAÍZES diferente (a concessão ao grupo, os repasses do membro, tudo o que uma
// conta concedeu, tudo o que um crachá sustentava), e um aviso ligado num deles não diz nada
// sobre os outros três. É a mesma razão de a proibição de lista fechada valer por SÍTIO.
//
// CONTROLE NEGATIVO (rode ao mexer no aviso): comente a chamada de
// `avisarAtlasQueEmprestam` no serviço do caso — `access-groups.service.js` (`deleteGroup` e
// `retirarMembro`) ou `users.service.js` (`updateUser` e `deleteUser`) — e SÓ aquele caso
// fica vermelho, no `waitForType` que expira. É o estado exato de antes desta fase. O piso de
// cada caso (o membro VÊ o recurso pelo empréstimo antes da poda) e o desfecho (ele deixou de
// ver) continuam verdes nos dois estados, e é isso que os torna incapazes de substituir a
// espera pelo frame: a poda sempre funcionou, o que faltava era o aviso.
//
// O caso da revogação deliberada NÃO se repete aqui: ele já é
// `tests/ws/revogacao-avisa-atlas-que-empresta.test.js`, e é lá que moram as duas
// discriminações do FRAME (as chaves da mensagem, e o endereçamento por empréstimo em vez de
// fan-out). Este arquivo assume aquelas e mede só o alcance dos quatro que faltavam.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAdminUser, createAtlas, createShare, createAccessGroup,
  addAccessGroupMember, loginUser,
} from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

// Folgado para um broadcast em memória disparado por uma requisição HTTP local (o irmão em
// `tests/ws/` mediu <100 ms), e continua discriminando: sem a chamada de aviso o frame não
// chega nunca, e nenhuma folga de espera o inventa.
const ESPERA_MS = 1500;

describe('poda de concessão: os quatro podadores silenciosos passaram a avisar as salas', () => {
  let app, db, server;
  let admin, tokenAdmin, dono, membro;
  const sufixo = randomUUID().slice(0, 8);
  const tilesets = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));

    admin = await createAdminUser(db, { username: `poda_admin_${sufixo}` });
    tokenAdmin = await loginUser(app, admin.username, admin.password);
    dono = await createUser(db, { username: `poda_dono_${sufixo}` });
    membro = await createUser(db, { username: `poda_membro_${sufixo}` });
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (tilesets.length > 0) {
      await db.query('DELETE FROM atlas_resources WHERE resource_id = ANY($1::text[])', [tilesets]);
      await db.query('DELETE FROM resource_grants WHERE resource_id = ANY($1::text[])', [tilesets]);
      await db.query('DELETE FROM tilesets WHERE id = ANY($1::text[])', [tilesets]);
    }
    await teardownTestEnv(db);
  });

  /** Um tileset PRIVADO novo, registrado para a limpeza do arquivo. */
  async function tilesetPrivado(marca) {
    const id = `poda-${marca}-${sufixo}`;
    tilesets.push(id);
    await db.query(
      `INSERT INTO tilesets (id, name, config, sort_order, access_level)
       VALUES ($1, $2, '{"url":"/x"}'::jsonb, 0, 'private')`,
      [id, `Tileset ${id}`]
    );
    return id;
  }

  /** Concede, pela rota, no nível pedido. @returns {Promise<string>} O id da concessão. */
  async function conceder(token, tileset, corpo) {
    const res = await supertest(app)
      .post(`/api/v1/resource-access/tileset/${tileset}/grants`)
      .set('Authorization', `Bearer ${token}`)
      .send(corpo)
      .expect(201);
    return res.body.data.id;
  }

  /**
   * O cenário comum dos quatro casos: `dono` (que já recebeu o recurso de alguma forma)
   * anexa o tileset a um atlas seu, e `membro` entra na sala desse atlas com `read`.
   *
   * É o EMPRÉSTIMO (D4) que faz a sala ser o endereço certo: ele vive enquanto o DONO do
   * atlas vir o recurso, então uma poda que atinja o dono derruba o acesso da sala INTEIRA
   * de uma vez, e nenhum daqueles usuários participou do ato que o derrubou.
   *
   * O `dono` CHEGA AQUI SEMPRE COM `view_share`, nos quatro casos, e isso não é folga de
   * fixture: anexar leva gate TRIPLO, e o terceiro (`requireResourceRelay`) exige autoridade
   * para REPASSAR, porque emprestar por atlas É repassar. Com `view` o cenário morre num 403
   * nesta linha, longe do assunto, e o arquivo pareceria estar acusando o aviso.
   */
  async function atlasQueEmpresta(tileset, tokenDono) {
    const atlas = await createAtlas(db, dono.id, { name: `poda ${randomUUID().slice(0, 6)}` });
    await createShare(db, atlas.id, membro.id, 'read', dono.id);
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/resources`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({ resourceType: 'tileset', resourceId: tileset })
      .expect(201);
    return atlas;
  }

  /** O membro enxerga este tileset olhando por dentro deste atlas? */
  async function membroVe(atlasId, tokenMembro, tileset) {
    const res = await supertest(app)
      .get(`/api/v1/resource-access/visible?atlasId=${atlasId}`)
      .set('Authorization', `Bearer ${tokenMembro}`)
      .expect(200);
    return res.body.data.tilesets.some((t) => t.id === tileset);
  }

  /**
   * O corpo compartilhado dos quatro casos, para que a diferença entre eles fique sendo só o
   * ATO que poda. Ele mede, nesta ordem: o piso (o membro vê), o frame (a sala foi acordada)
   * e o desfecho (o membro deixou de ver).
   *
   * O PISO NÃO É CERIMÔNIA. Sem ele, "o frame chegou" seria compatível com um empréstimo que
   * nunca existiu, e o aviso estaria avisando sobre nada; e o desfecho sozinho passaria
   * idêntico no estado ANTERIOR a esta fase, porque a poda sempre funcionou.
   */
  async function medirAviso({ tileset, atlas, tokenMembro, ato }) {
    assert.equal(
      await membroVe(atlas.id, tokenMembro, tileset), true,
      'piso: antes da poda o membro enxerga o recurso pelo empréstimo do atlas'
    );

    const peer = await createWsClient(server, atlas.id, tokenMembro);
    await peer.waitForType('connected');
    peer.clearMessages();

    await ato();

    try {
      await peer.waitForType('atlas_resources_updated', ESPERA_MS);
    } finally {
      peer.close();
    }

    assert.equal(
      await membroVe(atlas.id, tokenMembro, tileset), false,
      'e o aviso anuncia um fato: o recurso saiu do payload do membro'
    );
  }

  it('ACCESS_GROUP_DELETE: apagar o grupo que dava acesso ao dono acorda a sala', async () => {
    const tileset = await tilesetPrivado('grupo-del');
    const tokenDono = await loginUser(app, dono.username, dono.password);
    const tokenMembro = await loginUser(app, membro.username, membro.password);

    const grupo = await createAccessGroup(db, admin.id, { name: `poda del ${sufixo}` });
    await addAccessGroupMember(db, grupo.id, dono.id, admin.id);
    await conceder(tokenAdmin, tileset, { granteeGroupId: grupo.id, grantLevel: 'view_share' });

    const atlas = await atlasQueEmpresta(tileset, tokenDono);

    await medirAviso({
      tileset,
      atlas,
      tokenMembro,
      ato: async () => {
        await supertest(app)
          .delete(`/api/v1/access-groups/${grupo.id}`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(200);
      },
    });
  });

  it('ACCESS_GROUP_MEMBER_REMOVE: tirar o membro derruba o repasse dele, e a sala é avisada', async () => {
    const tileset = await tilesetPrivado('grupo-mem');
    const tokenDono = await loginUser(app, dono.username, dono.password);
    const tokenMembro = await loginUser(app, membro.username, membro.password);

    // A poda deste ato segue a aresta `parent_grant_id`: as raízes são os REPASSES do membro
    // feitos a partir da concessão AO GRUPO. Por isso o dono do atlas não é o membro tirado —
    // ele é o TERCEIRO, que nunca esteve no grupo e é justamente quem perde sem saber.
    const intermediario = await createUser(db, { username: `poda_int_${sufixo}` });
    const tokenIntermediario = await loginUser(app, intermediario.username, intermediario.password);

    const grupo = await createAccessGroup(db, admin.id, { name: `poda mem ${sufixo}` });
    await addAccessGroupMember(db, grupo.id, intermediario.id, admin.id);
    await conceder(tokenAdmin, tileset, { granteeGroupId: grupo.id, grantLevel: 'view_share' });
    await conceder(tokenIntermediario, tileset, { granteeId: dono.id, grantLevel: 'view_share' });

    const atlas = await atlasQueEmpresta(tileset, tokenDono);

    await medirAviso({
      tileset,
      atlas,
      tokenMembro,
      ato: async () => {
        await supertest(app)
          .delete(`/api/v1/access-groups/${grupo.id}/members/${intermediario.id}`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(200);
      },
    });
  });

  it('USER_DELETE: desativar quem concedeu acorda a sala do atlas que emprestava', async () => {
    const tileset = await tilesetPrivado('user-del');
    const tokenDono = await loginUser(app, dono.username, dono.password);
    const tokenMembro = await loginUser(app, membro.username, membro.password);

    const concedente = await createUser(db, { username: `poda_conc_${sufixo}` });
    const tokenConcedente = await loginUser(app, concedente.username, concedente.password);
    await conceder(tokenAdmin, tileset, { granteeId: concedente.id, grantLevel: 'view_share' });
    await conceder(tokenConcedente, tileset, { granteeId: dono.id, grantLevel: 'view_share' });

    const atlas = await atlasQueEmpresta(tileset, tokenDono);

    await medirAviso({
      tileset,
      atlas,
      tokenMembro,
      ato: async () => {
        await supertest(app)
          .delete(`/api/v1/users/${concedente.id}`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(200);
      },
    });
  });

  it('USER_DEMOTION: rebaixar o credenciado que concedeu de raiz acorda a sala', async () => {
    const tileset = await tilesetPrivado('user-dem');
    const tokenDono = await loginUser(app, dono.username, dono.password);
    const tokenMembro = await loginUser(app, membro.username, membro.password);

    // O credenciado concede de RAIZ (não há `view_share` de onde derivar), e é o fundamento
    // dessa raiz — o papel global de dado — que o PUT destrói. Nenhuma linha de concessão é
    // apontada por ninguém: a poda nasce do crachá que caiu.
    const credenciado = await createUser(db, {
      username: `poda_cred_${sufixo}`, role: 'credenciado',
    });
    const tokenCredenciado = await loginUser(app, credenciado.username, credenciado.password);
    await conceder(tokenCredenciado, tileset, { granteeId: dono.id, grantLevel: 'view_share' });

    const atlas = await atlasQueEmpresta(tileset, tokenDono);

    await medirAviso({
      tileset,
      atlas,
      tokenMembro,
      ato: async () => {
        const res = await supertest(app)
          .put(`/api/v1/users/${credenciado.id}`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ role: 'user' })
          .expect(200);
        // O rebaixamento é o único dos quatro em que a poda não é o assunto do pedido, então
        // vale afirmar que ela aconteceu: sem esta linha, um `fundamentoDeRaizPerdido` que
        // parasse de disparar deixaria o caso vermelho no lugar errado (a espera do frame),
        // apontando para o aviso quando o defeito seria do gatilho.
        assert.equal(res.body.data.grantsAffected, 1, 'o rebaixamento derrubou a concessão de raiz');
      },
    });
  });
});
