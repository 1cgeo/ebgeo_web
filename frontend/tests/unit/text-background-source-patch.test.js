// Path: tests/unit/text-background-source-patch.test.js

/**
 * Regression: the "texts source already patched" mark must live on the SOURCE, not on the
 * AddTextControl singleton.
 *
 * `map.setStyle()` (base-layer switch) destroys every custom source; `setupTextLayers` then
 * recreates them. When the mark lived on the control (a session-long singleton from the control
 * registry), the second call skipped the patch and the freshly created 'texts' source never
 * mirrored writes into 'text-backgrounds' again — so a text created after a base-layer switch
 * rendered without its background for the rest of the session.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Session-long control singleton, exactly like the real registry hands out. */
const textControl = {
    applyZoomCorrections: (features) => features,
};

vi.mock('../../src/js/store/index.js', () => ({
    getControl: vi.fn((name) => (name === 'AddTextControl' ? textControl : undefined)),
}));

const { setupTextLayers } = await import('../../src/js/layers/styles/content.layers.js');

/**
 * Minimal MapLibre stand-in: sources are plain objects and `addSource` mints a NEW object every
 * time, which is what makes the setStyle simulation faithful.
 */
function createFakeMap() {
    const sources = new Map();
    const layers = new Set();
    return {
        sources,
        getSource: (name) => sources.get(name),
        addSource: (name, def) => {
            let current = def.data;
            sources.set(name, {
                setData(data) { current = data; },
                async getData() { return current; },
            });
        },
        getLayer: (id) => (layers.has(id) ? { id } : undefined),
        addLayer: (def) => { layers.add(def.id); },
        /** Simulates `setStyle()`: every custom source and layer is dropped. */
        setStyle() { sources.clear(); layers.clear(); },
    };
}

/** @param {string} id @param {boolean} showBackground */
function textFeature(id, showBackground) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: {
            id,
            showBackground,
            selectionBox: showBackground
                ? { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }
                : null,
        },
    };
}

describe('setupTextLayers — text-backgrounds mirroring patch', () => {
    beforeEach(() => {
        // The control survives across base-layer switches; any leftover mark must NOT gate the patch.
        delete textControl._backgroundUpdateListener;
    });

    it('patches the texts source on the first setup', () => {
        const map = createFakeMap();
        setupTextLayers({ texts: [] }, map);

        const source = map.getSource('texts');
        expect(source).toBeDefined();
        expect(source.__ebgeoBgPatch).toBe(true);
    });

    it('re-patches the NEW texts source created after a setStyle (base-layer switch)', () => {
        const map = createFakeMap();
        setupTextLayers({ texts: [] }, map);

        const firstSource = map.getSource('texts');
        const firstSetData = firstSource.setData;

        map.setStyle(); // base-layer switch: sources destroyed
        setupTextLayers({ texts: [] }, map);

        const secondSource = map.getSource('texts');
        expect(secondSource).not.toBe(firstSource);
        expect(secondSource.__ebgeoBgPatch).toBe(true);
        expect(secondSource.setData).not.toBe(firstSetData);
    });

    it('mirrors a post-setStyle write into text-backgrounds', async () => {
        const map = createFakeMap();
        setupTextLayers({ texts: [] }, map);
        map.setStyle();
        setupTextLayers({ texts: [] }, map);

        map.getSource('texts').setData({
            type: 'FeatureCollection',
            features: [textFeature('t1', true), textFeature('t2', false)],
        });
        await new Promise((resolve) => setTimeout(resolve, 0));

        const backgrounds = await map.getSource('text-backgrounds').getData();
        expect(backgrounds.features).toHaveLength(1);
        expect(backgrounds.features[0].properties.id).toBe('t1_bg');
    });

    // Edge case: the same source must never be wrapped twice, or one write would schedule N
    // mirroring passes (and each re-setup during a session calls setupTextLayers again).
    it('does not double-wrap a source that survives a re-setup', () => {
        const map = createFakeMap();
        setupTextLayers({ texts: [] }, map);

        const patched = map.getSource('texts').setData;
        setupTextLayers({ texts: [] }, map); // no setStyle: same source object

        expect(map.getSource('texts').setData).toBe(patched);
    });

    // Edge case: a stale mark left on the control (the old mechanism) must not suppress the patch.
    it('patches even when the control carries the legacy mark', () => {
        const map = createFakeMap();
        textControl._backgroundUpdateListener = true;

        setupTextLayers({ texts: [] }, map);

        expect(map.getSource('texts').__ebgeoBgPatch).toBe(true);
    });
});
