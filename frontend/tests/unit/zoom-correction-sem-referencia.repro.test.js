// Path: tests/unit/zoom-correction-sem-referencia.repro.test.js

/**
 * @fileoverview REPRO for the feature with NO ZOOM REFERENCE (2026-09-02).
 *
 * THE DEFECT. `calculateZoomCorrectedValue` computed
 * `zoomDifference = currentZoom - properties.createdAtZoom` and
 * `Math.min(properties[sourceProperty] * scaleFactor, config.maxValue ?? Infinity)`.
 * A feature with no `createdAtZoom` (legacy data, or an `.ebgeo` whose images carry
 * their dimensions as `largura`/`altura` and no zoom anchor at all) made
 * `12 - undefined = NaN`, and the NaN came out whole: no `??` guards NaN, and
 * `Math.min(NaN, 10)` is NaN too.
 *
 * WHY THAT IS SEVERE RATHER THAN MERELY UGLY. The derived value is read straight into
 * `icon-size` (`layers/styles/content.layers.js` reads a bare `['get', 'calculatedSize']`
 * with no coalesce) and into the selection-box geometry. A NaN there raises no exception
 * anywhere: it travels into native placement code. Measured on `main` with the owner's
 * file, 6 runs out of 6: selecting the image from the features tab (the click zooms to
 * it), pressing Esc and switching maps at high zoom FREEZES the page's main thread, and
 * the debugger cannot pause. The hypothesis that the NaN is the root cause is supported,
 * not proven; what pins it end to end is
 * `tests/e2e-ui/imagem-sem-referencia-de-zoom.spec.js`.
 *
 * THE RULE CODIFIED HERE. With no usable `createdAtZoom` there is no zoom reference, and
 * with no reference the factor is 1: the base value comes out untouched, which is exactly
 * what those legacy features did before zoom correction existed. It is the same treatment
 * `boundary-zoom.model.js` already gave boundaries (`hasZoomReference` /
 * `getPixelZoomFactor`). A base value that is not finite has nothing to correct, so the
 * function returns `config.fallbackValue`.
 *
 * NEGATIVE CONTROL (what goes red when the guard is reverted). Restoring the two old
 * lines in `zoom-correction.helpers.js` makes the cases here fail with `NaN`: that is the
 * only way to know this green is not vacuous. The measured count is in the
 * `docs/livro-razao.md` entry.
 *
 * WHAT THIS FILE DOES NOT REACH. The freeze itself (native, needs a browser) and anything
 * drawn: there is only pure arithmetic in node here.
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
    calculateZoomCorrectedValue,
    applyZoomCorrections,
} from '../../src/js/tool_manager/helpers/zoom-correction.helpers.js';

const cfg = { sourceProperty: 'size', calculatedProperty: 'calculatedSize', maxValue: 10 };

/**
 * The image as it arrives from a legacy `.ebgeo`: no `createdAtZoom`, no `width`.
 * @param {Object} [overrides] - Properties to override
 * @returns {Object} Image feature properties
 */
function legacyImageProperties(overrides = {}) {
    return {
        id: 'img-legado',
        size: 1,
        rotation: 0,
        opacity: 1,
        largura: 640,
        altura: 480,
        ...overrides,
    };
}

// ============================================================================
// No zoom reference: the base value comes out untouched
// ============================================================================

describe('calculateZoomCorrectedValue sem referencia de zoom', () => {
    it('createdAtZoom AUSENTE devolve o valor-base, nao NaN', () => {
        const props = legacyImageProperties();
        const resultado = calculateZoomCorrectedValue(props, 17.4, cfg);
        expect(Number.isFinite(resultado)).toBe(true);
        expect(resultado).toBe(1);
    });

    it('createdAtZoom undefined, null e NaN sao o MESMO estado: fator 1', () => {
        for (const ancora of [undefined, null, NaN]) {
            const props = legacyImageProperties({ size: 3, createdAtZoom: ancora });
            expect(calculateZoomCorrectedValue(props, 17.4, cfg)).toBe(3);
        }
    });

    it('createdAtZoom Infinity e -Infinity tambem nao sao referencia', () => {
        expect(calculateZoomCorrectedValue({ size: 3, createdAtZoom: Infinity }, 12, cfg)).toBe(3);
        expect(calculateZoomCorrectedValue({ size: 3, createdAtZoom: -Infinity }, 12, cfg)).toBe(3);
    });

    // `12 - '10'` would be 2 by numeric coercion, so the feature would change size
    // through an accident of type. `Number.isFinite('10')` is false, so it does not.
    it('createdAtZoom em STRING nao e referencia (o tipo importa, nao a coercao)', () => {
        expect(calculateZoomCorrectedValue({ size: 3, createdAtZoom: '10' }, 12, cfg)).toBe(3);
    });

    it('propriedades ausentes por completo nao lancam', () => {
        expect(() => calculateZoomCorrectedValue(undefined, 12, cfg)).not.toThrow();
        expect(calculateZoomCorrectedValue(undefined, 12, cfg)).toBeUndefined();
        expect(calculateZoomCorrectedValue(null, 12, { ...cfg, fallbackValue: 1 })).toBe(1);
    });
});

// ============================================================================
// Unusable base value: the declared fallback
// ============================================================================

describe('calculateZoomCorrectedValue sem valor-base', () => {
    it('base ausente devolve o fallback declarado', () => {
        const props = legacyImageProperties({ size: undefined, createdAtZoom: 12 });
        expect(calculateZoomCorrectedValue(props, 14, { ...cfg, fallbackValue: 1 })).toBe(1);
    });

    it('base NaN, Infinity e string caem no mesmo fallback', () => {
        for (const base of [NaN, Infinity, -Infinity, '4', null]) {
            const props = legacyImageProperties({ size: base, createdAtZoom: 12 });
            expect(calculateZoomCorrectedValue(props, 14, { ...cfg, fallbackValue: 2 })).toBe(2);
        }
    });

    it('sem fallback declarado o retorno e undefined, para o consumidor usar o proprio padrao', () => {
        const props = legacyImageProperties({ size: undefined, createdAtZoom: 12 });
        expect(calculateZoomCorrectedValue(props, 14, cfg)).toBeUndefined();
    });

    // The unusable base beats even the early exit for a disabled correction, which used
    // to return the raw value (NaN included) without looking at anything.
    it('correcao DESLIGADA com base inutilizavel tambem cai no fallback', () => {
        const props = legacyImageProperties({ size: NaN, zoomCorrectionEnabled: false });
        expect(calculateZoomCorrectedValue(props, 14, { ...cfg, fallbackValue: 1 })).toBe(1);
    });
});

// ============================================================================
// POSITIVE CONTROL: the normal case is unchanged
// ============================================================================

describe('controle positivo: a correcao real nao mudou', () => {
    it('numeros absolutos: dobra por nivel de zoom acima da ancora', () => {
        expect(calculateZoomCorrectedValue({ size: 1, createdAtZoom: 12 }, 12, cfg)).toBe(1);
        expect(calculateZoomCorrectedValue({ size: 1, createdAtZoom: 12 }, 13, cfg)).toBe(2);
        expect(calculateZoomCorrectedValue({ size: 1, createdAtZoom: 12 }, 15, cfg)).toBe(8);
        expect(calculateZoomCorrectedValue({ size: 1, createdAtZoom: 12 }, 11, cfg)).toBe(0.5);
    });

    it('numeros absolutos: o teto de 10 continua valendo', () => {
        expect(calculateZoomCorrectedValue({ size: 1, createdAtZoom: 12 }, 16, cfg)).toBe(10);
        expect(calculateZoomCorrectedValue({ size: 4, createdAtZoom: 12 }, 12, cfg)).toBe(4);
    });

    // Deliberate divergence from `boundary-zoom.model.js`, which treats 0 as the
    // "never anchored" sentinel: here several tools stamp 0 in DEFAULT_PROPERTIES and
    // overwrite it, so rejecting zero would change the size of every one of them.
    it('zoom 0 continua sendo uma ancora legitima, nao um valor falsy', () => {
        expect(calculateZoomCorrectedValue({ size: 1, createdAtZoom: 0 }, 3, cfg)).toBe(8);
    });

    it('a correcao desligada com base boa continua devolvendo a base crua', () => {
        const props = { size: 42, createdAtZoom: 5, zoomCorrectionEnabled: false };
        expect(calculateZoomCorrectedValue(props, 18, cfg)).toBe(42);
    });
});

// ============================================================================
// Invariants (fast-check)
// ============================================================================

describe('invariantes', () => {
    /** Anchors that are NOT a zoom reference, plus the non-numeric values. */
    const ancoraInutil = () => fc.oneof(
        fc.constant(undefined),
        fc.constant(null),
        fc.constant(NaN),
        fc.constant(Infinity),
        fc.constant(-Infinity),
        fc.string(),
        fc.boolean(),
    );

    it('para TODA ancora inutil o resultado e finito e igual a base', () => {
        fc.assert(fc.property(
            fc.double({ min: 0.001, max: 1000, noNaN: true }),
            fc.double({ min: -30, max: 30, noNaN: true }),
            ancoraInutil(),
            (size, currentZoom, createdAtZoom) => {
                const resultado = calculateZoomCorrectedValue(
                    { size, createdAtZoom },
                    currentZoom,
                    { sourceProperty: 'size' },
                );
                expect(Number.isFinite(resultado)).toBe(true);
                expect(resultado).toBe(size);
            },
        ));
    });

    it('base finita e teto finito: a saida e SEMPRE finita, com qualquer zoom', () => {
        fc.assert(fc.property(
            fc.double({ min: 0.001, max: 1000, noNaN: true }),
            fc.oneof(fc.double({ min: -1e6, max: 1e6, noNaN: true }), fc.constant(NaN), fc.constant(Infinity)),
            fc.oneof(fc.double({ min: -1e6, max: 1e6, noNaN: true }), fc.constant(NaN), fc.constant(Infinity)),
            (size, createdAtZoom, currentZoom) => {
                const resultado = calculateZoomCorrectedValue(
                    { size, createdAtZoom },
                    currentZoom,
                    { sourceProperty: 'size', maxValue: 10 },
                );
                expect(Number.isFinite(resultado)).toBe(true);
                expect(resultado).toBeLessThanOrEqual(10);
                expect(resultado).toBeGreaterThan(0);
            },
        ));
    });

    it('o lote (applyZoomCorrections) herda a garantia feicao a feicao', () => {
        const features = [
            { properties: legacyImageProperties() },
            { properties: legacyImageProperties({ createdAtZoom: 12, size: 2 }) },
            { properties: legacyImageProperties({ size: NaN }) },
        ];
        const out = applyZoomCorrections(features, 15, { ...cfg, fallbackValue: 1 });
        expect(out.map(f => f.properties.calculatedSize)).toEqual([1, 10, 1]);
        for (const f of out) expect(Number.isFinite(f.properties.calculatedSize)).toBe(true);
    });
});

// ============================================================================
// The IMAGE path, which is where the defect was measured
// ============================================================================

vi.mock('@store', () => ({
    addFeature: vi.fn(),
    updateFeature: vi.fn(),
    removeFeature: vi.fn(),
    storeImage: vi.fn(),
    getActiveLayerIdSync: vi.fn(() => 'layer-1'),
}));
vi.mock('@utils', () => ({
    IDUtils: { generateGeoJSONId: vi.fn(() => 'geo-1'), generateFeatureName: vi.fn() },
    showError: vi.fn(),
    loadImageToMap: vi.fn(),
}));
vi.mock('@js/store/sync/image-sync.js', () => ({ uploadImageBlob: vi.fn() }));
vi.mock('@js/draw_tools/image_tool/image_attributes_panel.js', () => ({
    addImageAttributesToPanel: vi.fn(),
}));
vi.mock('@layers/geojson-dispatcher.js', () => ({
    getGeoJsonDispatcher: vi.fn(() => ({ add: vi.fn(), patch: vi.fn(), setData: vi.fn(), flush: vi.fn() })),
    destroyGeoJsonDispatcher: vi.fn(),
}));
vi.mock('@tools', () => ({
    BaseControl: class {
        constructor(toolManager) {
            this.toolManager = toolManager;
            this.selectionManager = toolManager?.selectionManager;
        }
    },
    BaseGeometry: class {},
}));

const { default: AddImageControl } = await import('@js/draw_tools/image_tool/add_image_control.js');

describe('AddImageControl com a imagem sem referencia de zoom', () => {
    /**
     * The control with a mute map that only knows its zoom.
     * @param {number} [zoom] - Zoom the fake map reports
     * @returns {Object} Control instance
     */
    function control(zoom = 17.4) {
        const instance = new AddImageControl({ selectionManager: {} });
        instance.map = { getZoom: () => zoom };
        return instance;
    }

    it('a config do tool declara um fallback, porque icon-size nao tem padrao proprio', () => {
        expect(AddImageControl.ZOOM_CORRECTION_CONFIG.fallbackValue).toBe(1);
        expect(AddImageControl.ZOOM_CORRECTION_CONFIG.maxValue).toBe(10);
    });

    it('applyZoomCorrections sobre a imagem legada devolve tamanho finito', () => {
        const out = control().applyZoomCorrections([{ properties: legacyImageProperties() }]);
        expect(out[0].properties.calculatedSize).toBe(1);
        expect(Number.isFinite(out[0].properties.calculatedSize)).toBe(true);
    });

    it('selectionBoxZoom devolve o zoom VIVO quando nao ha ancora, e null quando ha', () => {
        const c = control(17.4);
        expect(c.selectionBoxZoom(legacyImageProperties())).toBe(17.4);
        expect(c.selectionBoxZoom(legacyImageProperties({ createdAtZoom: NaN }))).toBe(17.4);
        expect(c.selectionBoxZoom(legacyImageProperties({ createdAtZoom: 12 }))).toBeNull();
        // A disabled correction stays pinned to the screen, as before.
        expect(c.selectionBoxZoom({ createdAtZoom: 12, zoomCorrectionEnabled: false })).toBe(17.4);
        // An explicit zoom 0 is a zoom, not a falsy value.
        expect(c.selectionBoxZoom(legacyImageProperties(), 0)).toBe(0);
    });

    it('usableDimension coage a dimensao antes de ela chegar ao canvas', () => {
        expect(AddImageControl.usableDimension(640)).toBe(640);
        expect(AddImageControl.usableDimension(undefined, 480)).toBe(480);
        for (const ruim of [undefined, null, NaN, 0, -5, Infinity, '640']) {
            expect(AddImageControl.usableDimension(ruim)).toBe(AddImageControl.FALLBACK_IMAGE_DIMENSION);
        }
    });

    it('a feicao nasce com width/height finitos mesmo vinda de largura/altura', () => {
        const c = control();
        const feature = c.createImageFeature({ lng: -43.2, lat: -22.9 }, 'img-1', undefined, undefined);
        expect(Number.isFinite(feature.properties.width)).toBe(true);
        expect(Number.isFinite(feature.properties.height)).toBe(true);
        expect(feature.properties.width).toBe(AddImageControl.FALLBACK_IMAGE_DIMENSION);
    });
});
