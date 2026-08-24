// Path: js/terrain/data-layer-phrases.js

/**
 * @fileoverview What the map SAYS when a catalog data layer does not draw, as pure functions.
 *
 * ZERO IMPORTS, on purpose, like `admin/group-phrases.js`: this is the half of the feature that
 * is verifiable in node, and it must stay loadable without MapLibre, without the store and
 * without alias resolution.
 *
 * WHY IT EXISTS. Until 2026-08-23 `data-layers.manager.js` handled every failure with
 * `catch (error) { console.error(...) }` and nothing else. Somebody with a legitimate grant
 * turned a layer on, the layer did not paint, and the screen said nothing at all. An empty map
 * and a broken map looked identical.
 *
 * THE HARD PART IS NOT THE WORDING, IT IS THE RESTRAINT. The obvious sentence is "você não tem
 * acesso a esta camada", and it would be a lie at least as often as it is true. Clauses 10.1 and
 * 10.3 of `CONSTITUICAO.md` say why, and they point in OPPOSITE directions:
 *
 *   - 10.1: the bytes of a private tile are served with no gate at all, and the twin defect is
 *     that the browser asks for the tile WITHOUT credential. So a person who has every right to
 *     the layer gets nothing drawn. Telling that person "você não tem acesso" states the
 *     opposite of the truth and sends them to ask for a grant they already hold.
 *   - 10.3: a revocation is not pushed, so somebody who really did lose access still sees a
 *     BROKEN layer rather than an absent one, until the next load.
 *
 * Add the ordinary causes (the network is down, the tile server is down, the URL an
 * administrator typed by hand is wrong) and the honest count of what the client actually knows
 * is: the request did not succeed. That is the whole of it. So the notice states the fact, names
 * the HTTP status when there IS one because a status is measured and not guessed, declares the
 * cause unknown out loud, and offers to try again.
 *
 * SAYING "I DO NOT KNOW" IS INFORMATION, not filler. Without that line the silence about the
 * cause reads as an accusation anyway: a person who sees a layer fail and no explanation
 * concludes they were shut out, which is the exact false belief 10.1 produces. The same choice
 * is already made in `groupPhrases.participatingReachUnknownNotice`.
 *
 * THE COUNT IS PER LAYER, NEVER PER REQUEST. A single visible layer at a low zoom asks for
 * dozens of tiles and MapLibre fires one `error` event per failed request. A phrase built from
 * the request count would say "42 falhas" about one layer, which is both useless and alarming.
 * Every function here takes LAYER NAMES.
 *
 * THREE SURFACES SHARE THESE WORDS, and one of them is not a layer. Since 2026-08-24 the same
 * notice covers the data layers of `config.dataLayers`, the raster layers of
 * `config.analysisLayers` and the BASEMAP (`config.basemaps` → the whole `config.style`). The
 * first two are sources ADDED to the style and are named in the same list; the basemap is the
 * style ITSELF, so it gets its own sentence rather than a slot in that list. Folding it into the
 * list would produce "2 camadas não puderam ser carregadas: "Mapa base" e "Molduras"", which
 * counts a thing that is not a layer and hides that the ground itself is missing.
 */

/** Label of the affordance that re-asks for the layer. */
export const RETRY_ACTION_LABEL = 'Tentar de novo';

/** Label of the affordance that dismisses the notice without retrying. */
export const DISMISS_ACTION_LABEL = 'Dispensar';

/**
 * A layer name fit to print, quoted. The fallback is NOT the empty string: a layer with no
 * name is still a layer that failed, and dropping it from the sentence would shorten the list
 * without lowering the count beside it, which is the shape of error where the screen
 * contradicts itself.
 * @param {*} value
 * @returns {string}
 */
export function layerDisplayName(value) {
    const name = String(value ?? '').trim();
    return name || 'Camada sem nome';
}

/**
 * Names de-duplicated, in the order they failed. The one place the collapsing happens, so the
 * printed count and the printed list can never disagree.
 * @param {Array<*>} names
 * @returns {string[]}
 */
function distinctNames(names) {
    const list = Array.isArray(names) ? names : [];
    const seen = new Set();
    const out = [];
    for (const raw of list) {
        const name = layerDisplayName(raw);
        if (seen.has(name)) continue;
        seen.add(name);
        out.push(name);
    }
    return out;
}

/**
 * Quoted names joined the way pt-BR joins them: "A", "A" e "B", "A", "B" e "C".
 * @param {Array<*>} names
 * @returns {string} Empty string for an empty list.
 */
export function formatLayerNameList(names) {
    const quoted = distinctNames(names).map((name) => `"${name}"`);
    if (quoted.length === 0) return '';
    if (quoted.length === 1) return quoted[0];
    return `${quoted.slice(0, -1).join(', ')} e ${quoted[quoted.length - 1]}`;
}

/**
 * THE FACT, and only the fact: this layer did not load.
 *
 * "não pôde ser carregada" is deliberate and is not a synonym of "não existe" or of "está
 * vazia". An empty layer is a layer that answered with zero features; this one did not answer.
 * @param {Array<*>} names - Layer names, one per LAYER (never per failed tile).
 * @returns {string} Empty string for an empty list, so the caller cannot render a notice about nothing.
 */
export function layerLoadFailureNotice(names) {
    // The count comes from the SAME de-duplicated list the sentence prints. Deriving it from the
    // raw array instead would say "2 camadas" and then name one, which is the shape of error where
    // the notice contradicts itself in a single line.
    const count = distinctNames(names).length;
    if (count === 0) return '';
    const rendered = formatLayerNameList(names);
    if (count === 1) return `A camada ${rendered} não pôde ser carregada.`;
    return `${count} camadas não puderam ser carregadas: ${rendered}.`;
}

/**
 * THE IGNORANCE, said out loud. See the file header for why this line is not filler.
 *
 * It lists candidate causes WITHOUT choosing one, and it deliberately puts access LAST, after
 * the two mundane causes, because access is the reading a person arrives at on their own and
 * the one most likely to be wrong (clause 10.1).
 * @returns {string}
 */
export function layerLoadFailureCauseNotice() {
    return 'O motivo não é conhecido daqui: pode ser a rede, o servidor que publica a camada, '
        + 'ou uma restrição de acesso. A tela não sabe qual dos três, e não vai adivinhar.';
}

/**
 * THE MEASURED DETAIL, when there is one. A status code is something the client OBSERVED, so
 * it belongs on screen; what the code MEANS is not, and is not written here.
 *
 * Statuses arrive aggregated per layer, so more than one can be present (a 403 on one tile and
 * a 500 on the next). They are printed in ascending order, without interpretation.
 * @param {Iterable<*>} statuses - HTTP status codes seen for this layer.
 * @returns {string} Empty string when nothing was observed, which is the common case for a
 *   network failure (no response arrives, so there is no status).
 */
export function layerLoadFailureStatusDetail(statuses) {
    const codes = [];
    for (const raw of statuses ?? []) {
        const n = Number(raw);
        // A status is an integer in the HTTP range. 0 (the value fetch reports for a blocked
        // or aborted request) is NOT a response and must not be printed as one.
        if (Number.isInteger(n) && n >= 100 && n <= 599 && !codes.includes(n)) codes.push(n);
    }
    if (codes.length === 0) return '';
    codes.sort((a, b) => a - b);
    if (codes.length === 1) return `O servidor respondeu ${codes[0]}.`;
    return `O servidor respondeu ${codes.join(', ')}.`;
}

/**
 * THE SECOND FAILURE, which is not the same event as the first.
 *
 * Repeating the opening sentence after a retry makes the button look inert: the person clicked,
 * the same words came back, and nothing tells them whether anything happened. Naming the retry
 * is what separates "it failed again" from "the screen did not react".
 * @param {Array<*>} names
 * @returns {string} Empty string for an empty list.
 */
export function layerRetryStillFailingNotice(names) {
    const count = distinctNames(names).length;
    if (count === 0) return '';
    const rendered = formatLayerNameList(names);
    if (count === 1) return `A camada ${rendered} continua sem carregar após a nova tentativa.`;
    return `${count} camadas continuam sem carregar após a nova tentativa: ${rendered}.`;
}

/**
 * THE BASEMAP, WHICH IS NOT A LAYER IN THIS LIST. See the file header for why it gets its own
 * sentence: it is the whole `config.style`, not a source added on top of one.
 *
 * THE NAME IS OPTIONAL, AND THE NAMELESS FORM IS THE HONEST DEFAULT, not a placeholder waiting to
 * be filled. What reports a basemap failure inside the map is the tile request that failed, and at
 * that moment the client cannot tell WHICH basemap id it belongs to without asking a module that
 * is not the map (see the fileoverview of `layer-failure-notice.js`). Printing the id the app
 * last recorded would name the PREVIOUS basemap during a switch, which is worse than naming none:
 * only one basemap is ever displayed, so the person already knows which one is missing.
 * @param {*} [name] - Basemap name, when the caller genuinely knows it.
 * @returns {string}
 */
export function basemapLoadFailureNotice(name) {
    const rendered = String(name ?? '').trim();
    return rendered
        ? `O mapa base "${rendered}" não pôde ser carregado.`
        : 'O mapa base não pôde ser carregado.';
}

/**
 * THE ONE HEADLINE the notice prints, however many surfaces are involved.
 *
 * THE BASEMAP COMES FIRST when both failed, and the order is an argument, not a taste: the
 * basemap is the ground the other layers are drawn on, so its absence explains more of what the
 * person is looking at than a layer's does. Reading "a camada X falhou" first, with a blank map
 * behind it, sends the diagnosis to the wrong place.
 *
 * `retried` applies ONLY to the layer half. The basemap is not re-requested by this notice (there
 * is no affordance for it: see `layer-failure-notice.js`), so claiming "após a nova tentativa"
 * about it would describe an attempt that never happened.
 * @param {{layerNames?: Array<*>, basemapFailed?: boolean, basemapName?: *, retried?: boolean}} [state]
 * @returns {string} Empty string when nothing failed, so the caller cannot render a notice about nothing.
 */
export function loadFailureHeadline({
    layerNames = [], basemapFailed = false, basemapName = null, retried = false,
} = {}) {
    const layers = retried ? layerRetryStillFailingNotice(layerNames) : layerLoadFailureNotice(layerNames);
    const basemap = basemapFailed ? basemapLoadFailureNotice(basemapName) : '';
    return [basemap, layers].filter(Boolean).join(' ');
}

/**
 * The accessible label of the whole notice, for a screen reader that gets the region before
 * the text inside it.
 * @returns {string}
 */
export function layerNoticeRegionLabel() {
    return 'Aviso de camada que não carregou';
}
