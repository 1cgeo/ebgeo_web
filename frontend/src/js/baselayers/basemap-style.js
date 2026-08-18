// Path: js/baselayers/basemap-style.js

/**
 * @fileoverview Which MapLibre style a basemap id renders with — pure lookup, testable in node.
 *
 * THE PROBLEM IT EXISTS FOR. The base-layer control knows FIVE styles, hardcoded as modules in this
 * folder (`STYLE_MAP`), while the list of basemaps comes from the server catalog and can hold any
 * id an administrator creates — including a PRIVATE one, which only reaches this client through the
 * additive payload (`GET /resource-access/visible`) after a login, a grant or an atlas that lends
 * it. Before this lookup, such a basemap appeared in the selector and switching to it silently
 * landed on another layer, because `styleUrls` was the intersection of the enabled basemaps with
 * those five modules and nothing else. "The selector honours the access filter" has to mean the
 * item works when it is offered, not merely that it is listed.
 *
 * THE ORDER IS BUILT-IN FIRST, AND THAT IS DELIBERATE. `/api/config` publishes `basemapStyles` for
 * the five built-in ids as well, assembled from the deployment's ENV-injected tile/glyph URLs.
 * Preferring the published copy for them would silently repoint the five layers every deployment
 * ships with — a change nobody asked for, riding along with a feature about private resources. So
 * the published style is consulted only where the client has NO style of its own, which is exactly
 * the set of ids that did not work at all.
 *
 * A malformed published style is treated as ABSENT: `map.setStyle()` on a broken object leaves the
 * map blank, and blank is worse than falling back to a layer that draws. The structural check is
 * the same one the admin editor runs before saving (`validateMapLibreStyle`), so client and server
 * agree on what counts as a style.
 */

import { validateMapLibreStyle } from '@utils/maplibre-style-validate.js';

/**
 * The style for a basemap id, or null when none is usable.
 * @param {string} id - Basemap id.
 * @param {Object<string, Object>} builtinStyles - The styles shipped with the client (`STYLE_MAP`).
 * @param {Object<string, Object|string>} [publishedStyles] - `config.basemapStyles` from the server.
 * @returns {Object|string|null} A style object, a style URL, or null.
 */
export function resolveBasemapStyle(id, builtinStyles, publishedStyles) {
    if (!id) return null;
    const builtin = builtinStyles?.[id];
    if (builtin) return builtin;

    const published = publishedStyles?.[id];
    if (typeof published === 'string') return published.trim() ? published : null;
    if (published && validateMapLibreStyle(published).ok) return published;
    return null;
}

/**
 * The first id of `orderedIds` that resolves to a usable style, or null.
 *
 * This is the fallback target when the persisted base layer no longer resolves — after a logout,
 * say, which takes a granted private basemap out of `config` while the map is still displaying it.
 * It walks the OFFERED order (the enabled basemaps, by priority) instead of the built-in map, so
 * the fallback is something the user can also see selected in the selector.
 * @param {string[]} orderedIds
 * @param {Object<string, Object>} builtinStyles
 * @param {Object<string, Object|string>} [publishedStyles]
 * @returns {string|null}
 */
export function firstStyledBasemap(orderedIds, builtinStyles, publishedStyles) {
    for (const id of (Array.isArray(orderedIds) ? orderedIds : [])) {
        if (resolveBasemapStyle(id, builtinStyles, publishedStyles)) return id;
    }
    return null;
}
