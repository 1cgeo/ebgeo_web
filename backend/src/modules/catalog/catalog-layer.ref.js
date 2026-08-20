// Path: src/modules/catalog/catalog-layer.ref.js
// A catalog layer added to a map is a REFERENCE to a catalog resource, and this file is where
// that reference is resolved. It is the frozen half of the client contract: the frontend mints
// the layer id by PREFIXING the catalog row id (`analysis-${id}` / `data-${id}` in
// `frontend/src/js/catalog/catalog.service.js`), and that string travels verbatim as the sync
// `entityId` and as `catalog_layers.id`.
//
// TWO INDEPENDENT DEFENCES, and both are needed — this is the trap of F11:
//
//   1. THE TYPE. `CATALOG_ITEM_TYPES` has a third member, `hillshade`, which is NOT a catalog
//      resource: it has no row in any catalog table (`CATALOG_TABLES` is basemaps / data_layers /
//      analysis_layers / tilesets), it is not a grantable type (`RESOURCE_TYPES`), and its
//      definition is STATIC (`config.static.js` MAP2D.hillshade, URL injected from HILLSHADE_URL).
//      Applying a resource predicate to it would take the shaded relief off everyone's map.
//   2. THE PREFIX. `005_catalogo.sql` seeds an `analysis_layers` row whose id is literally
//      'hillshade' (with `config = {}`, which is why `listAnalysisLayers` filters it out by the
//      bounds check and the frontend never sees it). Joining `catalog_layers.id` straight to a
//      catalog table would MATCH that row for the hillshade layer and hand back an empty config,
//      wiping the static definition. Requiring the prefix means the hillshade layer produces no
//      join key at all.
//
// The two vocabularies coincide word for word — `CATALOG_ITEM_TYPES.ANALYSIS_LAYER` is
// 'analysis_layer', the same string `resource_grants.resource_type` accepts — and that
// coincidence is asserted, not assumed: see `catalog-layer-ref.test.js`.

import { assertResourceType } from '../resource-access/resource-access.types.js';

/**
 * Catalog-layer `type` -> the id prefix the frontend mints for it.
 *
 * ONLY the two types that ARE catalog resources. `hillshade` is absent on purpose and its
 * absence is the whole point of the file; see the header.
 */
export const CATALOG_LAYER_ID_PREFIX = Object.freeze({
  analysis_layer: 'analysis-',
  data_layer: 'data-',
});

/**
 * The two keys of a stored catalog-layer payload that are DEFINITION (a copy of the catalog
 * row) rather than reference or per-atlas state.
 *
 * A DENYLIST, not an allowlist, and the choice is deliberate: the snapshot shape is frozen
 * against the client's IndexedDB document, and an allowlist would silently drop any key a
 * client adds — which is exactly what the two round-trip contract tests (`sourceId`, `nome`)
 * exist to forbid. Only the definition is taken away; everything else travels verbatim.
 *
 * `config` carries `source.url`, `bounds`, `legend`, `thumbnail` and the rest of the row, so
 * dropping the two closes the leak; `config.id` (the only key of it the drawing path reads) is
 * put back by the rehydration when the caller may see the resource.
 */
export const CATALOG_LAYER_DEFINITION_KEYS = Object.freeze(['name', 'config']);

/**
 * The catalog resource a catalog layer REFERS TO, or null when it refers to none.
 *
 * Null is the answer for the hillshade layer, for a legacy/array-shaped entry with no `type`,
 * for an id that does not carry the prefix its type demands, and for the empty remainder
 * (`'analysis-'` alone). Every one of those must be left alone by both the rehydration and the
 * write gate: they have no catalog row behind them, so there is nothing to hide and nothing to
 * refresh.
 *
 * @param {*} id - The catalog-layer id (`catalog_layers.id` / the op's entityId).
 * @param {*} type - The `type` of the stored payload.
 * @returns {{resourceType: string, resourceId: string}|null}
 */
export function catalogLayerResourceRef(id, type) {
  if (typeof type !== 'string' || typeof id !== 'string') return null;
  const prefix = CATALOG_LAYER_ID_PREFIX[type];
  if (!prefix || !id.startsWith(prefix)) return null;
  const resourceId = id.slice(prefix.length);
  if (!resourceId) return null;
  return { resourceType: assertResourceType(type), resourceId };
}

/**
 * Does this stored entry CLAIM to be a catalog resource?
 *
 * The predicate that decides whether the definition may travel, and it is deliberately WIDER
 * than `catalogLayerResourceRef`: it asks only about the `type` discriminator, never about the
 * id. An entry typed `data_layer` whose id carries no prefix still holds a copy of a catalog
 * row, and that copy is exactly what must not go out — refusing to strip it because the server
 * cannot address it would be protecting the addressable half of the same secret.
 *
 * False for hillshade (built-in, static, not a catalog resource) and for a legacy array entry
 * with no `type` at all, and both must stay untouched: the first would lose the shaded relief,
 * the second has no definition of ours to take.
 *
 * @param {*} type - The `type` of the stored payload.
 * @returns {boolean}
 */
export function claimsCatalogResource(type) {
  return typeof type === 'string' && Object.hasOwn(CATALOG_LAYER_ID_PREFIX, type);
}

/**
 * The catalog resource a stored entry refers to, through ANY of the three carriers the client
 * reads, or null when it carries none.
 *
 * Resolution order mirrors `catalogLayerReferenceId` in
 * `frontend/src/js/catalog/catalog-layer.ref.js`: the id PREFIX first (the only shape written
 * since F11), then `originalId`, then `config.id`. The server used to know only the first, and
 * that gap was the declared ceiling of F11: a PRE-PREFIX document carries its reference in
 * `originalId`, produced no reference here, and therefore travelled verbatim with its copy.
 *
 * @param {*} entry - The stored payload.
 * @param {*} [id] - The catalog-layer id, when it lives outside the payload.
 * @returns {{resourceType: string, resourceId: string}|null}
 */
export function catalogLayerReference(entry, id = entry?.id) {
  const byPrefix = catalogLayerResourceRef(id, entry?.type);
  if (byPrefix) return byPrefix;
  if (!claimsCatalogResource(entry?.type)) return null;
  const legacy = entry?.originalId || entry?.config?.id;
  if (typeof legacy !== 'string' || legacy === '') return null;
  return { resourceType: assertResourceType(entry.type), resourceId: legacy };
}

/**
 * The entry without its definition, with the reference PRESERVED.
 *
 * Mirrors `pruneCatalogLayerDefinition` in the frontend module of the same name, down to the
 * rescue of the reference: an entry whose id carries no prefix had `config.id` as its only
 * address, so dropping `config` without writing `originalId` would leave an entry nobody can
 * resolve — the definition gone AND the layer unrecoverable. That rescue is why closing the
 * pre-prefix ceiling was never "one line".
 *
 * Applied only to entries that claim a catalog resource; the caller decides.
 *
 * @param {Object} entry - The stored payload.
 * @param {*} [id] - The catalog-layer id, when it lives outside the payload.
 * @returns {Object} A copy without `name`/`config`.
 */
export function pruneCatalogLayerDefinition(entry, id = entry?.id) {
  const pruned = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!CATALOG_LAYER_DEFINITION_KEYS.includes(key)) pruned[key] = value;
  }
  if (!catalogLayerResourceRef(id, entry.type)) {
    const reference = entry.originalId || entry.config?.id;
    if (reference) pruned.originalId = reference;
  }
  return pruned;
}

/**
 * The key a resolved reference is looked up by. One helper so the producer of the lookup table
 * and its consumer cannot drift apart on the separator.
 *
 * The separator is NUL, written as the ESCAPE and never as a raw byte. NUL cannot appear in a
 * resource type or in a catalog id, so it is the one separator that cannot make two different
 * pairs collide on a single key (a space can: ('analysis_layer a', 'b') vs ('analysis_layer',
 * 'a b')). The escape matters as much as the character: a raw NUL byte makes git classify this
 * source file as BINARY, and a binary file has no reviewable diff — which is how a
 * security-relevant module changes without anyone being able to read the change.
 * @param {string} resourceType
 * @param {string} resourceId
 * @returns {string}
 */
export function catalogRefKey(resourceType, resourceId) {
  return `${resourceType}\u0000${resourceId}`;
}
