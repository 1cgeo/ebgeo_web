// Path: tests/integration/group-write-ahead.test.js
//
// O diário das duas entradas de grupo migradas no bloco B4 (`updateGroupProperty` e
// `ungroupFeatures`), contra o despachante REAL e o IndexedDB REAL. Molde:
// tests/integration/catalog-write-ahead.test.js.
//
// DUAS PROPRIEDADES SÃO PRÓPRIAS DESTE ARQUIVO, e nenhuma delas existia antes:
//
//  1. A escrita saiu do `setTimeout(0)`. `_saveGroupsToDBAsync` agendava a gravação para um
//     tick futuro com um `catch` que só logava, então a edição já estava na tela e na memória
//     quando o disco falhava, sem ninguém avisado. Agora a gravação está DENTRO da transação,
//     e a memória só muda depois que ela confirma.
//  2. `ungroupFeatures` registra o `group` DELETE e NADA de membresia. O servidor soft-deleta
//     a linha e remonta membro só de grupo vivo, então uma op `group_feature` por membro seria
//     trabalho sem efeito dos dois lados.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateScope, getActiveScope, remoteScope } from '../../src/js/store/atlas-namespace.js';
import { LocalRepository, localRepository } from '../../src/js/store/repositories/local.repository.js';
import { setRepository } from '../../src/js/store/repositories/index.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { enableOperationLogging } from '../../src/js/store/sync/operation-dispatcher.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { mapResolver } from '../../src/js/store/services/map-resolver.service.js';
import { createGroupManager } from '../../src/js/tool_manager/group_manager.js';
import { createSyncMetadata } from '../../src/js/store/sync/sync-metadata.js';

let mapB;
let gm;

/** Seeds one live group with three members straight into the cache, as a snapshot would. */
function seedGroup(id = 'g1') {
    memoryStore.groups[mapB.name] = {
        [id]: {
            id,
            name: 'Grupo 1',
            features: [
                { type: 'point', id: 'f1' },
                { type: 'point', id: 'f2' },
                { type: 'point', id: 'f3' }
            ],
            visible: true,
            locked: false,
            sync: createSyncMetadata(null)
        }
    };
    return memoryStore.groups[mapB.name][id];
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
    mapB = { id: crypto.randomUUID(), name: 'Destino', features: {} };
    await localRepository.saveMap(mapB.id, mapB);
    mapResolver.registerMap(mapB.name, mapB.id);
    memoryStore.currentMap = mapB.name;
    memoryStore.groups = {};
    gm = createGroupManager({ emit: vi.fn() });
});

describe('Group write-ahead persistence', () => {
    it('a propriedade registra a intenção no mapa ALVO antes do documento de grupos', async () => {
        seedGroup();
        const original = LocalRepository.prototype.saveGroups;
        let visto = null;
        vi.spyOn(LocalRepository.prototype, 'saveGroups').mockImplementation(async function (key, value) {
            const fila = await operationQueue.getAll();
            expect(fila).toHaveLength(1);
            visto = fila[0];
            expect(visto.entityType).toBe('group');
            expect(visto.operationType).toBe('update');
            expect(visto.mapId).toBe(mapB.id);
            // Enfileirada, porém NÃO enviável: a marca de materialização só cai depois da
            // gravação, e é ela que `peek` respeita.
            expect(await operationQueue.peek()).toEqual([]);
            // A memória ainda mostra o estado ANTIGO: ela é espelho do disco, não da intenção.
            expect(memoryStore.groups[mapB.name].g1.visible).toBe(true);
            return original.call(this, key, value);
        });

        const atualizado = await gm.updateGroupProperty('g1', 'visible', false, mapB.name);

        expect(visto).not.toBeNull();
        expect(atualizado.visible).toBe(false);
        expect((await localRepository.getGroups(mapB.id)).g1.visible).toBe(false);
        expect(memoryStore.groups[mapB.name].g1.visible).toBe(false);
        expect(await operationQueue.peek(10)).toHaveLength(1);
    });

    it('desagrupar registra o `group` DELETE e NENHUMA op de membresia', async () => {
        const group = seedGroup();
        const features = await gm.ungroupFeatures('g1', mapB.name);

        expect(features.map(f => f.id)).toEqual(['f1', 'f2', 'f3']);
        const fila = await operationQueue.getAll();
        expect(fila).toHaveLength(1);
        expect(fila[0].entityType).toBe('group');
        expect(fila[0].operationType).toBe('delete');
        expect(fila[0].mapId).toBe(mapB.id);
        expect(fila[0].data).toBeNull();
        // O estado anterior viaja para o undo, com os três membros e ainda vivo.
        expect(fila[0].previousData.features).toHaveLength(3);
        expect(fila[0].previousData.sync.deleted).toBe(false);
        // Soft delete dos dois lados.
        expect((await localRepository.getGroups(mapB.id)).g1.sync.deleted).toBe(true);
        expect(gm.getGroupById('g1', mapB.name)).toBeNull();
        expect(group.sync.deleted, 'o documento anterior não é mutado no lugar').toBe(false);
    });

    it('gravação recusada PRESERVA a intenção e não mexe na memória', async () => {
        seedGroup();
        vi.spyOn(LocalRepository.prototype, 'saveGroups')
            .mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));

        await expect(gm.updateGroupProperty('g1', 'locked', true, mapB.name)).rejects.toThrow('quota');

        const pending = await operationQueue.getAll();
        expect(pending).toHaveLength(1);
        expect(pending[0].data.locked).toBe(true);
        // Preparada e não materializada: o envio não a alcança.
        expect(await operationQueue.peek()).toEqual([]);
        // A metade visível NÃO sobreviveu: nem disco nem memória mudaram. Era exatamente o
        // contrário com `_saveGroupsToDBAsync`, cujo `catch` só escrevia no console.
        expect(await localRepository.getGroups(mapB.id)).toEqual({});
        expect(memoryStore.groups[mapB.name].g1.locked).toBe(false);
    });

    it('falha do diário não muda o documento de grupos nem a memória', async () => {
        seedGroup();
        const persist = vi.spyOn(LocalRepository.prototype, 'saveGroups');

        // Um valor não clonável reprova a escrita na fila, que é a PRIMEIRA das duas.
        await expect(gm.updateGroupProperty('g1', 'style', { ao: () => {} }, mapB.name)).rejects.toThrow();

        expect(persist).not.toHaveBeenCalled();
        expect(await operationQueue.count()).toBe(0);
        expect(await localRepository.getGroups(mapB.id)).toEqual({});
        expect(memoryStore.groups[mapB.name].g1.style).toBeUndefined();
    });

    it('grupo ausente ou já dissolvido recusa sem escrever nada', async () => {
        seedGroup();
        await gm.ungroupFeatures('g1', mapB.name);
        await operationQueue.clear();

        await expect(gm.updateGroupProperty('g1', 'visible', false, mapB.name)).rejects.toThrow('não encontrado');
        await expect(gm.ungroupFeatures('fantasma', mapB.name)).rejects.toThrow('não encontrado');
        expect(await operationQueue.count()).toBe(0);
    });

    it('escritas concorrentes no mesmo mapa preservam todas as propriedades', async () => {
        memoryStore.groups[mapB.name] = {};
        for (let i = 0; i < 6; i++) {
            memoryStore.groups[mapB.name][`g${i}`] = {
                id: `g${i}`, name: `Grupo ${i}`, features: [{ type: 'point', id: `f${i}` }],
                visible: true, locked: false, sync: createSyncMetadata(null)
            };
        }

        await Promise.all(Array.from({ length: 6 }, (_, i) =>
            gm.updateGroupProperty(`g${i}`, 'name', `Renomeado ${i}`, mapB.name)));

        const stored = await localRepository.getGroups(mapB.id);
        expect(Object.keys(stored).sort()).toEqual(['g0', 'g1', 'g2', 'g3', 'g4', 'g5']);
        expect(Object.values(stored).map(g => g.name).sort())
            .toEqual(Array.from({ length: 6 }, (_, i) => `Renomeado ${i}`));
        expect((await operationQueue.getAll()).map(op => op.mapId)).toEqual(Array.from({ length: 6 }, () => mapB.id));
    });

    it('troca de escopo durante a transação não escreve em nenhum dos dois atlas', async () => {
        seedGroup();
        const source = getActiveScope();
        let release;
        let entered;
        const reading = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        // O ponto de espera é a escrita do DIÁRIO: é ela que abre a janela entre o preparo e a
        // gravação da entidade, que é onde o atlas pode ser desmontado. O espião vai no
        // PROTÓTIPO, e não no singleton: `persistOperationIntents` trabalha sobre
        // `operationQueue.forScope(scope)`, que devolve uma instância NOVA, então um espião no
        // singleton nunca é chamado e o caso passaria verde medindo uma transação inteira que
        // nunca foi interrompida (foi o que aconteceu na primeira versão deste caso).
        vi.spyOn(Object.getPrototypeOf(operationQueue), 'enqueueAll').mockImplementationOnce(async () => {
            entered();
            await gate;
        });

        const write = gm.updateGroupProperty('g1', 'visible', false, mapB.name);
        const rejected = expect(write).rejects.toThrow('atlas mudou');
        await reading;
        activateScope(remoteScope(crypto.randomUUID()));
        release();
        await rejected;

        expect(await operationQueue.forScope(source).getAll()).toEqual([]);
        expect(await localRepository.forScope(source).getGroups(mapB.id)).toEqual({});
        expect(memoryStore.groups[mapB.name].g1.visible).toBe(true);
    });
});
