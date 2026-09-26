// Path: js/briefing/figura-de-slide.js

/**
 * @fileoverview The figure of a briefing slide, held BY REFERENCE. Zero imports, testable in node.
 *
 * WHY (owner's decision of 2026-09-26). A figure used to live inside the slide's HTML as a data URL,
 * so every autosave of that slide (three words typed next to it) re-sent the whole picture, several
 * times over: on a 40 kbps link a slide with a figure took minutes per edit and the peer did not get
 * the text. The bytes now travel once, through the durable blob queue, like an attached photo, and
 * the HTML carries only the reference.
 *
 * THE REFERENCE IS A SENTINEL `https` SRC, `https://figura.ebgeo/<uuid>`, and not a new attribute.
 * A tab on an older build (alive through the switch of the main line, with its queue) has a
 * sanitizer and a Quill that strip unknown attributes: with `data-figura` it would see an empty
 * picture and, editing the slide's text, save HTML without the reference, erasing the figure for
 * everyone. An `https` src survives both, so that tab shows a broken picture and keeps the
 * reference. This build swaps the sentinel for the local bytes when it draws (`resolverFiguras`),
 * and never lets the sentinel reach the network: the host does not exist, and asking it is a
 * request per picture per render.
 *
 * A slide saved before this keeps its data URLs and is still read as it always was.
 */

/** The sentinel origin. Never fetched: the renderers replace it before the element is live. */
export const FIGURA_ORIGEM = 'https://figura.ebgeo/';

/** An opaque id: what `generateUUID` mints, and nothing that could leave the path. */
const ID_VALIDO = /^[A-Za-z0-9-]{8,64}$/;

/** A sentinel inside an HTML string (src attribute value), with the id captured. */
const SENTINELA_NO_HTML = /https:\/\/figura\.ebgeo\/([A-Za-z0-9-]{8,64})/g;

/**
 * @param {string} id - The figure's image id.
 * @returns {string} The sentinel src that stands for it in the slide's HTML.
 */
export function srcDaFigura(id) {
    if (typeof id !== 'string' || !ID_VALIDO.test(id)) throw new Error(`srcDaFigura: id inválido "${id}"`);
    return `${FIGURA_ORIGEM}${id}`;
}

/**
 * @param {*} src - An `<img>` src.
 * @returns {string|null} The figure id when the src is a sentinel, otherwise null.
 */
export function idDaFigura(src) {
    if (typeof src !== 'string' || !src.startsWith(FIGURA_ORIGEM)) return null;
    const id = src.slice(FIGURA_ORIGEM.length);
    return ID_VALIDO.test(id) ? id : null;
}

/**
 * The figure ids an HTML string cites, in order and without duplicates.
 * @param {*} html - A slide's `content`.
 * @returns {string[]}
 */
export function idsDeFigurasNoHtml(html) {
    if (typeof html !== 'string' || !html.includes(FIGURA_ORIGEM)) return [];
    const ids = [];
    for (const [, id] of html.matchAll(SENTINELA_NO_HTML)) {
        if (!ids.includes(id)) ids.push(id);
    }
    return ids;
}

/**
 * The same HTML with every figure id rewritten through `mapa` (a copy that re-mints image ids: the
 * `.ebgeo` import into an existing atlas, a local atlas sent to the server, a server clone). An id
 * the map does not name is kept.
 * @param {*} html
 * @param {Map<string, string>|Object<string, string>} mapa - Old id to new id.
 * @returns {*} The rewritten HTML, or the input untouched when it is not a string.
 */
export function reescreverFigurasNoHtml(html, mapa) {
    if (typeof html !== 'string' || !html.includes(FIGURA_ORIGEM)) return html;
    const novo = (id) => (mapa instanceof Map ? mapa.get(id) : mapa?.[id]);
    return html.replace(SENTINELA_NO_HTML, (inteiro, id) => {
        const troca = novo(id);
        return typeof troca === 'string' && ID_VALIDO.test(troca) ? `${FIGURA_ORIGEM}${troca}` : inteiro;
    });
}

/**
 * What a figure shows until its bytes are resolved: a transparent pixel, so the element is inert
 * (no request) and keeps the space its `width`/`height` give it.
 */
export const PLACEHOLDER_DA_FIGURA = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** The attribute that carries a figure's id while it is drawn (never stored: see `htmlParaGuardar`). */
export const ATRIBUTO_DA_FIGURA = 'data-figura-id';

/** A sentinel src attribute as the sanitizer serializes it (always double quotes). */
const SRC_SENTINELA = /\ssrc="https:\/\/figura\.ebgeo\/([A-Za-z0-9-]{8,64})"/g;

/**
 * The HTML ready to be DRAWN: every sentinel src becomes the placeholder plus the id attribute, so
 * setting it as `innerHTML` asks nothing of the network, and `resolverFiguras` fills the bytes in.
 * Applied to the sanitizer's OUTPUT (`sanitizeQuillHtml`): the id attribute is not on the sanitizer's
 * list, and adding it after the sanitizer is what keeps it.
 * @param {*} html - Sanitized HTML.
 * @returns {*}
 */
export function marcarFigurasParaDesenho(html) {
    if (typeof html !== 'string' || !html.includes(FIGURA_ORIGEM)) return html;
    return html.replace(SRC_SENTINELA, (_, id) => ` src="${PLACEHOLDER_DA_FIGURA}" ${ATRIBUTO_DA_FIGURA}="${id}"`);
}

/**
 * The HTML ready to be STORED: the inverse of {@link marcarFigurasParaDesenho}, applied to what an
 * editor holds (whose figures carry the placeholder or a `blob:` URL of this tab). Every `<img>` with
 * the id attribute goes back to the sentinel src, and the attribute leaves.
 * @param {*} html - An editor's `innerHTML`.
 * @returns {*}
 */
export function htmlParaGuardar(html) {
    if (typeof html !== 'string' || !html.includes(ATRIBUTO_DA_FIGURA)) return html;
    return html.replace(/<img\b[^>]*>/gi, (tag) => {
        const achado = tag.match(/\sdata-figura-id="([A-Za-z0-9-]{8,64})"/);
        if (!achado) return tag;
        const sentinela = `${FIGURA_ORIGEM}${achado[1]}`;
        const semId = tag.replace(achado[0], '');
        return /\ssrc="[^"]*"/.test(semId)
            ? semId.replace(/\ssrc="[^"]*"/, ` src="${sentinela}"`)
            : semId.replace(/^<img\b/i, `<img src="${sentinela}"`);
    });
}

/** A figure as {@link marcarFigurasParaDesenho} writes it, up to the opening quote of its id. */
const FIGURA_MARCADA = ` src="${PLACEHOLDER_DA_FIGURA}" ${ATRIBUTO_DA_FIGURA}="`;

/**
 * The drawn HTML with the bytes of each figure written INLINE, for a copy that leaves the app (the
 * notes downloaded as a file): there is no store to resolve from over there. A figure whose bytes are
 * not in `dataUrls` keeps the placeholder.
 * @param {*} html - Output of `sanitizeQuillHtml` (figures marked for drawing).
 * @param {Map<string, string>} dataUrls - Figure id to the `data:` URL of its bytes.
 * @returns {*}
 */
export function embutirFigurasNoHtml(html, dataUrls) {
    if (typeof html !== 'string' || !html.includes(FIGURA_MARCADA)) return html;
    const [antes, ...partes] = html.split(FIGURA_MARCADA);
    return antes + partes.map((parte) => {
        const fim = parte.indexOf('"');
        const dataUrl = dataUrls instanceof Map ? dataUrls.get(parte.slice(0, fim)) : null;
        return fim > 0 && typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')
            ? ` src="${dataUrl}"${parte.slice(fim + 1)}`
            : `${FIGURA_MARCADA}${parte}`;
    }).join('');
}

/**
 * The figure ids a briefing document (or one slide) cites: every slide's `content`.
 * @param {*} briefingOuSlide - A briefing (with `slides`) or a slide (with `content`).
 * @returns {string[]}
 */
export function idsDeFigurasDoBriefing(briefingOuSlide) {
    const ids = [];
    const colher = (html) => {
        for (const id of idsDeFigurasNoHtml(html)) if (!ids.includes(id)) ids.push(id);
    };
    colher(briefingOuSlide?.content);
    for (const slide of Array.isArray(briefingOuSlide?.slides) ? briefingOuSlide.slides : []) colher(slide?.content);
    return ids;
}

/**
 * The figure ids an ATLAS DOCUMENT cites, in document order and without duplicates: every slide of
 * every briefing, and the notes of every map (where a slide figure can be pasted). It is the figure
 * half of what must travel beside a document (`idsDeFotosPorReferencia` is the photo half): the
 * `.ebgeo` export, its additive import, the copy that leaves the server, the upload of a local atlas.
 * @param {Object} documento - `briefings` (array, or object of briefings) and `mapNotes` (map name
 *   to `{ title, description }`), the shape of the export document.
 * @returns {string[]}
 */
export function idsDeFigurasDoDocumento(documento) {
    const ids = [];
    const colher = (lista) => {
        for (const id of lista) if (!ids.includes(id)) ids.push(id);
    };
    const briefings = documento?.briefings;
    for (const briefing of Array.isArray(briefings) ? briefings : Object.values(briefings || {})) {
        colher(idsDeFigurasDoBriefing(briefing));
    }
    for (const notas of Object.values(documento?.mapNotes || {})) colher(idsDeFigurasNoHtml(notas?.description));
    return ids;
}
