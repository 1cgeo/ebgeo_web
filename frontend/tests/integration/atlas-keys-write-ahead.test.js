// Path: tests/integration/atlas-keys-write-ahead.test.js
//
// O DIÁRIO ANTES DA CHAVE DE ATLAS: ordem de mapas, cores de crachá e aparência do projeto. As
// três gravavam a chave e só depois logavam a op, então uma falha entre as duas perdia a
// intenção sem rastro, e o sintoma é o pior possível para quem usa: a escolha vale nesta máquina
// e em nenhuma outra, para sempre. Molde: `catalog-write-ahead.test.js`.
//
// AS TRÊS COMPARTILHAM A CHAVE DE COMPACTAÇÃO `<escopo>:setting:<atlas>`, então o `entityId`
// decide se a intenção é durável: uma op de `setting` cujo id não seja UUID nem a sentinela
// `'atlas'` é DESCARTADA antes da fila (o Postgres recusa o id e a op reprovaria o lote inteiro).
// É o que `resolveAtlasSettingId` responde, e é por isso que ele é afirmado aqui nos dois ramos.
//
// O caso de renomear e o de excluir não medem conteúdo: eles medem que `setMapBadgeColors`, que
// abre a PRÓPRIA transação, continua sendo chamada de FORA da seção de `withMapDocument` dos
// dois. A fila de `document-lock.js` é FIFO e sem reentrância, então o dia em que isso deixar de
// valer estes dois casos PENDURAM em vez de ficar vermelhos, e é bom saber disso antes.

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
    setMapOrder,
    getMapOrder,
    setMapBadgeColors,
    getMapBadgeColors,
    removeMapBadgeColor,
    renameMap,
    removeMap,
    setMapDependencies
} from '../../src/js/store/map.operations.js';
import { saveAtlasAppearance, readAtlasAppearance } from '../../src/js/store/atlas-appearance.service.js';
import { resolveAtlasSettingId, ATLAS_SETTING_SENTINEL } from '../../src/js/store/atlas-setting-target.js';

vi.mock('../../src/js/store/sync/permission-guard.js', async importOriginal => ({
    ...await importOriginal(), checkPermission: () => ({ allowed: true })
}));

vi.mock('../../src/js/config.js', () => ({
    default: {
        basemaps: { 'carta-topografica': { enabled: true }, osm: { enabled: true } },
        getValidBasemapFallback: () => 'carta-topografica'
    }
}));

let mapA;
let mapB;

beforeEach(async () => {
    vi.restoreAllMocks();
    const storage = new Map();
    vi.stubGlobal('localStorage', {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key)
    });
    activateScope(remoteScope(crypto.randomUUID()));
    setRepository(new LocalRepository(getActiveScope()));
    enableOperationLogging();
    setMapDependencies({
        eventBus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
        groupManager: { loadGroupsToMemory: vi.fn(async () => {}), clearMapGroups: vi.fn(async () => {}) },
        layerManager: { loadLayersToMemory: vi.fn(async () => {}), clearLayersCache: vi.fn() }
    });
    mapA = { id: crypto.randomUUID(), name: 'Ativo', features: {} };
    mapB = { id: crypto.randomUUID(), name: 'Destino', features: {} };
    await localRepository.saveMap(mapA.id, mapA);
    await localRepository.saveMap(mapB.id, mapB);
    mapResolver.registerMap(mapA.name, mapA.id);
    mapResolver.registerMap(mapB.name, mapB.id);
    memoryStore.currentMap = mapA.name;
    memoryStore.lockedMaps.clear();
});

describe('Atlas-key write-ahead persistence', () => {
    it('o id da op de chave vem do escopo remoto, e cai na sentinela sem registro local', async () => {
        const scope = getActiveScope();
        expect(await resolveAtlasSettingId(scope)).toBe(scope.atlasId);
        // Escopo local sem linha de Atlas no slot: a sentinela é a resposta honesta, e o servidor
        // escopa a chave pelo atlas da ROTA, então ela aplica o patch no projeto certo.
        expect(await resolveAtlasSettingId({ kind: 'local' })).toBe(ATLAS_SETTING_SENTINEL);
        expect(await resolveAtlasSettingId(null, { id: mapA.id })).toBe(mapA.id);
    });

    it('ordem, cores e aparência registram a intenção antes de gravar a chave', async () => {
        const scope = getActiveScope();
        const originalSetting = LocalRepository.prototype.saveSetting;
        const originalAtlas = LocalRepository.prototype.saveAtlas;
        const seen = new Set();
        const observe = async () => {
            const fresh = (await operationQueue.getAll()).filter(op => !seen.has(op.id));
            expect(fresh).toHaveLength(1);
            expect(fresh[0].entityType).toBe('setting');
            expect(fresh[0].entityId).toBe(scope.atlasId);
            expect(fresh[0].mapId).toBeNull();
            // Preparada: a projeção local é a gravação que está começando agora.
            expect((await operationQueue.peek()).some(op => op.id === fresh[0].id)).toBe(false);
            seen.add(fresh[0].id);
        };
        vi.spyOn(LocalRepository.prototype, 'saveSetting').mockImplementation(async function (key, value) {
            await observe();
            return originalSetting.call(this, key, value);
        });
        vi.spyOn(LocalRepository.prototype, 'saveAtlas').mockImplementation(async function (atlas) {
            await observe();
            return originalAtlas.call(this, atlas);
        });

        await setMapOrder([mapB.name, mapA.name]);
        await setMapBadgeColors({ [mapA.name]: '#3b82f6' });
        expect(await saveAtlasAppearance({ terrainExaggeration: 2, globeProjection: false })).toBe(true);

        expect(seen.size).toBe(3);
        const journal = await operationQueue.getAll();
        expect(journal.map(op => op.data)).toEqual([
            { mapOrder: [mapB.name, mapA.name] },
            { mapBadgeColors: { [mapA.name]: '#3b82f6' } },
            { terrainExaggeration: 2, globeProjection: false }
        ]);
        // Materializadas: as três estão prontas para envio.
        expect((await operationQueue.peek()).map(op => op.id)).toEqual(journal.map(op => op.id));

        expect(await getMapOrder()).toEqual([mapB.name, mapA.name]);
        expect(await getMapBadgeColors()).toEqual({ [mapA.name]: '#3b82f6' });
        expect(await readAtlasAppearance()).toEqual({ terrainExaggeration: 2, globeProjection: false });
    });

    it('a intenção carrega o valor ANTERIOR da chave, lido do disco', async () => {
        await setMapOrder([mapA.name, mapB.name]);
        await setMapBadgeColors({ [mapA.name]: '#3b82f6' });
        await saveAtlasAppearance({ terrainExaggeration: 2 });

        await setMapOrder([mapB.name, mapA.name]);
        await removeMapBadgeColor(mapA.name);
        await saveAtlasAppearance({ terrainExaggeration: 3 });

        const journal = await operationQueue.getAll();
        expect(journal.slice(3).map(op => op.previousData)).toEqual([
            { mapOrder: [mapA.name, mapB.name] },
            { mapBadgeColors: { [mapA.name]: '#3b82f6' } },
            { terrainExaggeration: 2 }
        ]);
        // A primeira aparência já tem valor anterior, e ele é o PADRÃO que `ensureAtlas` grava ao
        // criar a linha (1.5), não `null`: o slot nasce com a aparência padrão, não sem ela.
        expect(journal[2].previousData).toEqual({ terrainExaggeration: 1.5 });
    });

    it('falha do diário não muda a chave nem deixa op na fila', async () => {
        // Intenção não serializável: `structuredClone` recusa a função, e é o diário que tenta
        // cloná-la, antes de a gravação da chave rodar.
        const persist = vi.spyOn(LocalRepository.prototype, 'saveSetting');
        await expect(setMapOrder([() => mapA.name])).rejects.toThrow();
        expect(persist).not.toHaveBeenCalled();
        expect(await operationQueue.count()).toBe(0);
        expect(await getMapOrder()).toEqual([]);
    });

    it('a aparência PROPAGA a falha de persistência em vez de devolver false', async () => {
        // O `try/catch` que engolia tudo devolvia `false` para quota e para escrita cancelada, e o
        // modal, que não lê o retorno, dizia "Configurações salvas." e fechava.
        vi.spyOn(LocalRepository.prototype, 'saveAtlas')
            .mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));
        await expect(saveAtlasAppearance({ terrainExaggeration: 3 })).rejects.toThrow('quota');
        // A intenção sobreviveu, preparada e não enviável, e o disco não mudou.
        expect((await operationQueue.countByState()).preparadas).toBe(1);
        expect(await operationQueue.peek()).toEqual([]);
        expect((await readAtlasAppearance()).terrainExaggeration).toBe(1.5);
    });

    it('a aparência devolve false, sem op, quando não há o que gravar', async () => {
        expect(await saveAtlasAppearance({})).toBe(false);
        expect(await saveAtlasAppearance({ chaveInventada: 7 })).toBe(false);
        expect(await operationQueue.count()).toBe(0);
    });

    it('renomear o mapa não trava e leva a cor com ele', async () => {
        await setMapBadgeColors({ [mapA.name]: '#3b82f6' });
        await operationQueue.clear();

        expect(await renameMap(mapA.name, 'Renomeado')).toBe(true);

        expect(await getMapBadgeColors()).toEqual({ Renomeado: '#3b82f6' });
        const colorOps = (await operationQueue.getAll()).filter(op => op.data?.mapBadgeColors);
        expect(colorOps).toHaveLength(1);
        expect(colorOps[0].previousData).toEqual({ mapBadgeColors: { [mapA.name]: '#3b82f6' } });
    });

    it('excluir o mapa não trava e tira a cor da chave', async () => {
        memoryStore.currentMap = mapA.name;
        await setMapBadgeColors({ [mapA.name]: '#3b82f6', [mapB.name]: '#f59e0b' });
        await operationQueue.clear();

        expect((await removeMap(mapB.name)).success).toBe(true);

        expect(await getMapBadgeColors()).toEqual({ [mapA.name]: '#3b82f6' });
        expect((await operationQueue.getAll()).filter(op => op.data?.mapBadgeColors)).toHaveLength(1);
    });

    it('troca de escopo durante a leitura não escreve em nenhum dos dois atlas', async () => {
        const source = getActiveScope();
        let release;
        let entered;
        const reading = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        vi.spyOn(LocalRepository.prototype, 'getSetting').mockImplementationOnce(async () => {
            entered(); await gate; return [];
        });

        const write = setMapOrder([mapB.name]);
        const rejected = expect(write).rejects.toThrow('atlas mudou');
        await reading;
        activateScope(remoteScope(crypto.randomUUID()));
        release();
        await rejected;

        expect(await operationQueue.forScope(source).getAll()).toEqual([]);
        expect(await operationQueue.count()).toBe(0);
        expect(await localRepository.forScope(source).getSetting('mapOrder')).toBeNull();
    });

    it('escritas concorrentes na mesma chave registram as duas intenções', async () => {
        await Promise.all([
            setMapBadgeColors({ [mapA.name]: '#3b82f6' }),
            setMapOrder([mapB.name, mapA.name])
        ]);
        expect((await operationQueue.getAll()).map(op => Object.keys(op.data)[0]).sort())
            .toEqual(['mapBadgeColors', 'mapOrder']);
        expect(await getMapOrder()).toEqual([mapB.name, mapA.name]);
        expect(await getMapBadgeColors()).toEqual({ [mapA.name]: '#3b82f6' });
    });
});
