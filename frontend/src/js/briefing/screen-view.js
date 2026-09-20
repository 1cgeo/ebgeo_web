// Path: js/briefing/screen-view.js

/**
 * @fileoverview What is on the screen of the AUTHOR right now, in the vocabulary a slide stores:
 * the base layer being drawn and the temporal switch.
 *
 * ONE READER, THREE BIRTHPLACES. A slide takes its view from the screen in three places (the first
 * slide of a new briefing, "add slide" in the editor, and the position capture), and a slide born
 * WITHOUT it inherits the view saved with the map, which repaints the screen of the author with a
 * base layer they did not choose the moment the slide is selected. That is how the second
 * birthplace was found: a capture of the editor showed a new briefing opening on the wrong base.
 * The decisions themselves are pure and live in `slide-view.js`; this file is only the impure
 * read, kept apart so that module stays free of imports.
 */

import { getControl, isMapTemporalEnabledSync } from '@store/index.js';
import { captureSlideView } from './slide-view.js';

/**
 * The view fields a slide of `mode` should be born with, read off the screen.
 *
 * The base layer is asked of the CONTROL, never of the store: since 2026-09-20 the store only
 * holds the base saved with the map, and `currentLayer` is the field the control rewrites after
 * every fallback, so it is the one that agrees with the pixels.
 *
 * @param {string} mode - Slide mode ('2d' | '3d' | '360').
 * @returns {{baseLayer: (string|null), temporalEnabled: boolean}}
 */
export function slideViewFromScreen(mode) {
    return captureSlideView(mode, {
        baseLayer: getControl('BaseLayerControl')?.currentLayer ?? null,
        temporalEnabled: isMapTemporalEnabledSync(),
    });
}
