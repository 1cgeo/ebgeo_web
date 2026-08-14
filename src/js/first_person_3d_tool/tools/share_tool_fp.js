// Path: js/first_person_3d_tool/tools/share_tool_fp.js

/**
 * @fileoverview Share button for the first-person 3D viewer.
 * Reads the current pose, builds a deep link and copies it to the clipboard,
 * mirroring `handleShare360Click` (street_view_viewer.js) and the share-3d
 * handler in map_3d.js.
 */

import { showError } from '@utils';

/**
 * Handles the share button click: builds a deep link URL and copies it.
 *
 * Both imports are dynamic on purpose. The viewer is lazy-loaded, and importing
 * it statically from here would drag it (and the whole splat renderer) back
 * into the eager graph; deep-link.js is imported dynamically for the same
 * reason the 360 and 3D viewers do it - it lives in the entry bundle and the
 * viewer chunk must not pin it.
 *
 * @param {Event} [event] - Click event, when wired straight to a button
 */
export async function handleShareFpClick(event) {
    event?.stopPropagation?.();

    const { getFirstPersonViewerState } = await import(
        '@js/first_person_3d_tool/first_person_viewer.js'
    );
    const state = getFirstPersonViewerState();
    if (!state || !state.sceneId) return;

    // toFixed() on a non-finite number writes "NaN" into the URL, which would
    // then travel to whoever receives the link. Refuse instead.
    const pose = [state.x, state.y, state.z, state.yaw, state.pitch];
    if (!pose.every(Number.isFinite)) {
        console.warn('[first-person] invalid pose, link not generated:', state);
        showError('Não foi possível ler a posição atual');
        return;
    }

    const { buildShareUrlFirstPerson, copyShareUrl } = await import(
        '@js/deep-link/deep-link.js'
    );
    const url = buildShareUrlFirstPerson(
        state.sceneId,
        state.x,
        state.y,
        state.z,
        state.yaw,
        state.pitch
    );
    await copyShareUrl(url);
}
