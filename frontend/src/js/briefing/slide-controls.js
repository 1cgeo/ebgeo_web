// Path: js/briefing/slide-controls.js

/**
 * @fileoverview WHICH MAP CONTROLS A BRIEFING SLIDE SHOWS while it is being PRESENTED. Pure, zero
 * imports, testable in node.
 *
 * THE RULE OF THE OWNER (2026-09-20). A presentation is a clean stage: every control of this list
 * is HIDDEN unless the author ticked it for that slide, and the default of every one is false.
 * The author decides per slide, because a slide that invites the audience to compare basemaps
 * wants the selector, and the next one, a plain statement, wants nothing on the map at all.
 *
 * THE LIST IS A CLOSED VOCABULARY, mirrored by the server (`SLIDE_CONTROL_KEYS`,
 * `backend/src/modules/sync/slide-controls.js`), which drops every other key: the field travels as
 * JSONB and an open object there would be a free-form store inside a slide. A control added here
 * and not there is silently discarded on the way in.
 *
 * WHAT IS NOT IN THE LIST, ON PURPOSE: the account area (the "Entrar" button or the signed-in
 * identity) and "share this view". Those are NEVER shown while presenting, for any slide, so they
 * are not a choice of the author; `css/briefing/briefing-presentation.css` hides them outright.
 *
 * The editor is NOT affected by any of this: the author needs the selector and the viewers to
 * build the slide. Only the presenter applies these classes.
 */

/**
 * One control of the closed vocabulary.
 * @typedef {Object} SlideControl
 * @property {string} key - Key inside `slide.controls`.
 * @property {string} label - Checkbox label in the editor (pt-BR).
 * @property {string} bodyClass - Class the presenter puts on `<body>` when the slide shows it.
 */

/** @type {ReadonlyArray<Readonly<SlideControl>>} */
export const SLIDE_CONTROLS = Object.freeze([
    Object.freeze({ key: 'basemap', label: 'Seletor de mapa base', bodyClass: 'briefing-show-basemap' }),
    Object.freeze({ key: 'models3d', label: 'Modelos 3D', bodyClass: 'briefing-show-models3d' }),
    Object.freeze({ key: 'views360', label: 'Imagens 360', bodyClass: 'briefing-show-views360' }),
    Object.freeze({ key: 'terrain', label: 'Terreno', bodyClass: 'briefing-show-terrain' }),
    Object.freeze({ key: 'coordinates', label: 'Controle de coordenadas', bodyClass: 'briefing-show-coordinates' }),
    Object.freeze({ key: 'utilities', label: 'Utilitários', bodyClass: 'briefing-show-utilities' }),
]);

/** Class that marks "a presentation is running", under which the controls above are hidden. */
export const PRESENTING_BODY_CLASS = 'briefing-presenting';

/**
 * The six flags of a slide, every one a real boolean.
 *
 * ONLY `true` IS TRUE. A slide written before this field existed has no `controls` at all, and a
 * hostile or half-written payload may carry `'true'`, `1` or an array: every one of those reads as
 * HIDDEN, which is the default of the owner and the side that fails closed.
 *
 * @param {*} raw - `slide.controls`, in whatever shape it arrived.
 * @returns {Object<string, boolean>} Exactly the keys of `SLIDE_CONTROLS`.
 */
export function normalizeSlideControls(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const out = {};
    for (const { key } of SLIDE_CONTROLS) {
        out[key] = Object.hasOwn(source, key) && source[key] === true;
    }
    return out;
}

/**
 * The body classes a slide asks for while it is on screen.
 * @param {*} raw - `slide.controls`.
 * @returns {string[]} Classes to ADD; every other class of `SLIDE_CONTROLS` must be removed.
 */
export function slideControlClasses(raw) {
    const flags = normalizeSlideControls(raw);
    return SLIDE_CONTROLS.filter(({ key }) => flags[key]).map(({ bodyClass }) => bodyClass);
}

/** Every class this module may put on the body: what the presenter removes on the way out. */
export const ALL_SLIDE_CONTROL_CLASSES = Object.freeze(SLIDE_CONTROLS.map(({ bodyClass }) => bodyClass));
