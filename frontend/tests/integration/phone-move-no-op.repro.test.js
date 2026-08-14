// Path: tests/integration/phone-move-no-op.repro.test.js

/**
 * Regression tests for the phone "mover feição" flow.
 *
 * Root cause: move mode was pure theatre. `onMoveStart` only snapped the bottom
 * sheet to peek and hid the FABs; the confirm callback restored the UI and
 * showed "Posição atualizada". There was no map.getCenter(), no delta, no
 * geometry translation and no store call anywhere in the flow, so the toast
 * announced a success that never happened.
 *
 * These tests drive the real PhoneLayout move session against a fake map and a
 * fake store. They pin the four things that decide whether a move is honest:
 *   1. the store is actually written, with the FEATURE OBJECT as the second
 *      argument (an id there makes cleanFeature return null and the write is
 *      dropped without throwing — the same defect that lost attribute saves);
 *   2. what is written is the geometry translated by the map pan;
 *   3. the success toast comes only after the store is re-read and agrees, so a
 *      refused write (locked map, missing permission) says so;
 *   4. cancelling writes nothing at all.
 *
 * The component is exercised through its prototype because instantiating
 * PhoneLayout needs a DOM and the unit environment is node. Only the collabora-
 * tors it talks to are stubbed; the move logic under test is the real one.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getAllStorageTypes,
    getStorageTypeFromSource,
} from '../../src/js/store/store.constants.js';

// ---------------------------------------------------------------------------
// Fake store: only what the move flow touches. updateFeature mimics the real
// contract — it NEVER throws, it silently does nothing when the feature is
// unusable or a guard blocks the write.
// ---------------------------------------------------------------------------

const storeState = {
    features: new Map(),   // `${type}:${id}` -> feature
    blocked: false,
    updateCalls: [],
};

const updateFeatureMock = vi.fn(async (type, feature, mapName) => {
    storeState.updateCalls.push({ type, feature, mapName });

    // cleanFeature() rejects anything without a `type` discriminator — passing an
    // id here returns null and the write is dropped, without throwing.
    if (!feature || typeof feature !== 'object' || !feature.type) return;
    if (storeState.blocked) return;   // permission / map-lock guard

    const key = `${type}:${feature.properties.id}`;
    if (!storeState.features.has(key)) return;
    storeState.features.set(key, JSON.parse(JSON.stringify(feature)));
});

vi.mock('@store', () => ({
    getAllStorageTypes: () => getAllStorageTypes(),
    getStorageTypeFromSource: (t) => getStorageTypeFromSource(t),
    getCurrentMapNameSync: () => 'Principal',
    getFeatureById: async (type, id) => storeState.features.get(`${type}:${id}`),
    updateFeature: (...args) => updateFeatureMock(...args),
    getControl: () => null,
    addMap: async () => null,
    renameMap: async () => undefined,
    removeMap: async () => ({ success: false }),
    getLayers: () => [],
    getCurrentMapFeatures: async () => ({}),
    getAllMapNamesStore: async () => ['Principal'],
    setCurrentMap: async () => undefined,
    setLayerVisibility: () => undefined,
}));

const toastMock = vi.fn();

vi.mock('@utils', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, showToast: (...args) => toastMock(...args) };
});

const { PhoneLayout } = await import('../../src/js/phone/phone-layout.js');

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeFakeMap(startCenter) {
    return {
        center: { ...startCenter },
        handlers: new Map(),
        getCenter() { return { ...this.center }; },
        panTo(next) { this.center = { ...next }; this.handlers.get('move')?.(); },
        on(type, handler) { this.handlers.set(type, handler); },
        off(type) { this.handlers.delete(type); },
        // No style in this environment: the ghost preview degrades to a no-op.
        getSource: () => undefined,
        getLayer: () => undefined,
        addSource: vi.fn(),
        addLayer: vi.fn(),
        removeLayer: vi.fn(),
        removeSource: vi.fn(),
    };
}

function makeLayout(map, featureType = 'point') {
    const layout = Object.create(PhoneLayout.prototype);
    layout._map = map;
    layout._moveSession = null;
    layout._moveMapHandler = null;

    layout._featureEditor = {
        _moving: false,
        getFeatureData: () => ({ id: 'f-1', type: featureType }),
        exitMoveMode: vi.fn(function () { this._moving = false; }),
        isMoving() { return this._moving; },
    };
    layout._bottomSheet = { snapTo: vi.fn() };
    layout._fabs = { hide: vi.fn(), show: vi.fn() };
    layout._moveActions = {
        confirm: null,
        cancel: null,
        setBusy: vi.fn(),
        hide: vi.fn(),
        show(onConfirm, onCancel) { this.confirm = onConfirm; this.cancel = onCancel; },
    };
    return layout;
}

const storedPoint = () => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
    properties: { id: 'f-1', nome: 'Posto', layerId: 'l-1' },
});

beforeEach(() => {
    storeState.features = new Map([['points:f-1', storedPoint()]]);
    storeState.blocked = false;
    storeState.updateCalls = [];
    updateFeatureMock.mockClear();
    toastMock.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('phone move mode — the confirmed move reaches the store', () => {
    it('translates the feature by the map pan and persists it', async () => {
        const map = makeFakeMap({ lng: -43.0, lat: -22.0 });
        const layout = makeLayout(map);

        await layout._startMoveSession('f-1');
        map.panTo({ lng: -42.5, lat: -22.25 });   // delta +0.5 lng, -0.25 lat
        await layout._moveActions.confirm();

        expect(updateFeatureMock).toHaveBeenCalledTimes(1);
        const stored = storeState.features.get('points:f-1');
        expect(stored.geometry.coordinates[0]).toBeCloseTo(-42.7, 9);
        expect(stored.geometry.coordinates[1]).toBeCloseTo(-23.15, 9);
        expect(toastMock).toHaveBeenCalledWith('Posição atualizada', 'success');
    });

    it('passes the FEATURE OBJECT as the second argument, never the id', async () => {
        const map = makeFakeMap({ lng: 0, lat: 0 });
        const layout = makeLayout(map);

        await layout._startMoveSession('f-1');
        map.panTo({ lng: 1, lat: 1 });
        await layout._moveActions.confirm();

        const [type, feature, mapName] = storeState.updateCalls[0]
            ? [storeState.updateCalls[0].type, storeState.updateCalls[0].feature, storeState.updateCalls[0].mapName]
            : [];
        expect(type).toBe('points');
        expect(mapName).toBe('Principal');
        expect(typeof feature).toBe('object');
        expect(feature.type).toBe('Feature');
        expect(feature.geometry.type).toBe('Point');
        expect(feature.properties.id).toBe('f-1');
        // Everything the feature carried must survive the move.
        expect(feature.properties.nome).toBe('Posto');
        expect(feature.properties.layerId).toBe('l-1');
    });

    it('keeps the delta continuous across the antimeridian', async () => {
        storeState.features.set('points:f-1', {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [179.5, 10] },
            properties: { id: 'f-1' },
        });

        // MapLibre reports an UNWRAPPED centre longitude, so panning east past
        // +180 gives 180.5, not -179.5, and the delta stays +1.
        const map = makeFakeMap({ lng: 179.5, lat: 10 });
        const layout = makeLayout(map);

        await layout._startMoveSession('f-1');
        map.panTo({ lng: 180.5, lat: 10 });
        await layout._moveActions.confirm();

        const stored = storeState.features.get('points:f-1');
        expect(stored.geometry.coordinates[0]).toBeCloseTo(-179.5, 9);
        expect(toastMock).toHaveBeenCalledWith('Posição atualizada', 'success');
    });
});

describe('phone move mode — the toast tells the truth', () => {
    it('reports failure when the store refuses the write', async () => {
        storeState.blocked = true;

        const map = makeFakeMap({ lng: 0, lat: 0 });
        const layout = makeLayout(map);

        await layout._startMoveSession('f-1');
        map.panTo({ lng: 1, lat: 1 });
        await layout._moveActions.confirm();

        // updateFeature returns undefined on the guarded path too, so the only
        // honest check is re-reading the store.
        expect(updateFeatureMock).toHaveBeenCalledTimes(1);
        expect(storeState.features.get('points:f-1').geometry.coordinates).toEqual([-43.2, -22.9]);
        expect(toastMock).not.toHaveBeenCalledWith('Posição atualizada', 'success');
        expect(toastMock).toHaveBeenCalledWith(
            'Não foi possível mover (sem permissão ou mapa bloqueado)', 'error',
        );
    });

    it('does not claim success when the map never moved', async () => {
        const map = makeFakeMap({ lng: 0, lat: 0 });
        const layout = makeLayout(map);

        await layout._startMoveSession('f-1');
        await layout._moveActions.confirm();   // confirmed without panning

        expect(updateFeatureMock).not.toHaveBeenCalled();
        expect(toastMock).toHaveBeenCalledWith('A feição não foi movida', 'info');
    });

    it('refuses a feature whose geometry cannot be translated', async () => {
        storeState.features.set('points:f-1', {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [] },
            properties: { id: 'f-1' },
        });

        const map = makeFakeMap({ lng: 0, lat: 0 });
        const layout = makeLayout(map);

        await layout._startMoveSession('f-1');

        expect(layout._moveSession).toBeNull();
        expect(updateFeatureMock).not.toHaveBeenCalled();
        expect(toastMock).toHaveBeenCalledWith('Não foi possível mover esta feição', 'error');
    });
});

describe('phone move mode — cancel and cleanup', () => {
    it('cancel leaves the feature exactly where it was', async () => {
        const map = makeFakeMap({ lng: 0, lat: 0 });
        const layout = makeLayout(map);

        await layout._startMoveSession('f-1');
        map.panTo({ lng: 30, lat: 30 });
        layout._moveActions.cancel();

        expect(updateFeatureMock).not.toHaveBeenCalled();
        expect(storeState.features.get('points:f-1').geometry.coordinates).toEqual([-43.2, -22.9]);
        expect(toastMock).not.toHaveBeenCalledWith('Posição atualizada', 'success');
        expect(layout._moveSession).toBeNull();
    });

    it('unregisters the map listener and restores the UI on both exits', async () => {
        const map = makeFakeMap({ lng: 0, lat: 0 });
        const layout = makeLayout(map);

        await layout._startMoveSession('f-1');
        expect(map.handlers.has('move')).toBe(true);

        layout._moveActions.cancel();
        expect(map.handlers.has('move')).toBe(false);
        expect(layout._fabs.show).toHaveBeenCalled();
        expect(layout._featureEditor.exitMoveMode).toHaveBeenCalled();

        await layout._startMoveSession('f-1');
        map.panTo({ lng: 1, lat: 1 });
        await layout._moveActions.confirm();
        expect(map.handlers.has('move')).toBe(false);
    });

    it('a second confirm tap cannot move the feature twice', async () => {
        const map = makeFakeMap({ lng: 0, lat: 0 });
        const layout = makeLayout(map);

        await layout._startMoveSession('f-1');
        map.panTo({ lng: 1, lat: 1 });

        const confirm = layout._moveActions.confirm;
        await Promise.all([confirm(), confirm()]);

        expect(updateFeatureMock).toHaveBeenCalledTimes(1);
        expect(storeState.features.get('points:f-1').geometry.coordinates[0]).toBeCloseTo(-42.2, 9);
    });
});
