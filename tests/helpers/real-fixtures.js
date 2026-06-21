// Path: tests/helpers/real-fixtures.js

/**
 * @fileoverview "Golden" feature fixtures mirroring EXACTLY what the real frontend
 * draw/military tools emit — the SAME shapes as
 * `ebgeo_web/tests/helpers/real-fixtures.js`, so the frontend producer tests and the
 * backend consumer (sync) tests share ONE contract.
 *
 * The real shape carries gotchas that minimal constructed fixtures never had and that
 * let real bugs through:
 *   - a NUMERIC top-level GeoJSON `id` (MapLibre/tool assigned) that is NOT a UUID and
 *     must NOT become the row id (the row id is the op's targetId);
 *   - `properties.id` = the canonical UUID;
 *   - `properties.source` = the type (the backend derives feature_type from it);
 *   - `properties.layerId` = 'default' (the implicit layer — a NON-UUID sentinel that
 *     must be coerced to null on `features.layer_id`, a UUID column).
 */

import { randomUUID } from 'crypto';

const NUMERIC_TOP_ID = 1782053337250;
const C = [-43.2, -22.9];

function baseProps(source, id, extra) {
  return {
    id,
    source,
    layerId: 'default',
    nome: `${source}-${String(id).slice(0, 6)}`,
    visivel: true,
    bloqueado: false,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    version: 1,
    ...extra,
  };
}

function feature(geometry, properties, topId = NUMERIC_TOP_ID) {
  return { type: 'Feature', id: topId, geometry, properties };
}

export function realPointFeature({ id = randomUUID(), ...over } = {}) {
  return feature({ type: 'Point', coordinates: C }, baseProps('point', id, { color: '#ff0000', size: 24, sizeCreatedAtZoom: 10, rotation: 0, ...over }));
}

export function realLineFeature({ id = randomUUID(), ...over } = {}) {
  return feature(
    { type: 'LineString', coordinates: [C, [-43.18, -22.88], [-43.16, -22.90]] },
    baseProps('line', id, { lineColor: '#3f4fb5', lineWidth: 5, opacity: 0.7, lineStyle: 'solid', measure: false, profile: false, profileData: JSON.stringify([{ distance: 0, elevation: 0, slope: 0 }]), ...over }),
  );
}

export function realPolygonFeature({ id = randomUUID(), ...over } = {}) {
  return feature(
    { type: 'Polygon', coordinates: [[C, [-43.1, -22.9], [-43.1, -22.8], C]] },
    baseProps('polygon', id, { fillColor: '#00ff00', fillOpacity: 0.4, lineColor: '#008800', lineWidth: 2, hatchPattern: 'none', ...over }),
  );
}

export function realMilitarySymbolFeature({ id = randomUUID(), sidc = 'SFGPUCI-----', ...over } = {}) {
  return feature({ type: 'Point', coordinates: C }, baseProps('military_symbol', id, { sidc, size: 35, rotation: 0, uniqueDesignation: 'Pel Inf', ...over }));
}

export function realTextFeature({ id = randomUUID(), ...over } = {}) {
  return feature({ type: 'Point', coordinates: C }, baseProps('text', id, { text: 'Sede', fontSize: 16, color: '#000000', rotation: 0, ...over }));
}

export function realCircleFeature({ id = randomUUID(), ...over } = {}) {
  return feature({ type: 'Point', coordinates: C }, baseProps('circle', id, { radius: 500, fillColor: '#0000ff', fillOpacity: 0.3, lineColor: '#0000aa', ...over }));
}

export function realRectangleFeature({ id = randomUUID(), ...over } = {}) {
  return feature(
    { type: 'Polygon', coordinates: [[C, [-43.1, -22.9], [-43.1, -22.8], [-43.2, -22.8], C]] },
    baseProps('rectangle', id, { fillColor: '#ffaa00', fillOpacity: 0.3, lineColor: '#cc8800', rotation: 0, ...over }),
  );
}

/** Returns the matching real fixture for a source, or a generic Point with the same gotchas. */
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
  const { id = randomUUID(), ...over } = overrides;
  return feature({ type: 'Point', coordinates: C }, baseProps(source, id, over));
}

/** The 18 backend-valid feature types (CHECK constraint on features.feature_type). */
export const ALL_FEATURE_SOURCES = Object.freeze([
  'point', 'line', 'polygon', 'text', 'image',
  'circle', 'rectangle', 'ellipse', 'brush',
  'arrow', 'boundary', 'occupied_front',
  'military_symbol', 'coordination_measure',
  'los', 'visibility', 'processed_los', 'processed_visibility',
]);

export { NUMERIC_TOP_ID };
