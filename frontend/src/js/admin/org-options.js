// Path: js/admin/org-options.js

/**
 * @fileoverview The Military Organization list, in the shape the admin tabs need.
 *
 * THE SOURCE IS `config.organizacoesMilitares`, hydrated by `GET /api/config` on the page boot,
 * and never a call of its own: a second source for the same list drifts, and the drift shows up
 * as two screens disagreeing about which OMs exist. No tab should hit the organizations route on
 * mount just to fill a `<select>`.
 *
 * This module was born because the id → name resolution ended up in TWO tabs (users, by producing
 * OM, and catalog, by owning OM) and both already carried divergent copies of the same pair of
 * functions.
 *
 * Prose here is English by convention (comment and JSDoc); the STRINGS are pt-BR because they are
 * UI, and that split is the whole reason this note exists — an earlier revision had the whole file
 * in pt-BR, parameter names included.
 */

import config from '@js/config.js';

/**
 * Resolves an OM id to its display name, falling back to the raw id when it is not in the active
 * list (an OM deactivated after the resource was stamped, for instance).
 * @param {string} [orgId]
 * @param {string} [emptyLabel] - What to show when there is no OM. Defaults to an em dash.
 * @returns {string}
 */
export function orgLabel(orgId, emptyLabel = '—') {
    if (!orgId) return emptyLabel;
    const list = Array.isArray(config.organizacoesMilitares) ? config.organizacoesMilitares : [];
    const found = list.find((o) => o && o.id === orgId);
    return found?.name || orgId;
}

/**
 * Builds the options of a `<select>` from a backend-controlled list (`config.postos` /
 * `config.organizacoesMilitares`). The option VALUE is the row id (the FK); a leading "(nenhum)"
 * allows clearing it, and the current id is preserved (labelled with its derived name) even when
 * it is no longer in the active list.
 * @param {Array<{id: string, name: string}>|undefined} list
 * @param {string} [currentId]
 * @param {string} [currentLabel]
 * @param {string} [emptyLabel] - Label of the empty option.
 * @returns {Array<{value: string, label: string}>}
 */
export function buildDomainOptions(list, currentId, currentLabel, emptyLabel = '— (nenhum)') {
    const opts = [{ value: '', label: emptyLabel }];
    const seen = new Set();
    for (const item of (Array.isArray(list) ? list : [])) {
        if (item && item.id && !seen.has(item.id)) {
            opts.push({ value: item.id, label: item.name });
            seen.add(item.id);
        }
    }
    if (currentId && !seen.has(currentId)) {
        opts.push({ value: currentId, label: `${currentLabel || currentId} (atual)` });
    }
    return opts;
}
