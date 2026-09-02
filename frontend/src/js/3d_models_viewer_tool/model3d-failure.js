// Path: js/3d_models_viewer_tool/model3d-failure.js

/**
 * @fileoverview WHEN A 3D MODEL DOES NOT DRAW, the map says so, in the panel every other surface
 * already uses (`terrain/layer-failure-notice.js`).
 *
 * WHY IT IS A FILE OF ITS OWN, and a small one. The failure and the map live in different
 * modules and neither can reach the other: `map_3d.js` is the lazily loaded engine that learns a
 * model did not load, and it has a Cesium viewer, not a MapLibre map; the control
 * (`add_3d_models_viewer_control.js`) has the MapLibre map and is loaded eagerly, but it never
 * sees a tile fail. This module is the seam: the control attaches the map at `onAdd`, the engine
 * reports through it, and nothing eager grows by more than these few lines. It sits at the folder
 * ROOT rather than under `tools/` or `services/` for a chunking reason that has bitten this
 * codebase before: those two subpaths are mapped to the lazy `cesium-integration` group
 * (`vite.config.js`), and a module the eager control imports statically must NOT live in a lazy
 * chunk, or core ends up statically depending on it (the TDZ cycle described there for
 * `keyboard-service-3d`).
 *
 * ── THE TWO FAILURES ARE NOT THE SAME FAILURE, AND THE SECOND ONE IS THE SILENT ONE ──────────
 *
 *   1. THE ROOT DOCUMENT FAILS. `Cesium3DTileset.fromUrl` (or `Model.fromGltfAsync`) rejects,
 *      `openViewerWithTileset` throws, and the control returns the person to the 2D map. Loud
 *      enough to notice, and the panel is exactly where they land.
 *
 *   2. THE ROOT LOADS AND EVERY CHILD 404s. The viewer opens on an empty scene, no promise
 *      rejects, and nothing anywhere throws. This is not hypothetical: the `fileoverview` of
 *      `recursoDeAsset3d` in `map_3d.js` records it as the measured symptom of handing Cesium a
 *      bare URL instead of a `Resource` (the credential and the atlas scope stop propagating to
 *      the children, so `tileset.json` passes and every `.b3dm` fails). It is also the exact
 *      shape a private model takes for a visitor who arrived by a public atlas link. The only
 *      signal is `tileset.tileFailed`, which carries `{url, message}` and no status field, which
 *      is what {@link statusOfCesiumTileFailure} exists for.
 *
 * WHAT IS NOT HERE: a retry. Asking again means re-opening the viewer, which is a navigation and
 * not a re-request, so no retry function is registered and the panel does not draw the button for
 * this surface. A command that cannot do what it names is the "posto que a pessoa não alcança"
 * of the constitution.
 */

import { createLoaderFailureSurface } from '@js/terrain/layer-failure-notice.js';
import { SURFACE_NOUN } from '@js/terrain/data-layer-phrases.js';

/** Key the 3D models are filed under in the shared notice. */
export const MODEL_3D_SURFACE = 'modelo3d';

// A ORIGEM COM QUE A TELEMETRIA DE ERRO MARCA ESTA SUPERFÍCIE é `cesium`, e ela é declarada
// em `session/origens-de-erro.js` (`ORIGEM_POR_SUPERFICIE`), indexada pela chave logo acima.
//
// O RELATO NÃO SAI DAQUI, e isso é decisão, não esquecimento: `model3dFailures.report` termina em
// `report(kind, id, status)` do painel compartilhado (`terrain/layer-failure-notice.js`), que é
// quem chama `relatarErro`. Um segundo relato neste arquivo mandaria DOIS relatos com DUAS
// assinaturas para UMA falha, gastando em dobro o teto de vinte envios por sessão. Quem casa a
// chave com a origem é `frontend/tests/unit/origens-de-erro.test.js`, que importa os dois lados.

/**
 * The one reporter for 3D models, shared by the control (which attaches the map) and the engine
 * (which reports). A module singleton because there is one map per page and the surface is a
 * property of the product, not of a call.
 */
export const model3dFailures = createLoaderFailureSurface({
    kind: MODEL_3D_SURFACE,
    noun: SURFACE_NOUN.MODELO_3D,
});

/**
 * The HTTP status inside a Cesium `tileFailed` message, or `null` when there is none.
 *
 * READING IT OUT OF PROSE IS NOT A SHORTCUT, it is the only channel Cesium offers here. Measured
 * against the vendored build (`public/vendors/cesium/index.js`, 2026-08-24) rather than assumed:
 * `tileFailed` is raised with `{url, message}` where `message` is `error.message ?? String(error)`,
 * and the error of a failed request is a `RequestErrorEvent`, which has no `message` and whose
 * `toString()` is `"Request has failed."` plus `" Status Code: <n>"` when a response arrived. So
 * the code is present exactly when there WAS a response, which is the same condition the panel
 * uses to decide whether to print one.
 *
 * ANYTHING ELSE RETURNS NULL, and that is the honest answer: a network drop, an abort or a
 * decode error produce a message with no code in it, and inventing one (0, or the last one seen)
 * would put a measured-looking number on screen for something nobody measured.
 * @param {*} message - The `message` field of a `tileFailed` event.
 * @returns {number|null}
 */
export function statusOfCesiumTileFailure(message) {
    const match = /Status Code:\s*(\d{3})\b/.exec(String(message ?? ''));
    if (!match) return null;
    const status = Number(match[1]);
    return status >= 100 && status <= 599 ? status : null;
}
