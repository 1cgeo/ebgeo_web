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
 * THE THIRD DOOR IS THE INDIVIDUAL TILE OF THE PYRAMID, and until 2026-08-24 it was the one
 * still mute: a panorama whose `tiles.json` answers but whose tiles do not renders with HOLES,
 * and `tile-loader.js` swallowed every one of them into its debug `log()`. That file is a COPY of
 * another repository (`ebgeo_360`) with a DECLARED delta, so buying the signal there had to cost
 * as little as a signal can cost. It does: the copied file gained one optional callback
 * (`onTileErro`) that reports the FACT, and the whole policy is here, in {@link createTileHoleWatch}.
 * The sixth hunk is declared in `.claude/rules/common-tasks.md`, which is what keeps the next
 * reconciliation from reading it as an unported fix.
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

/**
 * How many DISTINCT tiles of ONE photo have to be missing before the panel speaks.
 *
 * A FALSE ACCUSATION COSTS MORE THAN SILENCE, because it teaches the person to ignore the whole
 * panel, and that is the argument already on record for leaving the basemap's style-document
 * failure out of it. So the threshold is not "one tile", and the three measured reasons are:
 *
 *   1. A LOST TILE ASKS AGAIN BY ITSELF. `guardarNoCache` only files a tile that arrived, so a
 *      key that failed is still missing from the cache and the next reevaluation re-enqueues it.
 *      A tile lost to one bad second of a mobile link fills itself in, with nobody told. That is
 *      the shape of failure a threshold of one would accuse on every train ride.
 *   2. A HOLE IS BLURRY, NOT BLACK. The pyramid paints coarse-to-fine and level 0 is pinned in
 *      cache (`guardarNoCache` never evicts it), so the square under a missing tile still carries
 *      the background. One or two of those are indistinguishable from "still loading", which is
 *      exactly the state the person should NOT be told about.
 *   3. THE CASE THIS EXISTS FOR TRIPS INSTANTLY ANYWAY. A private photo lent by an atlas the
 *      visitor left, or a partial upload, answers the SAME way on every tile: the working level
 *      of a monitor frustum is on the order of nine columns by six rows, so a refusal produces
 *      dozens of distinct failing keys in one pass, and any threshold below that fires on the
 *      first pass.
 *
 * FOUR is the line between (1)-(2) and (3): under it the picture still reads, over it the loss is
 * a pattern rather than a bad moment. It is a DECISION, not an invariant, and the counting is
 * what makes it hold: DISTINCT keys, so one stubborn tile retried twenty times never accuses on
 * its own, and per photo, so crossing four panoramas that each lost one says nothing.
 */
export const TILE_HOLE_MIN = 4;

/**
 * Turns a stream of single failed tiles into at most one accusation per photo.
 *
 * IT IS A FACTORY AND NOT A SINGLETON so the threshold can be driven in a test without touching
 * module state, and so the caller injects both ends: which photo the tiles belong to (read at
 * report time, never frozen) and how to accuse it.
 *
 * @param {Object} opcoes
 * @param {() => (string|null|undefined)} opcoes.foto - The photo the loader is filling RIGHT NOW.
 *   Read on every failure, which is what makes a navigation reset the counters for free.
 * @param {(id: string, status: number|null) => void} opcoes.acusar - Reports one photo. Called
 *   once per collected status when the threshold is crossed, and once per failure after that; the
 *   panel de-duplicates by photo id and only accumulates the codes.
 * @param {number} [opcoes.minimo] - Distinct missing tiles required. Defaults to
 *   {@link TILE_HOLE_MIN}.
 * @returns {{tileFalhou: (falha: Object) => boolean, esquecer: (id?: string) => void}}
 */
export function createTileHoleWatch({ foto, acusar, minimo = TILE_HOLE_MIN }) {
    /** The photo the counters below belong to. */
    let dona = null;
    /** tile key → last status seen for it. A Map, so a repeated key overwrites instead of adding. */
    const faltando = new Map();
    /** Whether this photo has already reached the panel. */
    let acusada = false;

    /** @param {string} id */
    function trocarPara(id) {
        if (id === dona) return;
        dona = id;
        faltando.clear();
        acusada = false;
    }

    return {
        /**
         * @param {{chave?: string, status?: number|null}} [falha] - What `onTileErro` handed over.
         * @returns {boolean} Whether this failure reached the panel.
         */
        tileFalhou({ chave, status } = {}) {
            const id = foto();
            if (!id || !chave) return false;
            trocarPara(id);
            faltando.set(chave, status ?? null);
            if (acusada) {
                acusar(id, status ?? null);
                return true;
            }
            if (faltando.size < minimo) return false;
            acusada = true;
            // Every code collected so far, so the panel's status line names the ones that were
            // observed BEFORE the threshold instead of only the one that crossed it.
            for (const codigo of faltando.values()) acusar(id, codigo);
            return true;
        },
        /**
         * Forgets what one photo was counted for, so a fresh load starts from zero. Paired with
         * the panel's own retraction: the two have to forget together, or a photo that reloads
         * clean keeps a counter that accuses on its first hiccup.
         * @param {string} [id] - Only forgets when it is the photo being counted. Omitted, forgets
         *   whatever it is.
         */
        esquecer(id) {
            if (id !== undefined && id !== dona) return;
            dona = null;
            faltando.clear();
            acusada = false;
        },
    };
}
