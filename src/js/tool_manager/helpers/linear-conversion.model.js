// Path: js/tool_manager/helpers/linear-conversion.model.js

/**
 * @fileoverview Pure model behind converting a feature between the three
 * "linear" types: `line`, `arrow` and `boundary`. No DOM, no store, no map — so
 * it is node-testable and safe to import from anywhere.
 *
 * WHY A MODEL AT ALL. The three types share one and only one thing: a spine of
 * coordinates. Everything else (colour, opacity, width) is spelled with a
 * DIFFERENT property name per type, and a couple of them are duplicated inside
 * a single type (an arrow carries fill AND line colour/opacity). Reading and
 * writing those axes by hand at each call site is what produced the two bugs
 * this module replaces: `lineFeature.properties.opacity || defaultProps.opacity`
 * turned a deliberate `opacity: 0` into `0.8`, and `{ ...defaultProps }` handed
 * the new boundary the SAME `symbol_instances` array the defaults object owns.
 *
 * THE THREE CANONICAL AXES, and where each type spells them:
 *
 *   axis          line          arrow                     boundary
 *   ----          ----          -----                     --------
 *   strokeColor   lineColor     fillColor (then lineColor) color
 *   strokeWidth   lineWidth     lineWidth                  lineWidth
 *   alpha         opacity       fillOpacity                opacity
 *
 * Writing an arrow fills BOTH of its pairs from the single axis, which is what
 * makes `line -> arrow -> line` a round trip instead of a slow drift.
 *
 * THE GEOMETRIC TRUTH IS `properties.baseCoordinates`, NEVER `geometry`. Only
 * `line` persists a LineString; an arrow is a Polygon/MultiPolygon and a
 * boundary is a MultiLineString, both DERIVED. `resolveSpineCoordinates` reads
 * `baseCoordinates` (which legacy arrows persist as a JSON STRING) and falls
 * back to `geometry.coordinates` only when the geometry really is a LineString.
 *
 * The build is "target defaults + the axes + an explicit carry-over list",
 * never "source properties + overrides". That direction is what guarantees a
 * type-exclusive property (an arrow's `airmobile`, a boundary's `echelon`)
 * cannot leak into a type that has no idea what to do with it.
 */

import { deepClone } from '@utils/deep-utils.js';

/** The interchangeable linear types, in menu order. @constant {string[]} */
export const LINEAR_SOURCES = Object.freeze(['line', 'arrow', 'boundary', 'coordination_line']);

/** Menu labels (pt-BR). @constant {Object<string, string>} */
export const LINEAR_CONVERSION_LABELS = Object.freeze({
    line: 'Converter para Linha',
    arrow: 'Converter para Seta',
    boundary: 'Converter para Linha de Limite',
    coordination_line: 'Converter para Linha de Coordenação',
});

/** Type names used inside messages (pt-BR). @constant {Object<string, string>} */
export const LINEAR_TYPE_NAMES = Object.freeze({
    line: 'Linha',
    arrow: 'Seta',
    boundary: 'Linha de Limite',
    coordination_line: 'Linha de Coordenação',
});

/**
 * Line-width range accepted by each type's attribute panel. A line drawn at 14
 * px cannot stay 14 px as an arrow, whose slider stops at 10: without the clamp
 * the panel would open showing a value it can neither display nor restore.
 * @constant {Object<string, {min: number, max: number}>}
 */
export const LINE_WIDTH_RANGES = Object.freeze({
    line: Object.freeze({ min: 1, max: 15 }),
    arrow: Object.freeze({ min: 1, max: 10 }),
    boundary: Object.freeze({ min: 1, max: 10 }),
    coordination_line: Object.freeze({ min: 1, max: 10 }),
});

/**
 * Properties that survive every conversion. `baseCoordinates` and the identity
 * fields are handled separately; these are the optional ones, copied only when
 * the source actually carries them (so an absent key stays absent).
 * @constant {string[]}
 */
/**
 * Centre-to-centre spacing a converted coordination line is born with, as a
 * multiple of the glyph size. Mirrors the tool's own SPACING_RATIO, and is
 * duplicated here because this module has no imports from military_tools by
 * contract; the pair is held together by the conversion test.
 * @constant {number}
 */
export const COORDINATION_SPACING_RATIO = 3;

export const PRESERVED_OPTIONAL_KEYS = Object.freeze([
    'attributes',
    'images',
    'observations',
    'temporalInicio',
    'temporalFim',
]);

/**
 * What each source type loses on the way out, with the test that says whether
 * the feature actually CARRIES that data. A boundary always has an echelon and
 * a symbol, so those are always reported; a line only loses its measurement
 * when the measurement was on.
 * @constant {Object<string, Array<{key: string, label: string, carries: Function}>>}
 */
export const DROPPED_BY_SOURCE = Object.freeze({
    line: Object.freeze([
        { key: 'measure', label: 'medição', carries: (v) => v === true },
        { key: 'profile', label: 'perfil de elevação', carries: (v) => v === true },
        {
            key: 'lineStyle',
            label: 'estilo de traço',
            carries: (v) => typeof v === 'string' && v !== '' && v !== 'solid',
        },
    ]),
    arrow: Object.freeze([
        { key: 'width', label: 'largura', carries: (v) => Number.isFinite(v) && v > 0 },
        { key: 'showArrowHead', label: 'ponta da seta', carries: (v) => v !== false },
        { key: 'doubleHeaded', label: 'segunda ponta', carries: (v) => v === true },
        { key: 'airmobile', label: 'marca aeromóvel', carries: (v) => v === true },
        { key: 'isMerged', label: 'ramos combinados', carries: (v) => v === true },
    ]),
    boundary: Object.freeze([
        {
            key: 'echelon',
            label: 'escalão',
            carries: (v) => typeof v === 'string' && v !== '',
        },
        {
            key: 'symbol_instances',
            label: 'símbolos de limite',
            carries: (v) => Array.isArray(v) && v.length > 0,
        },
        {
            key: 'text_top',
            label: 'rótulo superior',
            carries: (v) => typeof v === 'string' && v !== '',
        },
        {
            key: 'text_bottom',
            label: 'rótulo inferior',
            carries: (v) => typeof v === 'string' && v !== '',
        },
    ]),
    coordination_line: Object.freeze([
        {
            key: 'symbol_code',
            label: 'símbolo do catálogo',
            carries: (v) => typeof v === 'string' && v !== '',
        },
        {
            key: 'symbol_size',
            label: 'tamanho do símbolo',
            carries: (v) => Number.isFinite(v) && v > 0,
        },
        {
            key: 'symbol_spacing',
            label: 'distância entre símbolos',
            carries: (v) => Number.isFinite(v) && v > 0,
        },
    ]),
});

// ============================================================================
// AXIS READERS
// ============================================================================

/** @param {*} value @returns {number|undefined} The value when finite */
function finiteOrUndefined(value) {
    return Number.isFinite(value) ? value : undefined;
}

/** @param {*} value @returns {string|undefined} The value when a non-empty string */
function nonEmptyString(value) {
    return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Read the stroke colour axis, whatever the source type calls it.
 * @param {Object} [properties] - Source feature properties
 * @returns {string|undefined} Colour, or undefined when the source has none
 */
function readStrokeColor(properties) {
    const props = properties || {};
    if (props.source === 'arrow') {
        return nonEmptyString(props.fillColor) ?? nonEmptyString(props.lineColor);
    }
    if (props.source === 'boundary') return nonEmptyString(props.color);
    return nonEmptyString(props.lineColor);
}

/**
 * Read the alpha axis. `0` is a legitimate authored value and MUST survive,
 * which is why this returns `undefined` (not a falsy number) when unusable.
 * @param {Object} [properties] - Source feature properties
 * @returns {number|undefined} Opacity in [0, 1], or undefined
 */
function readAlpha(properties) {
    const props = properties || {};
    if (props.source === 'arrow') return finiteOrUndefined(props.fillOpacity);
    return finiteOrUndefined(props.opacity);
}

/**
 * Read the stroke width axis.
 * @param {Object} [properties] - Source feature properties
 * @returns {number|undefined} Width in px, or undefined
 */
function readStrokeWidth(properties) {
    return finiteOrUndefined(properties?.lineWidth);
}

/**
 * Clamp a stroke width into the target panel's range.
 * @param {*} value - Authored width (may be missing or NaN)
 * @param {{min: number, max: number}} range - Target range
 * @param {*} fallback - Target default width
 * @returns {number} A width the target panel can display
 */
function clampLineWidth(value, range, fallback) {
    const base = Number.isFinite(value) ? value : fallback;
    if (!Number.isFinite(base)) return range.min;
    return Math.min(range.max, Math.max(range.min, base));
}

// ============================================================================
// SPINE
// ============================================================================

/**
 * Whether a value is a usable spine: at least two points, each with a finite
 * longitude and latitude.
 * @param {*} coords - Candidate coordinates
 * @returns {boolean} True when usable
 */
function isUsableSpine(coords) {
    if (!Array.isArray(coords) || coords.length < 2) return false;
    return coords.every(point =>
        Array.isArray(point) &&
        point.length >= 2 &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1])
    );
}

/**
 * Resolve the coordinate spine of a linear feature.
 *
 * `baseCoordinates` wins because it is the authored truth; an arrow's and a
 * boundary's `geometry` is a derived polygon/multi-line and reading it would
 * hand the new feature the OUTLINE instead of the centreline. Legacy arrows
 * persist `baseCoordinates` as a JSON string, hence the parse.
 *
 * @param {Object} [feature] - GeoJSON feature
 * @returns {Array<Array<number>>|null} A fresh copy of the spine, or null
 */
export function resolveSpineCoordinates(feature) {
    const raw = feature?.properties?.baseCoordinates;

    let coords = null;
    if (Array.isArray(raw)) {
        coords = raw;
    } else if (typeof raw === 'string') {
        try {
            coords = JSON.parse(raw);
        } catch {
            coords = null;
        }
    }

    if (!isUsableSpine(coords)) {
        const geometry = feature?.geometry;
        coords = geometry?.type === 'LineString' ? geometry.coordinates : null;
    }

    if (!isUsableSpine(coords)) return null;
    return coords.map(point => [...point]);
}

// ============================================================================
// ELIGIBILITY
// ============================================================================

/**
 * Whether `feature` can become `targetSource`, and why not when it cannot.
 *
 * The lock axis here is only the feature's OWN `bloqueado` flag: map lock,
 * layer lock and group lock are store state, so the orchestrator checks those.
 *
 * @param {Object} [feature] - Candidate feature
 * @param {string} targetSource - Desired type ('line' | 'arrow' | 'boundary')
 * @returns {{ok: boolean, reason?: string}} Verdict with a pt-BR reason
 */
export function canConvertLinear(feature, targetSource) {
    if (!LINEAR_SOURCES.includes(targetSource)) {
        return { ok: false, reason: 'Tipo de destino inválido' };
    }

    const props = feature?.properties;
    const source = props?.source;

    if (!LINEAR_SOURCES.includes(source)) {
        return {
            ok: false,
            reason: 'Só linha, seta, linha de limite e linha de coordenação podem ser convertidas',
        };
    }
    if (source === targetSource) {
        return { ok: false, reason: 'A feição já é desse tipo' };
    }
    if (props.bloqueado === true) {
        return { ok: false, reason: 'Feição está bloqueada' };
    }
    if (
        source === 'arrow' &&
        props.isMerged === true &&
        Array.isArray(props.branches) &&
        props.branches.length > 1
    ) {
        return { ok: false, reason: 'Separe as setas antes de converter' };
    }
    if (!resolveSpineCoordinates(feature)) {
        return { ok: false, reason: 'Feição sem coordenadas suficientes' };
    }

    return { ok: true };
}

/**
 * Why the surrounding state forbids the conversion, if it does.
 *
 * Kept pure (it takes the two booleans instead of reading the store) because
 * BOTH callers need the same sentence: the menu, which must decide synchronously
 * whether to draw the item enabled, and the orchestrator, which re-checks at
 * click time because the map can be locked while the menu is open. One copy of
 * the phrase means the tooltip and the toast can never disagree.
 *
 * @param {Object} state
 * @param {boolean} [state.mapLocked] - Current map is locked
 * @param {boolean} [state.featureLocked] - Feature is locked by layer or group
 * @returns {string|null} pt-BR reason, or null when the edit is allowed
 */
export function lockedConversionReason({ mapLocked, featureLocked } = {}) {
    if (mapLocked) return 'Mapa está bloqueado';
    if (featureLocked) return 'Feição está bloqueada';
    return null;
}

// ============================================================================
// PROPERTY BUILD
// ============================================================================

/**
 * Build the properties of the converted feature.
 *
 * Starts from a deep copy of the TARGET defaults (so `symbol_instances` and any
 * other object-valued default is owned by the new feature, never shared with
 * the defaults object) and then writes, in order: identity, the carried-over
 * metadata, and the three canonical axes translated into the target's spelling.
 *
 * @param {Object} config
 * @param {Object} config.feature - Source feature
 * @param {string} config.targetSource - Target type
 * @param {Object} config.defaults - Target control's `DEFAULT_PROPERTIES`
 * @param {string} config.featureId - Freshly minted feature id
 * @param {string} [config.fallbackName] - Name to use when the source is unnamed
 * @param {Array<Array<number>>} [config.coordinates] - Resolved spine
 * @param {number} [config.adaptiveWidth] - Zoom-adaptive arrow width (metres)
 * @param {number} [config.adaptiveSymbolSize] - Zoom-adaptive boundary symbol size (km)
 * @param {number} [config.referenceZoom] - Current zoom, becomes the boundary anchor
 * @returns {Object} Properties for the new feature
 */
export function buildConvertedProperties({
    feature,
    targetSource,
    defaults,
    featureId,
    fallbackName,
    coordinates,
    adaptiveWidth,
    adaptiveSymbolSize,
    referenceZoom,
} = {}) {
    const src = feature?.properties || {};
    const props = deepClone(defaults || {});

    const strokeColor = readStrokeColor(src);
    const strokeWidth = readStrokeWidth(src);
    const alpha = readAlpha(src);

    props.source = targetSource;
    props.id = featureId;
    props.nome = nonEmptyString(src.nome) ?? (fallbackName || '');
    props.descricao = typeof src.descricao === 'string' ? src.descricao : '';
    props.visivel = src.visivel !== false;
    props.bloqueado = src.bloqueado === true;
    props.layerId = src.layerId || 'default';
    props.baseCoordinates = deepClone(coordinates ?? resolveSpineCoordinates(feature) ?? []);

    for (const key of PRESERVED_OPTIONAL_KEYS) {
        if (src[key] !== undefined) props[key] = deepClone(src[key]);
    }

    const range = LINE_WIDTH_RANGES[targetSource] || LINE_WIDTH_RANGES.line;
    const lineWidth = clampLineWidth(strokeWidth, range, props.lineWidth);

    if (targetSource === 'line') {
        if (strokeColor !== undefined) props.lineColor = strokeColor;
        props.lineWidth = lineWidth;
        if (alpha !== undefined) props.opacity = alpha;
    } else if (targetSource === 'arrow') {
        if (strokeColor !== undefined) {
            props.fillColor = strokeColor;
            props.lineColor = strokeColor;
        }
        props.lineWidth = lineWidth;
        if (alpha !== undefined) {
            props.fillOpacity = alpha;
            props.lineOpacity = alpha;
        }
        if (Number.isFinite(adaptiveWidth) && adaptiveWidth > 0) props.width = adaptiveWidth;
    } else if (targetSource === 'boundary') {
        if (strokeColor !== undefined) props.color = strokeColor;
        props.lineWidth = lineWidth;
        if (alpha !== undefined) props.opacity = alpha;
        if (Number.isFinite(adaptiveSymbolSize) && adaptiveSymbolSize > 0) {
            props.symbol_size = adaptiveSymbolSize;
        }
        // The converted boundary is born HERE, so its zoom anchor is the zoom on
        // screen right now — same rule as `AddBoundaryControl.createFeature`.
        // The derived `calculated*` sizes are written by the caller, which owns
        // the boundary's own zoom model (see linear-conversion.helpers.js).
        if (Number.isFinite(referenceZoom)) {
            props.createdAtZoom = Math.round(referenceZoom * 10) / 10;
        }
    } else if (targetSource === 'coordination_line') {
        if (strokeColor !== undefined) props.color = strokeColor;
        props.lineWidth = lineWidth;
        if (alpha !== undefined) props.opacity = alpha;
        // The glyph size is the target tool's own zoom-adaptive value, and the
        // spacing follows it, so a converted line is born with the same pattern
        // a freshly drawn one would have at this zoom.
        if (Number.isFinite(adaptiveSymbolSize) && adaptiveSymbolSize > 0) {
            props.symbol_size = adaptiveSymbolSize;
            props.symbol_spacing = adaptiveSymbolSize * COORDINATION_SPACING_RATIO;
        }
        // Born HERE, so the zoom anchor is the zoom on screen right now, exactly
        // as in the boundary branch above.
        if (Number.isFinite(referenceZoom)) {
            props.createdAtZoom = Math.round(referenceZoom * 10) / 10;
        }
    }

    return props;
}

// ============================================================================
// LOSS REPORT
// ============================================================================

/**
 * What this feature loses by leaving its current type, in pt-BR.
 *
 * Only data the feature actually carries is listed; a plain line converts with
 * no warning at all, while a boundary always reports its echelon and symbols
 * because it always has them.
 *
 * @param {Object} [feature] - Source feature
 * @returns {string[]} Labels of the dropped data (empty when nothing is lost)
 */
export function describeConversionLoss(feature) {
    const props = feature?.properties;
    const entries = DROPPED_BY_SOURCE[props?.source];
    if (!entries) return [];

    return entries
        .filter(entry => entry.carries(props[entry.key], props))
        .map(entry => entry.label);
}

/**
 * The success message, naming the losses when there are any.
 * @param {string} targetSource - Target type
 * @param {string[]} [losses] - Output of `describeConversionLoss`
 * @returns {string} pt-BR message for the toast
 */
export function formatConversionSuccess(targetSource, losses) {
    const name = LINEAR_TYPE_NAMES[targetSource] || 'feição';
    if (!Array.isArray(losses) || losses.length === 0) {
        return `Convertido para ${name}`;
    }
    return `Convertido para ${name} (perdido: ${losses.join(', ')})`;
}
