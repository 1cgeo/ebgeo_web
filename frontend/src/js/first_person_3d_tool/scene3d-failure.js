// Path: js/first_person_3d_tool/scene3d-failure.js

/**
 * @fileoverview WHEN A 3D SCENE DOES NOT OPEN, the map says so, in the panel every other surface
 * already uses (`terrain/layer-failure-notice.js`). The SIXTH surface, and the last of the three
 * viewers that loaded their own bytes in silence.
 *
 * WHY IT IS A FILE OF ITS OWN. Same seam as `3d_models_viewer_tool/model3d-failure.js` and
 * `street_view_tool/photo360-failure.js`: the MapLibre map belongs to the eager control
 * (`3d_models_viewer_tool/add_3d_models_viewer_control.js`, which owns the scene markers and is
 * added to the map at boot) and the failure belongs to the lazily imported engine
 * (`first_person_viewer.js`, which holds an aholo viewer and no map at all). The control attaches,
 * the viewer reports.
 *
 * ── WHERE IT SITS IN THE CHUNKING, WHICH IS NOT A DETAIL HERE ────────────────────────────────
 *
 * `first-person-3d` is a LAZY group of ~1.9 MB that trips the size warning on purpose (half of it
 * is base64 WASM), so a module the EAGER control imports statically must not fall into it. It does
 * not: `vite.config.js` claims that group BY EXPLICIT SUBPATH (`first_person_viewer`,
 * `components/`, `tools/`, `walk/walk-mode`, `walk/pointer-lock`) and never by the folder, which is
 * the same clause that keeps `index.js` out. An unmapped path lands in the entry bundle, which is
 * exactly where `model3d-failure.js` lands for the same reason. NOT pinning it to `core` is
 * deliberate: the four modules pinned there (`scene-config.service`, `walk/voxel-collision`,
 * `walk/constants`, `services/keyboard-service-fp`) are pinned because CORE modules import them,
 * and a pin that is not needed is a rule the next reader has to explain.
 *
 * Importing this file costs the engine NOTHING: its only imports are the notice and the phrases,
 * and neither reaches `@manycore/aholo-viewer`.
 *
 * ── WHAT ACTUALLY FAILS, MEASURED IN `first_person_viewer.js` ────────────────────────────────
 *
 * The scene is ONE file plus optional extras, and only the first one is fatal:
 *
 *   1. THE SPLAT (`loadSplat`, a plain `fetch` of the `.sog`). A non-ok response throws, and the
 *      status is OBSERVABLE here in a way Cesium's is not: it comes off `Response.status`, so it
 *      travels as a FIELD on the error and `requestStatus` (`@utils/request-failure.js`) reads it
 *      without parsing prose. Everything downstream of it (`parseSplatData`, `createSplat`) throws
 *      through the same `catch`, with no status, which is the honest answer for a decode error.
 *   2. THE OCTREE and THE MARKERS never throw: `loadSceneCollision` returns `null` and
 *      `loadSceneMarkers` returns `[]`. A scene with no collision is degraded (the visitor floats,
 *      the tape measure and the label occlusion are gone) and is still walkable, so it is NOT
 *      reported here. Reporting it would put "não pôde ser carregada" over a scene that is on
 *      screen and being walked through.
 *
 * IT IS AN OPENING FAILURE, WHICH IS WHY THE PANEL IS ENOUGH. Every failing path in
 * `doOpenFirstPersonViewer` ends with the viewer gone (`cleanupFirstPersonFeatures` calls
 * `setFirstPersonUiVisible(false)`, which gives `#map-sig` back), so the person is looking at the
 * map, where the panel lives, by the time it is drawn. Nothing re-fetches the splat while the
 * scene is open, so there is no in-viewer failure for this surface to speak about. The toast that
 * covers the seconds in between is built from {@link scene3dLoadFailureMessage}, i.e. from the
 * SAME phrase builder the panel uses, so the two cannot drift into saying different things about
 * one event.
 *
 * NO RETRY, for the reason the other two viewers give: asking again means re-opening the viewer,
 * which is a navigation and not a re-request, so the panel does not draw a button this surface
 * cannot honour.
 */

import { createLoaderFailureSurface } from '@js/terrain/layer-failure-notice.js';
import { SURFACE_NOUN, layerLoadFailureNotice } from '@js/terrain/data-layer-phrases.js';

/** Key the first-person scenes are filed under in the shared notice. */
export const SCENE_3D_SURFACE = 'cena3d';

/**
 * The one reporter for first-person scenes, shared by the control (which attaches the map) and the
 * viewer (which reports). A module singleton because there is one map per page.
 */
export const scene3dFailures = createLoaderFailureSurface({
    kind: SCENE_3D_SURFACE,
    noun: SURFACE_NOUN.CENA_3D,
});

/**
 * The sentence a toast says about a scene that did not open.
 *
 * IT IS THE PANEL'S OWN BUILDER, called with one name. The alternative, a literal string at the
 * failure site (which is what was there: "Erro ao carregar a cena 3D"), is how a product ends up
 * telling one person two different things about one event, and the toast is the half that is read
 * first.
 * @param {*} name - Scene name from the catalog, if known.
 * @returns {string}
 */
export function scene3dLoadFailureMessage(name) {
    return layerLoadFailureNotice([name], SURFACE_NOUN.CENA_3D);
}
