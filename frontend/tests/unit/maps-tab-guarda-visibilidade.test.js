// Path: tests/unit/maps-tab-guarda-visibilidade.test.js
//
// A PORTEIRA DE VISIBILIDADE DA ABA DE MAPAS.
//
// `MapsTab._loadMaps()` rodava em TODO `LAYERS_CHANGED`, e cada passada desserializa um
// documento de mapa INTEIRO por mapa do atlas só para ler cinco escalares (posição salva,
// notas, trava, temporal, cor do selo). `LAYERS_CHANGED` é emitido de dezenas de lugares,
// então uma aba fechada pagava esse preço a cada mudança de visibilidade, trava, ordem ou
// opacidade de camada.
//
// O PIOR CASO QUE A RÉGUA EXISTE PARA REPROVAR: 120 eventos com a aba fechada, que é o que
// dois segundos de arrasto do controle de opacidade a 60 quadros por segundo produziam.
// Antes da porteira isso são 120 passadas de recarga; tem de ser ZERO, e a recarga tem de
// acontecer uma vez quando a aba reabre.
//
// O QUE ESTA RÉGUA NÃO É: o coalescedor. `_loadMapsPendente` já existia aqui e resolve outro
// problema (um pedido que chega DURANTE uma passada não pode ser jogado fora). Os dois se
// parecem e não são o mesmo mecanismo, então o arquivo mede os dois lados: com a aba fechada
// a porteira barra ANTES do coalescedor, e com a aba aberta o coalescedor segue inteiro.
//
// O ambiente é `node` sem jsdom, então a metade que constrói DOM é substituída na instância:
// o que está sob teste é a porteira, nunca a renderização.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const { storeMock } = vi.hoisted(() => ({
    storeMock: {
        getAllMapNamesStore: vi.fn(async () => ['MapaA', 'MapaB', 'MapaC']),
        getCurrentMapName: vi.fn(async () => 'MapaA')
    }
}));

vi.mock('sortablejs', () => ({ default: { create: vi.fn() } }));

// O barril da store, e não os módulos por dentro: é dele que a aba importa, e é a leitura
// dele que a porteira existe para evitar. `getComments`/`getCurrentMapNameSync` entram porque
// o painel de comentários importa do MESMO barril e o dublê tem de servir os dois.
vi.mock('../../src/js/store/index.js', () => ({
    getAllMapNamesStore: storeMock.getAllMapNamesStore,
    getCurrentMapName: storeMock.getCurrentMapName,
    getCurrentMapNameSync: vi.fn(() => 'MapaA'),
    setCurrentMap: vi.fn(async () => {}),
    getMapDataStore: vi.fn(async () => ({})),
    clearAllDataStore: vi.fn(async () => {}),
    setMapOrder: vi.fn(async () => {}),
    getMapOrder: vi.fn(async () => []),
    getLayers: vi.fn(() => []),
    getComments: vi.fn(async () => []),
    hasMapSavedPosition: vi.fn(async () => false),
    hasMapNotes: vi.fn(async () => false),
    isMapLocked: vi.fn(async () => false),
    isMapTemporalEnabled: vi.fn(async () => false),
    toggleMapTemporal: vi.fn(async () => {}),
    getControl: vi.fn(() => null),
    getOrderedMapBadgeColors: vi.fn(async () => ({})),
    isRemoteStoreSync: vi.fn(() => false)
}));

const { MapsTab } = await import('../../src/js/sidebar/tabs/maps.tab.js');
const { EventTypes } = await import('../../src/js/events/event_types.js');

/** Lê um arquivo de `src/` pelo caminho relativo ao pacote. */
const fonte = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

/**
 * Barramento de mentira que guarda os inscritos por tipo. Nada de dublê para
 * `event-cleanup.js`: a inscrição real passa por `eventBus.on`, e usar a de verdade mantém
 * a régua presa ao caminho que a aba percorre em produção.
 * @returns {Object} Barramento com `emit` e a contagem de inscritos por tipo
 */
function barramentoFalso() {
    const inscritos = new Map();
    return {
        on(tipo, handler) {
            if (!inscritos.has(tipo)) inscritos.set(tipo, []);
            inscritos.get(tipo).push(handler);
            return () => {};
        },
        off() {},
        emit(tipo, carga) {
            for (const handler of inscritos.get(tipo) ?? []) handler(carga);
        },
        inscritosEm(tipo) {
            return (inscritos.get(tipo) ?? []).length;
        }
    };
}

/**
 * Monta uma MapsTab com a metade de DOM substituída.
 * @param {Object} bus - Barramento de eventos
 * @returns {Object} Instância pronta para os casos da porteira
 */
function montarAba(bus) {
    const tab = new MapsTab({
        mapManager: {},
        baseLayerControl: {},
        eventBus: bus,
        exportImportService: {}
    });
    tab._updateCurrentMapCard = vi.fn(async () => {});
    tab._renderMapsList = vi.fn(async () => {});
    // `refresh()` também relê o cabeçalho do atlas, que fala com a rede e com o DOM.
    tab._refreshAtlasHeader = vi.fn(async () => {});
    tab._setupEventListeners();
    return tab;
}

/**
 * Deixa assentar toda microtarefa pendente de uma passada de `_loadMaps`.
 * @returns {Promise<void>}
 */
function assentar() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

describe('maps.tab: a porteira de visibilidade no LAYERS_CHANGED', () => {
    let tab;
    let bus;

    beforeEach(() => {
        storeMock.getAllMapNamesStore.mockClear();
        storeMock.getAllMapNamesStore.mockImplementation(async () => ['MapaA', 'MapaB', 'MapaC']);
        storeMock.getCurrentMapName.mockClear();
        bus = barramentoFalso();
        tab = montarAba(bus);
    });

    it('nasce invisivel, antes de a aba ser renderizada', () => {
        expect(tab._estaVisivel).toBe(false);
    });

    it('120 LAYERS_CHANGED com a aba fechada nao leem mapa nenhum', () => {
        for (let quadro = 0; quadro < 120; quadro++) {
            bus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
        }

        expect(storeMock.getAllMapNamesStore).toHaveBeenCalledTimes(0);
        // A porteira barra ANTES do coalescedor: nenhuma passada começou, então não há
        // pedido pendente para honrar depois. Este par é o que separa os dois mecanismos.
        expect(tab._loadMapsPendente).toBe(false);
        expect(tab._isLoadingMaps).toBe(false);
    });

    it('MAP_LOCK_CHANGED, MAP_MODIFIED e MAP_TEMPORAL_CHANGED tambem respeitam a porteira', () => {
        bus.emit(EventTypes.MAP_LOCK_CHANGED, {});
        bus.emit(EventTypes.MAP_MODIFIED, {});
        bus.emit(EventTypes.MAP_TEMPORAL_CHANGED, {});

        expect(storeMock.getAllMapNamesStore).toHaveBeenCalledTimes(0);
    });

    it('reabrir a aba pelo refresh() recarrega UMA vez e relê o cabeçalho do atlas', async () => {
        for (let quadro = 0; quadro < 120; quadro++) {
            bus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
        }

        tab.refresh();
        await assentar();

        expect(tab._estaVisivel).toBe(true);
        expect(storeMock.getAllMapNamesStore).toHaveBeenCalledTimes(1);
        expect(tab._refreshAtlasHeader).toHaveBeenCalledTimes(1);
    });

    it('com a aba aberta o evento continua recarregando', async () => {
        tab.refresh();
        await assentar();
        storeMock.getAllMapNamesStore.mockClear();

        bus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
        await assentar();

        expect(storeMock.getAllMapNamesStore).toHaveBeenCalledTimes(1);
    });

    it('fechar a aba pelo onDeactivate volta a barrar o evento', async () => {
        tab.refresh();
        await assentar();
        storeMock.getAllMapNamesStore.mockClear();

        tab.onDeactivate();
        for (let quadro = 0; quadro < 120; quadro++) {
            bus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
        }
        await assentar();

        expect(tab._estaVisivel).toBe(false);
        expect(storeMock.getAllMapNamesStore).toHaveBeenCalledTimes(0);
    });

    it('destroy() também fecha a porteira, para um evento tardio não reabrir a leitura', async () => {
        tab.refresh();
        await assentar();
        storeMock.getAllMapNamesStore.mockClear();

        tab.destroy();
        bus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
        await assentar();

        expect(tab._estaVisivel).toBe(false);
        expect(storeMock.getAllMapNamesStore).toHaveBeenCalledTimes(0);
    });
});

describe('maps.tab: a porteira não engoliu o coalescedor', () => {
    let tab;
    let bus;

    beforeEach(() => {
        storeMock.getAllMapNamesStore.mockClear();
        storeMock.getAllMapNamesStore.mockImplementation(async () => ['MapaA', 'MapaB', 'MapaC']);
        storeMock.getCurrentMapName.mockClear();
        bus = barramentoFalso();
        tab = montarAba(bus);
    });

    it('com a aba aberta, um evento chegado DURANTE a carga é honrado depois dela', async () => {
        let liberar;
        storeMock.getAllMapNamesStore.mockImplementationOnce(
            () => new Promise(resolve => { liberar = () => resolve(['MapaA']); })
        );

        tab.refresh();
        await assentar();
        expect(tab._isLoadingMaps).toBe(true);

        bus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
        expect(tab._loadMapsPendente).toBe(true);

        liberar();
        await assentar();

        expect(tab._loadMapsPendente).toBe(false);
        expect(storeMock.getAllMapNamesStore).toHaveBeenCalledTimes(2);
    });

    it('um evento durante a carga com a aba FECHADA não marca pendência nenhuma', async () => {
        let liberar;
        storeMock.getAllMapNamesStore.mockImplementationOnce(
            () => new Promise(resolve => { liberar = () => resolve(['MapaA']); })
        );

        tab.refresh();
        await assentar();
        tab.onDeactivate();

        bus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
        expect(tab._loadMapsPendente).toBe(false);

        liberar();
        await assentar();

        expect(storeMock.getAllMapNamesStore).toHaveBeenCalledTimes(1);
    });
});

describe('maps.tab: quem abre e quem fecha a porteira', () => {
    // ÂNCORA DE CONTRATO, e não régua de regressão: `sidebar.control.js` não mudou nesta
    // porta. Ela está aqui porque uma porteira que ninguém reabre é uma aba que nunca mais
    // se atualiza, e esse é o único jeito de o conserto virar defeito.
    it('a barra lateral chama refresh() ao reabrir a aba e onDeactivate() ao sair dela', () => {
        const codigo = fonte('src/js/sidebar/sidebar.control.js');

        expect(codigo).toMatch(/typeof component\.onDeactivate === 'function'/);
        expect(codigo).toMatch(/component\.onDeactivate\(\)/);
        expect(codigo).toMatch(/this\._tabComponents\[tabId\]\.refresh\(\)/);
    });

    it('render() abre a porteira, porque a barra lateral só renderiza a aba que vai mostrar', () => {
        const codigo = fonte('src/js/sidebar/tabs/maps.tab.js');
        const ondeRender = codigo.indexOf('    render() {');
        expect(ondeRender).toBeGreaterThan(-1);

        const corpo = codigo.slice(ondeRender, codigo.indexOf('\n    }', ondeRender));
        expect(corpo).toMatch(/this\._estaVisivel = true;/);
    });
});
