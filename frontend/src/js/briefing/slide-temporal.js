// Path: js/briefing/slide-temporal.js

/**
 * @fileoverview THE INSTANT A BRIEFING SLIDE PINS. Pure decisions, zero imports, testable in node.
 *
 * THE SLIDE PINS AN INSTANT IN ALL THREE MODES, and until 2026-09-21 it pinned one only in 2D:
 * the capture wrote `temporalCursor = null` in the 3D and the 360 branches, and the restore
 * returned early for anything that was not 2D. The switch (`temporalEnabled`) never had that
 * limit, because the 3D and the 360 markers filter by the timeline too, so a 3D slide showed the
 * marker set of whatever slide came before it. Mode decides the BASE LAYER
 * (`briefing/slide-view.js`), never the instant.
 *
 * ONE READING OF THE SWITCH DECIDES BOTH FIELDS. The capture used to read "the timeline is on"
 * from two places that drift apart by an async turn (the controller's own `isEnabled()`, which it
 * rewrites when it re-syncs for the active map, and `isMapTemporalEnabledSync()`, which is the
 * screen), so a slide could be born with the switch on and no instant. Here the caller reads the
 * switch ONCE and hands it in: with the timeline off the slide is born without an instant, and
 * `slideTemporalCursor` then has nothing to restore, which is the same answer on both ends.
 *
 * NULL MEANS "NO REMEMBERED INSTANT", never zero: epoch 0 is a legitimate instant, so every test
 * here is `Number.isFinite`, never truthiness.
 */

/**
 * What a position capture writes into the slide about the timeline, read off the SCREEN of the
 * author. Independent of the slide mode, on purpose.
 *
 * @param {{temporalEnabled?: *, cursor?: *}} screen - The switch and the cursor on screen now.
 *   `cursor` is `NaN` while the timeline is off, which is what the controller returns.
 * @returns {{temporalEnabled: boolean, temporalCursor: (number|null)}}
 */
export function captureSlideTemporal(screen) {
    const temporalEnabled = screen?.temporalEnabled === true;
    const cursor = screen?.cursor;
    return {
        temporalEnabled,
        temporalCursor: temporalEnabled && Number.isFinite(cursor) ? cursor : null,
    };
}

/**
 * The instant a slide asks the timeline to go to, or null when it remembers none.
 *
 * @param {{temporalCursor?: *}} slide - Slide as it was stored.
 * @returns {number|null} Epoch ms, or null.
 */
export function slideTemporalCursor(slide) {
    const cursor = slide?.temporalCursor;
    return Number.isFinite(cursor) ? cursor : null;
}
