// Path: js/store/sync/slide-shape.js

/**
 * @fileoverview THE CLIENT'S SHAPE OF A SLIDE, and the server columns that must never ride in it.
 * Zero imports, testable in node.
 *
 * The server stores a slide as a row and hands it back in two places, the canonical receipt of a
 * slide op and the snapshot, spreading EVERY column before adding the client's camelCase aliases.
 * So a slide that came back carries `base_layer` next to `baseLayer`, `map_id` (a UUID) next to
 * `mapId` (a map NAME), and so on. The client model has none of the snake_case keys and never
 * edits them, which is exactly why they go stale: the editor changes `baseLayer` and leaves
 * `base_layer` holding the value of the last acknowledgement.
 *
 * AND THE SERVER USED TO READ THE STALE ONE. Until 2026-09-24 every edit of a slide's base layer,
 * timeline switch, instant, map, 3D model or 360 photo made after the first acknowledgement (or
 * after any F5) stayed on the author's screen and never reached the server. The hole is closed on
 * both sides: this module keeps the client from sending the pair, and since 2026-09-26
 * `normalizeSlidePayload` (backend `sync.service.js`) prefers the camelCase value when a payload
 * still carries both, which is what a tab left open on an older build sends.
 */

/** Server columns (and the server's private `_mapName`) that have a client twin in a slide. */
export const SERVER_SLIDE_ALIASES = Object.freeze(['_mapName', 'map_id', 'model_id', 'photo_id',
    'temporal_cursor', 'base_layer', 'temporal_enabled', 'briefing_id']);

/**
 * The slide in the client's own shape: a shallow copy without {@link SERVER_SLIDE_ALIASES}.
 * Anything that is not an object comes back as it was.
 *
 * @param {Object} slide
 * @returns {Object}
 */
export function clientSlideShape(slide) {
    if (!slide || typeof slide !== 'object') return slide;
    const shaped = { ...slide };
    for (const key of SERVER_SLIDE_ALIASES) delete shaped[key];
    return shaped;
}
