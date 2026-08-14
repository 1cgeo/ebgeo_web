// Path: tests/unit/feature-organizer.test.js
//
// ROOT CAUSE it guards: `organizeFeaturesByLayers` derived the singular source type
// from the storage type with a plural-stripping heuristic
// (`storageType.endsWith('s') ? slice(0, -1) : storageType`). For the three storage
// buckets whose name is not `source + 's'` — 'setores' (sector), 'brushes' (brush)
// and 'los' (los) — the heuristic produced 'setore', 'brushe' and 'lo', while the
// group store records `type: feature.properties.source` (the canonical singular) and
// matches by strict equality. Result: grouped sectors, brush strokes and lines of
// sight never found their group and were listed as ungrouped in the Camadas tab.
//
// The fix uses the canonical reverse lookup `getSourceTypeFromStorage` (@store), the
// same helper the sibling `feature-item.component.js` already used.
//
// NOTE on the second edit in the same commit (`groups instanceof Map` → Object.entries):
// `getMapGroups` returns a plain object, so the old branch never ran and `groupTotals`
// was always empty. That is NOT observable through this API, because the call site
// falls back to `group.features?.length`, which yields the same number. No assertion
// here pretends to prove it.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
    groups: {},
    layers: [{ id: 'L1', name: 'Camada 1', order: 0 }],
};

vi.mock('@store', async () => {
    const constants = await import('../../src/js/store/store.constants.js');
    return {
        // Real implementations: the reverse lookup is the subject under test.
        getSourceTypeFromStorage: constants.getSourceTypeFromStorage,
        getAllStorageTypes: constants.getAllStorageTypes,
        getCurrentMapNameSync: () => 'Principal',
        getActiveLayerIdSync: () => 'L1',
        getLayers: async () => state.layers,
        getMapGroups: () => state.groups,
        // Faithful (simplified) copy of GroupManager.getFeatureGroup: strict equality
        // on the canonical singular type.
        getFeatureGroup: (type, featureId) => {
            for (const group of Object.values(state.groups)) {
                if (group.features.some((f) => f.type === type && f.id === featureId)) {
                    return group;
                }
            }
            return null;
        },
    };
});

const { organizeFeaturesByLayers } = await import('../../src/js/features_tab/feature-organizer.service.js');

/**
 * Builds a minimal GeoJSON-ish feature as the map sources hand it over.
 * @param {string} id - Feature id
 * @param {string} source - Canonical singular source type
 * @param {string} [layerId] - Owning layer id
 * @returns {Object} Feature
 */
function feat(id, source, layerId = 'L1') {
    return { properties: { id, nome: id, source, layerId } };
}

beforeEach(() => {
    state.groups = {};
    state.layers = [{ id: 'L1', name: 'Camada 1', order: 0 }];
});

describe('organizeFeaturesByLayers — resolução do tipo de origem', () => {
    it('agrupa setor, pincel e LOS, cujos buckets não são "source + s"', async () => {
        state.groups = {
            G1: {
                id: 'G1',
                name: 'Grupo 1',
                features: [
                    { type: 'sector', id: 's1' },
                    { type: 'brush', id: 'b1' },
                    { type: 'los', id: 'v1' },
                ],
            },
        };

        const layers = await organizeFeaturesByLayers({
            setores: [feat('s1', 'sector')],
            brushes: [feat('b1', 'brush')],
            los: [feat('v1', 'los')],
        });

        const layer = layers[0];
        expect(layer.featureCount).toBe(3);
        expect(layer.ungrouped).toEqual([]);
        expect(layer.groups.size).toBe(1);
        expect(layer.groups.get('G1').features.map((f) => f.id).sort()).toEqual(['b1', 's1', 'v1']);
        expect(layer.groups.get('G1').totalInGroup).toBe(3);
    });

    it('mantém o caminho regular (points → point) e deixa fora do grupo quem não está nele', async () => {
        state.groups = {
            G1: { id: 'G1', name: 'Grupo 1', features: [{ type: 'point', id: 'p1' }] },
        };

        const layers = await organizeFeaturesByLayers({
            points: [feat('p1', 'point'), feat('p2', 'point')],
        });

        const layer = layers[0];
        expect(layer.groups.get('G1').features.map((f) => f.id)).toEqual(['p1']);
        expect(layer.ungrouped.map((f) => f.id)).toEqual(['p2']);
    });

    it('borda: bucket sem plural nenhum ("visibility") e feição de camada inexistente caem na primeira camada, sem grupo', async () => {
        state.groups = {
            G1: { id: 'G1', name: 'Grupo 1', features: [{ type: 'visibility', id: 'z1' }] },
        };

        const layers = await organizeFeaturesByLayers({
            visibility: [feat('z1', 'visibility', 'CAMADA-QUE-SUMIU')],
        });

        const layer = layers[0];
        expect(layer.layer.id).toBe('L1');
        expect(layer.featureCount).toBe(1);
        expect(layer.ungrouped).toEqual([]);
        expect(layer.groups.get('G1').features.map((f) => f.id)).toEqual(['z1']);
    });

    it('borda: sem camada nenhuma, nada estoura e o resultado é vazio', async () => {
        state.layers = [];
        state.groups = {};

        const layers = await organizeFeaturesByLayers({ setores: [feat('s1', 'sector')] });

        expect(layers).toEqual([]);
    });
});
