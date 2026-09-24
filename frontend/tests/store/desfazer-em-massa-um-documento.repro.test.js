// Path: tests/store/desfazer-em-massa-um-documento.repro.test.js

/**
 * @fileoverview Undo and redo of a gesture over N features call ONE plural store operation per run
 * of like entries, not N single ones.
 *
 * Each single inversion reads and writes the whole map document (see
 * `gesto-local-em-massa-um-documento.repro.test.js`), and a `batch` entry used to invert entry by
 * entry: undoing a restyle of 1 000 features cost 16 s in Chromium and redoing a deletion of 1 000
 * cost 41 s (2026-09-24). The engine now groups consecutive entries whose inversion is the same
 * plural operation (`updateFeatures`, `removeFeatures`, `addFeatures`).
 *
 * The first case is the negative control and also the compatibility contract: an executor WITHOUT
 * the plural operations still gets one call per entry, in the same order as before.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { memoryStore, resetMemoryStore } from '../../src/js/store/memory-store.js';

vi.mock('../../src/js/store/repositories/index.js', () => ({
    setSettingCompat: vi.fn(),
    getSettingCompat: vi.fn().mockResolvedValue(null),
    getColorUsageCompat: vi.fn().mockResolvedValue({}),
    setColorUsageCompat: vi.fn(),
    removeColorUsageCompat: vi.fn(),
    getAllMapKeysCompat: vi.fn().mockResolvedValue([]),
    getMapDataCompat: vi.fn().mockResolvedValue({ features: {} })
}));

vi.mock('../../src/js/store/services.js', () => ({
    getGroupManager: () => ({
        loadGroupsToMemory: vi.fn().mockResolvedValue(undefined),
        clearMapGroups: vi.fn().mockResolvedValue(undefined)
    })
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logOperation: vi.fn(),
    EntityType: { SETTING: 'setting' },
    OperationType: { UPDATE: 'update' },
    sessionContext: { getUserId: vi.fn(() => 'test-user-id'), _reset: vi.fn() }
}));

const { default: mapManager } = await import('../../src/js/store/store-state-manager.js');

const N = 1000;

function ponto(id, color = '#ff0000') {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { id, source: 'point', color }
    };
}

function singulares() {
    return {
        addFeature: vi.fn().mockResolvedValue(undefined),
        updateFeature: vi.fn().mockResolvedValue(undefined),
        removeFeature: vi.fn().mockResolvedValue(undefined),
        addFeatureToMap: vi.fn().mockResolvedValue(undefined),
        removeFeatureFromMap: vi.fn().mockResolvedValue(undefined),
        rederiveAnalysisOutput: vi.fn().mockResolvedValue(false)
    };
}

function comPlurais() {
    return {
        ...singulares(),
        addFeatures: vi.fn().mockResolvedValue(undefined),
        updateFeatures: vi.fn().mockResolvedValue(0),
        removeFeatures: vi.fn().mockResolvedValue(0)
    };
}

function registrarEmLote(entradas) {
    mapManager.startBatchCollection();
    for (const entrada of entradas) mapManager.recordAction(entrada);
    mapManager.commitBatchCollection();
}

const estilo = (i) => ({
    type: 'update', featureType: 'points', oldFeature: ponto(`p${i}`), newFeature: ponto(`p${i}`, '#00aa00')
});
const exclusao = (i) => ({
    type: 'removeWithProcessed', mainFeatureType: 'points', mainFeature: ponto(`p${i}`), processedFeatures: null
});

beforeEach(() => {
    resetMemoryStore();
    memoryStore.maps['Principal'] = { undoStacks: {}, redoStacks: {} };
    memoryStore.currentMap = 'Principal';
    memoryStore.isUndoing = false;
    memoryStore.isRedoing = false;
    memoryStore.batchCollector = null;
});

describe('desfazer e refazer o estilo de 1000', () => {
    it('CONTROLE NEGATIVO: sem as operações plurais, uma chamada por entrada, na ordem de antes', async () => {
        const exec = singulares();
        registrarEmLote(Array.from({ length: N }, (_, i) => estilo(i)));

        await mapManager.undoLastAction(exec);

        expect(exec.updateFeature).toHaveBeenCalledTimes(N);
        expect(exec.updateFeature.mock.calls[0][1].properties.id).toBe(`p${N - 1}`);
        expect(exec.updateFeature.mock.calls[0][3]).toEqual({ revertFrom: ponto(`p${N - 1}`, '#00aa00') });
    });

    it('desfazer: UMA chamada de updateFeatures com as 1000, do fim para o começo, com revertFrom', async () => {
        const exec = comPlurais();
        registrarEmLote(Array.from({ length: N }, (_, i) => estilo(i)));

        await mapManager.undoLastAction(exec);

        expect(exec.updateFeature).not.toHaveBeenCalled();
        expect(exec.updateFeatures).toHaveBeenCalledTimes(1);
        const [itens] = exec.updateFeatures.mock.calls[0];
        expect(itens).toHaveLength(N);
        expect(itens[0]).toEqual({
            type: 'points', feature: ponto(`p${N - 1}`), options: { revertFrom: ponto(`p${N - 1}`, '#00aa00') }
        });
        expect(itens.at(-1).feature.properties.id).toBe('p0');
    });

    it('refazer: UMA chamada, na ordem original, com o lado de antes como revertFrom', async () => {
        const exec = comPlurais();
        registrarEmLote(Array.from({ length: N }, (_, i) => estilo(i)));
        await mapManager.undoLastAction(exec);
        exec.updateFeatures.mockClear();

        await mapManager.redoLastAction(exec);

        expect(exec.updateFeatures).toHaveBeenCalledTimes(1);
        const [itens] = exec.updateFeatures.mock.calls[0];
        expect(itens[0]).toEqual({
            type: 'points', feature: ponto('p0', '#00aa00'), options: { revertFrom: ponto('p0') }
        });
        expect(itens.at(-1).feature.properties.id).toBe(`p${N - 1}`);
    });
});

describe('desfazer e refazer a exclusão de 1000', () => {
    it('desfazer: UMA chamada de addFeatures como restauração, e a saída de análise re-derivada por entrada', async () => {
        const exec = comPlurais();
        registrarEmLote(Array.from({ length: N }, (_, i) => exclusao(i)));

        await mapManager.undoLastAction(exec);

        expect(exec.addFeature).not.toHaveBeenCalled();
        expect(exec.addFeatures).toHaveBeenCalledTimes(1);
        const [porTipo, mapa, opcoes] = exec.addFeatures.mock.calls[0];
        expect(Object.keys(porTipo)).toEqual(['points']);
        expect(porTipo.points).toHaveLength(N);
        expect(porTipo.points[0].properties.id).toBe(`p${N - 1}`);
        expect(mapa).toBeNull();
        expect(opcoes).toEqual({ featureIntent: 'restore' });
        // As the single path: every restored `removeWithProcessed` input is re-derived (a no-op
        // for a point, answered by the executor itself).
        expect(exec.rederiveAnalysisOutput).toHaveBeenCalledTimes(N);
    });

    it('refazer: UMA chamada de removeFeatures, na ordem original', async () => {
        const exec = comPlurais();
        registrarEmLote(Array.from({ length: N }, (_, i) => exclusao(i)));
        await mapManager.undoLastAction(exec);

        await mapManager.redoLastAction(exec);

        expect(exec.removeFeature).not.toHaveBeenCalled();
        expect(exec.removeFeatures).toHaveBeenCalledTimes(1);
        const [refs] = exec.removeFeatures.mock.calls[0];
        expect(refs).toHaveLength(N);
        expect(refs[0]).toEqual({ type: 'points', id: 'p0' });
    });

    it('addMultiple (colar 1000): desfazer é UMA removeFeatures, refazer UMA addFeatures', async () => {
        const exec = comPlurais();
        const features = { points: Array.from({ length: N }, (_, i) => ponto(`p${i}`)) };
        mapManager.recordAction({ type: 'addMultiple', features });

        await mapManager.undoLastAction(exec);
        await mapManager.redoLastAction(exec);

        expect(exec.removeFeature).not.toHaveBeenCalled();
        expect(exec.addFeature).not.toHaveBeenCalled();
        expect(exec.removeFeatures).toHaveBeenCalledTimes(1);
        expect(exec.removeFeatures.mock.calls[0][0]).toHaveLength(N);
        expect(exec.addFeatures).toHaveBeenCalledWith(features, null, { featureIntent: 'restore' });
    });
});

describe('o que é uma corrida', () => {
    it('a mesma feição duas vezes quebra a corrida: as duas edições se aplicam uma depois da outra', async () => {
        const exec = comPlurais();
        const primeira = { type: 'update', featureType: 'points', oldFeature: ponto('a'), newFeature: ponto('a', '#111111') };
        const segunda = { type: 'update', featureType: 'points', oldFeature: ponto('a', '#111111'), newFeature: ponto('a', '#222222') };
        registrarEmLote([estilo(1), primeira, segunda, estilo(2)]);

        await mapManager.undoLastAction(exec);

        // Reverse order: [p2, a(2nd), a(1st), p1] -> runs [p2, a(2nd)] and [a(1st), p1].
        expect(exec.updateFeatures.mock.calls.map(([itens]) => itens.map(i => i.feature.properties.id)))
            .toEqual([['p2', 'a'], ['a', 'p1']]);
        expect(exec.updateFeatures.mock.calls[0][0][1].feature.properties.color).toBe('#111111');
        expect(exec.updateFeatures.mock.calls[1][0][0].feature.properties.color).toBe('#ff0000');
    });

    it('tipos diferentes de entrada viram corridas separadas, e o que não tem plural vai sozinho', async () => {
        const exec = comPlurais();
        const analise = {
            type: 'updateWithProcessed', mainFeatureType: 'los',
            oldFeature: ponto('los1'), newFeature: ponto('los1', '#00aa00'),
            oldProcessedFeatures: null, newProcessedFeatures: null
        };
        registrarEmLote([exclusao(1), exclusao(2), analise, estilo(3), estilo(4)]);

        await mapManager.undoLastAction(exec);

        const ordem = [];
        for (const [nome, fn] of Object.entries(exec)) {
            for (const call of fn.mock.calls) ordem.push([fn.mock.invocationCallOrder[fn.mock.calls.indexOf(call)], nome]);
        }
        ordem.sort((x, y) => x[0] - y[0]);
        expect(ordem.map(([, nome]) => nome)).toEqual([
            'updateFeatures',            // p4, p3
            'updateFeature',             // los1, single path
            'rederiveAnalysisOutput',    //   and its output
            'addFeatures',               // p2, p1
            'rederiveAnalysisOutput',
            'rederiveAnalysisOutput',
        ]);
    });

    it('uma única entrada semelhante vai pelo caminho singular, como antes', async () => {
        const exec = comPlurais();
        registrarEmLote([estilo(1), exclusao(2)]);

        await mapManager.undoLastAction(exec);

        expect(exec.addFeature).toHaveBeenCalledTimes(1);
        expect(exec.updateFeature).toHaveBeenCalledTimes(1);
        expect(exec.addFeatures).not.toHaveBeenCalled();
        expect(exec.updateFeatures).not.toHaveBeenCalled();
    });
});
