import { describe, it, expect, vi } from 'vitest';

// The helper is a leaf export of terrain.control.js, which pulls the store in;
// mock the store-side imports so the module loads in the `node` environment.
vi.mock('../../src/js/store', () => ({ getEventBus: () => ({ on: () => () => {} }) }));
vi.mock('../../src/js/store/catalog.operations.js', () => ({ getCatalogLayers: async () => [], toggleCatalogLayerVisibility: async () => {} }));
vi.mock('../../src/js/store/atlas/atlas.entity.js', () => ({ DEFAULT_TERRAIN_EXAGGERATION: 1.5 }));

const { setProjectionKeepingHillshade } = await import('../../src/js/terrain/terrain.control.js');

// A map double whose `render` event fires on the next macrotask after
// `triggerRepaint`, the way MapLibre schedules a frame.
function makeMap({ hasHillshade = true, visibility = 'visible' } = {}) {
    const calls = [];
    const listeners = [];
    return {
        calls,
        getLayer: (id) => (hasHillshade && id === 'hillshade' ? { id } : undefined),
        getLayoutProperty: (id, prop) => (prop === 'visibility' ? visibility : undefined),
        setLayoutProperty: (id, prop, value) => { calls.push(`layout:${id}:${prop}=${value}`); visibility = value; },
        setProjection: (p) => { calls.push(`projection:${p.type}`); },
        once: (ev, fn) => { if (ev === 'render') listeners.push(fn); },
        triggerRepaint: () => { calls.push('repaint'); setTimeout(() => { const fns = listeners.splice(0); fns.forEach((f) => f()); }, 0); },
    };
}

describe('setProjectionKeepingHillshade', () => {
    it('hides the hillshade, waits a frame, switches, waits a frame, shows it again', async () => {
        const map = makeMap();
        await setProjectionKeepingHillshade(map, { type: 'mercator' });
        expect(map.calls).toEqual([
            'layout:hillshade:visibility=none',
            'repaint',
            'projection:mercator',
            'repaint',
            'layout:hillshade:visibility=visible',
        ]);
    });

    it('never changes the projection in the same frame as the hide', async () => {
        const map = makeMap();
        const pending = setProjectionKeepingHillshade(map, { type: 'globe' });
        // Synchronously after the call: only the hide (and the repaint request) happened.
        expect(map.calls).toEqual(['layout:hillshade:visibility=none', 'repaint']);
        await pending;
        expect(map.calls).toContain('projection:globe');
    });

    it('leaves a hidden hillshade hidden and switches at once', async () => {
        const map = makeMap({ visibility: 'none' });
        await setProjectionKeepingHillshade(map, { type: 'globe' });
        expect(map.calls).toEqual(['projection:globe']);
    });

    it('only switches when there is no hillshade layer', async () => {
        const map = makeMap({ hasHillshade: false });
        await setProjectionKeepingHillshade(map, { type: 'globe' });
        expect(map.calls).toEqual(['projection:globe']);
    });
});
