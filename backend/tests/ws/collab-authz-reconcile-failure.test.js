// Path: tests/ws/collab-authz-reconcile-failure.test.js
// Item 99 — `reconcileAuthorization` engolia o erro, e o sweep a disparava sem `await`.
//
// Os dois defeitos apontam para o mesmo lugar: a promessa do `backend/CLAUDE.md` de que
// a revogação de compartilhamento chega ao socket vivo em ~30 s (uma batida de
// heartbeat).
//
//  - ENGOLIR: o `catch` só logava. Enquanto a reconciliação falhasse, `ws.permission`
//    seguia sendo o que o handshake resolveu, então o socket escrevia com permissão
//    revogada por tempo INDEFINIDO — e o sintoma é um log, não uma queda.
//  - SEM `await`: N sockets viravam N queries simultâneas contra um pool de dez, e um
//    sweep ainda drenando quando o próximo começava fazia a revogação levar duas
//    batidas (~60 s) em vez de uma.
//
// A correção é deliberadamente ASSIMÉTRICA, e é essa assimetria que os casos 1 e 2
// prendem juntos: uma falha transitória de banco NÃO pode derrubar todo mundo (o sweep
// toca todos os sockets de uma vez, então um soluço de 200 ms viraria logout coletivo),
// mas uma falha SUSTENTADA precisa fechar. Tolera 1, fecha em N.
//
// INVARIANTE: um socket só continua vivo enquanto a autorização dele é verificável.
// Verificação que falha é falta de verificação, não permissão concedida.
//
// CONTROLE NEGATIVO (executado): com `collab.gateway.js` restaurado do backup (catch
// mudo + sweep sem await), caem 2 dos 4 casos — o do fechamento após N falhas e o do
// sweep aguardado. Restauração por CÓPIA do backup, nunca `git checkout`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import {
  attachWebSocket,
  reconcileAuthorization,
  heartbeatSweep,
} from '../../src/modules/collab/collab.gateway.js';

const U = () => `authz_${randomUUID().slice(0, 8)}`;

// O mesmo número que `AUTHZ_MAX_CONSECUTIVE_FAILURES` no gateway. Duplicado de
// propósito: se alguém afrouxar a constante lá, o caso 2 reprova e obriga a decisão a
// ser explícita, em vez de o teste seguir a mudança em silêncio.
const LIMITE_FALHAS = 3;

// `WHERE u.id = $1` é uma coluna UUID: um id que não é UUID faz o Postgres lançar
// "invalid input syntax for type uuid". É uma falha REAL do banco, do mesmo formato
// que uma indisponibilidade — e não um stub que finge falhar.
const ID_QUE_QUEBRA_A_QUERY = 'nao-e-um-uuid';

describe('falha de reconciliação de autorização (item 99)', () => {
  let app, db, server, wss;
  let owner, atlas, membro, tokenMembro;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    wss = attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));

    owner = await createUser(db, { username: U() });
    atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);
    membro = await createUser(db, { username: U() });
    await createShare(db, atlas.id, membro.id, 'write', owner.id);
    tokenMembro = await loginUser(app, membro.username, membro.password);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  /** Socket falso: só o que `reconcileAuthorization` lê e escreve. */
  function socketFalso(userId) {
    return {
      userId,
      atlasId: atlas.id,
      isPublic: false,
      permission: 'write',
      userRole: 'user',
      organizationId: null,
      authzFailures: 0,
      fechamentos: [],
      close(code, reason) {
        this.fechamentos.push({ code, reason });
      },
    };
  }

  it('uma falha isolada NÃO derruba o socket (transitório é tolerado)', async () => {
    const ws = socketFalso(ID_QUE_QUEBRA_A_QUERY);

    await reconcileAuthorization(ws);

    assert.equal(ws.authzFailures, 1, 'guarda: a falha precisa ter sido CONTADA, senão nada é tolerado nem punido');
    assert.deepEqual(ws.fechamentos, [], 'um soluço de banco não pode derrubar o socket');
    assert.equal(ws.permission, 'write', 'e a permissão em cache segue valendo durante a tolerância');
  });

  it(`${LIMITE_FALHAS} falhas CONSECUTIVAS fecham com 4003`, async () => {
    const ws = socketFalso(ID_QUE_QUEBRA_A_QUERY);

    for (let i = 1; i < LIMITE_FALHAS; i += 1) {
      await reconcileAuthorization(ws);
      assert.deepEqual(ws.fechamentos, [], `fechou cedo demais, na falha ${i}`);
    }

    await reconcileAuthorization(ws);

    assert.equal(ws.authzFailures, LIMITE_FALHAS);
    assert.equal(ws.fechamentos.length, 1, 'o socket precisa cair quando a autorização deixa de ser verificável');
    assert.equal(ws.fechamentos[0].code, 4003, `código errado: ${JSON.stringify(ws.fechamentos[0])}`);
  });

  it('um sucesso ZERA o contador: falhas alternadas nunca acumulam até o limite', async () => {
    // O contador é de falhas CONSECUTIVAS. Se fosse cumulativo, um socket de longa
    // duração acabaria fechado por soluços espalhados por horas — que é justamente o
    // caso que a tolerância existe para proteger.
    const ws = socketFalso(ID_QUE_QUEBRA_A_QUERY);

    for (let ciclo = 0; ciclo < LIMITE_FALHAS + 2; ciclo += 1) {
      ws.userId = ID_QUE_QUEBRA_A_QUERY;
      await reconcileAuthorization(ws);
      await reconcileAuthorization(ws);
      assert.equal(ws.authzFailures, LIMITE_FALHAS - 1, `contagem inesperada no ciclo ${ciclo}`);

      ws.userId = membro.id; // reconciliação que COMPLETA
      await reconcileAuthorization(ws);
      assert.equal(ws.authzFailures, 0, `o sucesso do ciclo ${ciclo} não zerou o contador`);
    }

    assert.deepEqual(ws.fechamentos, [], 'falhas alternadas com sucessos não podem fechar o socket');
  });

  it('o sweep AGUARDA: o rebaixamento já está aplicado quando heartbeatSweep resolve', async () => {
    // Esta é a metade do `await`. Antes, `heartbeatSweep` disparava as reconciliações e
    // voltava; quem esperasse por ela não esperava por nada, e o efeito só aparecia
    // "algum tempo depois" — que é exatamente como uma revogação escorrega para a
    // batida seguinte. Nada de polling aqui, de propósito: o polling esconderia
    // justamente a diferença que o caso mede.
    const client = await createWsClient(server, atlas.id, tokenMembro, `cid-${randomUUID().slice(0, 8)}`);
    const conectado = await client.waitForType('connected');
    assert.equal(conectado.permission, 'write', 'guarda: o socket entra com write');

    const socketServidor = [...wss.clients].find((s) => s.userId === membro.id);
    assert.ok(socketServidor, 'guarda: o socket do membro tem de estar na lista do servidor');

    await db.query(
      'UPDATE atlas_shares SET permission = $1 WHERE atlas_id = $2 AND user_id = $3',
      ['read', atlas.id, membro.id]
    );

    await heartbeatSweep(wss);

    assert.equal(
      socketServidor.permission,
      'read',
      'ao resolver o sweep, o rebaixamento já tem de estar aplicado (sem esperar a próxima batida)'
    );

    await db.query(
      'UPDATE atlas_shares SET permission = $1 WHERE atlas_id = $2 AND user_id = $3',
      ['write', atlas.id, membro.id]
    );
    client.ws.close(1000);
  });
});
