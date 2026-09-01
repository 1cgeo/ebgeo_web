import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
    LINEAR_SOURCES,
    LINEAR_CONVERSION_LABELS,
    LINEAR_TYPE_NAMES,
    LINE_WIDTH_RANGES,
    PRESERVED_OPTIONAL_KEYS,
    DROPPED_BY_SOURCE,
    resolveSpineCoordinates,
    canConvertLinear,
    lockedConversionReason,
    buildConvertedProperties,
    describeConversionLoss,
    formatConversionSuccess,
} from '../../src/js/tool_manager/helpers/linear-conversion.model.js';
import { computeBoundaryZoomSizes } from '../../src/js/military_tools/boundary_tool/boundary-zoom.model.js';

// ============================================================================
// FIXTURES
//
// These mirror the three controls' `static DEFAULT_PROPERTIES`. They cannot be
// imported (the controls pull MapLibre and the store, and this suite runs in
// plain node), so `defaults fixtures stay in sync with the controls` below reads
// the real files and fails when a fixture invents a key the control does not
// have. That is the drift this duplication would otherwise hide.
// ============================================================================

const LINE_DEFAULTS = {
    lineColor: '#3f4fb5',
    lineWidth: 5,
    opacity: 0.7,
    lineStyle: 'solid',
    measure: false,
    profile: false,
    profileData: null,
    source: 'line',
    nome: '',
    descricao: '',
    visivel: true,
    bloqueado: false,
    observations: [],
};

const ARROW_DEFAULTS = {
    width: 500,
    fillColor: '#3f4fb5',
    lineColor: '#3f4fb5',
    lineWidth: 3,
    fillOpacity: 0.8,
    lineOpacity: 1.0,
    headLengthRatio: 1.5,
    showArrowHead: true,
    doubleHeaded: false,
    airmobile: false,
    airmobilePosition: 0.7,
    source: 'arrow',
    geometryType: 'arrow',
    baseCoordinates: [],
    nome: '',
    descricao: '',
    visivel: true,
    bloqueado: false,
};

const BOUNDARY_DEFAULTS = {
    color: '#000000',
    lineWidth: 4,
    opacity: 1,
    source: 'boundary',
    type: 'boundary',
    symbol_instances: [{ ratio: 0.5, showLabels: true }],
    symbol_size: 1,
    text_size: 35,
    echelon: 'XXX',
    text_top: '',
    text_bottom: '',
    text_distance_ratio: 0.9,
    createdAtZoom: 0,
    zoomCorrectionEnabled: true,
    calculatedLineWidth: 4,
    calculatedTextSize: 35,
    calculatedStrokeWidth: 2,
    calculatedSymbolSize: 1,
    text_north_facing: false,
    nome: '',
    descricao: '',
    visivel: true,
    bloqueado: false,
};

const DEFAULTS_BY_SOURCE = {
    line: LINE_DEFAULTS,
    arrow: ARROW_DEFAULTS,
    boundary: BOUNDARY_DEFAULTS,
};

const SPINE = [[-47.9, -15.8], [-47.8, -15.7], [-47.7, -15.75]];

/** @param {Object} [extra] @returns {Object} A minimal line feature */
const lineFeature = (extra = {}) => ({
    type: 'Feature',
    id: 'geo-line',
    properties: {
        ...LINE_DEFAULTS,
        id: 'line-1',
        nome: 'Eixo A',
        layerId: 'camada-7',
        baseCoordinates: SPINE.map(p => [...p]),
        ...extra,
    },
    geometry: { type: 'LineString', coordinates: SPINE.map(p => [...p]) },
});

/** @param {Object} [extra] @returns {Object} A minimal arrow feature */
const arrowFeature = (extra = {}) => ({
    type: 'Feature',
    id: 'geo-arrow',
    properties: {
        ...ARROW_DEFAULTS,
        id: 'arrow-1',
        nome: 'Ataque',
        layerId: 'camada-7',
        baseCoordinates: SPINE.map(p => [...p]),
        ...extra,
    },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
});

/** @param {Object} [extra] @returns {Object} A minimal boundary feature */
const boundaryFeature = (extra = {}) => ({
    type: 'Feature',
    id: 'geo-boundary',
    properties: {
        ...BOUNDARY_DEFAULTS,
        symbol_instances: [{ ratio: 0.5, showLabels: true }],
        id: 'boundary-1',
        nome: 'Limite Norte',
        layerId: 'camada-7',
        baseCoordinates: SPINE.map(p => [...p]),
        ...extra,
    },
    geometry: { type: 'MultiLineString', coordinates: [SPINE.map(p => [...p])] },
});

/**
 * @param {Object} config
 * @returns {Object} Built properties, with the boilerplate arguments filled in
 */
const build = ({ feature, targetSource, ...rest }) => buildConvertedProperties({
    feature,
    targetSource,
    defaults: DEFAULTS_BY_SOURCE[targetSource],
    featureId: 'novo-id',
    fallbackName: `Nome ${targetSource}`,
    coordinates: resolveSpineCoordinates(feature),
    ...rest,
});

// ============================================================================
// VOCABULARY
// ============================================================================

describe('linear conversion vocabulary', () => {
    it('covers the three types in every table', () => {
        expect(LINEAR_SOURCES).toEqual(['line', 'arrow', 'boundary']);
        for (const source of LINEAR_SOURCES) {
            expect(typeof LINEAR_CONVERSION_LABELS[source]).toBe('string');
            expect(LINEAR_CONVERSION_LABELS[source].startsWith('Converter para ')).toBe(true);
            expect(typeof LINEAR_TYPE_NAMES[source]).toBe('string');
            expect(LINE_WIDTH_RANGES[source].min).toBe(1);
            expect(Array.isArray(DROPPED_BY_SOURCE[source])).toBe(true);
            expect(DROPPED_BY_SOURCE[source].length).toBeGreaterThan(0);
        }
    });

    it('keeps the arrow and boundary width ranges narrower than the line one', () => {
        expect(LINE_WIDTH_RANGES.line.max).toBe(15);
        expect(LINE_WIDTH_RANGES.arrow.max).toBe(10);
        expect(LINE_WIDTH_RANGES.boundary.max).toBe(10);
    });
});

// ============================================================================
// resolveSpineCoordinates
// ============================================================================

describe('resolveSpineCoordinates', () => {
    it('reads a plain baseCoordinates array', () => {
        expect(resolveSpineCoordinates(lineFeature())).toEqual(SPINE);
    });

    it('parses the JSON string a legacy arrow persists', () => {
        const feature = arrowFeature({ baseCoordinates: JSON.stringify(SPINE) });
        expect(resolveSpineCoordinates(feature)).toEqual(SPINE);
    });

    it('returns null for a baseCoordinates string that is not JSON', () => {
        const feature = arrowFeature({ baseCoordinates: '[[-47.9,-15.8],' });
        expect(resolveSpineCoordinates(feature)).toBeNull();
    });

    it('falls back to geometry.coordinates only when the geometry is a LineString', () => {
        const feature = lineFeature({ baseCoordinates: undefined });
        expect(resolveSpineCoordinates(feature)).toEqual(SPINE);
    });

    it('never reads a Polygon or a MultiLineString as a spine', () => {
        expect(resolveSpineCoordinates(arrowFeature({ baseCoordinates: undefined }))).toBeNull();
        expect(resolveSpineCoordinates(boundaryFeature({ baseCoordinates: undefined }))).toBeNull();
    });

    it('refuses a non-LineString geometry even when its coordinates LOOK like a spine', () => {
        // A ring is one level deeper than a spine, so the two assertions above
        // would still pass with the `type` check deleted. A MultiPoint carries
        // flat positions, exactly the shape a spine has: only the type check
        // separates it from a real centreline, so this is the case that fails
        // when someone widens the fallback to "any geometry with coordinates".
        expect(resolveSpineCoordinates({
            properties: {},
            geometry: { type: 'MultiPoint', coordinates: [[-47.9, -15.8], [-47.8, -15.7]] },
        })).toBeNull();
    });

    it('rejects a spine with fewer than two vertices', () => {
        // No geometry at all, so the LineString fallback cannot rescue it.
        expect(resolveSpineCoordinates({
            properties: { baseCoordinates: [[-47.9, -15.8]] },
        })).toBeNull();
        expect(resolveSpineCoordinates({
            properties: { baseCoordinates: [] },
        })).toBeNull();
        expect(resolveSpineCoordinates({
            properties: { baseCoordinates: [[-47.9, -15.8]] },
            geometry: { type: 'LineString', coordinates: [[-47.9, -15.8]] },
        })).toBeNull();
    });

    it('rejects missing, undefined and non-array coordinates', () => {
        expect(resolveSpineCoordinates(undefined)).toBeNull();
        expect(resolveSpineCoordinates({})).toBeNull();
        expect(resolveSpineCoordinates({ properties: {} })).toBeNull();
        expect(resolveSpineCoordinates({ properties: { baseCoordinates: 42 } })).toBeNull();
    });

    it('rejects NaN, Infinity and short points', () => {
        expect(resolveSpineCoordinates({
            properties: { baseCoordinates: [[NaN, -15.8], [-47.8, -15.7]] },
        })).toBeNull();
        expect(resolveSpineCoordinates({
            properties: { baseCoordinates: [[-47.9, Infinity], [-47.8, -15.7]] },
        })).toBeNull();
        expect(resolveSpineCoordinates({
            properties: { baseCoordinates: [[-47.9], [-47.8, -15.7]] },
        })).toBeNull();
        expect(resolveSpineCoordinates({
            properties: { baseCoordinates: [['-47.9', '-15.8'], [-47.8, -15.7]] },
        })).toBeNull();
    });

    it('returns a copy, so the caller cannot write through into the source', () => {
        const feature = lineFeature();
        const spine = resolveSpineCoordinates(feature);
        spine[0][0] = 999;
        expect(feature.properties.baseCoordinates[0][0]).toBe(-47.9);
    });

    it('keeps a third ordinate when the author drew with altitude', () => {
        const feature = lineFeature({
            baseCoordinates: [[-47.9, -15.8, 1100], [-47.8, -15.7, 1080]],
        });
        expect(resolveSpineCoordinates(feature)).toEqual([
            [-47.9, -15.8, 1100],
            [-47.8, -15.7, 1080],
        ]);
    });
});

// ============================================================================
// canConvertLinear
// ============================================================================

describe('canConvertLinear', () => {
    it('allows all six directions', () => {
        const features = {
            line: lineFeature(),
            arrow: arrowFeature(),
            boundary: boundaryFeature(),
        };
        const seen = [];
        for (const source of LINEAR_SOURCES) {
            for (const target of LINEAR_SOURCES) {
                if (source === target) continue;
                expect(canConvertLinear(features[source], target)).toEqual({ ok: true });
                seen.push(`${source}->${target}`);
            }
        }
        expect(seen).toHaveLength(6);
    });

    it('refuses converting a feature into its own type', () => {
        const verdict = canConvertLinear(lineFeature(), 'line');
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toBe('A feição já é desse tipo');
    });

    it('refuses a target that is not one of the three linear types', () => {
        const verdict = canConvertLinear(lineFeature(), 'polygon');
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toBe('Tipo de destino inválido');
    });

    it('refuses a source that is not one of the three linear types', () => {
        const polygon = { properties: { source: 'polygon', baseCoordinates: SPINE } };
        const verdict = canConvertLinear(polygon, 'line');
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toBe('Só linha, seta e linha de limite podem ser convertidas');
    });

    it('refuses a merged arrow, naming the way out', () => {
        const merged = arrowFeature({
            isMerged: true,
            branches: [{ baseCoordinates: SPINE }, { baseCoordinates: SPINE }],
        });
        const verdict = canConvertLinear(merged, 'line');
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toBe('Separe as setas antes de converter');
    });

    it('does not block an arrow whose merge left a single branch', () => {
        const single = arrowFeature({
            isMerged: true,
            branches: [{ baseCoordinates: SPINE }],
        });
        expect(canConvertLinear(single, 'line')).toEqual({ ok: true });
    });

    it('refuses a locked feature', () => {
        const verdict = canConvertLinear(lineFeature({ bloqueado: true }), 'arrow');
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toBe('Feição está bloqueada');
    });

    it('refuses a feature whose spine cannot be resolved', () => {
        const verdict = canConvertLinear(
            arrowFeature({ baseCoordinates: undefined }),
            'line'
        );
        expect(verdict.ok).toBe(false);
        expect(verdict.reason).toBe('Feição sem coordenadas suficientes');
    });

    it('survives a malformed feature without throwing', () => {
        expect(canConvertLinear(undefined, 'line').ok).toBe(false);
        expect(canConvertLinear({}, 'line').ok).toBe(false);
        expect(canConvertLinear({ properties: null }, 'line').ok).toBe(false);
    });
});

// ============================================================================
// lockedConversionReason
// ============================================================================

describe('lockedConversionReason', () => {
    it('names the map lock first, then the feature lock', () => {
        expect(lockedConversionReason({ mapLocked: true, featureLocked: true }))
            .toBe('Mapa está bloqueado');
        expect(lockedConversionReason({ mapLocked: false, featureLocked: true }))
            .toBe('Feição está bloqueada');
    });

    it('is null when nothing blocks the edit', () => {
        expect(lockedConversionReason({ mapLocked: false, featureLocked: false })).toBeNull();
        expect(lockedConversionReason()).toBeNull();
    });
});

// ============================================================================
// buildConvertedProperties — axes
// ============================================================================

describe('buildConvertedProperties: canonical axes', () => {
    it('line -> arrow duplicates the colour and the opacity into both arrow pairs', () => {
        const props = build({
            feature: lineFeature({ lineColor: '#ff0000', opacity: 0.4 }),
            targetSource: 'arrow',
        });
        expect(props.fillColor).toBe('#ff0000');
        expect(props.lineColor).toBe('#ff0000');
        expect(props.fillOpacity).toBe(0.4);
        expect(props.lineOpacity).toBe(0.4);
    });

    it('arrow -> line reads the fill colour and the fill opacity', () => {
        const props = build({
            feature: arrowFeature({ fillColor: '#00ff00', lineColor: '#0000ff', fillOpacity: 0.25 }),
            targetSource: 'line',
        });
        expect(props.lineColor).toBe('#00ff00');
        expect(props.opacity).toBe(0.25);
    });

    it('arrow -> line falls back to the arrow line colour when the fill has none', () => {
        const props = build({
            feature: arrowFeature({ fillColor: '', lineColor: '#123456' }),
            targetSource: 'line',
        });
        expect(props.lineColor).toBe('#123456');
    });

    it('boundary -> line reads `color`, not `lineColor`', () => {
        const props = build({
            feature: boundaryFeature({ color: '#abcdef' }),
            targetSource: 'line',
        });
        expect(props.lineColor).toBe('#abcdef');
    });

    it('line -> boundary writes `color`', () => {
        const props = build({
            feature: lineFeature({ lineColor: '#101010' }),
            targetSource: 'boundary',
        });
        expect(props.color).toBe('#101010');
    });

    it('PRESERVES an authored opacity of 0 instead of reading it as missing', () => {
        // The replaced code used `opacity || defaults.opacity`, which turned a
        // deliberately invisible feature into an 80%-opaque one on conversion.
        const toArrow = build({ feature: lineFeature({ opacity: 0 }), targetSource: 'arrow' });
        expect(toArrow.fillOpacity).toBe(0);
        expect(toArrow.lineOpacity).toBe(0);

        const toBoundary = build({ feature: lineFeature({ opacity: 0 }), targetSource: 'boundary' });
        expect(toBoundary.opacity).toBe(0);

        const toLine = build({ feature: arrowFeature({ fillOpacity: 0 }), targetSource: 'line' });
        expect(toLine.opacity).toBe(0);
    });

    it('falls back to the target default when an axis is missing or unusable', () => {
        const props = build({
            feature: lineFeature({ lineColor: undefined, opacity: NaN, lineWidth: undefined }),
            targetSource: 'arrow',
        });
        expect(props.fillColor).toBe(ARROW_DEFAULTS.fillColor);
        expect(props.fillOpacity).toBe(ARROW_DEFAULTS.fillOpacity);
        expect(props.lineOpacity).toBe(ARROW_DEFAULTS.lineOpacity);
        expect(props.lineWidth).toBe(ARROW_DEFAULTS.lineWidth);
    });
});

// ============================================================================
// buildConvertedProperties — width clamp
// ============================================================================

describe('buildConvertedProperties: width clamp', () => {
    it('clamps a 14 px line down to the arrow panel maximum', () => {
        const props = build({ feature: lineFeature({ lineWidth: 14 }), targetSource: 'arrow' });
        expect(props.lineWidth).toBe(10);
    });

    it('clamps a zero width up to the panel minimum', () => {
        const props = build({ feature: lineFeature({ lineWidth: 0 }), targetSource: 'boundary' });
        expect(props.lineWidth).toBe(1);
    });

    it('uses the target default for a NaN width', () => {
        const props = build({ feature: lineFeature({ lineWidth: NaN }), targetSource: 'boundary' });
        expect(props.lineWidth).toBe(BOUNDARY_DEFAULTS.lineWidth);
    });

    it('leaves a width already inside the target range untouched', () => {
        const props = build({ feature: lineFeature({ lineWidth: 7 }), targetSource: 'arrow' });
        expect(props.lineWidth).toBe(7);
    });

    it('does not clamp a 14 px arrow-bound width when the target is a line', () => {
        const props = build({ feature: arrowFeature({ lineWidth: 9 }), targetSource: 'line' });
        expect(props.lineWidth).toBe(9);
    });
});

// ============================================================================
// buildConvertedProperties — dropped and preserved
// ============================================================================

describe('buildConvertedProperties: what is dropped', () => {
    it('arrow -> line drops width, head and airmobile', () => {
        const props = build({
            feature: arrowFeature({ airmobile: true, doubleHeaded: true, showArrowHead: false }),
            targetSource: 'line',
        });
        expect(props.width).toBeUndefined();
        expect(props.showArrowHead).toBeUndefined();
        expect(props.doubleHeaded).toBeUndefined();
        expect(props.airmobile).toBeUndefined();
        expect(props.headLengthRatio).toBeUndefined();
        expect(props.geometryType).toBeUndefined();
    });

    it('arrow -> boundary drops the merge bookkeeping', () => {
        const props = build({
            feature: arrowFeature({ isMerged: true, branches: [{ baseCoordinates: SPINE }] }),
            targetSource: 'boundary',
        });
        expect(props.isMerged).toBeUndefined();
        expect(props.branches).toBeUndefined();
    });

    it('boundary -> line drops echelon, symbols and labels', () => {
        const props = build({
            feature: boundaryFeature({ echelon: 'XX', text_top: 'CIA A', text_bottom: 'CIA B' }),
            targetSource: 'line',
        });
        expect(props.echelon).toBeUndefined();
        expect(props.symbol_instances).toBeUndefined();
        expect(props.symbol_size).toBeUndefined();
        expect(props.text_top).toBeUndefined();
        expect(props.text_bottom).toBeUndefined();
        expect(props.text_size).toBeUndefined();
        expect(props.createdAtZoom).toBeUndefined();
        expect(props.calculatedLineWidth).toBeUndefined();
    });

    it('line -> arrow drops the line-only fields', () => {
        const props = build({
            feature: lineFeature({ measure: true, profile: true, profileData: '{}', lineStyle: 'dashed' }),
            targetSource: 'arrow',
        });
        expect(props.measure).toBeUndefined();
        expect(props.profile).toBeUndefined();
        expect(props.profileData).toBeUndefined();
        expect(props.lineStyle).toBeUndefined();
    });
});

describe('buildConvertedProperties: what is preserved', () => {
    it('carries identity, layer and state across', () => {
        const props = build({
            feature: lineFeature({
                nome: 'Eixo Bravo',
                descricao: 'ordem de operações',
                visivel: false,
                bloqueado: true,
                layerId: 'camada-9',
            }),
            targetSource: 'boundary',
        });
        expect(props.nome).toBe('Eixo Bravo');
        expect(props.descricao).toBe('ordem de operações');
        expect(props.visivel).toBe(false);
        expect(props.bloqueado).toBe(true);
        expect(props.layerId).toBe('camada-9');
    });

    it('carries attributes, images, observations and the temporal window', () => {
        const feature = lineFeature({
            attributes: { unidade: '1º BIS' },
            images: ['img-1'],
            observations: [{ id: 'o1', texto: 'checar' }],
            temporalInicio: 1700000000000,
            temporalFim: 1700003600000,
        });
        const props = build({ feature, targetSource: 'arrow' });

        expect(props.attributes).toEqual({ unidade: '1º BIS' });
        expect(props.images).toEqual(['img-1']);
        expect(props.observations).toEqual([{ id: 'o1', texto: 'checar' }]);
        expect(props.temporalInicio).toBe(1700000000000);
        expect(props.temporalFim).toBe(1700003600000);

        // Copies, not shared references: editing the new feature must not write
        // back into the one that is about to be deleted.
        props.attributes.unidade = 'outro';
        props.observations[0].texto = 'outro';
        expect(feature.properties.attributes.unidade).toBe('1º BIS');
        expect(feature.properties.observations[0].texto).toBe('checar');

        expect(PRESERVED_OPTIONAL_KEYS).toContain('attributes');
    });

    it('leaves an absent optional key absent', () => {
        const props = build({ feature: lineFeature(), targetSource: 'arrow' });
        expect('attributes' in props).toBe(false);
        expect('temporalInicio' in props).toBe(false);
    });

    it('mints a new id and stamps the target source', () => {
        const feature = lineFeature();
        const props = build({ feature, targetSource: 'boundary' });
        expect(props.id).toBe('novo-id');
        expect(props.id).not.toBe(feature.properties.id);
        expect(props.source).toBe('boundary');
    });

    it('falls back to the generated name only when the source is unnamed', () => {
        expect(build({ feature: lineFeature({ nome: '' }), targetSource: 'arrow' }).nome)
            .toBe('Nome arrow');
        expect(build({ feature: lineFeature({ nome: 'Eixo A' }), targetSource: 'arrow' }).nome)
            .toBe('Eixo A');
    });

    it('copies the spine deeply, keeping exactly two vertices when that is all there is', () => {
        const feature = lineFeature({ baseCoordinates: [[-47.9, -15.8], [-47.8, -15.7]] });
        const props = build({ feature, targetSource: 'arrow' });

        expect(props.baseCoordinates).toEqual([[-47.9, -15.8], [-47.8, -15.7]]);
        props.baseCoordinates[0][0] = 999;
        expect(feature.properties.baseCoordinates[0][0]).toBe(-47.9);
    });

    it('gives the new boundary its OWN symbol_instances array', () => {
        const defaults = { ...BOUNDARY_DEFAULTS };
        const props = buildConvertedProperties({
            feature: lineFeature(),
            targetSource: 'boundary',
            defaults,
            featureId: 'novo-id',
            coordinates: SPINE,
        });

        expect(props.symbol_instances).toEqual(defaults.symbol_instances);
        expect(props.symbol_instances).not.toBe(defaults.symbol_instances);
        props.symbol_instances[0].ratio = 0.1;
        expect(defaults.symbol_instances[0].ratio).toBe(0.5);
    });

    it('does not mutate the source feature', () => {
        const feature = lineFeature();
        const before = JSON.stringify(feature);
        build({ feature, targetSource: 'boundary' });
        expect(JSON.stringify(feature)).toBe(before);
    });
});

// ============================================================================
// buildConvertedProperties — target-specific recalculation
// ============================================================================

describe('buildConvertedProperties: zoom-adaptive fields', () => {
    it('takes the adaptive arrow width when the control offers one', () => {
        const props = build({
            feature: lineFeature(),
            targetSource: 'arrow',
            adaptiveWidth: 1234,
        });
        expect(props.width).toBe(1234);
    });

    it('keeps the arrow default when the control cannot compute a width', () => {
        for (const adaptiveWidth of [undefined, NaN, 0, -5]) {
            const props = build({ feature: lineFeature(), targetSource: 'arrow', adaptiveWidth });
            expect(props.width).toBe(ARROW_DEFAULTS.width);
        }
    });

    it('takes the adaptive boundary symbol size', () => {
        const props = build({
            feature: lineFeature(),
            targetSource: 'boundary',
            adaptiveSymbolSize: 2.5,
        });
        expect(props.symbol_size).toBe(2.5);
    });

    it('anchors the new boundary at the current zoom, rounded to one decimal', () => {
        const props = build({
            feature: lineFeature(),
            targetSource: 'boundary',
            referenceZoom: 12.34,
        });
        expect(props.createdAtZoom).toBe(12.3);
        expect(props.zoomCorrectionEnabled).toBe(true);
    });

    it('keeps the default anchor when no zoom is available', () => {
        const props = build({ feature: lineFeature(), targetSource: 'boundary' });
        expect(props.createdAtZoom).toBe(BOUNDARY_DEFAULTS.createdAtZoom);
    });

    it('composes with the boundary zoom model so the derived sizes match the inherited ones', () => {
        // The orchestrator runs exactly this pair. At birth the factor is 1, so
        // `calculatedLineWidth` has to follow the width inherited from the line
        // (5), NOT the boundary default (4) that a bare spread would leave.
        const props = build({
            feature: lineFeature({ lineWidth: 5 }),
            targetSource: 'boundary',
            referenceZoom: 12,
        });
        Object.assign(props, computeBoundaryZoomSizes(props, 12));

        expect(props.lineWidth).toBe(5);
        expect(props.calculatedLineWidth).toBe(5);
        expect(props.calculatedTextSize).toBe(BOUNDARY_DEFAULTS.text_size);
    });
});

// ============================================================================
// ROUND TRIP
// ============================================================================

describe('round trip line -> arrow -> line', () => {
    it('preserves everything that is not clamped by a narrower panel', () => {
        const original = lineFeature({
            lineColor: '#ff8800',
            lineWidth: 12,
            opacity: 0.35,
            descricao: 'eixo principal',
            attributes: { fase: 'II' },
        });

        const arrowProps = build({ feature: original, targetSource: 'arrow' });
        const asArrow = { type: 'Feature', properties: arrowProps, geometry: null };
        const backProps = build({ feature: asArrow, targetSource: 'line' });

        expect(backProps.lineColor).toBe('#ff8800');
        expect(backProps.opacity).toBe(0.35);
        expect(backProps.descricao).toBe('eixo principal');
        expect(backProps.attributes).toEqual({ fase: 'II' });
        expect(backProps.baseCoordinates).toEqual(SPINE);
        expect(backProps.source).toBe('line');

        // 12 px does not fit an arrow (max 10); the clamp happens once and the
        // trip back is then stable.
        expect(arrowProps.lineWidth).toBe(10);
        expect(backProps.lineWidth).toBe(10);
    });

    it('is idempotent on a second lap', () => {
        const first = build({ feature: lineFeature({ lineWidth: 6 }), targetSource: 'arrow' });
        const back = build({
            feature: { properties: first },
            targetSource: 'line',
        });
        const second = build({ feature: { properties: back }, targetSource: 'arrow' });

        expect(second.lineWidth).toBe(first.lineWidth);
        expect(second.fillColor).toBe(first.fillColor);
        expect(second.fillOpacity).toBe(first.fillOpacity);
        expect(second.lineOpacity).toBe(first.lineOpacity);
    });
});

// ============================================================================
// LOSS REPORT
// ============================================================================

describe('describeConversionLoss', () => {
    it('reports nothing for a plain line', () => {
        expect(describeConversionLoss(lineFeature())).toEqual([]);
    });

    it('reports only the line data that is actually switched on', () => {
        expect(describeConversionLoss(lineFeature({ measure: true }))).toEqual(['medição']);
        expect(describeConversionLoss(lineFeature({ profile: true, lineStyle: 'dashed' })))
            .toEqual(['perfil de elevação', 'estilo de traço']);
    });

    it('reports an arrow width and head, and the optional marks when set', () => {
        expect(describeConversionLoss(arrowFeature())).toEqual(['largura', 'ponta da seta']);
        expect(describeConversionLoss(arrowFeature({ doubleHeaded: true, airmobile: true })))
            .toEqual(['largura', 'ponta da seta', 'segunda ponta', 'marca aeromóvel']);
        expect(describeConversionLoss(arrowFeature({ showArrowHead: false })))
            .toEqual(['largura']);
    });

    it('always reports a boundary echelon and its symbols, labels only when written', () => {
        expect(describeConversionLoss(boundaryFeature()))
            .toEqual(['escalão', 'símbolos de limite']);
        expect(describeConversionLoss(boundaryFeature({ text_top: 'CIA A', text_bottom: 'CIA B' })))
            .toEqual(['escalão', 'símbolos de limite', 'rótulo superior', 'rótulo inferior']);
    });

    it('returns an empty list for anything it does not know', () => {
        expect(describeConversionLoss(undefined)).toEqual([]);
        expect(describeConversionLoss({ properties: { source: 'polygon' } })).toEqual([]);
    });
});

describe('formatConversionSuccess', () => {
    it('names the target alone when nothing is lost', () => {
        expect(formatConversionSuccess('arrow', [])).toBe('Convertido para Seta');
        expect(formatConversionSuccess('line')).toBe('Convertido para Linha');
    });

    it('lists the losses in parentheses', () => {
        expect(formatConversionSuccess('boundary', ['escalão', 'símbolos de limite']))
            .toBe('Convertido para Linha de Limite (perdido: escalão, símbolos de limite)');
    });

    it('degrades to a generic noun for an unknown target', () => {
        expect(formatConversionSuccess('polygon', [])).toBe('Convertido para feição');
    });
});

// ============================================================================
// FIXTURE DRIFT GUARD
// ============================================================================

describe('defaults fixtures stay in sync with the controls', () => {
    const CONTROL_PATHS = {
        line: '../../src/js/draw_tools/line_tool/add_line_control.js',
        arrow: '../../src/js/military_tools/arrow_tool/add_arrow_control.js',
        boundary: '../../src/js/military_tools/boundary_tool/add_boundary_control.js',
    };

    /**
     * @param {string} relativePath - Path of the control, relative to this file
     * @returns {string} The text of its `static DEFAULT_PROPERTIES` block
     */
    function readDefaultsBlock(relativePath) {
        const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
        const start = source.indexOf('static DEFAULT_PROPERTIES');
        expect(start).toBeGreaterThan(-1);
        const end = source.indexOf('\n    };', start);
        expect(end).toBeGreaterThan(start);
        return source.slice(start, end);
    }

    for (const [source, relativePath] of Object.entries(CONTROL_PATHS)) {
        it(`the ${source} fixture invents no property the control lacks`, () => {
            const block = readDefaultsBlock(relativePath);
            const keys = Object.keys(DEFAULTS_BY_SOURCE[source]);
            expect(keys.length).toBeGreaterThan(5);
            for (const key of keys) {
                expect(block).toContain(`${key}:`);
            }
        });
    }
});
