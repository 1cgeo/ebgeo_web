// Path: tests/integration/nome-de-mapa-repetido.repro.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * @fileoverview "Novo mapa", "Duplicar" e "Renomear" com o nome de OUTRO mapa do atlas.
 *
 * O DEFEITO (achado pela revisão final da caça noturna de 2026-09-24, lido no código). Nenhuma das
 * três portas conferia se o nome já existia. Num atlas LOCAL o documento do mapa é guardado com o
 * NOME como chave (`mintMapDocument` com a sincronização desligada, e `LocalRepository.saveMap`
 * faz um `setItem` puro), então "Novo mapa" chamado "Principal" regravava o Principal com um mapa
 * vazio e as feições dele sumiam. Num atlas de servidor o resultado eram dois mapas com o mesmo
 * nome, e o resolvedor de nome para id passa a apontar para um só deles.
 *
 * O CONSERTO mora no `MapManager`, que é a porta das três ações da interface: o nome de outro mapa
 * é recusado antes de qualquer escrita, com uma frase que diz o que fazer.
 */

const { storeMock } = vi.hoisted(() => ({
    storeMock: {
        addMap: vi.fn(async () => ({})),
        renameMap: vi.fn(async () => true),
        setCurrentMap: vi.fn(async () => {}),
        getAllMapNamesStore: vi.fn(async () => ['Principal', 'Outro']),
        getMapDataStore: vi.fn(async (name) => ({ name, features: { points: [] } })),
    },
}));

vi.mock('../../src/js/store', () => ({
    addMap: storeMock.addMap,
    addFeature: vi.fn(),
    removeMap: vi.fn(),
    renameMap: storeMock.renameMap,
    setCurrentMap: storeMock.setCurrentMap,
    saveMapView: vi.fn(),
    getMapTemporalConfig: vi.fn(),
    setMapTemporalConfig: vi.fn(),
    isMapTemporalEnabledSync: vi.fn(() => false),
    hasMapSavedPosition: vi.fn(),
    clearMapView: vi.fn(),
    getAllMapNamesStore: storeMock.getAllMapNamesStore,
    getCurrentMapName: vi.fn(async () => 'Principal'),
    moveFeaturesToMap: vi.fn(),
    clearAllDataStore: vi.fn(),
    getMapDataStore: storeMock.getMapDataStore,
    getColorUsage: vi.fn(),
    getMapNotes: vi.fn(),
    setMapOrder: vi.fn(),
    getLayerManager: vi.fn(),
    getLayersRepo: vi.fn(),
    getGroupManager: vi.fn(),
    getCesium3dDataForExport: vi.fn(),
    setCesium3dDataForImport: vi.fn(),
    getStreetview360DataForExport: vi.fn(),
    setStreetview360DataForImport: vi.fn(),
    getEmptyCesium3dData: vi.fn(),
    isMapLocked: vi.fn(async () => false),
}));

vi.mock('../../src/js/utilities', () => ({ IDUtils: { regenerateMapIds: vi.fn() } }));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: { UPDATE_MAP: 'EDIT', DELETE_MAP: 'DELETE', CREATE_MAP: 'EDIT' },
}));

vi.mock('../../src/js/store/store.constants.js', () => ({ DEFAULT_MAP_NAME: 'Principal' }));

import MapManager from '../../src/js/map/map.manager.js';

let manager;

beforeEach(() => {
    vi.clearAllMocks();
    storeMock.getAllMapNamesStore.mockResolvedValue(['Principal', 'Outro']);
    manager = new MapManager(null, null);
});

describe('um nome que já é de outro mapa é recusado antes de qualquer escrita', () => {
    it('"Novo mapa" com o nome de um mapa existente não regrava aquele mapa', async () => {
        const result = await manager.createMap('Principal');

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/Já existe um mapa/);
        expect(storeMock.addMap).not.toHaveBeenCalled();
        expect(storeMock.setCurrentMap).not.toHaveBeenCalled();
    });

    it('o nome é comparado DEPOIS de aparar os espaços', async () => {
        const result = await manager.createMap('   Principal  ');

        expect(result.success).toBe(false);
        expect(storeMock.addMap).not.toHaveBeenCalled();
    });

    it('CONTROLE: um nome livre continua criando o mapa', async () => {
        const result = await manager.createMap('Mapa Novo');

        expect(result.success).toBe(true);
        expect(storeMock.addMap).toHaveBeenCalledWith('Mapa Novo');
    });

    it('"Duplicar" para o nome de outro mapa não chega à cópia', async () => {
        const result = await manager.copyMap('Principal', 'Outro');

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/Já existe um mapa/);
        expect(storeMock.addMap).not.toHaveBeenCalled();
        expect(storeMock.getMapDataStore).not.toHaveBeenCalled();
    });

    it('"Renomear" para o nome de OUTRO mapa não chega à store', async () => {
        const result = await manager.renameMap('Principal', 'Outro');

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/Já existe um mapa/);
        expect(storeMock.renameMap).not.toHaveBeenCalled();
        expect(storeMock.setCurrentMap).not.toHaveBeenCalled();
    });

    it('CONTROLE: renomear para um nome livre continua renomeando', async () => {
        const result = await manager.renameMap('Principal', 'Base');

        expect(result.success).toBe(true);
        expect(storeMock.renameMap).toHaveBeenCalledWith('Principal', 'Base');
    });
});
