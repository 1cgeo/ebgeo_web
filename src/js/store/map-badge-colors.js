// Path: js/store/map-badge-colors.js

/**
 * @fileoverview Map-badge palette + the STABLE per-map color function. A map's badge color is a
 * deterministic function of its display NAME (djb2 hash → palette), so it NEVER changes when maps
 * are reordered (the previous position-based assignment recolored every map on reorder, which the
 * user found confusing) and is identical for every collaborator without needing to be synced. Pure
 * + Node-testable — no store/IndexedDB dependency.
 */

/**
 * Map-badge palette: 10 visually-distinct hues (all ~600/700 weight, so white text reads on them).
 * This is the SINGLE source of a map's badge color, shared by the current-map card, the maps-list
 * badge, and the recent-map shortcut.
 */
export const MAP_BADGE_COLORS = [
    '#2563eb', // blue
    '#dc2626', // red
    '#16a34a', // green
    '#9333ea', // purple
    '#ea580c', // orange
    '#0891b2', // cyan
    '#db2777', // pink
    '#65a30d', // lime
    '#4f46e5', // indigo
    '#ca8a04', // gold
];

/**
 * djb2 string hash → non-negative 32-bit integer. Stable across runs and clients.
 * @param {string} str
 * @returns {number}
 */
function djb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

/**
 * The stable badge color for a map, derived ONLY from its name → unaffected by list order.
 * @param {string} name - The map's display name.
 * @returns {string} A hex color from MAP_BADGE_COLORS.
 */
export function mapBadgeColorForName(name) {
    return MAP_BADGE_COLORS[djb2(String(name)) % MAP_BADGE_COLORS.length];
}
