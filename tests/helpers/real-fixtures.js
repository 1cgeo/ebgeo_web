// Path: tests/helpers/real-fixtures.js

/**
 * @fileoverview "Golden" fixtures that mirror EXACTLY what the real draw/military
 * tools emit — NOT minimal idealized features. Built after a 2-browser collaboration
 * harness exposed bugs that every minimal-fixture test missed, because the real shape
 * carries gotchas the constructed fixtures never had:
 *
 *   - a NUMERIC top-level GeoJSON `id` (MapLibre/tool assigned, e.g. Date.now()) that
 *     is NOT the canonical id and must never be treated as a UUID;
 *   - `properties.id` = the canonical UUID;
 *   - `properties.source` = the feature type (the backend derives feature_type from it);
 *   - `properties.layerId` = 'default' (the implicit layer — a NON-UUID sentinel that
 *     broke the backend's UUID layer_id column);
 *   - the full per-type style/attribute property set.
 *
 * The SAME shapes exist in `ebgeo_backend/tests/helpers/real-fixtures.js` so the
 * frontend producer tests and the backend consumer tests share one contract.
 *
 * Pass a UUID for `id` via overrides to keep `properties.id` deterministic in a test.
 */

/** A non-UUID numeric top-level id like the tools assign (intentionally NOT a UUID). */
const NUMERIC_TOP_ID = 1782053337250;

/** Common props every tool-drawn feature carries. */
function baseProps(source, id, extra) {
    return {
        id,                    // canonical UUID
        source,                // feature type
        layerId: 'default',    // implicit layer — NON-UUID sentinel
        nome: `${source}-${String(id).slice(0, 6)}`,
        visivel: true,
        bloqueado: false,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        version: 1,
        ...extra,
    };
}

/** Wraps geometry + properties in the exact envelope a tool emits (numeric top id included). */
function feature(geometry, properties, topId = NUMERIC_TOP_ID) {
    return { type: 'Feature', id: topId, geometry, properties };
}

const C = [-43.2, -22.9];

/** A real POINT feature (draw_tools/point_tool). */
export function realPointFeature({ id = crypto.randomUUID(), ...over } = {}) {
    return feature(
        { type: 'Point', coordinates: C },
        baseProps('point', id, { color: '#ff0000', size: 24, sizeCreatedAtZoom: 10, rotation: 0, ...over }),
    );
}

/** A real LINE feature (draw_tools/line_tool) — carries the profile data the tool computes. */
export function realLineFeature({ id = crypto.randomUUID(), ...over } = {}) {
    return feature(
        { type: 'LineString', coordinates: [C, [-43.18, -22.88], [-43.16, -22.90]] },
        baseProps('line', id, {
            lineColor: '#3f4fb5', lineWidth: 5, opacity: 0.7, lineStyle: 'solid',
            measure: false, profile: false,
            profileData: JSON.stringify([{ distance: 0, elevation: 0, slope: 0 }]),
            ...over,
        }),
    );
}

/** A real POLYGON feature (draw_tools/polygon_tool). */
export function realPolygonFeature({ id = crypto.randomUUID(), ...over } = {}) {
    return feature(
        { type: 'Polygon', coordinates: [[C, [-43.1, -22.9], [-43.1, -22.8], C]] },
        baseProps('polygon', id, { fillColor: '#00ff00', fillOpacity: 0.4, lineColor: '#008800', lineWidth: 2, hatchPattern: 'none', ...over }),
    );
}

/** A real MILITARY SYMBOL feature (military_tools/military_symbol_tool) — default SIDC. */
export function realMilitarySymbolFeature({ id = crypto.randomUUID(), sidc = 'SFGPUCI-----', ...over } = {}) {
    return feature(
        { type: 'Point', coordinates: C },
        baseProps('military_symbol', id, { sidc, size: 35, rotation: 0, uniqueDesignation: 'Pel Inf', ...over }),
    );
}

/** A real TEXT feature. */
export function realTextFeature({ id = crypto.randomUUID(), ...over } = {}) {
    return feature(
        { type: 'Point', coordinates: C },
        baseProps('text', id, { text: 'Sede', fontSize: 16, color: '#000000', rotation: 0, ...over }),
    );
}

/** A real CIRCLE feature (center geometry + radius in properties). */
export function realCircleFeature({ id = crypto.randomUUID(), ...over } = {}) {
    return feature(
        { type: 'Point', coordinates: C },
        baseProps('circle', id, { radius: 500, fillColor: '#0000ff', fillOpacity: 0.3, lineColor: '#0000aa', ...over }),
    );
}

/** A real RECTANGLE feature. */
export function realRectangleFeature({ id = crypto.randomUUID(), ...over } = {}) {
    return feature(
        { type: 'Polygon', coordinates: [[C, [-43.1, -22.9], [-43.1, -22.8], [-43.2, -22.8], C]] },
        baseProps('rectangle', id, { fillColor: '#ffaa00', fillOpacity: 0.3, lineColor: '#cc8800', rotation: 0, ...over }),
    );
}

/**
 * Factory by source/type — returns the matching real fixture, or a generic Point
 * feature carrying the same gotchas for any other of the 18 types.
 * @param {string} source - properties.source / feature type
 * @param {Object} [overrides]
 */
export function realFeature(source, overrides = {}) {
    const byType = {
        point: realPointFeature,
        line: realLineFeature,
        polygon: realPolygonFeature,
        military_symbol: realMilitarySymbolFeature,
        text: realTextFeature,
        circle: realCircleFeature,
        rectangle: realRectangleFeature,
    };
    if (byType[source]) return byType[source](overrides);
    const { id = crypto.randomUUID(), ...over } = overrides;
    return feature({ type: 'Point', coordinates: C }, baseProps(source, id, over));
}

/** The 18 backend-valid feature types (for "every type" contract sweeps). */
export const ALL_FEATURE_SOURCES = Object.freeze([
    'point', 'line', 'polygon', 'text', 'image',
    'circle', 'rectangle', 'ellipse', 'brush',
    'arrow', 'boundary', 'occupied_front',
    'military_symbol', 'coordination_measure',
    'los', 'visibility', 'processed_los', 'processed_visibility',
]);

export { NUMERIC_TOP_ID };
