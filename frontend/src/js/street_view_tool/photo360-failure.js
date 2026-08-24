// Path: js/street_view_tool/photo360-failure.js

/**
 * @fileoverview WHEN A 360 PHOTO DOES NOT DRAW, the map says so, in the panel every other
 * surface already uses (`terrain/layer-failure-notice.js`).
 *
 * WHY IT IS A FILE OF ITS OWN. Same seam as `3d_models_viewer_tool/model3d-failure.js`: the
 * MapLibre map belongs to the control (`add_street_view_control.js`, eager, added to the map at
 * boot) and the failure belongs to the Three.js viewer (`street_view_viewer.js`, lazily
 * imported, which holds a scene and a camera and no map at all). The control attaches, the
 * viewer reports.
 *
 * ── WHERE THE FAILURE IS OBSERVABLE, AND WHERE IT IS NOT ─────────────────────────────────────
 *
 * ONE choke point covers every door: `loadPhoto`, which every open and every in-viewer jump goes
 * through. Both of its halves can fail and both are reported there: the metadata request
 * (`fetchPhotoMetadata`, a 403/404 for a photo the visitor cannot read) and the panorama itself
 * (the pyramid probe falls back to the legacy full image, and the full image throws when it is
 * gone or forbidden).
 *
 * WHAT IS NOT OBSERVABLE FROM OUTSIDE is the individual tile of the pyramid. `tile-loader.js`
 * swallows a failed tile into its debug `log()` and keeps going, by design, and that file is a
 * COPY of another repository (`ebgeo_360`) with a declared five-hunk delta, so a sixth hunk
 * bought here would read as an unported fix at the next reconciliation
 * (`.claude/rules/common-tasks.md`). The consequence is stated rather than hidden: a panorama
 * whose `tiles.json` answers but whose tiles do not renders with HOLES and this panel says
 * nothing. Closing that one costs a change in the copied file, which is a decision for whoever
 * owns the sync with `ebgeo_360`, not a side effect of this module.
 *
 * NO RETRY, for the same reason as the 3D model: asking again means re-opening the viewer, which
 * is a navigation and not a re-request, so the panel does not draw a button this surface cannot
 * honour.
 */

import { createLoaderFailureSurface } from '@js/terrain/layer-failure-notice.js';
import { SURFACE_NOUN } from '@js/terrain/data-layer-phrases.js';

/** Key the 360 photos are filed under in the shared notice. */
export const PHOTO_360_SURFACE = 'foto360';

/**
 * The one reporter for 360 photos, shared by the control (which attaches the map) and the viewer
 * (which reports). A module singleton because there is one map per page.
 */
export const photo360Failures = createLoaderFailureSurface({
    kind: PHOTO_360_SURFACE,
    noun: SURFACE_NOUN.FOTO_360,
});
