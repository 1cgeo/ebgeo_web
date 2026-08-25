// Path: js/import_export/import-normalize.js

/**
 * @fileoverview Import-data normalization for .ebgeo files (v1.x migration +
 * per-map structural normalization).
 *
 * Extracted from `export-import.service.js` so it can be exercised by a node
 * test: that service imports JSZip, the whole `@store` barrel and modal UI, none
 * of which load in the headless test environment. Everything here depends only on
 * pure helpers; the one store-backed dependency (catalog-layer availability) is
 * passed in by the caller.
 *
 * A NULL MEMBER IS SKIPPED, NOT DEREFERENCED. A hand-edited or truncated `.ebgeo` can carry
 * a null entry inside `maps`, `layers[*]` or `groups[*][*]`; reading `.sync` off it threw a
 * TypeError out of the migration, which runs before anything is shown, so one bad member
 * aborted the whole import with a raw stack. The `groups` guard only ever covered the
 * CONTAINER, never the member.
 *
 * INVARIANT (phantom-map regression): neither function may assign an `id` to a
 * map. Map identity and storage keying belong to addMap()/createMapCompat(); an
 * id injected here made addMap register a name->UUID resolver mapping that
 * diverged from the name-keyed storage entry, so the next name-resolving save
 * wrote a SECOND, phantom map. Guarded by
 * `tests/integration/import-phantom-map.repro.test.js`.
 */

import { createSyncMetadata } from '@store/sync/sync-metadata.js';
import { ATLAS_SCHEMA_VERSION } from '@store/atlas/atlas.entity.js';

/**
 * Migrates import data from v1.x to v2.0+ format.
 * Adds sync metadata to maps, features, layers, and groups.
 * @param {Object} data - v1.x format import data
 * @returns {Object} Migrated data in current format
 */
export function migrateImportDataToV2(data) {
    const migrated = { ...data };

    // Update version
    migrated.version = ATLAS_SCHEMA_VERSION;

    // Migrate each map
    if (migrated.maps) {
        for (const [_mapName, mapData] of Object.entries(migrated.maps)) {
            if (!mapData || typeof mapData !== 'object') continue;
            // Add sync metadata to map
            if (!mapData.sync) {
                mapData.sync = createSyncMetadata(null);
            }

            // NOTE: map ids are intentionally NOT generated here — addMap (via createMapCompat)
            // assigns the UUID and, when sync is active, stores the map UUID-keyed so a later
            // snapshot re-apply updates the SAME entry (no phantom/duplicate). See addMap().

            // Migrate features
            if (mapData.features) {
                for (const [_featureType, features] of Object.entries(mapData.features)) {
                    if (!Array.isArray(features)) continue;
                    for (const feature of features) {
                        if (!feature || typeof feature !== 'object') continue;
                        if (feature.properties && !feature.properties.sync) {
                            feature.properties.sync = createSyncMetadata(null);
                        }
                    }
                }
            }
        }
    }

    // Migrate layers
    if (migrated.layers) {
        for (const [_mapName, layers] of Object.entries(migrated.layers)) {
            if (!Array.isArray(layers)) continue;
            for (const layer of layers) {
                if (!layer || typeof layer !== 'object') continue;
                if (!layer.sync) {
                    layer.sync = createSyncMetadata(null);
                }
            }
        }
    }

    // Migrate groups
    if (migrated.groups) {
        for (const [_mapName, groups] of Object.entries(migrated.groups)) {
            if (!groups || typeof groups !== 'object') continue;
            for (const [_groupId, group] of Object.entries(groups)) {
                if (!group || typeof group !== 'object') continue;
                if (!group.sync) {
                    group.sync = createSyncMetadata(null);
                }
            }
        }
    }

    return migrated;
}

/**
 * Normalizes mapData structure to current version.
 * Ensures coordination_measures exists (added in v1.4).
 * Validates catalog layers availability.
 * @param {Object} mapData - Map data to normalize
 * @param {(layers: Array) => {processed: Array, unavailableCount: number}} processCatalogLayers -
 *   Catalog-availability resolver (store-backed `processCatalogLayersOnImport`). Required
 *   whenever mapData carries catalog layers; injected so this module stays node-testable.
 * @returns {{ mapData: Object, unavailableCatalogLayersCount: number }} Normalized map data and count of unavailable layers
 */
export function normalizeMapDataForCurrentVersion(mapData, processCatalogLayers) {
    // Defensive: a malformed/hand-edited or legacy .ebgeo may omit the features
    // object entirely. Guard before dereferencing it (avoids a throw mid-import).
    if (!mapData.features) {
        mapData.features = {};
    }
    // Ensure coordination_measures exists (v1.4)
    if (!mapData.features.coordination_measures) {
        mapData.features.coordination_measures = [];
    }

    // Add sync metadata if missing (v2.0)
    if (!mapData.sync) {
        mapData.sync = createSyncMetadata(null);
    }

    // NOTE: map ids are intentionally NOT generated here — addMap (via createMapCompat)
    // assigns the UUID and, when sync is active, stores the map UUID-keyed so a later
    // snapshot re-apply updates the SAME entry (no phantom/duplicate). See addMap().

    // Validate catalog layers availability
    let unavailableCatalogLayersCount = 0;
    if (mapData.catalogLayers && mapData.catalogLayers.length > 0) {
        const { processed, unavailableCount } = processCatalogLayers(mapData.catalogLayers);
        mapData.catalogLayers = processed;
        unavailableCatalogLayersCount = unavailableCount;
    }

    return { mapData, unavailableCatalogLayersCount };
}
