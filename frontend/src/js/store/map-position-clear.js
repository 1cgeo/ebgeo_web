// Path: js/store/map-position-clear.js

/**
 * @fileoverview The shape of a CLEARED map position, and the two sides that must agree on it.
 *
 * Clearing a saved position is an UPDATE with the five position columns empty, never a DELETE:
 * a `mapPosition` op carries the MAP's id as its `entityId` (`createMapSettingLogger`), the
 * server normalises the type to the target `map`, and a delete there is a delete OF THE MAP.
 * That is achado F1, measured on 2026-09-13, and the server now refuses the delete envelope by
 * name.
 *
 * The producer (`clearMapPosition`, `map.operations.js`) and the consumer
 * (`applyRemoteMapSettingOp`, `sync/remote-operation-handler.js`) live in different files and
 * would otherwise each carry their own literal list of the five fields, which is the closed-list
 * shape that goes stale one field at a time. They share this leaf instead.
 *
 * ZERO IMPORTS, deliberately: the remote handler and the map operations are on opposite sides of
 * the store, and a shared helper that imported either of them would close a cycle.
 */

/** The five columns a saved position occupies. Mirrors `MAP_SUBTYPE_FIELDS.position` (server). */
export const POSITION_FIELDS = ['center_lat', 'center_long', 'zoom', 'bearing', 'pitch'];

/**
 * The payload of a CLEARED position: every field explicitly null.
 *
 * Explicit nulls, not an empty object: the server's update path skips `undefined` and would
 * write nothing at all, acking a clear that never happened.
 *
 * @returns {Object<string, null>} A fresh payload (never shared, callers may mutate it).
 */
export function clearedPositionPayload() {
    const payload = {};
    for (const field of POSITION_FIELDS) payload[field] = null;
    return payload;
}

/**
 * Whether an inbound `mapPosition` update payload means "cleared".
 *
 * A null/absent payload is the OLD delete envelope, still possible from a peer on an older
 * build, and it means the same thing. A payload whose five fields are all null is the current
 * one. Anything with a number in it is a real position.
 *
 * @param {Object|null|undefined} data - The op's payload.
 * @returns {boolean} True when the peer must erase the saved position.
 */
export function isClearedPositionPayload(data) {
    if (!data || typeof data !== 'object') return true;
    return POSITION_FIELDS.every((field) => data[field] === null || data[field] === undefined);
}
