// Path: js/utilities/typing-target.js

/**
 * @fileoverview "Is the user typing right now?", for keyboard handlers bound to
 * the document.
 *
 * WHY IT EXISTS AS A FILE. Four modules already carried their own copy of this
 * test (`keyboard/keyboard-shortcuts.js`, and the keyboard services of the 3D,
 * briefing and first-person viewers) and a fifth was about to be written, for the
 * module that had none: `first_person_3d_tool/walk/walk-mode.js`. Its absence was
 * a real defect, not a theoretical one — walk mode tracks W, A, S, D and Space and
 * calls `preventDefault()` on them, so a text field anywhere on the page could not
 * receive those six characters while the viewer was open, and the camera walked
 * while the visitor typed. The scene's item search (`items-list-fp.js`) is a text
 * field open at exactly that moment.
 *
 * The four older copies are deliberately left where they are: replacing them is a
 * separate change, with its own reason to be reviewed. This is the home they
 * should converge on.
 */

/** Tag names that accept typing. `SELECT` is deliberately absent: it does not. */
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA']);

/**
 * Is this event target a place where keystrokes are TEXT rather than commands?
 *
 * Matches the older copies' behaviour, including the Quill editor's `.ql-editor`,
 * which is a contenteditable that some versions do not report as one on the exact
 * node the event carries.
 *
 * @param {EventTarget|null} target - The event's target.
 * @returns {boolean} True when a keyboard handler should keep its hands off.
 */
export function isTypingTarget(target) {
    if (!target || typeof target !== 'object') return false;

    const tagName = /** @type {Element} */ (target).tagName;
    if (typeof tagName === 'string' && TEXT_ENTRY_TAGS.has(tagName)) return true;

    if (/** @type {HTMLElement} */ (target).isContentEditable) return true;

    const closest = /** @type {Element} */ (target).closest;
    if (typeof closest !== 'function') return false;

    return Boolean(
        closest.call(target, '[contenteditable="true"]') || closest.call(target, '.ql-editor')
    );
}
