// Path: js/utilities/selection-frame.js

/**
 * @fileoverview The screen margin of a framed selection, per side, and how much of the canvas the
 * rail and the open panel cover. The margin is pure and testable in node; the cover reads the DOM.
 *
 * WHY PER SIDE (owner's decision of 2026-09-26). The map canvas is the whole window, and the rail
 * and the open panel lie ON TOP of it on the left. A frame with the same margin on four sides put
 * the left part of the selection under the panel: the rotation handle of a text, which sits to the
 * left of it, ended up where the person cannot reach it (measured at x = 348 with the panel ending
 * at 456).
 *
 * THE WIDTH IS MEASURED, THE STATE IS ASKED, and each source answers only what it knows. The
 * state manager's `contentLeftOffset` says 376, because it mirrors `SIDEBAR_DIMENSIONS` (a 320 px
 * panel), while the panel the CSS draws is `--sidebar-panel-width`, 400 px: a frame built on that
 * number still left the handle under the panel. The DOM, on its side, lags: the tree click frames
 * in the same turn that opens the feature panel, and `data-expanded` lands on the element only
 * afterwards, so a frame that asked the attribute saw the rail alone (measured: the text's box
 * started at x = 144). So WHETHER a panel covers the canvas comes from the state, and HOW MUCH from
 * the layout box of the panel element (`offsetLeft`/`offsetWidth`, which ignore the slide-in
 * transform and exist while it is still closed). On a tablet the panel PUSHES the map
 * (`map/tablet-panel-push.js`), the canvas starts after it, and the same measurement answers zero
 * with no special case.
 *
 * THE DISCOUNT NEVER EATS THE CANVAS: a camera asked to fit bounds with more padding than the
 * canvas has fits nothing at all, so on a narrow window the discount shrinks until a strip of
 * {@link MIN_FRAME_WIDTH} pixels is left between the margins.
 */

/** The narrowest strip a frame keeps between its margins. */
export const MIN_FRAME_WIDTH = 64;

/** The elements that lie over the left of the map canvas when shown. */
const RAIL_SELECTOR = '.sidebar-nav';
const PANELS_SELECTOR = '.sidebar-panel, .feature-panel';

/**
 * @param {Object} args
 * @param {number} args.margem - The margin every side gets.
 * @param {*} args.cobertoAEsquerda - Pixels of the canvas covered on the left.
 * @param {number} [args.larguraDoCanvas] - The canvas width, when known.
 * @returns {{top: number, right: number, bottom: number, left: number}}
 */
export function selectionFramePadding({ margem, cobertoAEsquerda, larguraDoCanvas }) {
    let coberto = Number.isFinite(cobertoAEsquerda) && cobertoAEsquerda > 0 ? cobertoAEsquerda : 0;
    if (Number.isFinite(larguraDoCanvas) && larguraDoCanvas > 0) {
        coberto = Math.max(0, Math.min(coberto, larguraDoCanvas - MIN_FRAME_WIDTH - 2 * margem));
    }
    return { top: margem, right: margem, bottom: margem, left: margem + coberto };
}

/**
 * How many pixels of the canvas, from its left edge, the rail and (when open) the panel cover.
 * @param {HTMLElement|null|undefined} canvas - The map container.
 * @param {boolean} painelAberto - The state manager says the sidebar or the feature panel is open.
 * @returns {number}
 */
export function leftCoverOf(canvas, painelAberto) {
    if (typeof document === 'undefined' || !canvas?.getBoundingClientRect) return 0;
    const inicio = canvas.getBoundingClientRect().left;
    let fim = inicio;
    const trilha = document.querySelector(RAIL_SELECTOR);
    if (trilha) fim = Math.max(fim, trilha.getBoundingClientRect().right);
    if (painelAberto) {
        for (const painel of document.querySelectorAll(PANELS_SELECTOR)) {
            const base = painel.offsetParent?.getBoundingClientRect?.().left ?? 0;
            fim = Math.max(fim, base + painel.offsetLeft + painel.offsetWidth);
        }
    }
    return Math.max(0, fim - inicio);
}
