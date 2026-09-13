// Path: tests/integration/catalogo-array-recusada.repro.test.js
//
// ESTE ARQUIVO TROCOU DE ASSUNTO EM 2026-09-13, e a história importa porque ela é o argumento.
// Ele se chamava `catalogo-array-nao-ressuscita.repro.test.js` e media um defeito real: a forma
// ARRAY de `catalogLayer` (`data.catalog_layers`, o atalho de compatibilidade do cliente pré-F11)
// fazia `ON CONFLICT ... DO UPDATE SET data = EXCLUDED.data, deleted_at = NULL` sem `WHERE`, então
// UMA op ressuscitava toda camada apagada cujo id ela por acaso nomeasse, com a definição velha do
// remetente, e o cliente recebia sucesso. Aquele conserto foi feito (a política de UPDATE da forma
// por camada), e o que ele NÃO podia consertar é o motivo de a forma sair agora (B5, item 5).
//
// POR QUE A FORMA SAIU. Ela NÃO ENDEREÇA UMA LINHA. O `entityId` dela é o id do mapa ou um UUID
// descartável, e o payload é a lista inteira: não há entidade sobre a qual observar uma base, e
// portanto não há o que a verificação por base e revisão compare. O replay LITERAL era barrado uma
// camada acima, pelo recibo; o FORA DE ORDEM não era, e continuava escrevendo a linha viva com o
// que o remetente ainda carregava. Era o único ponto do modelo de conflito que nenhuma
// contabilidade de fronteira podia fechar, porque o buraco é a ausência de endereço.
//
// E NENHUM CLIENTE VIVO A EMITE: o cliente de hoje escreve `mapData.catalogLayers` entrada por
// entrada (`frontend/src/js/store/catalog.operations.js`), e não há produtor da forma de lista em
// `frontend/src/` (varrido nos dois pacotes em 2026-09-13). A escolha era manter um caminho de
// escrita inverificável para ninguém ou recusá-lo por nome, e a recusa por nome o cliente já sabe
// mostrar.
//
// CONTROLE NEGATIVO, medido em 2026-09-13 tirando `catalogLayerArrayDenialReason` de `recusaPura`:
// os três primeiros casos ficam VERMELHOS (a op volta aceita e nada é escrito, porque o ramo de
// array já não existe no handler, que é o desfecho pior de todos: acked e mudo). O quarto, o da
// forma por camada, segue verde, e é ele que prova que a recusa é sobre a LISTA e não sobre a
// entidade inteira.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

const RECUSA = 'Alteração descartada: a lista inteira de camadas de catálogo não é mais aceita; '
  + 'envie uma operação por camada.';

describe('B5.5 — a forma de LISTA de camadas de catálogo é recusada por nome', () => {
  let app, db, token, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const owner = await createUser(db, { username: 'arr_recusa_owner' });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Array recusada' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations })
      .expect(200);

  /** Per-layer op: the shape the live client mints, and the only one that still applies. */
  const opDeCamada = (operationType, mapId, entityId, data) => ({
    protocolVersion: 2,
    id: randomUUID(),
    entityType: 'catalogLayer',
    operationType,
    entityId,
    mapId,
    data,
    timestamp: Date.now(),
    clientId: 'c-por-camada',
  });

  /** Legacy whole-array op: `entityId` is the MAP id, the payload is the whole list. */
  const opDeArray = (mapId, itens, campo = 'data') => ({
    protocolVersion: 2,
    id: randomUUID(),
    entityType: 'catalogLayer',
    operationType: 'update',
    entityId: mapId,
    mapId,
    [campo]: { catalog_layers: itens },
    timestamp: Date.now(),
    clientId: 'c-array-legado',
  });

  const linhas = async (mapId) => {
    const { rows } = await db.query(
      'SELECT id, data, deleted_at FROM catalog_layers WHERE map_id = $1 ORDER BY id', [mapId],
    );
    return rows;
  };

  it('a lista em `data` é recusada por operação, com o motivo nomeado', async () => {
    const map = await createMap(db, atlas.id, { name: 'Lista em data' });

    const resposta = await push([opDeArray(map.id, [
      { id: 'wms-a', nome: 'A', visible: true },
      { id: 'wms-b', nome: 'B', visible: false },
    ])]);

    const ack = resposta.body.data.acks[0];
    assert.equal(resposta.body.data.acks.length, 1, 'respondida por operação');
    assert.equal(ack.rejected, true, 'e recusada');
    assert.equal(ack.reason, RECUSA, 'com o motivo que a pessoa lê na tela');
    assert.deepEqual(await linhas(map.id), [], 'nenhuma linha materializada');
  });

  it('a lista em `changes` é recusada igual: o alias não é uma porta de trás', async () => {
    // O handler antigo lia `data.catalog_layers` OU `changes.catalog_layers`. Uma recusa que só
    // olhasse o primeiro deixaria a segunda porta aberta, e o cliente que a usasse voltaria a
    // escrever pelo caminho que acabou de ser removido, agora sem ramo que o aplique: acked e mudo.
    const map = await createMap(db, atlas.id, { name: 'Lista em changes' });

    const ack = (await push([opDeArray(map.id, [{ id: 'wms-c' }], 'changes')])).body.data.acks[0];
    assert.equal(ack.rejected, true, 'recusada também por `changes`');
    assert.equal(ack.reason, RECUSA, 'com a mesma frase');
    assert.deepEqual(await linhas(map.id), [], 'nenhuma linha materializada');
  });

  it('a recusa é ANTES do log: a op não queima versão nem viaja para os pares', async () => {
    // Op recusada não pode consumir `server_version` (o cursor do pull incremental) nem ser
    // replicada a um par: as duas coisas dependem de a recusa vir antes do INSERT em `operations`.
    const map = await createMap(db, atlas.id, { name: 'Lista antes do log' });
    const antes = await db.query('SELECT current_version FROM atlas WHERE id = $1', [atlas.id]);

    const opId = randomUUID();
    const ack = (await push([{ ...opDeArray(map.id, [{ id: 'wms-d' }]), id: opId }])).body.data.acks[0];
    assert.equal(ack.rejected, true, 'pré-condição: recusada');

    const { rows } = await db.query('SELECT count(*)::int AS n FROM operations WHERE op_id = $1', [opId]);
    assert.equal(rows[0].n, 0, 'nada foi escrito no log de operações');
    const depois = await db.query('SELECT current_version FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(Number(depois.rows[0].current_version), Number(antes.rows[0].current_version),
      'e a versão do atlas não andou');
  });

  it('CONTROLE ABSOLUTO: a forma POR CAMADA continua aplicando', async () => {
    // Sem este caso, uma recusa larga demais (todo `catalogLayer`, ou todo payload com o campo)
    // passaria verde nos três acima e teria desligado a entidade inteira.
    const map = await createMap(db, atlas.id, { name: 'Por camada segue viva' });

    const criar = (await push([opDeCamada('create', map.id, 'hillshade',
      { nome: 'Relevo', visible: true })])).body.data.acks[0];
    assert.equal(criar.rejected, undefined, 'a criação por camada entra');

    const editar = (await push([opDeCamada('update', map.id, 'hillshade',
      { nome: 'Relevo', visible: false })])).body.data.acks[0];
    assert.equal(editar.rejected, undefined, 'e a edição por camada também');

    const rows = await linhas(map.id);
    assert.equal(rows.length, 1, 'uma linha, a que as duas ops endereçaram');
    assert.equal(rows[0].data.visible, false, 'com o valor da segunda op');
    assert.equal(rows[0].deleted_at, null, 'e viva');
  });
});
