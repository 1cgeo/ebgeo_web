// Path: tests/unit/azimuth-distance-panel-style.test.js

/**
 * Regression test for the azimuth/distance attributes panel state.
 *
 * The panel used to read `strokeColor`/`strokeWidth`/`strokeOpacity` — keys no MapLibre paint
 * reads — and to look for the polar fields (`outputMode`, `legs`, ...) at the top level of the
 * feature properties, where `generateFeature` never puts them (they live inside
 * `azimuthDistanceData`). Both mistakes are pinned here.
 */

import { describe, it, expect, vi } from 'vitest';

// The panel imports the `@tools/helpers` barrel, which pulls DOM/MapLibre-coupled modules. Mock it
// so the pure state derivation can run in the `node` environment.
vi.mock('@tools/helpers/index.js', () => ({
    createModernColorPicker: () => ({}),
    createModernSlider: () => ({}),
    createModernButtons: () => ({}),
    createSectionDivider: () => ({}),
}));

const { getAzimuthDistanceStyleState } = await import(
    '../../src/js/azimuth_distance_tool/azimuth_distance_attributes_panel.js'
);
const { OUTPUT_MODE } = await import(
    '../../src/js/azimuth_distance_tool/azimuth_distance_constants.js'
);

/** Properties as `generateFeature` emits them for a ROUTE. */
function routeProps(overrides = {}) {
    return {
        source: 'line',
        featureType: 'azimuth_distance',
        lineColor: '#ff0000',
        lineWidth: 5,
        opacity: 0.7,
        azimuthDistanceData: {
            outputMode: OUTPUT_MODE.ROUTE,
            referencePoint: [-43.2, -22.9],
            legs: [{ azimuth: 90, distance: 100, observation: '' }],
        },
        ...overrides,
    };
}

describe('getAzimuthDistanceStyleState — style keys', () => {
    it('reads the keys the paint reads, not the stroke* ones', () => {
        const state = getAzimuthDistanceStyleState(routeProps());
        expect(state.lineColor).toBe('#ff0000');
        expect(state.lineWidth).toBe(5);
        expect(state.opacity).toBe(0.7);
    });

    it('ignores legacy stroke* properties entirely', () => {
        // A feature carrying only the old keys must fall back to the defaults, never adopt them:
        // adopting them would show the user a value the map does not render.
        const state = getAzimuthDistanceStyleState({
            strokeColor: '#123456',
            strokeWidth: 9,
            strokeOpacity: 0.1,
            azimuthDistanceData: { outputMode: OUTPUT_MODE.ROUTE },
        });
        expect(state.lineColor).toBe('#16a34a');
        expect(state.lineWidth).toBe(5);
        expect(state.opacity).toBe(0.7);
    });

    it('keeps a zero opacity instead of falling back to the default', () => {
        const state = getAzimuthDistanceStyleState(routeProps({ opacity: 0 }));
        expect(state.opacity).toBe(0);
    });

    it('falls back when width/opacity are NaN, null or undefined', () => {
        const nan = getAzimuthDistanceStyleState(routeProps({ lineWidth: NaN, opacity: NaN }));
        expect(nan.lineWidth).toBe(5);
        expect(nan.opacity).toBe(0.7);

        const nulls = getAzimuthDistanceStyleState(routeProps({ lineWidth: null, opacity: null }));
        expect(nulls.lineWidth).toBe(5);
        expect(nulls.opacity).toBe(0.7);

        const missing = getAzimuthDistanceStyleState({ azimuthDistanceData: {} });
        expect(missing.lineWidth).toBe(5);
        expect(missing.opacity).toBe(0.7);
    });

    it('survives null/empty properties', () => {
        const state = getAzimuthDistanceStyleState(null);
        expect(state.isArea).toBe(false);
        expect(state.polar).toEqual({});
        expect(state.lineColor).toBe('#16a34a');
    });
});

describe('getAzimuthDistanceStyleState — polar data location', () => {
    it('reads the polar block from azimuthDistanceData', () => {
        const props = routeProps();
        const state = getAzimuthDistanceStyleState(props);
        expect(state.polar).toBe(props.azimuthDistanceData);
        expect(state.polar.legs).toHaveLength(1);
    });

    it('detects AREA mode from azimuthDistanceData, not from the top level', () => {
        const area = getAzimuthDistanceStyleState({
            fillColor: '#00ff00',
            opacity: 0.5,
            azimuthDistanceData: { outputMode: OUTPUT_MODE.AREA },
        });
        expect(area.isArea).toBe(true);
        expect(area.fillColor).toBe('#00ff00');

        // The old top-level read: it must NOT be honoured, otherwise a ROUTE would grow a fill
        // section it has no polygon to paint.
        const spoofed = getAzimuthDistanceStyleState({
            outputMode: OUTPUT_MODE.AREA,
            azimuthDistanceData: { outputMode: OUTPUT_MODE.ROUTE },
        });
        expect(spoofed.isArea).toBe(false);
    });

    it('uses the AREA defaults for width and opacity', () => {
        const state = getAzimuthDistanceStyleState({
            azimuthDistanceData: { outputMode: OUTPUT_MODE.AREA },
        });
        expect(state.lineWidth).toBe(2);
        expect(state.opacity).toBe(0.5);
    });
});
