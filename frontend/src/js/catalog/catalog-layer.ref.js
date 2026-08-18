// Path: js/catalog/catalog-layer.ref.js

/**
 * @fileoverview A catalog layer stored in a map is a REFERENCE to a catalog resource plus the
 * per-atlas state of that reference. It is NOT a copy of the catalog row, and this module is the
 * single place that turns the reference back into a definition, reading the live catalog that
 * `GET /api/config` hydrates into `config`.
 *
 * WHY THE COPY HAD TO GO (two symptoms, one desnormalization):
 *   1. LEAK. The stored copy carried `config.source.url` of a PRIVATE resource, and the copy
 *      travelled in the sync snapshot, which is gated at `read` — a level a public-link visitor
 *      holds. No permission gate was crossed, because the URL never went near one.
 *   2. STALENESS. The copy was never refreshed. An administrator fixing a layer's URL left every
 *      atlas that had already added it pointing at the old address, forever.
 *
 * The model without either symptom already existed one table over: `maps.base_layer` stores only
 * the id, which is why a basemap never leaked this way.
 *
 * WHAT IS REFERENCE AND WHAT IS DEFINITION:
 *   - reference: `id` (the PREFIXED catalog row id) and `type` (the discriminator that says which
 *     catalog section to look in). Legacy documents may carry the reference in `originalId` or in
 *     `config.id` instead; both are read, neither is written.
 *   - per-atlas state: `visible`, `status`, `styleOverrides`, `opacity`. Belongs to the map.
 *   - definition: `name` and the whole of `config` (`source.url`, `bounds`, `legend`, `thumbnail`,
 *     `paint`, ...). Belongs to the catalog and is resolved here, on every read.
 *
 * HILLSHADE IS NOT A CATALOG RESOURCE, and this is the trap of the phase. It has no row in any
 * catalog table, it is not grantable, and its definition is STATIC (`config.map2d.hillshade`,
 * URL injected from the backend env). It therefore mints no prefix and resolves against the
 * static block; giving it a resource reference would take the shaded relief off everyone's map.
 *
 * `CATALOG_LAYER_ID_PREFIX` and `catalogLayerResourceRef` MIRROR
 * `backend/src/modules/catalog/catalog-layer.ref.js`, which resolves the same reference on the
 * server to decide whose definition it may serve. The two are asserted to agree by
 * `frontend/tests/unit/catalog-layer-ref.test.js`, which imports BOTH — a disagreement would make
 * the server rehydrate a layer the client cannot address, or vice versa, with both suites green.
 */

import config from '@js/config.js';
import { CATALOG_ITEM_TYPES } from './catalog.constants.js';

/**
 * Catalog-layer `type` -> the id prefix `catalog.service.js` mints for it.
 *
 * ONLY the two types that ARE catalog resources, mirroring the backend table key for key.
 * `hillshade` is absent on purpose; see the header.
 * @type {Readonly<Object<string, string>>}
 */
export const CATALOG_LAYER_ID_PREFIX = Object.freeze({
    [CATALOG_ITEM_TYPES.ANALYSIS_LAYER]: 'analysis-',
    [CATALOG_ITEM_TYPES.DATA_LAYER]: 'data-'
});

/**
 * The keys of a stored catalog-layer entry that are DEFINITION rather than reference or
 * per-atlas state. A denylist, exactly as on the server, and for the same reason: the entry shape
 * is shared with the snapshot, so an allowlist would silently drop any key another part of the
 * client (or a future version) adds.
 * @type {ReadonlyArray<string>}
 */
export const CATALOG_LAYER_DEFINITION_KEYS = Object.freeze(['name', 'config']);

/**
 * The catalog resource a layer id REFERS TO, or null when it refers to none.
 *
 * Null is the answer for hillshade, for a type that mints no prefix, for an id that does not
 * carry the prefix its type demands, and for the empty remainder (`'analysis-'` alone). Mirrors
 * the backend function of the same name.
 *
 * @param {*} id - The catalog-layer id.
 * @param {*} type - The stored `type`.
 * @returns {{resourceType: string, resourceId: string}|null}
 */
export function catalogLayerResourceRef(id, type) {
    if (typeof type !== 'string' || typeof id !== 'string') return null;
    const prefix = CATALOG_LAYER_ID_PREFIX[type];
    if (!prefix || !id.startsWith(prefix)) return null;
    const resourceId = id.slice(prefix.length);
    if (!resourceId) return null;
    return { resourceType: type, resourceId };
}

/**
 * The catalog row id a stored layer points at, whatever shape the entry is in.
 *
 * Resolution order, and it is deliberate: the PREFIX of the id first (the only shape written
 * since F11), then `originalId`, then `config.id` (the two legacy carriers). It is the same order
 * the availability check used, so the id that decides whether a layer is drawable is by
 * construction the id handed to the manager that draws it. They disagreed before: availability
 * preferred `originalId` while drawing read `config.id`, so a legacy entry could report itself
 * available and then ask the manager for a layer that is not there.
 *
 * @param {Object|null} layer - Stored catalog layer.
 * @returns {string|null} Catalog row id, or null when the entry carries no reference.
 */
export function catalogLayerReferenceId(layer) {
    const ref = catalogLayerResourceRef(layer?.id, layer?.type);
    if (ref) return ref.resourceId;
    return layer?.originalId || layer?.config?.id || null;
}

/**
 * Finds a layer definition inside a `/api/config` catalog section.
 *
 * A DISABLED section resolves to null even when it lists the id: the section switch is the
 * per-atlas gate, and a layer nobody may draw is not available.
 *
 * @param {Object|null} sectionConfig - `config.analysisLayers` / `config.dataLayers`.
 * @param {string|null} referenceId
 * @returns {Object|null}
 */
function findInSection(sectionConfig, referenceId) {
    if (!sectionConfig?.enabled || !referenceId) return null;
    return sectionConfig.layers?.find(l => l.id === referenceId) ?? null;
}

/**
 * The LIVE definition of a stored catalog layer, or null when this client cannot see it.
 *
 * Null covers every reason at once, and the caller does not have to tell them apart: the resource
 * was removed from the catalog, the section is disabled for this atlas, the resource is private
 * and this user has no grant, or the loan that made it reachable was to another atlas. In all of
 * them the layer is "indisponível" and the UI already has that state.
 *
 * @param {Object|null} layer - Stored catalog layer.
 * @returns {Object|null} The catalog row (or the static hillshade block), never a stored copy.
 */
export function resolveCatalogLayerDefinition(layer) {
    switch (layer?.type) {
        case CATALOG_ITEM_TYPES.HILLSHADE: {
            const hillshade = config.map2d?.hillshade;
            return hillshade?.enabled === true ? hillshade : null;
        }

        case CATALOG_ITEM_TYPES.ANALYSIS_LAYER:
            return findInSection(config.analysisLayers, catalogLayerReferenceId(layer));

        case CATALOG_ITEM_TYPES.DATA_LAYER:
            return findInSection(config.dataLayers, catalogLayerReferenceId(layer));

        case CATALOG_ITEM_TYPES.MODEL_3D: {
            // Never minted as a catalog layer by the current UI (a 3D card opens the viewer), but
            // old documents carry them and the availability check has always answered for them.
            const referenceId = catalogLayerReferenceId(layer);
            if (!referenceId) return null;
            return config.tilesets?.find(t => t.id === referenceId) ?? null;
        }

        default:
            return null;
    }
}

/**
 * The label to show for a stored catalog layer.
 *
 * The live catalog name wins. A stored `name` is accepted as a fallback ONLY because a legacy
 * document may still carry one, and showing the last-known label of a layer the user just lost
 * access to is friendlier than showing a slug; it is never written back and never authoritative.
 * Last resort is the reference id, which is the same string the unavailable popover prints.
 *
 * @param {Object|null} layer - Stored catalog layer.
 * @returns {string}
 */
export function catalogLayerDisplayName(layer) {
    const definition = resolveCatalogLayerDefinition(layer);
    if (definition?.name) return definition.name;
    if (typeof layer?.name === 'string' && layer.name.trim() !== '') return layer.name;
    return catalogLayerReferenceId(layer) || layer?.id || 'Camada sem nome';
}

/**
 * Strips the definition from an entry that is about to LEAVE the map document (a sync op, an
 * `.ebgeo` export, an upload of a local atlas) or to be rewritten in it.
 *
 * It is applied at the boundary and NOT as a sweep over stored documents, which is the migration
 * decision of this phase: the copy sitting in an old IndexedDB is inert (nothing reads it as
 * definition any more) and rewriting user documents to delete it would be irreversible for
 * nothing. What matters is that it stops travelling, and that is a boundary property.
 *
 * The reference is preserved across the strip: an entry whose id carries no prefix keeps its
 * inner id in `originalId`, because for that entry `config.id` was the only reference it had.
 *
 * @param {Object|null} layer - Stored catalog layer.
 * @returns {Object|null} A copy without the definition keys.
 */
export function pruneCatalogLayerDefinition(layer) {
    if (!layer || typeof layer !== 'object') return layer;

    const pruned = {};
    for (const [key, value] of Object.entries(layer)) {
        if (!CATALOG_LAYER_DEFINITION_KEYS.includes(key)) pruned[key] = value;
    }

    if (!catalogLayerResourceRef(layer.id, layer.type)) {
        const referenceId = layer.originalId || layer.config?.id;
        if (referenceId) pruned.originalId = referenceId;
    }

    return pruned;
}

/**
 * Convenience for the two whole-document exits (`.ebgeo` export, local-atlas upload).
 *
 * @param {Array|null|undefined} layers
 * @returns {Array|null|undefined} Same shape, definitions stripped.
 */
export function pruneCatalogLayerDefinitions(layers) {
    if (!Array.isArray(layers)) return layers;
    return layers.map(pruneCatalogLayerDefinition);
}
