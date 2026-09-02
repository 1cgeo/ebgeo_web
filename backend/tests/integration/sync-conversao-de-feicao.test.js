// Path: tests/integration/sync-conversao-de-feicao.test.js
//
// CONVERTER UMA FEIÇÃO É UM CREATE DE UM ID NOVO MAIS UM DELETE DO ID ANTIGO, NO MESMO PUSH.
//
// ================= A LACUNA QUE ESTE ARQUIVO FECHA ===========================
//
// Nenhum teste deste pacote empurrava esse par junto. `sync-batch-atomicity` mede três creates
// e um 403; `sync-authz-lock` mede um create e um delete em pushes SEPARADOS; `undo-redo`
// repete o MESMO id. O par de ids DIFERENTES numa transação só é a forma que a conversão do
// cliente produz, e ela carrega duas propriedades que só se medem juntas:
//
//   1. UMA TRANSAÇÃO, DOIS ACKS, DUAS LINHAS NO LOG. O push é uma transação com advisory lock
//      por atlas, então o par não pode ser aplicado pela metade por concorrência.
//   2. O MAPA TRAVADO RECUSA AS DUAS. `lockedMapDenialReason` roda dentro do SAVEPOINT de cada
//      operação e `feature` está entre os alvos filhos do cadeado, com o mesmo `mapId` nas
//      duas metades. Se a recusa alcançasse só o DELETE, o mapa ficaria com AS DUAS feições,
//      que é duplicação silenciosa de dado; se alcançasse só o CREATE, a conversão se perderia
//      e a antiga sobreviveria, que é chato e seguro. Este arquivo afirma que ela alcança as
//      duas, e que a irmã num mapa ABERTO do mesmo lote continua passando (a recusa é por
//      operação, e o 409 que envenenava o lote congelava a fila de saída do cliente).
//
// AS FIXTURES SÃO AS REAIS. `realBoundaryFeature` e `realArrowFeature`
// (`tests/helpers/real-fixtures.js`, gêmeas das do frontend) carregam a forma que a ferramenta
// de fato emite: geometria `MultiLineString` e `Polygon` — que NÃO são o eixo autoral, e sim a
// forma desenhada —, o eixo em `properties.baseCoordinates`, a âncora de zoom e os quatro
// derivados `calculated*`. Antes delas, `realFeature('boundary')` devolvia um PONTO genérico, e
// toda varredura "de todos os tipos" media um ponto no lugar dos dois tipos mais complexos.
//
// Todas as escritas passam por POST /atlas/:id/sync: não existe rota REST de escrita de feição.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { realLineFeature, realBoundaryFeature, realArrowFeature } from '../helpers/real-fixtures.js';

describe('Sync — conversão de feição (CREATE de um id + DELETE de outro no mesmo push)', () => {
  let app, db, owner, editor, ownerTok, editorTok, atlas, mapaTravavel, mapaAberto;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: `conv_owner_${randomUUID().slice(0, 8)}` });
    editor = await createUser(db, { username: `conv_editor_${randomUUID().slice(0, 8)}` });
    ownerTok = await loginUser(app, owner.username, owner.password);
    editorTok = await loginUser(app, editor.username, editor.password);
    atlas = await createAtlas(db, owner.id);
    await createShare(db, atlas.id, editor.id, 'write', owner.id);
    mapaTravavel = await createMap(db, atlas.id, { name: 'Mapa Travável' });
    mapaAberto = await createMap(db, atlas.id, { name: 'Mapa Aberto' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Empurra um lote e devolve a resposta crua. */
  const push = (token, operations, expectStatus = 200) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations })
      .expect(expectStatus);

  /** O envelope de um CREATE de feição carregando a forma real da ferramenta. */
  const createOp = (entityId, mapId, feature) => ({
    id: randomUUID(),
    entityType: 'feature',
    operationType: 'create',
    entityId,
    mapId,
    data: feature,
    timestamp: Date.now(),
    clientId: 'conv-client',
  });

  /** O envelope de um DELETE de feição: só o id viaja. */
  const deleteOp = (entityId, mapId) => ({
    id: randomUUID(),
    entityType: 'feature',
    operationType: 'delete',
    entityId,
    mapId,
    timestamp: Date.now(),
    clientId: 'conv-client',
  });

  /** Liga/desliga a trava (owner-only). */
  const setLock = (locked) => push(ownerTok, [{
    id: randomUUID(),
    entityType: 'map',
    operationType: 'update',
    entityId: mapaTravavel.id,
    data: { locked },
    timestamp: Date.now(),
    clientId: 'conv-client',
  }]);

  /** A linha da tabela `features`, viva ou morta. */
  const linhaDaFeicao = async (id) =>
    (await db.query('SELECT id, feature_type, deleted_at, map_id, properties, geometry FROM features WHERE id = $1', [id])).rows[0];

  /** O mapa do snapshot, com os baldes por tipo. */
  const mapaDoSnapshot = async (token, mapId) => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const mapa = (res.body.data.snapshot.maps || []).find((m) => m.id === mapId);
    assert.ok(mapa, 'o mapa está no snapshot');
    return mapa;
  };

  /** Quantas operações daquele id de entidade estão no log deste atlas. */
  const opsNoLog = async (entityId) => (await db.query(
    'SELECT op_type FROM operations WHERE atlas_id = $1 AND entity_id = $2 ORDER BY server_version',
    [atlas.id, entityId],
  )).rows.map((r) => r.op_type);

  // ---- A travessia inteira, num push ----

  it('linha -> limite: dois acks, a nova viva e a antiga com deleted_at', async () => {
    const lineId = randomUUID();
    const boundaryId = randomUUID();

    // Estado inicial: a linha existe, criada pela forma real da ferramenta.
    await push(editorTok, [createOp(lineId, mapaAberto.id, realLineFeature({ id: lineId }))]);
    assert.equal((await linhaDaFeicao(lineId)).deleted_at, null, 'a linha nasceu viva');

    // A CONVERSÃO.
    const res = await push(editorTok, [
      createOp(boundaryId, mapaAberto.id, realBoundaryFeature({ id: boundaryId })),
      deleteOp(lineId, mapaAberto.id),
    ]);

    const acks = res.body.data.results;
    assert.equal(acks.length, 2, 'as duas metades foram acusadas');
    assert.ok(acks.every((a) => a.success === true), 'as duas metades foram aplicadas');

    const nova = await linhaDaFeicao(boundaryId);
    assert.ok(nova, 'a linha do limite foi criada');
    assert.equal(nova.feature_type, 'boundary', 'o tipo veio de properties.source');
    assert.equal(nova.deleted_at, null, 'a nova está viva');
    assert.equal(nova.geometry.type, 'MultiLineString', 'a geometria desenhada atravessou');

    const antiga = await linhaDaFeicao(lineId);
    assert.ok(antiga.deleted_at, 'a antiga levou soft-delete');

    // DUAS LINHAS NO LOG, uma por metade: é isso que o par recebe pelo WebSocket, e é por isso
    // que ele converge sem precisar de uma operação de "conversão" própria.
    assert.deepEqual(await opsNoLog(boundaryId), ['create'], 'o log tem o create do novo id');
    assert.deepEqual(await opsNoLog(lineId), ['create', 'delete'], 'e o create + delete do antigo');
  });

  it('o snapshot troca de balde: a nova em `boundarys`, a antiga fora de `lines`', async () => {
    const lineId = randomUUID();
    const boundaryId = randomUUID();
    await push(editorTok, [createOp(lineId, mapaAberto.id, realLineFeature({ id: lineId }))]);
    await push(editorTok, [
      createOp(boundaryId, mapaAberto.id, realBoundaryFeature({ id: boundaryId })),
      deleteOp(lineId, mapaAberto.id),
    ]);

    const mapa = await mapaDoSnapshot(editorTok, mapaAberto.id);

    // O balde é `boundarys`, com o `y`: é o nome irregular do registro de tipos, e é
    // exatamente o detalhe que um teste escrito de cabeça erra.
    const limite = (mapa.features.boundarys || []).find((f) => f.properties.id === boundaryId);
    assert.ok(limite, 'o limite caiu no balde boundarys');
    assert.equal(limite.properties.source, 'boundary');

    // ASSERÇÃO NEGATIVA: sem ela, "converteu" seria indistinguível de "duplicou".
    assert.equal(
      (mapa.features.lines || []).some((f) => f.properties.id === lineId), false,
      'a linha antiga sumiu do snapshot',
    );
    assert.equal(
      (mapa.features.lines || []).some((f) => f.properties.id === boundaryId), false,
      'e o limite não vazou para o balde de linhas',
    );
  });

  it('o envelope do limite chega inteiro: eixo autoral, âncora de zoom, escalão e derivados', async () => {
    // `properties` é JSONB sem esquema e a borda de escrita livre é SCRUBBED por campo, então
    // o que prova que estas chaves atravessam é o round-trip, nunca a leitura do servidor
    // (que só extrai `source` e `layerId`).
    const boundaryId = randomUUID();
    await push(editorTok, [createOp(boundaryId, mapaAberto.id, realBoundaryFeature({ id: boundaryId }))]);

    const linha = await linhaDaFeicao(boundaryId);
    assert.equal(linha.properties.createdAtZoom, 12.3, 'a âncora de zoom atravessou');
    assert.equal(linha.properties.zoomCorrectionEnabled, true);
    assert.equal(linha.properties.echelon, 'XXX');
    assert.equal(linha.properties.calculatedTextSize, 35, 'os derivados do cliente atravessam como qualquer propriedade');
    assert.equal(linha.properties.baseCoordinates.length, 3, 'o eixo AUTORAL, que não é a geometria desenhada');
    assert.deepEqual(linha.properties.symbol_instances, [{ ratio: 0.5, showLabels: true }]);
    // E a nota de escopo: `layer_id` é UUID na coluna, e o sentinela não-UUID vira null lá e
    // sobrevive verbatim no JSONB.
    assert.equal(linha.properties.layerId, 'default');
  });

  it('a ORDEM dentro do lote não importa: DELETE antes do CREATE dá o mesmo resultado', async () => {
    // A ordem dentro de um push NÃO é a do gesto: a fila de saída ordena por uma chave que
    // leva timestamp mais um UUID aleatório de desempate. A conversão tem de convergir nas
    // duas ordens, ou converge por sorte.
    const arrowId = randomUUID();
    const lineId = randomUUID();
    await push(editorTok, [createOp(arrowId, mapaAberto.id, realArrowFeature({ id: arrowId }))]);

    const res = await push(editorTok, [
      deleteOp(arrowId, mapaAberto.id),
      createOp(lineId, mapaAberto.id, realLineFeature({ id: lineId })),
    ]);
    assert.ok(res.body.data.results.every((a) => a.success === true), 'as duas passaram na ordem invertida');

    assert.ok((await linhaDaFeicao(arrowId)).deleted_at, 'a seta antiga morreu');
    assert.equal((await linhaDaFeicao(lineId)).deleted_at, null, 'e a linha nova está viva');
  });

  // ---- O mapa travado ----

  it('CONTROLE POSITIVO: no mapa travável AINDA destravado, a conversão passa', async () => {
    // Sem este passo, todas as asserções de recusa abaixo passariam para uma conversão
    // simplesmente quebrada naquele mapa.
    const lineId = randomUUID();
    const arrowId = randomUUID();
    await push(editorTok, [createOp(lineId, mapaTravavel.id, realLineFeature({ id: lineId }))]);
    const res = await push(editorTok, [
      createOp(arrowId, mapaTravavel.id, realArrowFeature({ id: arrowId })),
      deleteOp(lineId, mapaTravavel.id),
    ]);
    assert.ok(res.body.data.results.every((a) => a.success === true));
    assert.ok((await linhaDaFeicao(lineId)).deleted_at);
  });

  it('mapa TRAVADO recusa AS DUAS metades, por operação, sem envenenar o lote', async () => {
    const lineId = randomUUID();
    const boundaryId = randomUUID();
    const irmaId = randomUUID();

    // A linha nasce ANTES da trava, para haver o que converter.
    await push(editorTok, [createOp(lineId, mapaTravavel.id, realLineFeature({ id: lineId }))]);

    await setLock(true);
    const { rows } = await db.query('SELECT locked FROM maps WHERE id = $1', [mapaTravavel.id]);
    assert.equal(rows[0].locked, true, 'o dono travou o mapa');

    const res = await push(editorTok, [
      createOp(boundaryId, mapaTravavel.id, realBoundaryFeature({ id: boundaryId })),
      deleteOp(lineId, mapaTravavel.id),
      // A irmã, num mapa ABERTO do MESMO lote.
      createOp(irmaId, mapaAberto.id, realLineFeature({ id: irmaId })),
    ]);

    const acks = res.body.data.results;
    assert.equal(acks.length, 3);

    assert.equal(acks[0].success, false, 'o CREATE foi recusado');
    assert.equal(acks[0].rejected, true);
    assert.match(acks[0].reason, /bloquead/i, 'e o ack nomeia o motivo');

    assert.equal(acks[1].success, false, 'o DELETE também foi recusado');
    assert.equal(acks[1].rejected, true);
    assert.match(acks[1].reason, /bloquead/i);

    assert.equal(acks[2].success, true, 'a irmã no mapa aberto passou');

    // O ESTADO CONTINUA CONSISTENTE, que é a propriedade inteira: a antiga viva, a nova
    // ausente. Recusar só o DELETE deixaria as DUAS; recusar só o CREATE perderia a conversão.
    assert.equal((await linhaDaFeicao(lineId)).deleted_at, null, 'a linha antiga sobreviveu inteira');
    assert.equal(await linhaDaFeicao(boundaryId), undefined, 'o limite não chegou a existir');
    assert.equal((await linhaDaFeicao(irmaId)).deleted_at, null, 'a irmã do mapa aberto entrou');
  });

  it('destravado de novo, a MESMA conversão passa', async () => {
    const lineId = randomUUID();
    const boundaryId = randomUUID();
    await setLock(false);
    await push(editorTok, [createOp(lineId, mapaTravavel.id, realLineFeature({ id: lineId }))]);

    const res = await push(editorTok, [
      createOp(boundaryId, mapaTravavel.id, realBoundaryFeature({ id: boundaryId })),
      deleteOp(lineId, mapaTravavel.id),
    ]);
    assert.ok(res.body.data.results.every((a) => a.success === true));
    assert.equal((await linhaDaFeicao(boundaryId)).deleted_at, null);
    assert.ok((await linhaDaFeicao(lineId)).deleted_at);
  });

  // ---- O posto ----

  it('um LEITOR não converte: 403 no LOTE, e nenhuma das duas metades entra', async () => {
    // A DIFERENÇA DE FORMA IMPORTA, e é o motivo deste caso existir ao lado do cadeado:
    // violação de POSTO derruba o LOTE (`assertOperationAllowed` LANÇA, antes do savepoint),
    // enquanto o cadeado recusa POR OPERAÇÃO. O cliente só faz dequeue em 2xx, então o 403
    // CONGELA a fila de saída inteira — que é exatamente por que o comando de conversão não
    // pode ser desenhado para quem não tem o posto.
    const leitor = await createUser(db, { username: `conv_leitor_${randomUUID().slice(0, 8)}` });
    const leitorTok = await loginUser(app, leitor.username, leitor.password);
    await createShare(db, atlas.id, leitor.id, 'read', owner.id);

    const lineId = randomUUID();
    const boundaryId = randomUUID();
    await push(editorTok, [createOp(lineId, mapaAberto.id, realLineFeature({ id: lineId }))]);

    await push(leitorTok, [
      createOp(boundaryId, mapaAberto.id, realBoundaryFeature({ id: boundaryId })),
      deleteOp(lineId, mapaAberto.id),
    ], 403);

    assert.equal(await linhaDaFeicao(boundaryId), undefined, 'o limite do Leitor não existe');
    assert.equal((await linhaDaFeicao(lineId)).deleted_at, null, 'e a linha do Editor está intacta');
  });
});
