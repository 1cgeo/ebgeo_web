# Sondas da revisao do atlas remoto, 12/09/2026

Base: fa0f021891b785b61c45fd8aedc51f20a99a0950, branch integracao_backend.

Estas sondas caracterizam defeitos do estado revisado. Os testes frontend e navegador abaixo exigem o comportamento seguro e FALHAM nesse commit; os quatro testes backend afirmam o comportamento observado e PASSAM, sem certificar seguranca. Nao sao correcoes.

## Reproducao

Execute no checkout da base, com as dependencias instaladas e PostgreSQL/PostGIS disponivel para os runners habituais. Use somente os bancos descartaveis dos runners. Nao execute duas suites backend ao mesmo tempo.

Para cada sonda frontend, copie o arquivo de suporte indicado para o nome temporario e acrescente o bloco correspondente. Isso conserva os mesmos imports, mocks e inicializacao usados nesta revisao. Para backend e navegador, o bloco e o arquivo inteiro. Remova os arquivos temporarios depois.

```powershell
npm test --prefix frontend -- audit-temp -t AUDIT
npm test --prefix backend -- tests/integration/audit-temp-sync.test.js
$env:CI="1"
npm run test:e2e:ui --prefix frontend -- audit-temp-snapshot --retries=0
```

Os 159 testes filtrados do frontend pertencem aos suportes copiados; nao foram executados nesta rodada. O resultado relevante e 11 sondas executadas e 11 falhas de assercao, sem falha de importacao. Backend: quatro cenarios observados. Navegador: uma falha de convergencia local depois de confirmar linha no PostgreSQL e fila vazia.

## Frontend: operation-queue-lifecycle

Suporte: [operation-queue-lifecycle.test.js](../../frontend/tests/integration/operation-queue-lifecycle.test.js). Destino temporario: frontend/tests/integration/audit-temp-operation-queue-lifecycle.test.js.

```javascript
describe('AUDIT pending queue', () => {
 it('AUDIT expiry must not remove unacknowledged work', async () => {
  queueMap.clear(); const q = new OperationQueue();
  await q.enqueue(createOp('audit-old', EntityType.FEATURE, OperationType.CREATE, 'audit-f', 'map-1', {x:1}, Date.now()-8*86400000));
  await q.purgeOldOperations();
  expect(await q.count()).toBe(1);
 });
 it('AUDIT compaction must not change the payload of an already sent op id', async () => {
  queueMap.clear(); const q = new OperationQueue();
  const create=createOp('sent-id', EntityType.FEATURE, OperationType.CREATE, 'audit-f', 'map-1', {x:1}, 1000);
  const update=createOp('new-id', EntityType.FEATURE, OperationType.UPDATE, 'audit-f', 'map-1', {x:2}, 1001);
  const compacted=q._compactEntityOps([create,update]);
  expect(compacted.find(o=>o.id==='sent-id')?.data).toEqual({x:1});
 });
 it('AUDIT clock rollback must not send an update before its create', async () => {
  queueMap.clear(); const q = new OperationQueue();
  await q.enqueue({...createOp('create',EntityType.FEATURE,OperationType.CREATE,'audit-f','map-1',{x:1},2000),lamportTimestamp:1});
  await q.enqueue({...createOp('update',EntityType.FEATURE,OperationType.UPDATE,'audit-f','map-1',{x:2},1000),lamportTimestamp:2});
  expect((await q.getAll()).map(o=>o.id)).toEqual(['create','update']);
 });
});

it('AUDIT compaction must preserve independent setting patches',()=>{
 const q=new OperationQueue();
 const compacted=q._compactEntityOps([
  createOp('p1',EntityType.SETTING,OperationType.UPDATE,'atlas',null,{terrainExaggeration:2},1000),
  createOp('p2',EntityType.SETTING,OperationType.UPDATE,'atlas',null,{globeProjection:'globe'},1001),
 ]);
 expect(Object.assign({},...compacted.map(o=>o.data))).toEqual({terrainExaggeration:2,globeProjection:'globe'});
});
```

## Frontend: remote-operation-handler

Suporte: [remote-operation-handler.test.js](../../frontend/tests/integration/remote-operation-handler.test.js). Destino temporario: frontend/tests/integration/audit-temp-remote-operation-handler.test.js.

```javascript
describe('AUDIT snapshot and convergence', () => {
 it('AUDIT snapshot followed by own ack must restore pending local create', async () => {
  const m=createTestMapData(); const f={id:'audit-pending',type:'Feature',geometry:{type:'Point',coordinates:[1,2]},properties:{source:'point'}};
  m.features.points.push(f); mapDataStore.set('map-1',m); markLocalEditPending(f.id);
  const op={id:'audit-op',entityType:EntityType.FEATURE,operationType:OperationType.CREATE,entityId:f.id,mapId:'map-1',data:f};
  await applyRemoteSnapshot({maps:[createTestMapData()]});
  await resolveLocalEdit(f.id,100,op);
  expect(mapDataStore.get('map-1').features.points.some(x=>x.id===f.id)).toBe(true);
 });
 it('AUDIT full snapshot must remove maps and briefings absent on server', async () => {
  mapDataStore.set('deleted-map',createTestMapData()); briefingStore.set('deleted-brief',{id:'deleted-brief'});
  await applyRemoteSnapshot({maps:[],briefings:[]});
  expect({maps:mapDataStore.size,briefings:briefingStore.size}).toEqual({maps:0,briefings:0});
 });
 it('AUDIT old create must not resurrect a newer deletion', async () => {
  mapDataStore.set('map-1',createTestMapData());
  const op={id:'audit-create',entityType:EntityType.FEATURE,operationType:OperationType.CREATE,entityId:'audit-deleted',mapId:'map-1',data:{id:'audit-deleted',type:'Feature',geometry:{type:'Point',coordinates:[1,2]},properties:{source:'point'}},serverVersion:10};
  await applyRemoteOperation(op);
  expect(mapDataStore.get('map-1').features.points).toHaveLength(1);
  await applyRemoteOperation({...op,id:'audit-delete',operationType:OperationType.DELETE,serverVersion:11});
  await applyRemoteOperation(op);
  expect(mapDataStore.get('map-1').features.points).toHaveLength(0);
 });
});
```

## Frontend: sync-engine

Suporte: [sync-engine.test.js](../../frontend/tests/integration/sync-engine.test.js). Destino temporario: frontend/tests/integration/audit-temp-sync-engine.test.js.

```javascript
it('AUDIT refused op must not seed local winning version',async()=>{
 queueState.ops=[{id:'audit-denied',entityType:'feature',entityId:'audit-f',operationType:'update',data:{x:2}}];
 apiClientMock.pushOperations.mockResolvedValueOnce({results:[{operationId:'audit-denied',success:false,rejected:true,reason:'locked',currentVersion:100}],serverVersion:100});
 recordLocalAppliedVersion.mockClear();
 await syncEngine.flush();
 expect(recordLocalAppliedVersion).not.toHaveBeenCalled();
});
```

## Frontend: ws-client

Suporte: [ws-client.test.js](../../frontend/tests/integration/ws-client.test.js). Destino temporario: frontend/tests/integration/audit-temp-ws-client.test.js.

```javascript
describe('AUDIT durable receive cursor', () => {
 it('AUDIT failed local apply must remain eligible for replay', async () => {
  const {ws}=setup(); const p=ws.connect('atlas-1',{lastVersion:10});
  const sock=FakeSocket.instances[0]; sock.emit({type:'connected'}); await p;
  ws.on('operation',async()=>{throw new Error('injected IndexedDB write failure');});
  sock.emit({type:'operation',op:{id:'audit-op',clientId:'other',serverVersion:11}});
  await ws._applyChain;
  ws.requestSync(); ws.disconnect();
  expect(sock.sent.find(x=>x.type==='sync_request').lastVersion).toBe(10);
 });
 it('AUDIT delayed close of previous socket must not clear new socket', async () => {
  const {ws}=setup(); const p=ws.connect('atlas-1'); const old=FakeSocket.instances[0]; old.emit({type:'connected'}); await p;
  old.close=()=>{old.readyState=3;};
  ws.disconnect(); const p2=ws.connect('atlas-2'); const current=FakeSocket.instances[1]; current.emit({type:'connected'}); await p2;
  old.onclose({code:1000,reason:'leave'});
  const retained=ws._socket===current; ws.disconnect(); expect(retained).toBe(true);
 });
});

it('AUDIT initial handshake must replay changes after the HTTP snapshot',async()=>{
 const {ws}=setup(); const p=ws.connect('atlas-1',{lastVersion:10});
 const sock=FakeSocket.instances[0]; sock.emit({type:'connected'}); await p;
 ws.disconnect();
 expect(sock.sent.some(x=>x.type==='sync_request'&&x.lastVersion===10)).toBe(true);
});
```

## Arquivo completo: audit-temp-sync.test.js

Destino temporario: backend/tests/integration/audit-temp-sync.test.js.

```javascript
// Path: tests/integration/audit-temp-sync.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import { cleanupOldOperations } from '../../src/modules/sync/sync.service.js';

describe('AUDIT observed server behavior', () => {
  let app, db, user, atlas, map, token;
  before(async () => {
    ({ app, db } = await setupTestEnv());
    user = await createUser(db, { username: 'audit_sync_review' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
  });
  after(async () => { await teardownTestEnv(db); });
  const op = (type, entity, data) => ({
    id: randomUUID(), type, target: 'feature', targetId: entity,
    mapId: map.id, data, timestamp: Date.now(), clientId: 'audit-client',
  });
  const push = async (...operations) => (await supertest(app)
    .post(`/api/v1/atlas/${atlas.id}/sync`).set('Authorization', `Bearer ${token}`)
    .send({ operations }).expect(200)).body.data;
  const row = async id => (await db.query('SELECT * FROM features WHERE id=$1', [id])).rows[0];
  const data = x => ({ feature_type: 'point', geometry: { type: 'Point', coordinates: [x, 0] }, properties: { name: 'original' } });

  it('changed payload under same op id is acknowledged without applying the change', async () => {
    const id = randomUUID();
    const original = op('create', id, data(1));
    await push(original);
    const result = await push({ ...original, data: data(2) });
    assert.equal(result.results[0].idempotent, true);
    assert.deepEqual((await row(id)).geometry.coordinates, [1, 0]);
  });

  it('late offline full document overwrites unrelated newer fields', async () => {
    const id = randomUUID();
    await push(op('create', id, data(1)));
    const later = { ...op('update', id, null), changes: { properties: { name: 'newer-name' } } };
    await push(later);
    const stale = { ...op('update', id, null), timestamp: Date.now() - 86400000,
      changes: { geometry: { type: 'Point', coordinates: [2, 0] }, properties: { name: 'original' } } };
    const result = await push(stale);
    assert.equal(result.results[0].success, true);
    assert.equal((await row(id)).properties.name, 'original');
    assert.deepEqual((await row(id)).geometry.coordinates, [2, 0]);
  });

  it('cleanup removes deduplication evidence and retry overwrites newer value', async () => {
    const id = randomUUID();
    await push(op('create', id, data(1)));
    const old = { ...op('update', id, null), changes: { properties: { name: 'old' } } };
    await push(old);
    const latest = await push({ ...op('update', id, null), changes: { properties: { name: 'latest' } } });
    await cleanupOldOperations(atlas.id, { keepFromVersion: latest.results[0].currentVersion });
    const retry = await push(old);
    assert.equal(retry.results[0].idempotent, false);
    assert.equal((await row(id)).properties.name, 'old');
  });

  it('create referencing absent map gets success with no materialized row', async () => {
    const id = randomUUID();
    const result = await push({ ...op('create', id, data(1)), mapId: randomUUID() });
    assert.equal(result.results[0].success, true);
    assert.equal(await row(id), undefined);
  });
});

```

## Arquivo completo: audit-temp-snapshot.spec.js

Destino temporario: frontend/tests/e2e-ui/audit-temp-snapshot.spec.js.

```javascript
// Path: tests/e2e-ui/audit-temp-snapshot.spec.js
import { collabTest, expect, drawLineUI } from './helpers/collab.fixtures.js';
import { readIdbEntity } from './helpers/idb.js';

collabTest('AUDIT pending create survives server snapshot and acknowledgement', async ({ collab }) => {
    collabTest.setTimeout(90000);
    const B = collab.peers[0];
    const routePattern = '**/atlas/*/sync';
    await B.route(routePattern, route => route.request().method() === 'POST'
        ? route.abort('connectionfailed') : route.continue());
    const id = await drawLineUI(B, [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]]);
    await expect.poll(() => B.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return operationQueue.count();
    })).toBeGreaterThan(0);
    const read = () => readIdbEntity(B, { entityId: id, entityType: 'feature', mapId: collab.mapId, storage: 'lines' });
    expect((await read()).found).toBe(true);
    await B.evaluate(async () => {
        const { syncEngine } = await import('/src/js/store/sync/sync-engine.js');
        await syncEngine.resync();
    });
    await B.unroute(routePattern);
    await expect.poll(async () => !!(await collab.db.queryFeatureRow(id)), { timeout: 25000 }).toBe(true);
    await expect.poll(() => B.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return operationQueue.count();
    })).toBe(0);
    await B.screenshot({ path: '../docs/reviews/2026-09-12-atlas-remoto-snapshot-pendente.png' });
    await expect.poll(async () => (await read()).found, { timeout: 6000 }).toBe(true);
});

```
