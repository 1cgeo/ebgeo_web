// Path: tests/helpers/real-fixtures.js

/**
 * @fileoverview "Golden" feature fixtures mirroring EXACTLY what the real frontend
 * draw/military tools emit, the SAME shapes as
 * `frontend/tests/helpers/real-fixtures.js`, so the frontend producer tests and the
 * backend consumer (sync) tests share ONE contract.
 *
 * The real shape carries gotchas that minimal constructed fixtures never had and that
 * let real bugs through:
 *   - a NUMERIC top-level GeoJSON `id` (MapLibre/tool assigned) that is NOT a UUID and
 *     must NOT become the row id (the row id is the op's targetId);
 *   - `properties.id` = the canonical UUID;
 *   - `properties.source` = the type (the backend derives feature_type from it);
 *   - `properties.layerId` = 'default' (the implicit layer, a NON-UUID sentinel that
 *     must be coerced to null on `features.layer_id`, a UUID column).
 *
 * `ALL_FEATURE_SOURCES` USED TO BE A HAND-WRITTEN LIST, AND IT LIED.
 * It carried 18 types and called them "all" while the Joi allowlist, the CHECK
 * constraint and the client agreed on 20: `sector` and `magnetic_declination` were
 * missing. Every sweep over it therefore proved less than its reader believed, which is
 * the most dangerous kind of copy in the repository, because it wears the clothes of
 * verification. It is now DERIVED, by reading `VALID_FEATURE_TYPES` out of
 * `src/modules/atlas/atlas.schemas.js`.
 *
 * WHY THE JOI LIST AND NOT THE CHECK CONSTRAINT: the test database is built by running
 * the very migrations that declare the CHECK, so a sweep derived from the CHECK and
 * asserted against the database would be checking a file against itself. Deriving from
 * Joi and pushing every type through the real sync path makes the sweep a genuine
 * cross-check of two independent copies, and it is why the sweep is worth running at
 * all. Text plus anchored regex, no AST: `acorn` is declared in no `package.json` here,
 * and declaring it touches the lockfile, which is a decision with an owner.
 */

import { randomUUID } from 'crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** `new URL` + `import.meta.url`, never a slash-joined path: this repo is developed on Windows. */
const ARQ_JOI = fileURLToPath(new URL('../../src/modules/atlas/atlas.schemas.js', import.meta.url));

/**
 * Pulls the members of `const VALID_FEATURE_TYPES = [ ... ];` out of source text.
 * Returns [] when the anchor is gone, so the caller's floor (not a comparison against an
 * empty list) reports the breakage. Exported for the positive control in
 * `tests/integration/features-real-shape.test.js`: a guard that has never been seen
 * seeing something is indistinguishable from a blind one.
 * @param {string} fonte - the file's source text
 * @returns {string[]}
 */
export function extractJoiFeatureTypes(fonte) {
  const abertura = 'const VALID_FEATURE_TYPES = [';
  const i = fonte.indexOf(abertura);
  if (i === -1) return [];
  const j = fonte.indexOf('];', i + abertura.length);
  if (j === -1) return [];
  return [...fonte.slice(i, j).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/**
 * The derivation, with its floors. They run at MODULE LOAD and throw, on purpose: an
 * empty or truncated list would make every sweep over it green while verifying nothing,
 * which is exactly the defect this file used to embody.
 * @returns {readonly string[]} sorted, so this array is literally identical to the
 *   frontend twin, which derives the same set from the store's own mapping.
 */
function deriveAllFeatureSources() {
  const tipos = extractJoiFeatureTypes(readFileSync(ARQ_JOI, 'utf8'));
  if (tipos.length === 0) {
    throw new Error(
      `real-fixtures: no feature type parsed from ${ARQ_JOI}. The VALID_FEATURE_TYPES anchor `
      + 'broke (renamed, or no longer a literal array of quoted strings); the list did not shrink.',
    );
  }
  if (new Set(tipos).size !== tipos.length) {
    throw new Error('real-fixtures: VALID_FEATURE_TYPES repeats a type.');
  }
  // Absolute anchor beside the comparative checks: the oldest type of all must be there.
  if (!tipos.includes('point')) {
    throw new Error("real-fixtures: the parsed list has no 'point'; it is not the feature-type list.");
  }
  return Object.freeze([...tipos].sort());
}

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

/** O eixo autoral que os três tipos LINEARES carregam em `properties.baseCoordinates`. */
const EIXO = [C, [-43.18, -22.88], [-43.16, -22.90]];

/**
 * A real ARROW feature (military_tools/arrow_tool). Twin of the same name in
 * `frontend/tests/helpers/real-fixtures.js`.
 *
 * THREE GOTCHAS a generic point never had: the geometry is a `Polygon` (the drawn OUTLINE)
 * while the authored spine lives in `properties.baseCoordinates`; colour and opacity come in
 * TWO pairs (body and outline), not one; and `doubleHeaded` is the type's newest key, the one
 * every hand-written list loses.
 * @param {Object} [overrides] - `id` and any property overrides
 * @returns {Object} GeoJSON feature in the exact shape the tool emits
 */
export function realArrowFeature({ id = randomUUID(), ...over } = {}) {
  return feature(
    { type: 'Polygon', coordinates: [[C, [-43.18, -22.88], [-43.16, -22.90], [-43.19, -22.91], C]] },
    baseProps('arrow', id, {
      width: 500, fillColor: '#3f4fb5', lineColor: '#3f4fb5', lineWidth: 3,
      fillOpacity: 0.8, lineOpacity: 1.0, headLengthRatio: 1.5, showArrowHead: true,
      doubleHeaded: false, airmobile: false, airmobilePosition: 0.7,
      geometryType: 'arrow', baseCoordinates: EIXO,
      ...over,
    }),
  );
}

/**
 * A real BOUNDARY feature (military_tools/boundary_tool). Twin of the same name in
 * `frontend/tests/helpers/real-fixtures.js`.
 *
 * The geometry is a `MultiLineString`, because the echelon gaps are already CUT OUT of the
 * line, and the authored spine is in `properties.baseCoordinates`. It carries the zoom anchor
 * (`createdAtZoom` + `zoomCorrectionEnabled`) and the four `calculated*` derivatives, which
 * are a client cache and travel through the envelope like any other property.
 * @param {Object} [overrides] - `id` and any property overrides
 * @returns {Object} GeoJSON feature in the exact shape the tool emits
 */
export function realBoundaryFeature({ id = randomUUID(), ...over } = {}) {
  return feature(
    { type: 'MultiLineString', coordinates: [[C, [-43.18, -22.88]], [[-43.17, -22.89], [-43.16, -22.90]]] },
    baseProps('boundary', id, {
      color: '#000000', lineWidth: 4, opacity: 1, type: 'boundary',
      symbol_instances: [{ ratio: 0.5, showLabels: true }], symbol_size: 1, text_size: 35,
      echelon: 'XXX', text_top: '1º BI Mtz', text_bottom: '2º BI Mtz', text_distance_ratio: 0.9,
      createdAtZoom: 12.3, zoomCorrectionEnabled: true, text_north_facing: false,
      calculatedLineWidth: 4, calculatedTextSize: 35, calculatedStrokeWidth: 2,
      calculatedSymbolSize: 1,
      baseCoordinates: EIXO,
      ...over,
    }),
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
    arrow: realArrowFeature,
    boundary: realBoundaryFeature,
  };
  if (byType[source]) return byType[source](overrides);
  const { id = randomUUID(), ...over } = overrides;
  return feature({ type: 'Point', coordinates: C }, baseProps(source, id, over));
}

/** Every feature type the import Joi allowlist accepts (for "every type" contract sweeps). */
export const ALL_FEATURE_SOURCES = deriveAllFeatureSources();

export { NUMERIC_TOP_ID };
