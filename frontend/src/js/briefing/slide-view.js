// Path: js/briefing/slide-view.js

/**
 * @fileoverview WHAT A BRIEFING SLIDE SHOWS besides the camera: the base layer and the temporal
 * switch. Pure decisions, zero imports, testable in node.
 *
 * WHY A SLIDE CARRIES THEM (decision of the owner, 2026-09-20, registered in
 * docs/decisions/decisions-2026.md). Until then the base layer and the temporal switch were
 * synced settings of the MAP, so a slide showed whatever the map had and the author set the
 * stage by changing the map for everybody. Both became view state of each person, which leaves
 * a presentation with nothing to stand on unless the slide says what IT shows.
 *
 * NULL MEANS "INHERIT WHAT WAS SAVED WITH THE MAP", in both fields, and that is what keeps every
 * slide written before these fields presenting exactly as it did: `undefined` reads as null.
 */

/** Slide mode whose screen is the 2D map. Spelled here to keep this module free of imports. */
const MODE_2D = '2d';

/**
 * Resolves the view a slide asks for.
 *
 * THE BASE LAYER IS A 2D MATTER. A 3D or 360 slide covers the map, so it never asks for a base
 * (`baseLayer: null` in the answer means "leave the base alone"). The temporal switch is not:
 * the 3D and the 360 markers filter by it too.
 *
 * A BASE THIS VIEWER CANNOT DRAW FALLS BACK TO THE SAVED ONE OF THE MAP, never to "the first
 * base on offer". A private basemap chosen by the author is not in the catalog of a viewer
 * without the grant, and the honest degradation is the base the map would have shown anyway.
 *
 * @param {{mode?: string, baseLayer?: (string|null), temporalEnabled?: (boolean|null)}} slide
 * @param {{baseLayer: (string|null), temporalEnabled: boolean}} saved - The saved view of the
 *   map of the slide.
 * @param {string[]} [available] - Base layer ids this viewer can draw. Absent = do not check.
 * @returns {{baseLayer: (string|null), temporalEnabled: boolean}}
 */
export function resolveSlideView(slide, saved, available) {
    const temporalEnabled = typeof slide?.temporalEnabled === 'boolean'
        ? slide.temporalEnabled
        : saved?.temporalEnabled === true;

    if ((slide?.mode || MODE_2D) !== MODE_2D) {
        return { baseLayer: null, temporalEnabled };
    }

    const asked = typeof slide?.baseLayer === 'string' && slide.baseLayer !== '' ? slide.baseLayer : null;
    const drawable = (id) => !Array.isArray(available) || available.includes(id);
    const baseLayer = asked && drawable(asked) ? asked : (saved?.baseLayer || null);
    return { baseLayer, temporalEnabled };
}

/**
 * What a position capture writes into the slide, read off the SCREEN of the author.
 *
 * @param {string} mode - Mode of the capture ('2d' | '3d' | '360').
 * @param {{baseLayer: (string|null), temporalEnabled: boolean}} screen - What is on screen now.
 * @returns {{baseLayer: (string|null), temporalEnabled: boolean}}
 */
export function captureSlideView(mode, screen) {
    return {
        baseLayer: mode === MODE_2D && typeof screen?.baseLayer === 'string' && screen.baseLayer !== ''
            ? screen.baseLayer
            : null,
        temporalEnabled: screen?.temporalEnabled === true,
    };
}
