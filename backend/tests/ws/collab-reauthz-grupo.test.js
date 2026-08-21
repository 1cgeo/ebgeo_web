// Path: tests/ws/collab-reauthz-grupo.test.js
//
// O EIXO DE GRUPO NO HEARTBEAT DO SOCKET.
//
// POR QUE ESTE ARQUIVO EXISTE, e o motivo é o desfecho, não a cobertura: o socket de
// colaboração resolve permissão DUAS vezes — no handshake e a cada tick de ~30 s
// (`reconcileAuthorization`). Se o ramo de grupo existisse só no handshake, a pessoa
// entraria, trabalharia e cairia meio minuto depois com "access revoked", sem nada na tela
// que ligasse a queda ao grupo. Sintoma longe da causa é o perfil de defeito que esta casa
// paga mais caro.
//
// O irmão `collab-reauthz.test.js` NÃO pode ficar vermelho por causa desta onda: ele é o
// controle de que o eixo DIRETO não se moveu enquanto o de grupo entrava.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createShare,
  createAccessGroup, addAccessGroupMember, createGroupShare,
} from '../helpers/fixtures.js';
import { reconcileAuthorization } from '../../src/modules/collab/collab.gateway.js';

const U = () => `wsg_${randomUUID().slice(0, 8)}`;

/** Minimal stand-in for a connected ws: records the last close() call. */
function fakeSocket(overrides) {
  return {
    isPublic: false,
    organizationId: null,
    closed: null,
    close(code, reason) { this.closed = { code, reason }; },
    ...overrides,
  };
}

describe('Collab WS · reautorização com share por GRUPO', () => {
  let db, dono, atlas;

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;
    dono = await createUser(db, { username: U() });
    atlas = await createAtlas(db, dono.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('o heartbeat RESOLVE o writer que entrou por grupo (e não só deixa de fechá-lo)', async () => {
    // O SOCKET ENTRA ABAIXO DO QUE O BANCO DIZ, DE PROPÓSITO, e essa é a única forma deste
    // caso medir uma ESCRITA em vez de uma ausência de escrita. Medido: montando o socket
    // já em `write` e afirmando `write`, as duas asserções eram sobre o valor que o próprio
    // teste tinha posto, e o caso ficava VERDE com a resolução do gateway lançando em 100%
    // das chamadas (`reconcileAuthorization` engole a exceção e só fecha na terceira falha
    // consecutiva). Entrando em `read`, só uma reconciliação que de fato consultou o banco
    // devolve `write`.
    //
    // `authzFailures === 0` é o segundo discriminador, e é barato: ele só é escrito no ramo
    // de SUCESSO. Sem ele, um `catch` silencioso que deixasse o socket intacto passaria em
    // qualquer caso que apenas afirmasse "não fechou".
    const x = await createUser(db, { username: U() });
    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, x.id, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'write', dono.id);

    const ws = fakeSocket({ atlasId: atlas.id, userId: x.id, permission: 'read' });
    await reconcileAuthorization(ws);
    assert.equal(ws.permission, 'write', 'o tick SOBE o socket para o que o grupo dá');
    assert.equal(ws.closed, null, 'quem alcança por grupo não pode cair no primeiro tick');
    assert.equal(ws.authzFailures, 0, 'a reconciliação VERIFICOU: não falhou calada');

    // DISCRIMINAÇÃO (1): um writer com share DIRETO, na MESMA rodada, continua aberto. Sem
    // ele, um gateway quebrado que abrisse tudo passaria igual.
    const direto = await createUser(db, { username: U() });
    await createShare(db, atlas.id, direto.id, 'write', dono.id);
    const wsDireto = fakeSocket({ atlasId: atlas.id, userId: direto.id, permission: 'read' });
    await reconcileAuthorization(wsDireto);
    assert.equal(wsDireto.permission, 'write');
    assert.equal(wsDireto.closed, null);
    assert.equal(wsDireto.authzFailures, 0);
  });

  it('perder a adesão ao grupo FECHA (4003) quando o grupo era o único caminho', async () => {
    const x = await createUser(db, { username: U() });
    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, x.id, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'write', dono.id);

    const ws = fakeSocket({ atlasId: atlas.id, userId: x.id, permission: 'write' });
    await reconcileAuthorization(ws);
    assert.equal(ws.closed, null, 'piso: aberto antes do ato');

    await db.query('DELETE FROM access_group_members WHERE group_id = $1 AND user_id = $2', [g.id, x.id]);
    await reconcileAuthorization(ws);
    assert.equal(ws.closed?.code, 4003);
    assert.equal(ws.closed?.reason, 'access revoked');
  });

  it('apagar o GRUPO tem o mesmo efeito de perder a adesão', async () => {
    const x = await createUser(db, { username: U() });
    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, x.id, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'manage', dono.id);

    // Mesma razão do primeiro caso: o piso entra ABAIXO do que o banco dá, senão ele afirma
    // o valor que o próprio teste escreveu.
    const ws = fakeSocket({ atlasId: atlas.id, userId: x.id, permission: 'read' });
    await reconcileAuthorization(ws);
    assert.equal(ws.permission, 'manage', 'piso: manage por grupo vale no socket');
    assert.equal(ws.authzFailures, 0, 'piso: a reconciliação rodou de verdade');

    await db.query('UPDATE access_groups SET deleted_at = NOW() WHERE id = $1', [g.id]);
    await reconcileAuthorization(ws);
    assert.equal(ws.closed?.code, 4003, 'grupo apagado derruba, e derruba por resolução');
  });

  it('REBAIXA em vez de fechar quando existe share direto menor por baixo', async () => {
    // ESTE É O CASO QUE A IMPLEMENTAÇÃO INGÊNUA ERRA. Um `if (perdeuGrupo) close()` passaria
    // nos dois casos acima e mataria a sessão de quem nunca deixou de ter acesso: X mantém
    // `read` direto e só perde o degrau extra que o grupo dava.
    const x = await createUser(db, { username: U() });
    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, x.id, dono.id);
    await createShare(db, atlas.id, x.id, 'read', dono.id);
    await createGroupShare(db, atlas.id, g.id, 'write', dono.id);

    const ws = fakeSocket({ atlasId: atlas.id, userId: x.id, permission: 'comment' });
    await reconcileAuthorization(ws);
    assert.equal(ws.permission, 'write', 'piso: o tick resolve o MAIOR dos dois caminhos');

    await db.query('DELETE FROM access_group_members WHERE group_id = $1 AND user_id = $2', [g.id, x.id]);
    await reconcileAuthorization(ws);
    assert.equal(ws.permission, 'read', 'rebaixa para o share direto');
    assert.equal(ws.closed, null, 'e NÃO fecha: quem tem caminho vivo continua conectado');
  });

  it('promover o grupo SOBE o nível no socket aberto, sem reconexão', async () => {
    const x = await createUser(db, { username: U() });
    const g = await createAccessGroup(db, dono.id);
    await addAccessGroupMember(db, g.id, x.id, dono.id);
    await createGroupShare(db, atlas.id, g.id, 'read', dono.id);

    const ws = fakeSocket({ atlasId: atlas.id, userId: x.id, permission: 'read' });
    await reconcileAuthorization(ws);
    assert.equal(ws.permission, 'read', 'piso');

    await db.query('UPDATE atlas_shares SET permission = $1 WHERE atlas_id = $2 AND group_id = $3',
      ['manage', atlas.id, g.id]);
    await reconcileAuthorization(ws);
    assert.equal(ws.permission, 'manage');
    assert.equal(ws.closed, null);
  });
});
