// Path: tests/integration/etiqueta-ancora-zero-sobrescrita.repro.test.js

/**
 * @fileoverview Regression test for the label zoom anchor being rewritten on every
 * shape whose label was never re-anchored.
 *
 * ROOT CAUSE. `labelCreatedAtZoom: 0` is the value in LABEL_DEFAULT_PROPERTIES, so
 * it is the anchor EVERY new label carries. The backfill guard was
 * `if (!feature.properties.labelCreatedAtZoom)`, a truthiness test, so that
 * legitimate zero read as "missing" and was overwritten with whatever zoom the user
 * happened to be at. The label's zoom correction was then silently re-anchored to a
 * different reference, and the same falsy-zero read `labelSize: 0` as the default 14.
 *
 * The dangerous half is that the arithmetic existed TWICE: `recalcLabelSize` and an
 * inline copy inside the `createLabelZoomHandler` rAF loop. Fixing the function and
 * not the copy leaves the defect alive on the path that runs on every zoom gesture,
 * with the unit suite green, because the unit suite only reaches the function.
 *
 * FIX (2026-08-24). `Number.isFinite` instead of truthiness, and the handler calls
 * `recalcLabelSize` instead of restating it.
 *
 * WHAT THIS DRIVES. Both paths: the helper directly, and the handler's update pass
 * through a fake MapLibre source and a fake GeoJSON dispatcher. `requestAnimationFrame`
 * is replaced by a synchronous stub that hands back the promise the handler ignores,
 * so the assertion can await the real update instead of polling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tools/helpers/index.js', () => ({
    createModernSlider: vi.fn(),
    createModernColorPicker: vi.fn(),
    createModernToggle: vi.fn(),
    createModernTextarea: vi.fn(),
    createSectionDivider: vi.fn(),
}));

vi.mock('@js/measurement_tool/measurement-geometry.js', () => ({
    formatAreaAuto: vi.fn(() => '0 m²'),
}));

const { getGeoJsonDispatcher } = await import('@layers/geojson-dispatcher.js');

vi.mock('@layers/geojson-dispatcher.js', () => ({
    getGeoJsonDispatcher: vi.fn(),
}));

const {
    recalcLabelSize,
    createLabelZoomHandler,
    LABEL_DEFAULT_PROPERTIES,
} = await import('../../src/js/tool_manager/helpers/label-tab.helpers.js');

/** Feature carrying the default label bag, i.e. anchor 0, plus overrides. */
const labelledFeature = (overrides = {}) => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    properties: { ...LABEL_DEFAULT_PROPERTIES, showLabel: true, labelText: 'PC', ...overrides },
});

describe('repro: a ancora de zoom 0 da etiqueta era sobrescrita', () => {
    it('controle: o padrao de etiqueta ancora em ZERO, que e o valor sob suspeita', () => {
        expect(LABEL_DEFAULT_PROPERTIES.labelCreatedAtZoom).toBe(0);
    });

    it('recalcLabelSize preserva a ancora 0 e deixa a etiqueta crescer com o zoom', () => {
        const feature = labelledFeature();
        recalcLabelSize(feature, feature, 4);

        expect(feature.properties.labelCreatedAtZoom).toBe(0);
        expect(feature.properties.labelCalculatedSize).toBe(14 * 2 ** 4);
    });

    it('e continua fazendo backfill quando a ancora e de fato ausente', () => {
        const feature = labelledFeature({ labelCreatedAtZoom: undefined });
        recalcLabelSize(feature, feature, 13.5);

        expect(feature.properties.labelCreatedAtZoom).toBe(13.5);
        expect(feature.properties.labelCalculatedSize).toBe(14);
    });

    describe('o mesmo pelo caminho que roda a cada gesto de zoom', () => {
        let rafCallback;
        let originalRaf;
        let originalCancelRaf;

        beforeEach(() => {
            originalRaf = globalThis.requestAnimationFrame;
            originalCancelRaf = globalThis.cancelAnimationFrame;
            globalThis.requestAnimationFrame = (cb) => { rafCallback = cb; return 1; };
            globalThis.cancelAnimationFrame = () => {};
        });

        afterEach(() => {
            globalThis.requestAnimationFrame = originalRaf;
            globalThis.cancelAnimationFrame = originalCancelRaf;
            rafCallback = undefined;
            vi.mocked(getGeoJsonDispatcher).mockReset();
        });

        /** Fake source + dispatcher; returns what the handler wrote back. */
        const runHandlerAtZoom = async (features, zoom) => {
            const data = { type: 'FeatureCollection', features };
            const written = [];
            const source = { getData: async () => data };
            const map = { getSource: () => source, getZoom: () => zoom };

            vi.mocked(getGeoJsonDispatcher).mockReturnValue({
                flush: async () => {},
                setData: (payload) => written.push(payload),
            });

            const { handler, cleanup } = createLabelZoomHandler(() => map, 'polygons');
            handler();
            await rafCallback();
            cleanup();

            return { written, features: data.features };
        };

        it('o laco do zoom preserva a ancora 0 e recalcula o tamanho', async () => {
            const { written, features } = await runHandlerAtZoom([labelledFeature()], 4);

            expect(features[0].properties.labelCreatedAtZoom).toBe(0);
            expect(features[0].properties.labelCalculatedSize).toBe(14 * 2 ** 4);
            // The size did change, so the collection is written back.
            expect(written).toHaveLength(1);
        });

        it('o laco do zoom respeita labelSize 0 em vez de redesenhar em 14', async () => {
            const { features } = await runHandlerAtZoom([labelledFeature({ labelSize: 0 })], 4);
            expect(features[0].properties.labelCalculatedSize).toBe(0);
        });

        it('feicao sem etiqueta nao e tocada, e nada e reescrito quando nada muda', async () => {
            const plain = labelledFeature({ showLabel: false, labelCreatedAtZoom: 7 });
            const settled = labelledFeature({ labelCreatedAtZoom: 5, labelCalculatedSize: 14 });

            const { written, features } = await runHandlerAtZoom([plain, settled], 5);

            expect(features[0].properties.labelCalculatedSize).toBe(LABEL_DEFAULT_PROPERTIES.labelCalculatedSize);
            expect(features[0].properties.labelCreatedAtZoom).toBe(7);
            expect(written).toHaveLength(0);
        });
    });
});
