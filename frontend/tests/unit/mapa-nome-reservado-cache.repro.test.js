import { beforeEach, describe, expect, it } from 'vitest';
import { memoryStore, resetMemoryStore } from '../../src/js/store/memory-store.js';
import { createLayerManager } from '../../src/js/layers/layer.manager.js';
import mapManager from '../../src/js/store/store-state-manager.js';

beforeEach(() => resetMemoryStore());

describe('nomes de mapa são dados também nos caches de sessão', () => {
    it.each(['__proto__', 'constructor', 'toString'])('%s abre camadas antes da hidratação e depois de limpar o cache', name => {
        const manager = createLayerManager({ emit() {}, on() {}, off() {} });
        for (let attempt = 0; attempt < 2; attempt++) {
            expect(manager.getLayers(name).map(layer => layer.id)).toEqual(['default']);
            expect(Object.hasOwn(memoryStore.layers, name)).toBe(true);
            manager.clearLayersCache();
        }
    });

    it.each(['__proto__', 'constructor', 'toString'])('%s tem histórico próprio sem escrever no protótipo', name => {
        mapManager.setCurrentMapName(name);
        expect(Object.hasOwn(memoryStore.maps, name)).toBe(true);
        expect(memoryStore.maps[name]).toEqual({ undoStacks: {}, redoStacks: {} });
        expect(Object.hasOwn(Object.prototype, 'undoStacks')).toBe(false);
    });
});
