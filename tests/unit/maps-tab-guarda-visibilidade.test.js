/**
 * @fileoverview F-store-eventos-2, item (a).
 *
 * `maps.tab._loadMaps` ran on EVERY LAYERS_CHANGED, with no visibility guard,
 * and each pass deserializes one whole map document per map of the atlas just to
 * read five scalars. LAYERS_CHANGED is emitted from 33 places, so a hidden tab
 * paid for every visibility, lock, order and opacity change.
 *
 * Worst case the ruler must reject: 120 LAYERS_CHANGED events (two seconds of
 * slider drag at 60 fps) with the tab closed. Before the guard that is 120
 * reload passes; it must be zero, and the reload must happen once on reopen.
 *
 * Environment is `node` with no jsdom, so the DOM-building half of the tab is
 * stubbed on the instance: what is under test is the guard, not the rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { storeMock, subscriptions } = vi.hoisted(() => ({
    storeMock: {
        getAllMapNamesStore: vi.fn(async () => ['MapaA', 'MapaB', 'MapaC']),
        getCurrentMapName: vi.fn(async () => 'MapaA')
    },
    subscriptions: { value: [] }
}));

vi.mock('sortablejs', () => ({ default: { create: vi.fn() } }));

vi.mock('@utils/event-cleanup.js', () => ({
    setupCleanup: vi.fn(),
    addDomListener: vi.fn(),
    addScopedDomListener: vi.fn(),
    clearScopedListeners: vi.fn(),
    subscribe: vi.fn((_owner, _bus, eventType, handler) => {
        subscriptions.value.push({ eventType, handler });
    }),
    cleanup: vi.fn(),
    removeElement: vi.fn()
}));

vi.mock('@utils/html-escape.js', () => ({ escapeHtml: (s) => s }));

vi.mock('@utils/index.js', () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showWarning: vi.fn(),
    IDUtils: { generate: () => 'id' }
}));

vi.mock('@modals/index.js', () => ({
    showPrompt: vi.fn(),
    showConfirm: vi.fn(),
    showCombineMapsModal: vi.fn()
}));

vi.mock('@store/index.js', () => ({
    getAllMapNamesStore: storeMock.getAllMapNamesStore,
    getCurrentMapName: storeMock.getCurrentMapName,
    setCurrentMap: vi.fn(async () => {}),
    getMapDataStore: vi.fn(async () => ({})),
    clearAllDataStore: vi.fn(async () => {}),
    setMapOrder: vi.fn(async () => {}),
    getMapOrder: vi.fn(async () => []),
    getLayers: vi.fn(() => []),
    hasMapSavedPosition: vi.fn(async () => false),
    hasMapNotes: vi.fn(async () => false),
    isMapLocked: vi.fn(async () => false),
    toggleMapLock: vi.fn(async () => {}),
    isMapTemporalEnabled: vi.fn(async () => false),
    toggleMapTemporal: vi.fn(async () => {}),
    getControl: vi.fn(() => null)
}));

const { MapsTab } = await import('../../src/js/sidebar/tabs/maps.tab.js');
const { EventTypes } = await import('../../src/js/events/event_types.js');

/**
 * Builds a MapsTab with the DOM half stubbed out.
 * @returns {Object} MapsTab instance ready for the guard tests
 */
function makeTab() {
    const tab = new MapsTab({
        mapManager: {},
        baseLayerControl: {},
        eventBus: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
        exportImportService: {}
    });
    tab._updateCurrentMapCard = vi.fn(async () => {});
    tab._renderMapsList = vi.fn(async () => {});
    tab._setupEventListeners();
    return tab;
}

/**
 * Lets every pending microtask of a _loadMaps pass settle.
 * @returns {Promise<void>}
 */
function flush() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Fires the handler registered for one event type.
 * @param {string} eventType - Event to fire
 */
function fire(eventType) {
    for (const sub of subscriptions.value) {
        if (sub.eventType === eventType) sub.handler();
    }
}

describe('maps.tab: guarda de visibilidade no LAYERS_CHANGED', () => {
    let tab;

    beforeEach(() => {
        subscriptions.value = [];
        storeMock.getAllMapNamesStore.mockClear();
        storeMock.getCurrentMapName.mockClear();
        tab = makeTab();
    });

    it('nasce invisivel, antes de a aba ser renderizada', () => {
        expect(tab._isVisible).toBe(false);
    });

    it('120 LAYERS_CHANGED com a aba fechada nao leem mapa nenhum', () => {
        for (let frame = 0; frame < 120; frame++) {
            fire(EventTypes.LAYERS_CHANGED);
        }

        expect(storeMock.getAllMapNamesStore).toHaveBeenCalledTimes(0);
        expect(tab._needsReload).toBe(true);
    });

    it('MAP_LOCK_CHANGED e MAP_TEMPORAL_CHANGED tambem respeitam a guarda', () => {
        fire(EventTypes.MAP_LOCK_CHANGED);
        fire(EventTypes.MAP_TEMPORAL_CHANGED);

        expect(storeMock.getAllMapNamesStore).toHaveBeenCalledTimes(0);
    });

    it('reabrir a aba recarrega uma vez e limpa a pendencia', async () => {
        fire(EventTypes.LAYERS_CHANGED);
        expect(tab._needsReload).toBe(true);

        tab.refresh();
        await flush();

        expect(tab._isVisible).toBe(true);
        expect(tab._needsReload).toBe(false);
        expect(storeMock.getAllMapNamesStore).toHaveBeenCalledTimes(1);
    });

    it('com a aba aberta o evento continua recarregando', async () => {
        tab.refresh();
        await flush();
        storeMock.getAllMapNamesStore.mockClear();

        fire(EventTypes.LAYERS_CHANGED);
        await flush();

        expect(storeMock.getAllMapNamesStore).toHaveBeenCalledTimes(1);
    });

    it('fechar a aba pelo onDeactivate volta a barrar o evento', async () => {
        tab.refresh();
        await flush();
        storeMock.getAllMapNamesStore.mockClear();

        tab.onDeactivate();
        for (let frame = 0; frame < 120; frame++) {
            fire(EventTypes.LAYERS_CHANGED);
        }

        expect(tab._isVisible).toBe(false);
        expect(storeMock.getAllMapNamesStore).toHaveBeenCalledTimes(0);
    });
});
