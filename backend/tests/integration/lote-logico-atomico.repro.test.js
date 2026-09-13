// Path: tests/integration/lote-logico-atomico.repro.test.js
//
// O LOTE LÓGICO APLICA OU RECUSA INTEIRO (decisão D4 do plano de lançamento, 2026-09-13).
//
// CAUSA RAIZ. `pushOperations` abria um SAVEPOINT POR OPERAÇÃO (`t.tx(async (sp) => ...)`), e
// isso é certo para op avulsa: a violação de dado de uma op não pode envenenar a fila inteira do
// cliente. Só que desde B4 vários GESTOS emitem várias ops de uma vez, carimbadas com o mesmo
// `batchId` por `createBatchOperations` (frontend `operation-factory.js`): criar grupo é um
// `group` create mais um `group_feature` create por membro; combinar grupos, transferir camada e
// colar são iguais. O servidor não lia o `batchId` (ele atravessava o `.unknown(true)` do schema
// e morria ali), então o savepoint por op transformava a aplicação PARCIAL de um comando composto
// no desfecho normal: um membro recusado deixava o grupo criado, os irmãos dentro dele, e a
// resposta era 200. O usuário via um grupo pela metade sem uma linha de erro que dissesse o que
// faltou, e o reenvio da fila não consertava, porque a recusa é determinística.
//
// O CONTRATO NOVO: as ops de um mesmo `batchId` correm num savepoint SÓ. Qualquer recusa,
// conflito ou violação de integridade rola o grupo inteiro para trás, e TODAS voltam recusadas,
// com o mesmo motivo, o mesmo `batchId` e o `batchFailedOperationId` da culpada. Op sem `batchId`
// segue no regime individual, inclusive no mesmo push.
//
// CONTROLE NEGATIVO, executado em 2026-09-13: trocando a chamada de `processarLote` por
// `processarIndividual` op a op no laço de `agruparPorLote` (que é literalmente o savepoint por
// op de antes), TRÊS dos nove casos ficam vermelhos, e o primeiro deles com exatamente o defeito
// desta descrição: `actual: [ true, true, false ]` contra `expected: [ false, false, false ]`,
// ou seja, o grupo e o membro válido aplicados e só o inválido recusado. Caem junto o reenvio do
// lote recusado (que aplicaria as irmãs na segunda tentativa) e o teto, que sem o agrupamento
// não tem lote para medir. Fonte restaurada byte a byte depois, e os nove voltaram verdes.
//
// O QUE ESTE ARQUIVO NÃO PROVA, e é declarado porque um lote incompleto passa por lote completo:
// o servidor define o lote como "as ops com aquele `batchId` que chegaram NESTE push", porque a
// fábrica do cliente carimba `batchId` e `batchIndex` e NÃO carimba um total. Enquanto o cliente
// recortar o envio por FIFO cego a cada 25 ops, um gesto de 30 chega como dois lotes lógicos,
// cada um atômico em si. Fechar isso é trabalho do cliente (respeitar a fronteira do lote no
// recorte), e está registrado em `docs/reviews/fechamento/04-comandos-compostos.md`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createFeature, loginUser } from '../helpers/fixtures.js';
import { LOTE_MAX_OPS, MSG_LOTE_ACIMA_DO_TETO, agruparPorLote } from '../../src/modules/sync/sync.service.js';

describe('Lote lógico: aplica ou recusa inteiro (D4)', () => {
  let app, db, user, token, atlas, mapa;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'lote_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    mapa = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  function push(operations) {
    return supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations });
  }

  /** O gesto "criar grupo com N membros": um `group` create mais um `group_feature` por membro. */
  function opsDeAgrupar(groupId, featureIds, batchId) {
    const agora = Date.now();
    return [
      { protocolVersion: 2, id: randomUUID(), type: 'create', target: 'group', targetId: groupId,
        mapId: mapa.id, data: { name: 'Grupo do gesto' }, timestamp: agora, clientId: 'lote-c',
        batchId, batchIndex: 0 },
      ...featureIds.map((featureId, i) => ({
        protocolVersion: 2, id: randomUUID(), type: 'create', target: 'group_feature',
        targetId: randomUUID(), mapId: mapa.id, data: { group_id: groupId, feature_id: featureId },
        timestamp: agora + 1 + i, clientId: 'lote-c', batchId, batchIndex: i + 1,
      })),
    ];
  }

  const contarGrupo = async (groupId) => (await db.query(
    'SELECT COUNT(*)::int AS n FROM groups WHERE id = $1', [groupId])).rows[0].n;
  const contarMembros = async (groupId) => (await db.query(
    'SELECT COUNT(*)::int AS n FROM group_features WHERE group_id = $1', [groupId])).rows[0].n;
  const contarOps = async (ops) => (await db.query(
    'SELECT COUNT(*)::int AS n FROM operations WHERE op_id = ANY($1::text[])',
    [ops.map((o) => o.id)])).rows[0].n;

  it('agrupar: o SEGUNDO membro inválido derruba o gesto inteiro, e as três ops voltam com o mesmo motivo', async () => {
    const groupId = randomUUID();
    const valida = await createFeature(db, mapa.id);
    const fantasma = randomUUID();               // feição que não existe: o EXISTS do INSERT falha
    const batchId = randomUUID();
    const ops = opsDeAgrupar(groupId, [valida.id, fantasma], batchId);

    const res = await push(ops).expect(200);
    const results = res.body.data.results;

    assert.equal(results.length, 3, 'um ack por op do lote');
    assert.deepEqual(results.map((r) => r.success), [false, false, false],
      'nenhuma op do lote pode voltar como sucesso');
    const motivos = new Set(results.map((r) => r.reason));
    assert.equal(motivos.size, 1, `um motivo só para o lote inteiro, vieram ${[...motivos].join(' | ')}`);
    assert.match([...motivos][0], /referencia um item que não existe mais/);
    assert.deepEqual(results.map((r) => r.batchId), [batchId, batchId, batchId],
      'o ack precisa dizer QUAL lote caiu; sem isso o cliente não distingue a recusa do gesto da recusa da op');
    assert.deepEqual(new Set(results.map((r) => r.batchFailedOperationId)), new Set([ops[2].id]),
      'a culpada é nomeada para todas as irmãs');

    // E o efeito: NADA persistiu, nem o grupo, nem a associação que era válida, nem o log.
    assert.equal(await contarGrupo(groupId), 0, 'o grupo do gesto recusado não pode existir');
    assert.equal(await contarMembros(groupId), 0, 'a associação válida some junto com o gesto');
    assert.equal(await contarOps(ops), 0, 'nenhuma op do lote recusado entra no log');
  });

  it('lote válido: tudo aplicado, e numa faixa de versão contígua', async () => {
    const groupId = randomUUID();
    const a = await createFeature(db, mapa.id);
    const b = await createFeature(db, mapa.id);
    const ops = opsDeAgrupar(groupId, [a.id, b.id], randomUUID());

    const res = await push(ops).expect(200);
    assert.deepEqual(res.body.data.results.map((r) => r.success), [true, true, true]);

    assert.equal(await contarGrupo(groupId), 1);
    assert.equal(await contarMembros(groupId), 2);

    const { rows } = await db.query(
      'SELECT server_version, batch_id FROM operations WHERE op_id = ANY($1::text[]) ORDER BY server_version',
      [ops.map((o) => o.id)]
    );
    assert.equal(rows.length, 3);
    const versoes = rows.map((r) => Number(r.server_version));
    assert.equal(versoes[2] - versoes[0], 2,
      `as três ops do gesto ocupam versões contíguas, vieram ${versoes.join(',')}`);
    assert.equal(new Set(rows.map((r) => r.batch_id)).size, 1, 'o lote é persistido em batch_id');
    assert.equal(rows[0].batch_id, ops[0].batchId, 'e é o batchId que o cliente carimbou');
  });

  it('op SEM batchId no mesmo push continua individual: a boa passa, a ruim é recusada sozinha', async () => {
    const featureId = randomUUID();
    const boa = { protocolVersion: 2, id: randomUUID(), type: 'create', target: 'feature',
      targetId: featureId, mapId: mapa.id,
      data: { feature_type: 'point', geometry: { coordinates: [-43.2, -22.9] }, properties: { name: 'Avulsa' } },
      timestamp: Date.now(), clientId: 'lote-c' };
    const ruim = { protocolVersion: 2, id: randomUUID(), type: 'create', target: 'group_feature',
      targetId: randomUUID(), mapId: mapa.id,
      data: { group_id: randomUUID(), feature_id: randomUUID() },
      timestamp: Date.now() + 1, clientId: 'lote-c' };

    const res = await push([boa, ruim]).expect(200);
    assert.deepEqual(res.body.data.results.map((r) => r.success), [true, false],
      'sem lote declarado, a recusa continua alcançando SÓ a op ofensora');
    assert.equal(res.body.data.results[0].batchId, undefined, 'op individual não ganha batchId no ack');
    const { rows } = await db.query('SELECT id FROM features WHERE id = $1', [featureId]);
    assert.equal(rows.length, 1, 'a op avulsa boa persiste ao lado da recusa da outra');
  });

  it('reenviar o lote APLICADO é idempotente: nada duplica e todo ack volta already_applied', async () => {
    const groupId = randomUUID();
    const a = await createFeature(db, mapa.id);
    const ops = opsDeAgrupar(groupId, [a.id], randomUUID());

    await push(ops).expect(200);
    const res = await push(ops).expect(200);

    assert.deepEqual(res.body.data.results.map((r) => r.status),
      ['already_applied', 'already_applied'], 'o reenvio do gesto inteiro é entrega repetida');
    assert.equal(await contarGrupo(groupId), 1);
    assert.equal(await contarMembros(groupId), 1, 'o membro não é associado duas vezes');
    assert.equal(await contarOps(ops), 2, 'o log não ganha linha nova no reenvio');
  });

  it('reenviar o lote RECUSADO é recusado de novo, e continua sem aplicar as irmãs', async () => {
    const groupId = randomUUID();
    const valida = await createFeature(db, mapa.id);
    const ops = opsDeAgrupar(groupId, [valida.id, randomUUID()], randomUUID());

    await push(ops).expect(200);
    const res = await push(ops).expect(200);

    assert.deepEqual(res.body.data.results.map((r) => r.success), [false, false, false],
      'a recusa é determinística: aplicar as irmãs no reenvio seria a aplicação parcial adiada');
    assert.deepEqual(res.body.data.results.map((r) => r.idempotent), [true, true, true],
      'e o ack diz que a entrega é repetida, para o cliente não avisar duas vezes');
    assert.equal(await contarGrupo(groupId), 0);
    assert.equal(await contarMembros(groupId), 0);
  });

  it(`lote acima de ${LOTE_MAX_OPS} ops é recusado inteiro, com motivo, sem tocar o banco`, async () => {
    const groupId = randomUUID();
    const feicoes = Array.from({ length: LOTE_MAX_OPS }, () => randomUUID());
    const ops = opsDeAgrupar(groupId, feicoes, randomUUID());   // 1 + LOTE_MAX_OPS = acima do teto
    assert.equal(ops.length, LOTE_MAX_OPS + 1);

    const res = await push(ops).expect(200);
    const results = res.body.data.results;
    assert.equal(results.length, ops.length);
    assert.equal(results.filter((r) => r.success === true).length, 0);
    assert.equal(new Set(results.map((r) => r.reason)).size, 1);
    assert.equal(results[0].reason, MSG_LOTE_ACIMA_DO_TETO);
    assert.equal(await contarGrupo(groupId), 0, 'o teto recusa ANTES de escrever qualquer coisa');
  });

  describe('agruparPorLote (a unidade de aplicação, sem banco)', () => {
    it('op sem batchId vira grupo de uma, e ops do mesmo batchId viram um grupo só', () => {
      const grupos = agruparPorLote([
        { id: 'a' },
        { id: 'b', batchId: 'L1' },
        { id: 'c' },
        { id: 'd', batchId: 'L1' },
        { id: 'e', batchId: 'L2' },
      ]);
      assert.deepEqual(grupos.map((g) => [g.batchId, g.ops.map((o) => o.id)]), [
        [null, ['a']],
        ['L1', ['b', 'd']],
        [null, ['c']],
        ['L2', ['e']],
      ]);
    });

    it('ordena por batchIndex quando TODAS declaram (pai antes de filho), e não quando alguma falta', () => {
      const comIndice = agruparPorLote([
        { id: 'membro', batchId: 'L', batchIndex: 1 },
        { id: 'grupo', batchId: 'L', batchIndex: 0 },
      ]);
      assert.deepEqual(comIndice[0].ops.map((o) => o.id), ['grupo', 'membro']);

      const semIndice = agruparPorLote([
        { id: 'membro', batchId: 'L', batchIndex: 1 },
        { id: 'grupo', batchId: 'L' },
      ]);
      assert.deepEqual(semIndice[0].ops.map((o) => o.id), ['membro', 'grupo'],
        'sem índice em todas, a ordem de chegada é a única informação que existe');
    });

    it('batchId vazio NÃO agrupa: senão um cliente que carimbasse "" faria um lote acidental de tudo', () => {
      const grupos = agruparPorLote([{ id: 'a', batchId: '' }, { id: 'b', batchId: null }]);
      assert.deepEqual(grupos.map((g) => g.batchId), [null, null]);
      assert.deepEqual(grupos.map((g) => g.ops.length), [1, 1]);
    });
  });
});
