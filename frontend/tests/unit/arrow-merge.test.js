// Path: tests/unit/arrow-merge.test.js

/**
 * @fileoverview Suite for `src/js/military_tools/arrow_tool/arrow-merge.js`, the
 * `mil-arrow` rows of `tests/TESTING-BACKLOG.md` that live outside the geometry class.
 *
 * WHAT IT PINS
 * - `canMergeArrows` / `canSplitArrows`: the exported gates, including the
 *   `layerId || 'default'` bucket (a falsy layer id merges ACROSS layers) and the
 *   strict `isMerged === true`.
 * - `extractBranches`, which is NOT exported. It is reached through `mergeArrows`
 *   and observed on the feature handed to `addFeature`, which is the only surface
 *   the branch list ever reaches. What is pinned: falsy-but-DEFINED geometric props
 *   (`width: 0`, `showArrowHead: false`, `airmobilePosition: 0`) are copied, an
 *   already-merged arrow is flattened, and how much of `baseCoordinates` is copied.
 * - The write ORDER of `mergeArrows` (add the merged arrow before removing the
 *   sources), which is the property that keeps a persist failure recoverable.
 *
 * WHAT IT DOES NOT REACH
 * - `splitArrows` beyond its early guard: its body is the same store/dispatcher
 *   choreography as `mergeArrows` and adds no new pure logic.
 * - Anything about turf shape: `AddArrowGeometry.generate` runs against a planar
 *   stub, so the merged GEOMETRY here is a placeholder, never evidence.
 * - The store, the dispatcher, undo batching and the toasts are all doubles; this
 *   suite says nothing about whether persistence works.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('@tools', () => ({
    BaseGeometry: class { constructor(properties = {}) { this.properties = { ...properties }; } },
}));

const calls = { added: [], removed: [], batchStarts: 0, batchCommits: 0, warnings: [] };

vi.mock('@store', () => ({
    addFeature: (source, feature) => { calls.added.push({ source, feature }); return Promise.resolve(); },
    removeFeature: (source, id) => { calls.removed.push({ source, id }); return Promise.resolve(); },
    getActiveLayerIdSync: () => 'camada-ativa',
    startBatchUndo: () => { calls.batchStarts++; },
    commitBatchUndo: () => { calls.batchCommits++; },
}));

vi.mock('@utils', () => ({
    IDUtils: {
        generateFeatureIds: () => ({ id: 'novo-id', geoJsonId: 'novo-geojson-id' }),
        generateFeatureName: () => Promise.resolve('Seta 1'),
    },
    showSuccess: () => {},
    showWarning: (msg) => { calls.warnings.push(msg); },
}));

vi.mock('@layers/geojson-dispatcher.js', () => ({
    getGeoJsonDispatcher: () => ({ remove: () => {}, add: () => {}, flush: () => Promise.resolve() }),
}));

beforeAll(() => {
    globalThis.turf = {
        lineString: (coords) => {
            if (!Array.isArray(coords)) throw new Error('coordinates must be an array');
            return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } };
        },
        point: (c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c } }),
        lineOffset: (line) => line,
        bearing: () => 90,
        destination: (p, d, b) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [d, b] } }),
        feature: (g) => ({ type: 'Feature', geometry: g }),
        featureCollection: (features) => ({ type: 'FeatureCollection', features }),
        union: (fc) => fc.features[0],
    };
});

afterAll(() => { delete globalThis.turf; });

const {
    canMergeArrows, canSplitArrows, mergeArrows, splitArrows,
} = await import('../../src/js/military_tools/arrow_tool/arrow-merge.js');

/** Selection manager double: the merge path only calls these three. */
const selectionManager = {
    deselectAllFeatures() {},
    toggleFeatureSelection() { return Promise.resolve(); },
    updateUI() {},
};

const arrow = (props) => ({
    type: 'Feature',
    properties: { id: 'a', source: 'arrow', baseCoordinates: [[0, 0], [1, 1]], ...props },
});

/** The single feature `mergeArrows` handed to the store. */
const mergedProps = () => {
    expect(calls.added.length).toBe(1);
    return calls.added[0].feature.properties;
};

beforeEach(() => {
    calls.added = [];
    calls.removed = [];
    calls.batchStarts = 0;
    calls.batchCommits = 0;
    calls.warnings = [];
});

// ============================================================================
// canMergeArrows
// ============================================================================

describe('canMergeArrows', () => {
    it('exige pelo menos 2 feições', () => {
        expect(canMergeArrows(null)).toEqual({ canMerge: false, reason: 'Selecione pelo menos 2 setas' });
        expect(canMergeArrows([])).toEqual({ canMerge: false, reason: 'Selecione pelo menos 2 setas' });
        expect(canMergeArrows([arrow({})])).toEqual({ canMerge: false, reason: 'Selecione pelo menos 2 setas' });
    });

    it('exige que TODAS sejam setas', () => {
        const out = canMergeArrows([arrow({ layerId: 'L' }), { properties: { source: 'polygon', layerId: 'L' } }]);
        expect(out).toEqual({ canMerge: false, reason: 'Todas as feições devem ser setas' });
    });

    it('feição sem `properties` não passa (optional chaining, sem throw)', () => {
        expect(canMergeArrows([{}, {}])).toEqual({ canMerge: false, reason: 'Todas as feições devem ser setas' });
    });

    it('exige a mesma camada', () => {
        const out = canMergeArrows([arrow({ layerId: 'A' }), arrow({ layerId: 'B' })]);
        expect(out).toEqual({ canMerge: false, reason: 'Setas devem estar na mesma camada' });
    });

    it('duas setas sem layerId caem no mesmo balde e podem combinar', () => {
        expect(canMergeArrows([arrow({}), arrow({})])).toEqual({ canMerge: true });
    });

    it('três setas na mesma camada combinam', () => {
        const selection = [arrow({ layerId: 'A' }), arrow({ layerId: 'A' }), arrow({ layerId: 'A' })];
        expect(selection.length).toBe(3);
        expect(canMergeArrows(selection)).toEqual({ canMerge: true });
    });

    it("FORMA `valor || padrao`: layerId 0 e '' viram o balde 'default' e combinam com ele", () => {
        // `f.properties?.layerId || 'default'` swallows every falsy id. A layer whose id
        // is 0 or the empty string is therefore indistinguishable from "no layer", and
        // two arrows in genuinely different places pass the same-layer gate.
        expect(canMergeArrows([arrow({ layerId: 0 }), arrow({ layerId: 'default' })])).toEqual({ canMerge: true });
        expect(canMergeArrows([arrow({ layerId: '' }), arrow({ layerId: 'default' })])).toEqual({ canMerge: true });
        expect(canMergeArrows([arrow({ layerId: 0 }), arrow({ layerId: '' })])).toEqual({ canMerge: true });
        // Control: a non-falsy pair of distinct ids is still refused, so the block above
        // is not passing because the check is dead.
        expect(canMergeArrows([arrow({ layerId: '0' }), arrow({ layerId: 'default' })]).canMerge).toBe(false);
    });
});

// ============================================================================
// canSplitArrows
// ============================================================================

describe('canSplitArrows', () => {
    const merged = (branches) => ({ properties: { source: 'arrow', isMerged: true, branches } });

    it('exige exatamente UMA feição selecionada', () => {
        expect(canSplitArrows(null)).toEqual({ canSplit: false });
        expect(canSplitArrows([])).toEqual({ canSplit: false });
        expect(canSplitArrows([merged([{}, {}]), merged([{}, {}])])).toEqual({ canSplit: false });
    });

    it('exige 2 ou mais ramos', () => {
        expect(canSplitArrows([merged([])])).toEqual({ canSplit: false });
        expect(canSplitArrows([merged([{}])])).toEqual({ canSplit: false });
        expect(canSplitArrows([merged([{}, {}])])).toEqual({ canSplit: true });
    });

    it('`isMerged` é comparado por `===` estrito: truthy não basta', () => {
        expect(canSplitArrows([{ properties: { source: 'arrow', isMerged: 1, branches: [{}, {}] } }]))
            .toEqual({ canSplit: false });
        expect(canSplitArrows([{ properties: { source: 'arrow', isMerged: 'true', branches: [{}, {}] } }]))
            .toEqual({ canSplit: false });
    });

    it('exige source arrow e branches array', () => {
        expect(canSplitArrows([{ properties: { source: 'polygon', isMerged: true, branches: [{}, {}] } }]))
            .toEqual({ canSplit: false });
        expect(canSplitArrows([{ properties: { source: 'arrow', isMerged: true, branches: 'nao-array' } }]))
            .toEqual({ canSplit: false });
        expect(canSplitArrows([{}])).toEqual({ canSplit: false });
    });
});

// ============================================================================
// extractBranches, observed through mergeArrows
// ============================================================================

describe('extractBranches (via mergeArrows)', () => {
    it('CONTROLE: a função é alcançável e produz um ramo por seta', async () => {
        await mergeArrows([arrow({ id: '1' }), arrow({ id: '2' })], {}, selectionManager);
        const branches = mergedProps().branches;
        expect(branches.length).toBe(2);
        expect(branches[0].baseCoordinates).toEqual([[0, 0], [1, 1]]);
    });

    it('propriedade geométrica falsy-mas-DEFINIDA é copiada (width 0, false, posição 0)', async () => {
        const falsyButSet = arrow({
            id: '1',
            width: 0,
            showArrowHead: false,
            headLengthRatio: 0,
            airmobile: false,
            airmobilePosition: 0,
        });
        await mergeArrows([falsyButSet, arrow({ id: '2' })], {}, selectionManager);
        const branch = mergedProps().branches[0];
        expect(Object.keys(branch).sort()).toEqual(
            ['airmobile', 'airmobilePosition', 'baseCoordinates', 'headLengthRatio', 'showArrowHead', 'width'],
        );
        expect(branch.width).toBe(0);
        expect(branch.showArrowHead).toBe(false);
        expect(branch.headLengthRatio).toBe(0);
        expect(branch.airmobile).toBe(false);
        expect(branch.airmobilePosition).toBe(0);
    });

    it('propriedade AUSENTE não é inventada (o `undefined` é o único descartado)', async () => {
        await mergeArrows([arrow({ id: '1' }), arrow({ id: '2' })], {}, selectionManager);
        expect(Object.keys(mergedProps().branches[0])).toEqual(['baseCoordinates']);
    });

    it('achata uma seta JÁ combinada em vez de aninhá-la', async () => {
        const alreadyMerged = {
            properties: {
                id: 'm', source: 'arrow', isMerged: true,
                branches: [
                    { baseCoordinates: [[0, 0], [1, 1]], width: 7 },
                    { baseCoordinates: [[5, 5], [6, 6]], width: 8 },
                ],
            },
        };
        await mergeArrows([alreadyMerged, arrow({ id: '2' })], {}, selectionManager);
        const branches = mergedProps().branches;
        expect(branches.length).toBe(3);
        expect(branches.map((b) => b.width)).toEqual([7, 8, undefined]);
    });

    it('`isMerged` com branches VAZIO cai no caminho de seta simples', async () => {
        const emptyBranches = arrow({ id: '1', isMerged: true, branches: [], width: 3 });
        await mergeArrows([emptyBranches, arrow({ id: '2' })], {}, selectionManager);
        const branches = mergedProps().branches;
        expect(branches.length).toBe(2);
        expect(branches[0]).toEqual({ baseCoordinates: [[0, 0], [1, 1]], width: 3 });
    });

    it('os props de topo espelham o PRIMEIRO ramo (compat com o leitor antigo)', async () => {
        const first = arrow({ id: '1', width: 111, headLengthRatio: 2.5 });
        const second = arrow({ id: '2', width: 222 });
        await mergeArrows([first, second], {}, selectionManager);
        const props = mergedProps();
        expect(props.width).toBe(111);
        expect(props.headLengthRatio).toBe(2.5);
        expect(props.baseCoordinates).toBe(props.branches[0].baseCoordinates);
    });
});

describe('DEFEITO: extractBranches copia baseCoordinates de forma RASA', () => {
    // The backlog row says "baseCoordinates deep-copy". Measured, it is `[...props.key]`,
    // a one-level spread: the outer array is new, every inner [lng, lat] is the SAME
    // object as the source arrow's. Editing a vertex of the merged arrow therefore
    // reaches back into the feature the merge was supposed to consume.

    it('CONTROLE: o array EXTERNO realmente é novo', async () => {
        const coords = [[0, 0], [1, 1]];
        await mergeArrows([arrow({ id: '1', baseCoordinates: coords }), arrow({ id: '2' })], {}, selectionManager);
        expect(mergedProps().branches[0].baseCoordinates).not.toBe(coords);
    });

    it.fails('DEVERIA isolar os vértices (hoje o [lng, lat] interno é compartilhado)', async () => {
        const coords = [[0, 0], [1, 1]];
        await mergeArrows([arrow({ id: '1', baseCoordinates: coords }), arrow({ id: '2' })], {}, selectionManager);
        expect(mergedProps().branches[0].baseCoordinates[0]).not.toBe(coords[0]);
    });

    it('OBSERVADO: mutar o vértice do ramo muta o da seta de origem', async () => {
        const coords = [[0, 0], [1, 1]];
        await mergeArrows([arrow({ id: '1', baseCoordinates: coords }), arrow({ id: '2' })], {}, selectionManager);
        mergedProps().branches[0].baseCoordinates[0][0] = 99;
        expect(coords[0][0]).toBe(99);
    });

    it('OBSERVADO: no caminho JÁ COMBINADO nem o array externo é copiado', async () => {
        const branchCoords = [[0, 0], [1, 1]];
        const alreadyMerged = {
            properties: {
                id: 'm', source: 'arrow', isMerged: true,
                branches: [{ baseCoordinates: branchCoords }, { baseCoordinates: [[5, 5], [6, 6]] }],
            },
        };
        await mergeArrows([alreadyMerged, arrow({ id: '2' })], {}, selectionManager);
        // `{ ...b }` copies the branch object but not the array it points at.
        expect(mergedProps().branches[0]).not.toBe(alreadyMerged.properties.branches[0]);
        expect(mergedProps().branches[0].baseCoordinates).toBe(branchCoords);
    });
});

describe('DEFEITO: extractBranches destrói baseCoordinates guardado como string', () => {
    // `AddArrowGeometry.normalizeBaseCoordinates` has an explicit branch for a JSON
    // string, which is the codebase saying that shape reaches it from persistence.
    // `extractBranches` does not normalize: it spreads, and spreading a string yields
    // its CHARACTERS. The merged arrow then carries a coordinate list of "[", "0", ",".

    it('CONTROLE: com array a mesma chamada produz coordenadas de verdade', async () => {
        await mergeArrows([arrow({ id: '1', baseCoordinates: [[0, 0], [1, 1]] }), arrow({ id: '2' })], {}, selectionManager);
        expect(mergedProps().branches[0].baseCoordinates).toEqual([[0, 0], [1, 1]]);
    });

    it.fails('DEVERIA normalizar a string JSON (hoje espalha em caracteres)', async () => {
        const persisted = arrow({ id: '1', baseCoordinates: '[[0,0],[1,1]]' });
        await mergeArrows([persisted, arrow({ id: '2' })], {}, selectionManager);
        expect(mergedProps().branches[0].baseCoordinates).toEqual([[0, 0], [1, 1]]);
    });

    it('OBSERVADO: o ramo recebe os 13 caracteres da string', async () => {
        const persisted = arrow({ id: '1', baseCoordinates: '[[0,0],[1,1]]' });
        await mergeArrows([persisted, arrow({ id: '2' })], {}, selectionManager);
        const out = mergedProps().branches[0].baseCoordinates;
        expect(out.length).toBe(13);
        expect(out).toEqual(['[', '[', '0', ',', '0', ']', ',', '[', '1', ',', '1', ']', ']']);
    });
});

// ============================================================================
// mergeArrows / splitArrows — guards and write order
// ============================================================================

describe('mergeArrows: guardas e ordem de escrita', () => {
    it('recusa menos de 2 setas sem tocar no store', async () => {
        const out = await mergeArrows([arrow({})], {}, selectionManager);
        expect(out).toBeNull();
        expect(calls.added.length).toBe(0);
        expect(calls.removed.length).toBe(0);
        expect(calls.warnings).toEqual(['Selecione pelo menos 2 setas para combinar']);
    });

    it('ADICIONA a combinada antes de remover as origens, e fecha o lote uma vez', async () => {
        const order = [];
        const first = arrow({ id: '1' });
        const second = arrow({ id: '2' });
        calls.added = new Proxy([], { set(t, k, v) { if (k !== 'length') order.push('add'); t[k] = v; return true; } });
        calls.removed = new Proxy([], { set(t, k, v) { if (k !== 'length') order.push(`remove:${v.id}`); t[k] = v; return true; } });

        await mergeArrows([first, second], {}, selectionManager);

        expect(order).toEqual(['add', 'remove:1', 'remove:2']);
        expect(calls.batchStarts).toBe(1);
        expect(calls.batchCommits).toBe(1);
    });

    it('a camada da combinada vem da PRIMEIRA seta, com a camada ativa como reserva', async () => {
        await mergeArrows([arrow({ id: '1', layerId: 'L9' }), arrow({ id: '2', layerId: 'L9' })], {}, selectionManager);
        expect(mergedProps().layerId).toBe('L9');

        calls.added = [];
        await mergeArrows([arrow({ id: '1' }), arrow({ id: '2' })], {}, selectionManager);
        expect(mergedProps().layerId).toBe('camada-ativa');
    });

    it('a combinada nasce com isMerged e source arrow', async () => {
        await mergeArrows([arrow({ id: '1' }), arrow({ id: '2' })], {}, selectionManager);
        const props = mergedProps();
        expect(props.isMerged).toBe(true);
        expect(props.source).toBe('arrow');
        expect(props.id).toBe('novo-id');
    });
});

describe('splitArrows: guarda de entrada', () => {
    it('recusa uma seta que não é combinada, sem tocar no store', async () => {
        expect(await splitArrows(arrow({}), {}, selectionManager)).toBeNull();
        expect(await splitArrows({ properties: { isMerged: true, branches: [{}] } }, {}, selectionManager)).toBeNull();
        expect(calls.added.length).toBe(0);
        expect(calls.removed.length).toBe(0);
        expect(calls.warnings.length).toBe(2);
    });

    it('separa em uma feição por ramo, adicionando antes de remover a combinada', async () => {
        const merged = {
            properties: {
                id: 'm', source: 'arrow', isMerged: true, layerId: 'L',
                branches: [
                    { baseCoordinates: [[0, 0], [1, 1]], width: 7 },
                    { baseCoordinates: [[5, 5], [6, 6]], width: 8 },
                ],
            },
        };
        const created = await splitArrows(merged, {}, selectionManager);
        expect(created.length).toBe(2);
        expect(calls.added.length).toBe(2);
        expect(calls.removed).toEqual([{ source: 'arrows', id: 'm' }]);
        expect(created.map((f) => f.properties.width)).toEqual([7, 8]);
        // The per-branch defaults the split applies (and merge does not).
        expect(created[0].properties.headLengthRatio).toBe(1.5);
        expect(created[0].properties.airmobilePosition).toBe(0.7);
    });

    it("FORMA `valor || padrao` no split: headLengthRatio 0 e airmobilePosition 0 viram 1.5 e 0.7", () => {
        // Same falsy-zero shape the merge path avoids with `!== undefined`. A branch that
        // legitimately stored 0 comes back changed, and nothing reports it.
        const merged = {
            properties: {
                id: 'm', source: 'arrow', isMerged: true,
                branches: [
                    { baseCoordinates: [[0, 0], [1, 1]], headLengthRatio: 0, airmobilePosition: 0 },
                    { baseCoordinates: [[5, 5], [6, 6]] },
                ],
            },
        };
        return splitArrows(merged, {}, selectionManager).then((created) => {
            expect(created.length).toBe(2);
            expect(created[0].properties.headLengthRatio).toBe(1.5);
            expect(created[0].properties.airmobilePosition).toBe(0.7);
        });
    });
});
