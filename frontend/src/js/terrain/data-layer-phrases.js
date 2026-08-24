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
 * FIVE SURFACES SHARE THESE WORDS, and only three of them are layers. Since 2026-08-24 the same
 * notice covers the data layers of `config.dataLayers`, the raster layers of
 * `config.analysisLayers`, the BASEMAP (`config.basemaps` → the whole `config.style`), the 3D
 * models of `config.tilesets` and the 360 photos. The first two are sources ADDED to the style
 * and are named in the same list; the basemap is the style ITSELF, so it gets its own sentence
 * rather than a slot in that list. Folding it into the list would produce "2 camadas não puderam
 * ser carregadas: "Mapa base" e "Molduras"", which counts a thing that is not a layer and hides
 * that the ground itself is missing.
 *
 * THE 3D MODEL AND THE 360 PHOTO ARE NOT LAYERS EITHER, and calling them one is the same class of
 * error, only quieter. The product's own vocabulary separates them: the catalog files them under
 * "Modelos 3D" and "Imagens 360°", never under "Dados" or "Análise" (`CATALOG_TYPE_CONFIG`). So
 * they get their own NOUN instead of their own sentence, because unlike the basemap there can be
 * several of them at once and the count-plus-list shape is exactly right for them. That is what
 * {@link SURFACE_NOUN} is: the agreement pt-BR needs (article, plural, participle) so one set of
 * builders can say "A camada X não pôde ser carregada" and "O modelo 3D X não pôde ser
 * carregado" without a second copy of the sentence per surface.
 */

/** Label of the affordance that re-asks for the layer. */
export const RETRY_ACTION_LABEL = 'Tentar de novo';

/** Label of the affordance that dismisses the notice without retrying. */
export const DISMISS_ACTION_LABEL = 'Dispensar';

/**
 * The nouns the notice can speak about, other than the basemap.
 *
 * They are KEYS, not sentences: the sentence is assembled from {@link NOUN_TABLE}, so a surface
 * declares what it IS and never how it reads.
 * @enum {string}
 */
export const SURFACE_NOUN = Object.freeze({
    /** `config.dataLayers` and `config.analysisLayers`: sources added on top of the style. */
    CAMADA: 'camada',
    /** `config.tilesets`: a Cesium tileset or GLB model, drawn by another viewer entirely. */
    MODELO_3D: 'modelo3d',
    /** A 360 panorama, drawn by the Three.js viewer. */
    FOTO_360: 'foto360',
});

/**
 * The pt-BR agreement of each noun. Gender is the whole reason this table exists: "carregada"
 * for a camada and "carregado" for a modelo is not a detail a Portuguese reader can skip, and
 * hard-coding the feminine (which is what a single set of sentences would do) makes the notice
 * read as machine output exactly when it is asking to be trusted.
 *
 * The ORDER of the keys is the order the sentences come out in, so it is stable across renders
 * instead of following whatever happened to fail first.
 */
const NOUN_TABLE = Object.freeze({
    [SURFACE_NOUN.CAMADA]: {
        article: 'A', singular: 'camada', plural: 'camadas',
        loadedSingular: 'carregada', loadedPlural: 'carregadas', nameless: 'Camada sem nome',
    },
    [SURFACE_NOUN.MODELO_3D]: {
        article: 'O', singular: 'modelo 3D', plural: 'modelos 3D',
        loadedSingular: 'carregado', loadedPlural: 'carregados', nameless: 'Modelo 3D sem nome',
    },
    [SURFACE_NOUN.FOTO_360]: {
        article: 'A', singular: 'foto 360°', plural: 'fotos 360°',
        loadedSingular: 'carregada', loadedPlural: 'carregadas', nameless: 'Foto 360° sem nome',
    },
});

/**
 * The agreement of a noun, falling back to the layer's. An unknown noun is a caller bug, and the
 * fallback is deliberately the one that produces a true sentence about SOMETHING rather than
 * `undefined` on screen.
 * @param {*} noun
 * @returns {Object}
 */
function nounOf(noun) {
    return NOUN_TABLE[noun] || NOUN_TABLE[SURFACE_NOUN.CAMADA];
}

/**
 * A name fit to print, quoted. The fallback is NOT the empty string: a layer with no
 * name is still a layer that failed, and dropping it from the sentence would shorten the list
 * without lowering the count beside it, which is the shape of error where the screen
 * contradicts itself.
 * @param {*} value
 * @param {string} [noun] - A {@link SURFACE_NOUN}. Defaults to the layer, so every existing
 *   caller keeps the sentence it had.
 * @returns {string}
 */
export function layerDisplayName(value, noun = SURFACE_NOUN.CAMADA) {
    const name = String(value ?? '').trim();
    return name || nounOf(noun).nameless;
}

/**
 * Names de-duplicated, in the order they failed. The one place the collapsing happens, so the
 * printed count and the printed list can never disagree.
 * @param {Array<*>} names
 * @returns {string[]}
 */
function distinctNames(names, noun = SURFACE_NOUN.CAMADA) {
    const list = Array.isArray(names) ? names : [];
    const seen = new Set();
    const out = [];
    for (const raw of list) {
        const name = layerDisplayName(raw, noun);
        if (seen.has(name)) continue;
        seen.add(name);
        out.push(name);
    }
    return out;
}

/**
 * Quoted names joined the way pt-BR joins them: "A", "A" e "B", "A", "B" e "C".
 * @param {Array<*>} names
 * @param {string} [noun] - A {@link SURFACE_NOUN}, which only decides the nameless fallback.
 * @returns {string} Empty string for an empty list.
 */
export function formatLayerNameList(names, noun = SURFACE_NOUN.CAMADA) {
    const quoted = distinctNames(names, noun).map((name) => `"${name}"`);
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
 * @param {string} [noun] - A {@link SURFACE_NOUN}. The default keeps every existing caller's
 *   sentence byte for byte.
 * @returns {string} Empty string for an empty list, so the caller cannot render a notice about nothing.
 */
export function layerLoadFailureNotice(names, noun = SURFACE_NOUN.CAMADA) {
    // The count comes from the SAME de-duplicated list the sentence prints. Deriving it from the
    // raw array instead would say "2 camadas" and then name one, which is the shape of error where
    // the notice contradicts itself in a single line.
    const count = distinctNames(names, noun).length;
    if (count === 0) return '';
    const rendered = formatLayerNameList(names, noun);
    const w = nounOf(noun);
    if (count === 1) return `${w.article} ${w.singular} ${rendered} não pôde ser ${w.loadedSingular}.`;
    return `${count} ${w.plural} não puderam ser ${w.loadedPlural}: ${rendered}.`;
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
 * @param {string} [noun] - A {@link SURFACE_NOUN}.
 * @returns {string} Empty string for an empty list.
 */
export function layerRetryStillFailingNotice(names, noun = SURFACE_NOUN.CAMADA) {
    const count = distinctNames(names, noun).length;
    if (count === 0) return '';
    const rendered = formatLayerNameList(names, noun);
    const w = nounOf(noun);
    if (count === 1) return `${w.article} ${w.singular} ${rendered} continua sem carregar após a nova tentativa.`;
    return `${count} ${w.plural} continuam sem carregar após a nova tentativa: ${rendered}.`;
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
 * `retried` is PER GROUP, and it has to be. The basemap is not re-requested by this notice (there
 * is no affordance for it: see `layer-failure-notice.js`), so claiming "após a nova tentativa"
 * about it would describe an attempt that never happened; and the same is true of the 3D model
 * and the 360 photo, whose loaders this notice cannot drive either. A single flag applied to
 * everything on screen would put those words on a surface nobody asked for again the moment a
 * data layer was retried beside it.
 *
 * THE ORDER IS FIXED BY {@link NOUN_TABLE}, not by who failed first, so the same set of failures
 * always reads the same way.
 * @param {{layerNames?: Array<*>, basemapFailed?: boolean, basemapName?: *, retried?: boolean,
 *   groups?: Array<{noun?: string, names?: Array<*>, retried?: boolean}>}} [state] - `layerNames`
 *   and `retried` are the layer group, kept as their own arguments because every caller that
 *   predates the other nouns passes them; `groups` carries the rest and merges into it.
 * @returns {string} Empty string when nothing failed, so the caller cannot render a notice about nothing.
 */
export function loadFailureHeadline({
    layerNames = [], basemapFailed = false, basemapName = null, retried = false, groups = [],
} = {}) {
    const merged = new Map();
    const add = (noun, names, wasRetried) => {
        const key = NOUN_TABLE[noun] ? noun : SURFACE_NOUN.CAMADA;
        const slot = merged.get(key) || { names: [], retried: false };
        slot.names.push(...(Array.isArray(names) ? names : []));
        slot.retried = slot.retried || wasRetried === true;
        merged.set(key, slot);
    };
    add(SURFACE_NOUN.CAMADA, layerNames, retried);
    for (const group of Array.isArray(groups) ? groups : []) {
        add(group?.noun, group?.names, group?.retried);
    }

    const sentences = [basemapFailed ? basemapLoadFailureNotice(basemapName) : ''];
    for (const noun of Object.keys(NOUN_TABLE)) {
        const slot = merged.get(noun);
        if (!slot) continue;
        sentences.push(slot.retried
            ? layerRetryStillFailingNotice(slot.names, noun)
            : layerLoadFailureNotice(slot.names, noun));
    }
    return sentences.filter(Boolean).join(' ');
}

/**
 * The accessible label of the whole notice, for a screen reader that gets the region before
 * the text inside it.
 * @returns {string}
 */
export function layerNoticeRegionLabel() {
    return 'Aviso de camada que não carregou';
}
