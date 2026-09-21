// Path: tests/integration/duplicar-mapa-leva-config-temporal.repro.test.js

/**
 * @fileoverview Regressao: duplicar um mapa NAO copiava a configuracao temporal dele (S4).
 *
 * A CAUSA. `MapManager.copyMap` copia o documento do mapa (e com ele a camera e o mapa base,
 * porque `IDUtils.regenerateMapIds` clona o documento inteiro), as cores, as notas, as camadas,
 * os grupos, o 3D e o 360. A config temporal nao esta no documento: ela e um app setting
 * chaveado pelo NOME do mapa, entao a copia nascia com os padroes enquanto cada feicao copiada
 * mantinha suas datas. Duplicar um mapa com a linha do tempo salva LIGADA abria a copia com tudo
 * visivel de uma vez.
 *
 * O QUE A COPIA HERDA, e por que. A janela, a unidade, o modo e a origem sao ajustes do mapa. O
 * `ativo` e um TERCO da vista salva (`store/map-view.operations.js`), ao lado da camera e do
 * mapa base, e esses dois ja viajam dentro do documento: deixa-lo de fora entregaria a copia com
 * dois tercos de uma vista salva. Por isso a copia usa as DUAS portas publicas:
 * `setMapTemporalConfig`, que descarta `ativo` de proposito, e `setMapTemporalSaved`, que e o
 * unico escritor do `ativo` salvo.
 *
 * A OUTRA METADE DO CONTRATO: chave cujo valor a copia ja tem nao e escrita (em atlas de
 * servidor cada escrita dessas e uma op de sync), e as duas escritas acontecem ANTES de
 * `setCurrentMap`, que e quem carrega a config para o cache sincrono e fixa o interruptor de
 * tela do mapa que se entra.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const PADRAO = Object.freeze({
    ativo: false, unidade: 'DIA', inicio: null, fim: null, modo: 'absoluto', origem: null
});

/** A config da origem: janela, unidade, modo relativo e Dia D, mais o interruptor salvo. */
const ORIGEM = Object.freeze({
    ativo: true,
    unidade: 'HORA',
    inicio: 1700000000000,
    fim: 1700086400000,
    modo: 'relativo',
    origem: 1700000000000
});

const { storeMock, idUtilsMock, temporalMock } = vi.hoisted(() => ({
    storeMock: {
        addMap: vi.fn(async () => {}),
        setCurrentMap: vi.fn(async () => {}),
        getAllMapNamesStore: vi.fn(async () => ['Original']),
        getMapDataStore: vi.fn(async () => ({ id: 'map-1', name: 'Original', features: {} })),
        getColorUsage: vi.fn(async () => ({})),
        getMapNotes: vi.fn(async () => null),
        getLayerManager: vi.fn(() => ({ duplicateMapLayers: vi.fn(async () => new Map()) })),
        getGroupManager: vi.fn(() => ({ duplicateMapGroups: vi.fn(async () => {}) })),
        getCesium3dDataForExport: vi.fn(async () => null),
        getStreetview360DataForExport: vi.fn(async () => null),
        setCesium3dDataForImport: vi.fn(async () => {}),
        setStreetview360DataForImport: vi.fn(async () => {}),
        getMapTemporalConfig: vi.fn(async () => ({ ...PADRAO })),
        setMapTemporalConfig: vi.fn(async () => ({}))
    },
    idUtilsMock: {
        regenerateMapIds: vi.fn(async (mapData, mapName) => ({
            newMapData: { ...mapData, name: mapName }, idMapping: new Map()
        }))
    },
    temporalMock: { setMapTemporalSaved: vi.fn(async () => ({})) }
}));

vi.mock('../../src/js/store', () => ({
    addMap: storeMock.addMap,
    addFeature: vi.fn(),
    removeMap: vi.fn(),
    renameMap: vi.fn(),
    setCurrentMap: storeMock.setCurrentMap,
    saveMapView: vi.fn(),
    getMapTemporalConfig: storeMock.getMapTemporalConfig,
    setMapTemporalConfig: storeMock.setMapTemporalConfig,
    isMapTemporalEnabledSync: vi.fn(() => false),
    hasMapSavedPosition: vi.fn(),
    clearMapView: vi.fn(),
    getAllMapNamesStore: storeMock.getAllMapNamesStore,
    getCurrentMapName: vi.fn(async () => 'Original'),
    moveFeaturesToMap: vi.fn(),
    clearAllDataStore: vi.fn(),
    getMapDataStore: storeMock.getMapDataStore,
    getColorUsage: storeMock.getColorUsage,
    getMapNotes: storeMock.getMapNotes,
    setMapOrder: vi.fn(),
    getLayerManager: storeMock.getLayerManager,
    getLayersRepo: vi.fn(),
    getGroupManager: storeMock.getGroupManager,
    getCesium3dDataForExport: storeMock.getCesium3dDataForExport,
    setCesium3dDataForImport: storeMock.setCesium3dDataForImport,
    getStreetview360DataForExport: storeMock.getStreetview360DataForExport,
    setStreetview360DataForImport: storeMock.setStreetview360DataForImport,
    getEmptyCesium3dData: vi.fn(),
    isMapLocked: vi.fn(async () => false)
}));

vi.mock('../../src/js/utilities', () => ({ IDUtils: idUtilsMock }));

vi.mock('../../src/js/store/temporal.operations.js', () => ({
    setMapTemporalSaved: temporalMock.setMapTemporalSaved
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: { UPDATE_MAP: 'EDIT', DELETE_MAP: 'DELETE', CREATE_MAP: 'EDIT', COMBINE_MAPS: 'DELETE' }
}));

vi.mock('../../src/js/store/store.constants.js', () => ({ DEFAULT_MAP_NAME: 'Principal' }));

import MapManager from '../../src/js/map/map.manager.js';

let manager;

/** Responde a config da ORIGEM para o mapa de origem e a do DESTINO para a copia. */
function comConfigs(origem, destino) {
    storeMock.getMapTemporalConfig.mockImplementation(async (nome) =>
        (nome === 'Original' ? { ...origem } : { ...destino }));
}

beforeEach(() => {
    vi.clearAllMocks();
    comConfigs(PADRAO, PADRAO);
    manager = new MapManager(null, null);
});

describe('MapManager.copyMap leva a configuracao temporal', () => {
    it('copia a janela, a unidade, o modo e a origem, e NAO manda `ativo` pela porta errada', async () => {
        comConfigs(ORIGEM, PADRAO);

        const result = await manager.copyMap('Original', 'Cópia');

        expect(result.success).toBe(true);
        expect(storeMock.setMapTemporalConfig).toHaveBeenCalledTimes(1);
        const [alvo, ajustes] = storeMock.setMapTemporalConfig.mock.calls[0];
        expect(alvo).toBe('Cópia');
        expect(ajustes).toEqual({
            unidade: 'HORA',
            inicio: 1700000000000,
            fim: 1700086400000,
            modo: 'relativo',
            origem: 1700000000000
        });
        // A porta que descarta `ativo` nao pode receber `ativo` nem como chave presente.
        expect(Object.hasOwn(ajustes, 'ativo')).toBe(false);
    });

    it('copia o interruptor SALVO pela porta propria dele', async () => {
        comConfigs(ORIGEM, PADRAO);

        await manager.copyMap('Original', 'Cópia');

        expect(temporalMock.setMapTemporalSaved).toHaveBeenCalledWith('Cópia', true);
    });

    it('as duas escritas acontecem ANTES de entrar na copia', async () => {
        // `setCurrentMap` e quem le a config do disco para o cache sincrono e fixa o interruptor
        // de tela. Escrever depois dele deixaria a copia aberta com os padroes ate um F5.
        comConfigs(ORIGEM, PADRAO);

        await manager.copyMap('Original', 'Cópia');

        const entrada = storeMock.setCurrentMap.mock.invocationCallOrder[0];
        expect(storeMock.setMapTemporalConfig.mock.invocationCallOrder[0]).toBeLessThan(entrada);
        expect(temporalMock.setMapTemporalSaved.mock.invocationCallOrder[0]).toBeLessThan(entrada);
    });

    it('borda: origem nos padroes nao produz escrita nenhuma', async () => {
        // Em atlas de servidor cada escrita dessas e uma op de sync, e op que regrava o valor
        // guardado reivindica unidade de disputa a toa.
        comConfigs(PADRAO, PADRAO);

        await manager.copyMap('Original', 'Cópia');

        expect(storeMock.setMapTemporalConfig).not.toHaveBeenCalled();
        expect(temporalMock.setMapTemporalSaved).not.toHaveBeenCalled();
    });

    it('borda: so o interruptor salvo difere, entao so ele e escrito', async () => {
        comConfigs({ ...PADRAO, ativo: true }, PADRAO);

        await manager.copyMap('Original', 'Cópia');

        expect(storeMock.setMapTemporalConfig).not.toHaveBeenCalled();
        expect(temporalMock.setMapTemporalSaved).toHaveBeenCalledWith('Cópia', true);
    });

    it('borda: so os ajustes diferem, entao o interruptor salvo nao e tocado', async () => {
        comConfigs({ ...ORIGEM, ativo: false }, PADRAO);

        await manager.copyMap('Original', 'Cópia');

        expect(storeMock.setMapTemporalConfig).toHaveBeenCalledTimes(1);
        expect(temporalMock.setMapTemporalSaved).not.toHaveBeenCalled();
    });

    it('borda: destino com config herdada de um homonimo so recebe o que difere', async () => {
        // A comparacao e contra o DESTINO, nao contra os padroes: um `temporal_<nome>` deixado
        // por um mapa anterior de mesmo nome e um valor real, e regrava-lo custaria uma op.
        comConfigs(ORIGEM, { ...ORIGEM, unidade: 'DIA' });

        await manager.copyMap('Original', 'Cópia');

        expect(storeMock.setMapTemporalConfig).toHaveBeenCalledTimes(1);
        expect(temporalMock.setMapTemporalSaved).not.toHaveBeenCalled();
    });
});
