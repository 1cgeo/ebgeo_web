// Path: js/sidebar/components/photo-gallery-affordance.js

/**
 * @fileoverview WHAT THE PHOTO GALLERY OF A FEATURE DRAWS, as a pure decision.
 *
 * ZERO IMPORTS, so it runs in plain node: the gallery itself builds DOM and reads the store, and
 * the rule is what needs pinning, not the `createElement` calls around it.
 *
 * THE DEFECT IT CLOSES (owner, 2026-09-22): "mesmo no modo leitura ou comentário aparece na UI
 * para o cara adicionar imagem numa feição". The gallery asked ONLY whether the map was locked
 * (`isCurrentMapLockedSync`), the ESTADO axis. For a Leitor or a Comentarista on a server atlas
 * (the POSTO axis) it drew the header "Adicionar" button, the delete button of every card and the
 * big "+" card in the grid. The panel around it did know the role and marked itself
 * `feature-panel--locked`, whose CSS hid the header button and the delete buttons, but NOT the
 * "+" card, and the "+" card opened the file picker: the person chose a picture and the store
 * refused it afterwards.
 *
 * THE RULE, the house one for this panel on both axes: whoever cannot edit sees the pictures that
 * exist and nothing that writes. The POSTO does not draw the command (the house rule), and the
 * ESTADO keeps the pattern this panel already had with a locked map, which was also to hide
 * (`feature-panel--locked`), so there is no third behaviour here. Viewing a picture, the lightbox
 * and its download stay available to everyone.
 */

/** Pictures shown in the compact grid before the counter takes over. */
export const COMPACT_MAX_VISIBLE = 5;

/** The "+" card is offered while the feature has at most this many pictures. */
export const ADD_CARD_MAX_IMAGES = 2;

/**
 * What the gallery draws.
 *
 * POSITIVE FORM: only `readOnly === false` draws a writing command. An absent or malformed flag
 * reads as read-only, so a caller that forgets to say fails CLOSED and never offers the picker.
 *
 * @param {Object} state
 * @param {boolean} state.readOnly - Whether editing is unavailable (either axis) for this build.
 * @param {number} state.imageCount - How many pictures the feature carries.
 * @param {boolean} [state.compact=true] - Compact grid (the feature panel) or the full list.
 * @returns {{hidden: boolean, canAdd: boolean, canRemove: boolean, showAddCard: boolean,
 *   visibleCount: number}} `hidden` removes the whole section: a read-only gallery with no
 *   picture has nothing to show and nothing to offer.
 */
export function photoGalleryAffordances({ readOnly, imageCount, compact = true } = {}) {
    const count = Number.isFinite(imageCount) && imageCount > 0 ? Math.floor(imageCount) : 0;
    const writable = readOnly === false;
    return Object.freeze({
        hidden: !writable && count === 0,
        canAdd: writable,
        canRemove: writable,
        showAddCard: writable && count <= ADD_CARD_MAX_IMAGES,
        visibleCount: compact ? Math.min(count, COMPACT_MAX_VISIBLE) : count,
    });
}
