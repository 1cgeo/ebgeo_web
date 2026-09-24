// Path: tests/store/atributo-le-o-documento-sob-a-trava.repro.test.js

/**
 * @fileoverview Gravar um ATRIBUTO não pode desfazer o que um colega mudou na mesma feição
 * entre a leitura e a gravação.
 *
 * O DEFEITO (2026-09-24). `userDataManager._updateFeature` (`user_data/user_data_manager.js`),
 * por onde passam criar, editar, renomear e excluir atributo e foto (a aba Atributos do painel e a
 * célula de atributo da tabela), lia o documento do mapa FORA da trava do documento, aplicava a
 * mudança num clone e entregava a feição INTEIRA a `updateFeature`. Uma op do colega aplicada
 * entre a leitura e a trava (o caminho de entrada toma a MESMA trava) era desfeita pela gravação,
 * e o patch que sai para o servidor levava o valor velho com a base já atualizada: o servidor
 * aceitava, e a edição do colega sumia em todo lugar.
 *
 * A INTERLEAVING PERDEDORA É DETERMINÍSTICA AQUI: a leitura do gerente de atributos segura um
 * gancho, e o "colega" grava pelo caminho real da store (sob a trava) enquanto ela está segurada.
 * Mesmo arnês de `concurrent-document-writes.repro.test.js`: repositório em memória com clone
 * estruturado nos dois sentidos, `feature.operations.js` REAL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEmptyMapData } from '../../src/js/store/repository.utils.js';

const h = vi.hoisted(() => ({
    docs: new Map(),
    /** Awaited by the attribute manager's own read, AFTER it read. */
    afterUserRead: null,
    mapManager: {
        getCurrentMapName: vi.fn(() => 'TestMap'),
        getCurrentMapId: vi.fn(() => 'map-uuid-123'),
        getMapId: vi.fn(() => 'map-uuid-123'),
        getFeatureColor: vi.fn(() => null),
        getFeatureColors: vi.fn(() => []),
        updateColorUsage: vi.fn(),
        recordAction: vi.fn(),
    },
    config: {
        map2d: { hillshade: { enabled: false } },
        analysisLayers: { enabled: false, layers: [] },
        dataLayers: { enabled: false, layers: [] },
        tilesets: [],
    },
}));

const tick = async (n = 1) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

vi.mock('../../src/js/store/repositories/index.js', () => {
    const ler = async (mapName) => {
        await tick(1);
        const raw = h.docs.get(mapName);
        return raw ? JSON.parse(raw) : null;
    };
    return {
        getExistingMapData: vi.fn(ler),
        getMapDataCompat: vi.fn(async (mapName) => (await ler(mapName)) ?? getEmptyMapData()),
        updateMapDataCompat: vi.fn(async (mapName, data) => {
            await tick(2);
            h.docs.set(mapName, JSON.stringify(data));
        }),
        getLayersCompat: vi.fn(async () => []),
    };
});

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_PERSIST_ERROR: 'store:persistError',
        STORE_SYNC_ERROR: 'store:syncError',
        STORE_OPERATION_BLOCKED: 'store:operationBlocked',
    },
    emitStoreError: vi.fn(),
}));

vi.mock('../../src/js/store/store-origin.js', () => ({
    StoreOriginKind: { LOCAL: 'local', REMOTE: 'remote' },
    isRemoteStoreSync: vi.fn(() => false),
    getStoreOriginSync: vi.fn(() => ({ kind: 'local', atlasId: null })),
    loadStoreOrigin: vi.fn(async () => ({ kind: 'local', atlasId: null })),
    setStoreOrigin: vi.fn(async () => {}),
    markStoreRemote: vi.fn(async () => {}),
    markStoreLocal: vi.fn(async () => {}),
}));

vi.mock('../../src/js/store/map.operations.js', () => ({ isCurrentMapLockedSync: vi.fn(() => false) }));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logFeatureOperation: vi.fn().mockResolvedValue(undefined),
    logCatalogLayerOperation: vi.fn(),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' },
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({ default: h.mapManager }));
vi.mock('../../src/js/store/memory-store.js', () => ({ memoryStore: { lockedMaps: new Set(), currentMap: 'TestMap' } }));
vi.mock('../../src/js/config.js', () => ({ default: h.config }));

// O gerente de atributos importa a store pelo BARRIL: aqui ele recebe a leitura do documento com o
// gancho e a `updateFeature` REAL.
vi.mock('@store', async () => {
    const real = await import('../../src/js/store/feature.operations.js');
    const constants = await import('../../src/js/store/store.constants.js');
    return {
        getMapData: vi.fn(async (mapName) => {
            const raw = h.docs.get(mapName);
            const doc = raw ? JSON.parse(raw) : null;
            if (h.afterUserRead) await h.afterUserRead();
            return doc;
        }),
        updateFeature: (...args) => real.updateFeature(...args),
        getCurrentMapNameSync: () => 'TestMap',
        getStorageTypeFromSource: constants.getStorageTypeFromSource,
        getEventBus: () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() }),
    };
});
vi.mock('@sidebar/panels/notes-panel.js', () => ({ sanitizeHtml: (s) => s }));

const { updateFeatureProperty, setFeatureDependencies } = await import('../../src/js/store/feature.operations.js');
const { resetDocumentLocks } = await import('../../src/js/store/document-lock.js');
const userDataManager = (await import('../../src/js/user_data/user_data_manager.js')).default;

const MAP = 'TestMap';
const ID = 'feat-1';

function persistida() {
    return JSON.parse(h.docs.get(MAP)).features.points.find((f) => f.properties.id === ID);
}

beforeEach(() => {
    h.docs.clear();
    h.afterUserRead = null;
    resetDocumentLocks();
    const doc = getEmptyMapData();
    doc.features.points.push({
        type: 'Feature', id: ID,
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { id: ID, source: 'point', nome: 'Original', layerId: 'default', attributes: { cota: '1' } },
    });
    h.docs.set(MAP, JSON.stringify(doc));
    setFeatureDependencies({ eventBus: null, layerManager: null, groupManager: { removeFeatureFromAllGroups: () => null } });
});

/** Segura a leitura do gerente e deixa o "colega" gravar pela store real enquanto ela está segurada. */
function colegaGravaNoMeio(fn) {
    h.afterUserRead = async () => {
        h.afterUserRead = null;
        await fn();
    };
}

describe('o gerente de atributos le e grava sob a mesma trava', () => {
    it('editar um atributo nao desfaz o nome que o colega deu no meio', async () => {
        colegaGravaNoMeio(() => updateFeatureProperty('points', ID, 'nome', 'Do colega'));
        await userDataManager.setAttribute(ID, 'point', 'cota', '2');
        const f = persistida();
        expect(f.properties.attributes.cota, 'o atributo gravou').toBe('2');
        expect(f.properties.nome, 'o nome do colega sobreviveu').toBe('Do colega');
    });

    it('editar um atributo nao desfaz o OUTRO atributo que o colega criou no meio', async () => {
        colegaGravaNoMeio(async () => {
            const doc = JSON.parse(h.docs.get(MAP));
            const atual = doc.features.points.find((x) => x.properties.id === ID);
            await updateFeatureProperty('points', ID, 'attributes', { ...atual.properties.attributes, dono: 'B' });
        });
        await userDataManager.setAttribute(ID, 'point', 'cota', '3');
        expect(persistida().properties.attributes).toEqual({ cota: '3', dono: 'B' });
    });

    it('excluir um atributo nao desfaz o nome do colega, e diz que excluiu', async () => {
        colegaGravaNoMeio(() => updateFeatureProperty('points', ID, 'nome', 'Do colega'));
        expect(await userDataManager.removeAttribute(ID, 'point', 'cota')).toBe(true);
        const f = persistida();
        expect(Object.hasOwn(f.properties.attributes ?? {}, 'cota')).toBe(false);
        expect(f.properties.nome).toBe('Do colega');
    });

    it('CONTROLE: sem colega no meio, o atributo grava e o resto fica', async () => {
        await userDataManager.setAttribute(ID, 'point', 'cota', '9');
        const f = persistida();
        expect(f.properties.attributes).toEqual({ cota: '9' });
        expect(f.properties.nome).toBe('Original');
    });
});
