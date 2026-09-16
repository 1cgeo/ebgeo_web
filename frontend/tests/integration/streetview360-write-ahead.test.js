// Path: tests/integration/streetview360-write-ahead.test.js
//
// O diário das entradas 360 (orientação de câmera e marcador de anotação), contra o
// despachante REAL e o IndexedDB REAL. Molde: tests/integration/catalog-write-ahead.test.js.
//
// O que este arquivo prova e o irmão de tests/store/ não pode: que a intenção durável chega
// ao disco ANTES do documento sv360, que ela sobrevive à falha da entidade, e que a marca de
// materialização é o que separa "enfileirada" de "enviável".

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, getActiveScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { LocalRepository, localRepository } from '../../src/js/store/repositories/local.repository.js';
import { setRepository } from '../../src/js/store/repositories/index.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { enableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import {
    addMarker360,
    clearOrientation,
    clearStreetview360Cache,
    removeMarker360,
    removeMarkers360ByPhoto,
    saveOrientation,
    setStreetview360Dependencies,
    updateMarker360
} from '../../src/js/store/streetview360.operations.js';
import { applyRemoteOperation, applyRemoteSnapshot, setRemoteHandlerEventBus } from '../../src/js/store/sync/remote-operation-handler.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';
import { createAtlas } from '../../src/js/store/atlas/atlas.entity.js';

vi.mock('../../src/js/store/sync/permission-guard.js', async importOriginal => ({
    ...await importOriginal(), checkPermission: () => ({ allowed: true })
}));

let mapA;
let mapB;

/** One marker placed by the operation under test, on the target map. */
async function seedMarker() {
    return addMarker360('photo-1.jpg', {
        position: { heading: 10, pitch: -5, distance: 8 },
        properties: { nome: 'Ponto A', descricao: 'desc' }
    }, mapB.name);
}

beforeEach(async () => {
    vi.restoreAllMocks();
    const storage = new Map();
    vi.stubGlobal('localStorage', {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key)
    });
    activateScope(remoteScope(crypto.randomUUID()));
    // A bound repository keeps the fault injection on the method actually used by the producer.
    setRepository(new LocalRepository(getActiveScope()));
    enableOperationLogging();
    setRemoteHandlerEventBus({ emit: vi.fn() });
    setStreetview360Dependencies({ eventBus: { emit: vi.fn() } });
    mapA = { id: crypto.randomUUID(), name: 'Ativo', features: {} };
    mapB = { id: crypto.randomUUID(), name: 'Destino', features: {} };
    await localRepository.saveMap(mapA.id, mapA);
    await localRepository.saveMap(mapB.id, mapB);
    mapResolver.registerMap(mapA.name, mapA.id);
    mapResolver.registerMap(mapB.name, mapB.id);
    memoryStore.currentMap = mapA.name;
    clearStreetview360Cache();
});

describe('Streetview360 write-ahead persistence', () => {
    it('orientação e marcador registram a intenção no mapa ALVO antes do documento sv360', async () => {
        const original = LocalRepository.prototype.saveStreetview360;
        const seen = new Set();
        vi.spyOn(LocalRepository.prototype, 'saveStreetview360').mockImplementation(async function (key, value) {
            const fresh = (await operationQueue.getAll()).filter(op => !seen.has(op.id));
            expect(fresh).toHaveLength(1);
            expect(fresh[0].mapId).toBe(mapB.id);
            // Enfileirada, porém NÃO enviável: a marca de materialização só cai depois da
            // gravação da entidade, e é ela que `peek` respeita.
            expect((await operationQueue.peek()).some(op => op.id === fresh[0].id)).toBe(false);
            seen.add(fresh[0].id);
            return original.call(this, key, value);
        });

        await saveOrientation('photo-1.jpg', { lon: 1, lat: 2, fov: 70 }, mapB.name);
        await saveOrientation('photo-1.jpg', { lon: 3, lat: 4, fov: 60 }, mapB.name);
        await clearOrientation('photo-1.jpg', mapB.name);
        const marker = await seedMarker();
        await updateMarker360(marker.id, { properties: { nome: 'B' } }, mapB.name);
        await removeMarker360(marker.id, mapB.name);

        expect(seen.size).toBe(6);
        expect((await operationQueue.getAll()).map(op => `${op.entityType}:${op.operationType}`)).toEqual([
            'orientation360:create', 'orientation360:update', 'orientation360:delete',
            'marker360:create', 'marker360:update', 'marker360:delete'
        ]);
        // Depois de gravadas, as seis são enviáveis, e nenhuma tocou o mapa que estava ativo.
        expect((await operationQueue.peek(10))).toHaveLength(6);
        const ativo = await localRepository.getStreetview360(mapA.id);
        expect(ativo.markers).toEqual([]);
        expect(ativo.orientations).toEqual({});
    });

    it('a remoção em lote por foto compartilha UMA escrita de diário, uma op por marcador', async () => {
        const a = await seedMarker();
        const b = await seedMarker();
        const outra = await addMarker360('photo-2.jpg', { position: { heading: 0, pitch: 0 }, properties: {} }, mapB.name);
        const antes = (await operationQueue.getAll()).length;
        expect(antes).toBe(3);

        let noMomentoDaGravacao = null;
        const original = LocalRepository.prototype.saveStreetview360;
        vi.spyOn(LocalRepository.prototype, 'saveStreetview360').mockImplementation(async function (key, value) {
            noMomentoDaGravacao = (await operationQueue.getAll()).length;
            return original.call(this, key, value);
        });

        expect(await removeMarkers360ByPhoto('photo-1.jpg', mapB.name)).toBe(2);
        // As duas exclusões já estavam no diário quando a gravação começou.
        expect(noMomentoDaGravacao).toBe(antes + 2);
        const deletes = (await operationQueue.getAll()).filter(op => op.operationType === 'delete');
        expect(deletes.map(op => op.entityId).sort()).toEqual([a.id, b.id].sort());
        expect(deletes.every(op => op.mapId === mapB.id)).toBe(true);
        const stored = await localRepository.getStreetview360(mapB.id);
        expect(stored.markers.find(m => m.id === outra.id).sync.deleted).toBe(false);
    });

    it('falha do diário não muda o documento lateral nem a entrada do chamador', async () => {
        // Um valor não clonável reprova a escrita na fila, que é a PRIMEIRA das duas.
        const markerData = { position: { heading: 0, pitch: 0 }, properties: { nome: 'X', ao: () => {} } };
        const persist = vi.spyOn(LocalRepository.prototype, 'saveStreetview360');

        await expect(addMarker360('photo-1.jpg', markerData, mapB.name)).rejects.toThrow();

        expect(persist).not.toHaveBeenCalled();
        expect(await operationQueue.count()).toBe(0);
        expect((await localRepository.getStreetview360(mapB.id)).markers).toEqual([]);
        expect(markerData.properties.ao).toBeTypeOf('function');
    });

    it('quota depois do diário preserva a intenção original e o snapshot a recupera uma vez', async () => {
        vi.spyOn(LocalRepository.prototype, 'saveStreetview360')
            .mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));

        await expect(saveOrientation('photo-1.jpg', { lon: 7, lat: 8, fov: 90 }, mapB.name)).rejects.toThrow('quota');

        const pending = await operationQueue.getAll();
        expect(pending).toHaveLength(1);
        expect(pending[0].data.lon).toBe(7);
        // Preparada e não materializada: o envio não a alcança.
        expect(await operationQueue.peek()).toEqual([]);
        expect((await localRepository.getStreetview360(mapB.id)).orientations).toEqual({});

        vi.restoreAllMocks();
        const snapshot = {
            atlas: { ...createAtlas('Atlas'), id: getActiveScope().atlasId },
            maps: [mapA, { ...mapB, streetview360: { orientations: { 'photo-1.jpg': pending[0].data }, markers: [] } }],
            briefings: [], currentVersion: 1
        };
        await applyRemoteSnapshot(snapshot);
        expect((await localRepository.getStreetview360(mapB.id)).orientations['photo-1.jpg'].lon).toBe(7);
        // O snapshot não consome nem duplica a fila; a op preparada continua lá, intacta.
        expect(await operationQueue.getAll()).toEqual(pending);
        await applyRemoteSnapshot(snapshot);
        expect(Object.keys((await localRepository.getStreetview360(mapB.id)).orientations)).toHaveLength(1);
        expect(await operationQueue.getAll()).toEqual(pending);
    });

    it('escritas concorrentes na mesma foto preservam todos os marcadores', async () => {
        const criados = await Promise.all(Array.from({ length: 8 }, (_, i) => addMarker360(
            'photo-1.jpg', { position: { heading: i, pitch: 0 }, properties: { nome: `P${i}` } }, mapB.name
        )));
        const stored = await localRepository.getStreetview360(mapB.id);
        expect(new Set(stored.markers.map(m => m.id))).toEqual(new Set(criados.map(m => m.id)));
        expect((await operationQueue.getAll()).map(op => op.mapId)).toEqual(criados.map(() => mapB.id));
    });

    // =========================================================================================
    // O CRUZAMENTO ENTRE O ESCRITOR LOCAL E O APPLY REMOTO (2026-09-16)
    //
    // O caso acima ("escritas concorrentes na mesma foto") prova a exclusão entre DOIS ESCRITORES
    // LOCAIS, e passava verde enquanto o documento se perdia em produção, porque o segundo
    // escritor do mundo real não é local: é a operação do colega. `serializeGuardedApply` ordena
    // remoto contra remoto, nunca remoto contra local, e o apply do 360 gravava o documento
    // inteiro sem tomar a trava que `addMarker360` toma.
    //
    // A INTERCALAÇÃO PERDEDORA É FORÇADA, e não sorteada: estatística de corrida não converge, e
    // um verde único é indistinguível do determinístico. O portão prende a PRIMEIRA leitura do
    // documento; sem a trava, o escritor local atravessa por baixo e grava, e a gravação do
    // remoto (que leu antes) o apaga.
    // =========================================================================================
    it('op remota que cruza com a escrita local preserva os DOIS marcadores', async () => {
        const marcadorA = await seedMarker();

        let liberar;
        let entrou;
        const leituraEmCurso = new Promise(resolve => { entrou = resolve; });
        const portao = new Promise(resolve => { liberar = resolve; });
        const original = LocalRepository.prototype.getStreetview360;
        vi.spyOn(LocalRepository.prototype, 'getStreetview360').mockImplementationOnce(async function (key) {
            const documento = await original.call(this, key);
            entrou();
            await portao;
            return documento;
        });

        // O remoto entra primeiro e fica preso na leitura; o local só depois.
        const remoto = applyRemoteOperation({
            entityType: EntityType.MARKER_360, operationType: OperationType.CREATE,
            entityId: 'm360-remoto', mapId: mapB.id,
            data: { id: 'm360-remoto', photoName: 'photo-1.jpg', position: { heading: 99, pitch: 0 } },
        });
        await leituraEmCurso;
        const local = addMarker360('photo-1.jpg', {
            position: { heading: 42, pitch: 0 }, properties: { nome: 'Local' }
        }, mapB.name);

        // Espaço de sobra para o escritor local terminar, se nada o estiver segurando.
        await new Promise(resolve => setTimeout(resolve, 20));
        liberar();
        const [, marcadorLocal] = await Promise.all([remoto, local]);

        const ids = (await localRepository.getStreetview360(mapB.id)).markers.map(m => m.id);
        expect(ids).toContain(marcadorA.id);
        expect(ids).toContain('m360-remoto');
        expect(ids).toContain(marcadorLocal.id);
    });

    it('delete remoto que cruza com a escrita local não ressuscita o marcador apagado', async () => {
        // O sentido oposto do mesmo defeito, e o que o chefe descreve como "apaguei e voltou": o
        // documento relido antes do delete é o que vai ao disco depois dele.
        //
        // O ALVO É UM MARCADOR DO PAR, e não um local, de propósito: sobre uma entidade com edição
        // local PENDENTE o guard de convergência adia a op remota, que é o comportamento certo e
        // mediria outra coisa.
        await applyRemoteOperation({
            entityType: EntityType.MARKER_360, operationType: OperationType.CREATE,
            entityId: 'm360-do-par', mapId: mapB.id,
            data: { id: 'm360-do-par', photoName: 'photo-1.jpg', position: { heading: 7, pitch: 0 } },
        });
        const alvo = { id: 'm360-do-par' };

        let liberar;
        let entrou;
        const leituraEmCurso = new Promise(resolve => { entrou = resolve; });
        const portao = new Promise(resolve => { liberar = resolve; });
        const original = LocalRepository.prototype.getStreetview360;
        vi.spyOn(LocalRepository.prototype, 'getStreetview360').mockImplementationOnce(async function (key) {
            const documento = await original.call(this, key);
            entrou();
            await portao;
            return documento;
        });

        const localNovo = addMarker360('photo-1.jpg', {
            position: { heading: 1, pitch: 0 }, properties: { nome: 'Novo' }
        }, mapB.name);
        await leituraEmCurso;
        const remoto = applyRemoteOperation({
            entityType: EntityType.MARKER_360, operationType: OperationType.DELETE,
            entityId: alvo.id, mapId: mapB.id, data: null,
        });

        await new Promise(resolve => setTimeout(resolve, 20));
        liberar();
        const [marcadorNovo] = await Promise.all([localNovo, remoto]);

        const ids = (await localRepository.getStreetview360(mapB.id)).markers.map(m => m.id);
        expect(ids).not.toContain(alvo.id);
        expect(ids).toContain(marcadorNovo.id);
    });

    it('troca de escopo durante a leitura não escreve em nenhum dos dois atlas', async () => {
        const source = getActiveScope();
        let release;
        let entered;
        const reading = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        vi.spyOn(LocalRepository.prototype, 'getStreetview360').mockImplementationOnce(async () => {
            entered(); await gate; return { orientations: {}, markers: [] };
        });

        const write = saveOrientation('photo-1.jpg', { lon: 5, lat: 5, fov: 50 }, mapB.name);
        const rejected = expect(write).rejects.toThrow('atlas mudou');
        await reading;
        activateScope(remoteScope(crypto.randomUUID()));
        release();
        await rejected;

        expect(await operationQueue.forScope(source).getAll()).toEqual([]);
        expect(await operationQueue.count()).toBe(0);
        expect((await localRepository.forScope(source).getStreetview360(mapB.id)).orientations).toEqual({});
    });
});
