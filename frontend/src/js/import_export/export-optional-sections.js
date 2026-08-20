// Path: js/import_export/export-optional-sections.js
/**
 * @module import_export/export-optional-sections
 * @description The decision table for the OPTIONAL per-map sections of a `.ebgeo`:
 * which getter feeds each section, and the predicate that decides whether the
 * section carries content or should be left out of the file.
 *
 * WHY THIS IS A MODULE OF ITS OWN, and not a literal inside
 * `_exportOptionalMapData`. The table already produced a silent data-loss bug: the
 * `groups` predicate read `v?.size`, and `getMapGroups` returns a PLAIN OBJECT, so
 * `undefined > 0` was always false and every `.ebgeo` shipped without its groups —
 * no error, no warning (fixed upstream in 1f2b3428). The regression test written for
 * that bug had to COPY the table, because a private method's literal is not
 * reachable from a test, and a copy verifies nothing: measured here, replacing a
 * real predicate with `() => true` left the copied-table test green. Exporting the
 * table is what lets the test run the REAL predicates.
 *
 * The predicate of each section must match the TYPE its getter returns. Two shapes
 * live here and they are easy to confuse: `groups` and `comments` are objects keyed
 * by id (count keys), while `layers` is an array (check length).
 */

import {
    getColorUsage,
    getMapNotes,
    getMapGroups,
    getLayers,
    getCesium3dDataForExport,
    getStreetview360DataForExport,
    getMapTemporalConfig,
    getGridStyle,
    getComments,
} from '@store';
import { DEFAULT_TEMPORAL_CONFIG } from '@js/temporal/temporal.constants.js';

/**
 * @typedef {Object} OptionalSectionTask
 * @property {string} key - section name, used as the key in the `.ebgeo`
 * @property {Function} fn - getter, may be sync or async
 * @property {Function} check - predicate: true when the value carries content
 * @property {Function} [transform] - optional reshape before writing
 */

/**
 * Builds the optional-section table for one map.
 * @param {string} mapName - the map whose data is being exported
 * @returns {OptionalSectionTask[]} one entry per optional section
 */
export function optionalSectionTasks(mapName) {
    return [
        { key: 'colorUsage', fn: () => getColorUsage(mapName), check: (v) => v && Object.keys(v).length > 0 },
        { key: 'mapNotes', fn: () => getMapNotes(mapName), check: (v) => v && (v.title || v.description) },
        // getMapGroups returns a PLAIN OBJECT keyed by group id (memoryStore.groups[map]),
        // which is exactly what importGroupsDirectly/importMapGroups expect — so check by key
        // count and export as-is. (A stale `.size`/`Object.fromEntries` here assumed a Map and
        // silently dropped ALL groups from every `.ebgeo`, local and remote — P9/P11 bug.)
        { key: 'groups', fn: () => getMapGroups(mapName), check: (v) => v && Object.keys(v).length > 0 },
        { key: 'layers', fn: () => getLayers(mapName), check: (v) => v?.length > 0 },
        { key: 'cesium3d', fn: () => getCesium3dDataForExport(mapName), check: (v) => !!v },
        { key: 'streetview360', fn: () => getStreetview360DataForExport(mapName), check: (v) => !!v },
        // Per-map temporal config (modo/origem/unidade/bounds) so temporal-aware
        // maps round-trip. Export whenever it differs from the default in ANY field
        // — not only when currently active — so a configured-but-disabled relative
        // map keeps its origem/modo/unidade/bounds across export/import.
        {
            key: 'temporal',
            fn: () => getMapTemporalConfig(mapName),
            check: (v) => !!v && Object.keys(DEFAULT_TEMPORAL_CONFIG).some((k) => v[k] !== DEFAULT_TEMPORAL_CONFIG[k]),
        },
        // Per-map grid/UTM-grid style so configured grids round-trip in .ebgeo (P9 symmetry
        // with the live sync, which already persists gridStyle inbound).
        {
            key: 'gridStyle',
            fn: () => getGridStyle(mapName),
            check: (v) => !!v && typeof v === 'object' && Object.keys(v).length > 0,
        },
        // Spatial comments (root + replies, keyed by id) so commented maps round-trip in .ebgeo.
        { key: 'comments', fn: () => getComments(mapName), check: (v) => v && Object.keys(v).length > 0 },
    ];
}
