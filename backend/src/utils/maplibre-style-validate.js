// Path: src/utils/maplibre-style-validate.js

/**
 * Minimal structural validation of a MapLibre GL style — the server-side guard so a basemap
 * resource whose `config.style` is malformed can never be persisted (and then served verbatim in
 * the public GET /config basemapStyles, bricking the base map for everyone). Mirrors the client
 * validator (frontend/src/js/utilities/maplibre-style-validate.js): pins `version: 8`, a `sources`
 * object, and a `layers` array.
 *
 * @param {*} style
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateMapLibreStyle(style) {
  if (style === null || typeof style !== 'object' || Array.isArray(style)) {
    return { ok: false, errors: ['Style must be a JSON object.'] };
  }
  const errors = [];
  if (style.version !== 8) {
    errors.push('Style must have "version": 8.');
  }
  if (style.sources === null || typeof style.sources !== 'object' || Array.isArray(style.sources)) {
    errors.push('Style must have "sources" as an object.');
  }
  const sourcesOk = style.sources !== null && typeof style.sources === 'object' && !Array.isArray(style.sources);
  if (!Array.isArray(style.layers)) {
    errors.push('Style must have "layers" as an array.');
  } else {
    // THE LAYER CONTRACT, and it is not decoration. A layer without `type` is not
    // rendered by MapLibre and the style silently draws less than it declares; a layer
    // naming a source the style does not have is the same failure with a louder cause.
    // Both used to sail through here: measured on 2026-09-11 against the real Overture
    // style, where `{ version: 8, sources: {}, layers: [{ id: 'x' }] }` was accepted.
    const seen = new Set();
    style.layers.forEach((layer, i) => {
      if (layer === null || typeof layer !== 'object' || Array.isArray(layer)) {
        errors.push(`Layer at index ${i} must be an object.`);
        return;
      }
      const name = typeof layer.id === 'string' && layer.id ? `"${layer.id}"` : `at index ${i}`;
      if (typeof layer.id !== 'string' || !layer.id) {
        errors.push(`Layer at index ${i} must have a non-empty string "id".`);
      } else if (seen.has(layer.id)) {
        errors.push(`Duplicate layer id "${layer.id}".`);
      } else {
        seen.add(layer.id);
      }
      if (typeof layer.type !== 'string' || !layer.type) {
        errors.push(`Layer ${name} must have a non-empty string "type".`);
      }
      if (layer.source !== undefined && sourcesOk
        && !Object.prototype.hasOwnProperty.call(style.sources, layer.source)) {
        errors.push(`Layer ${name} references source "${layer.source}", which the style does not declare.`);
      }
    });
  }
  return { ok: errors.length === 0, errors };
}
