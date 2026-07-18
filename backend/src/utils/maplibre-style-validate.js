// Path: src/utils/maplibre-style-validate.js

/**
 * Minimal structural validation of a MapLibre GL style — the server-side guard so a basemap
 * resource whose `config.style` is malformed can never be persisted (and then served verbatim in
 * the public GET /config basemapStyles, bricking the base map for everyone). Mirrors the client
 * validator (ebgeo_web/src/js/utilities/maplibre-style-validate.js): pins `version: 8`, a `sources`
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
  if (!Array.isArray(style.layers)) {
    errors.push('Style must have "layers" as an array.');
  }
  return { ok: errors.length === 0, errors };
}
