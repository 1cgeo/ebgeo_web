// Path: js/sidebar/panels/feature-panel-flush.js

/**
 * @fileoverview WHAT THE OUTGOING FEATURE-PANEL CONTENT OWES BEFORE IT LEAVES THE SCREEN, and
 * when an async build may replace it.
 *
 * The feature panel is built asynchronously (`createFeaturePanelContent` awaits the layer list,
 * the stored description, the photo gallery and the location section), and the PREVIOUS content
 * stays in the DOM, interactive, until the new one is swapped in. Two defects lived in that
 * window until 2026-09-22, both silent:
 *
 * 1. THE EDIT MADE ON THE OUTGOING CONTENT WAS NEVER SAVED. `_showFeatureContent` saved the
 *    outgoing content once, when the rebuild STARTED. An edit made on it afterwards (name,
 *    colour, size, anything the panel stages) was dropped with the node at the swap, and the new
 *    content could not save it either: its baseline was taken after the edit, or its features
 *    never saw it. So the outgoing content is flushed again at the SWAP, by
 *    `finishFeaturePanelBuild`. The extra save is idempotent: `updateFeature` returns early when
 *    the stored feature is equal (`isFeatureEqual`), so no op and no undo entry is born twice.
 *
 * 2. A BUILD THAT OUTLIVED A CLOSE REOPENED THE PANEL. Only a newer build invalidated an older
 *    one; closing the panel (a deselect, Escape, the sidebar expanding) did not, so a build that
 *    was still in flight finished by calling `show()` and the panel came back for a feature that
 *    was no longer selected (an Escape right after drawing, while the creation's panel is still
 *    being built, is enough). Such a panel is worse than stale: the state says the panel is
 *    closed, so a click on empty map does not close it (there is no selection to drop) and the
 *    next rebuild sees its content as the outgoing one. The sidebar now invalidates the build on
 *    close, and `finishFeaturePanelBuild` drops what it was building.
 *
 * `commitOpenNameFields` is the third piece: an open name field is an edit the person has not
 * confirmed yet, and a programmatic unmount does not fire `blur`, so whoever is about to save or
 * remove the content confirms the field first (`sidebar/components/feature-identification.js`
 * hangs the hook on the input).
 *
 * Leaf, zero imports: runs in node (`tests/unit/nome-de-feicao-no-painel.repro.test.js`).
 */

/** Class of the name input of the 2D feature panel (the 3D and 360 panels reuse it, hookless). */
export const NAME_INPUT_SELECTOR = '.feature-identification-name-input';

/**
 * Property the name input carries to confirm a pending edit. A property on the node, in the
 * shape of the save button's `_saveOnly`, because the component that owns the field and the
 * code that unmounts it do not know each other.
 */
export const PENDING_NAME_COMMIT = '_commitPending';

/**
 * Confirms every open name field under `root`. A field that is not being edited ignores the
 * call, so this is safe to run on every save and every unmount.
 * @param {{querySelectorAll?: Function}|null|undefined} root
 * @returns {number} How many hooks were called.
 */
export function commitOpenNameFields(root) {
    const inputs = root?.querySelectorAll?.(NAME_INPUT_SELECTOR) ?? [];
    let called = 0;
    for (const input of inputs) {
        const commit = input?.[PENDING_NAME_COMMIT];
        if (typeof commit === 'function') {
            commit();
            called += 1;
        }
    }
    return called;
}

/**
 * Finishes one async build of the feature panel.
 *
 * ORDER IS THE CONTRACT: the build is awaited; if it is no longer the current one (a newer build
 * started, or the panel was closed meanwhile) it is DISCARDED and nothing on screen is touched;
 * otherwise the OUTGOING content is flushed and only then the new content is shown.
 *
 * @param {Object} steps
 * @param {() => Promise<*>} steps.build - Builds the new content.
 * @param {() => boolean} steps.isCurrent - Asked AFTER the build resolves.
 * @param {() => void} steps.flushOutgoing - Saves what the content still on screen holds.
 * @param {(result: *) => void} steps.show - Swaps the new content in.
 * @param {(result: *) => void} [steps.discard] - Releases a build that will never be shown.
 * @returns {Promise<boolean>} True when the new content was shown.
 */
export async function finishFeaturePanelBuild({ build, isCurrent, flushOutgoing, show, discard }) {
    const result = await build();
    if (!isCurrent()) {
        discard?.(result);
        return false;
    }
    flushOutgoing();
    show(result);
    return true;
}
