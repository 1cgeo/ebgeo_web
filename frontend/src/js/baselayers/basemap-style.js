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
 * A ORDEM É O PUBLICADO PRIMEIRO, E ELA MUDOU EM 2026-09-16. Era o embutido primeiro, com um
 * receio declarado: preferir a cópia publicada para os cinco ids embutidos "repontaria em silêncio
 * as cinco camadas que todo deployment traz". O caso real mostrou o custo do outro lado, e ele é
 * maior: os cinco módulos desta pasta são ESBOÇOS nesta linha do produto (o `carta_topografica.js`
 * são 18 linhas de OSM cru, o `carta_ortoimagem.js` é a URL de demonstração do MapLibre), enquanto
 * a `main` traz neles a carta DSG de 4.817 linhas e a Ortoimagem de 3.185. Com o embutido vencendo,
 * o administrador publicava a carta DSG no catálogo e a tela desenhava o esboço de OSM por baixo
 * dela, sem um erro em lugar nenhum. Foi o relato de 2026-09-16: "esse topográfica que tá com OSM".
 *
 * O QUE A INVERSÃO PRESERVA: quem não publica estilo nenhum continua caindo no embutido, que é o
 * que os cinco ids sempre fizeram antes de existir catálogo servido; e um publicado MALFORMADO
 * continua contando como ausente, então o esboço ainda é a rede de segurança. O que ela devolve é
 * a autoridade a quem configura o catálogo, que é de onde o resto de `/api/config` já vem.
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

    const published = publishedStyles?.[id];
    if (typeof published === 'string' && published.trim()) return published;
    if (published && typeof published !== 'string' && validateMapLibreStyle(published).ok) return published;

    // A QUEDA, e não o caminho principal: o embutido vale quando o servidor não publicou nada
    // utilizável para este id. Um publicado malformado chega aqui de propósito (ver o cabeçalho).
    return builtinStyles?.[id] ?? null;
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
