// Path: src/utils/figura-de-slide.js
/**
 * @fileoverview The slide figure held BY REFERENCE, on the server side. ZERO IMPORTS.
 *
 * Since the owner's decision of 2026-09-26 a figure of a briefing slide lives in the atlas image
 * store, and the slide's HTML (`slides.content`) cites it by a sentinel src,
 * `https://figura.ebgeo/<image id>`, instead of carrying its bytes as a data URL. A map's notes
 * (`maps.notes_description`) can carry one too, pasted from a slide. The client owns the format
 * (`frontend/src/js/briefing/figura-de-slide.js`); the server reads it in two places: the import
 * requires the bytes of every figure a payload cites (`importImageIds`), and a copy that RE-MINTS
 * image ids keeps the reference valid (the atlas clone, `cloneAtlas` in `atlas.service.js`). The
 * orphan-image collector needs nothing: it matches any UUID in `slides.content` and
 * `maps.notes_description` (`modules/images/imagens-orfas.fontes.js`).
 *
 * The two copies of the sentinel are held together by
 * `tests/unit/figura-de-slide-espelha-o-cliente.test.js`: the backend does not import from the
 * frontend at run time.
 */

/** The sentinel origin. Never fetched by anyone: the client swaps it for the bytes when it draws. */
export const FIGURA_ORIGEM = 'https://figura.ebgeo/';

/** An opaque id: what the client mints, and nothing that could leave the path. */
const ID_VALIDO = /^[A-Za-z0-9-]{8,64}$/;

/** A sentinel inside an HTML string, with the id captured. */
const SENTINELA_NO_HTML = /https:\/\/figura\.ebgeo\/([A-Za-z0-9-]{8,64})/g;

/**
 * The figure ids an HTML string cites, in order and without duplicates.
 * @param {*} html
 * @returns {string[]}
 */
export function idsDeFigurasNoHtml(html) {
  if (typeof html !== 'string' || !html.includes(FIGURA_ORIGEM)) return [];
  const ids = [];
  for (const [, id] of html.matchAll(SENTINELA_NO_HTML)) if (!ids.includes(id)) ids.push(id);
  return ids;
}

/**
 * The same HTML with every figure id rewritten through `mapa`. An id the map does not name is kept.
 * @param {*} html - A slide's `content`, or a map's `notes_description`.
 * @param {Object<string, string>|Map<string, string>|null} mapa - Old image id to new image id.
 * @returns {*} The rewritten HTML, or the input untouched when it is not a string.
 */
export function reescreverFigurasNoHtml(html, mapa) {
  if (typeof html !== 'string' || !html.includes(FIGURA_ORIGEM) || !mapa) return html;
  const novo = (id) => (mapa instanceof Map ? mapa.get(id) : mapa[id]);
  return html.replace(SENTINELA_NO_HTML, (inteiro, id) => {
    const troca = novo(id);
    return typeof troca === 'string' && ID_VALIDO.test(troca) ? `${FIGURA_ORIGEM}${troca}` : inteiro;
  });
}
