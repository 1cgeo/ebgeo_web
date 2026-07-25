// Path: src/modules/collab/collab.schemas.js
// Joi schemas for the EPHEMERAL presence frames (cursor / temporal / selection).
//
// Presence is in-memory awareness: it never reaches the sync/CRDT path or the database.
// It is NOT free, though — `handleCursor`/`handleTemporal`/`handleSelection` RETAIN the
// payload on the `ws` object, `getRoomUsers` (collab.rooms.js) reads it back, and
// `onConnection` (collab.gateway.js) re-serializes the whole roster into the `connected`
// frame of EVERY new join. Retaining the raw client value therefore made one idle socket
// able to hold up to the frame ceiling (10 MB) per slot and to tax every later join with
// that much JSON.stringify — reachable by a read-only public visitor, since cursor and
// temporal are deliberately ungated. These schemas normalize the frame BEFORE it is
// retained, so what a socket holds (and what a joiner pays for) is bounded.
//
// The bounds are sized from the payloads the real client actually emits
// (frontend/src/js/presence/presence-bridge.js + frontend/src/js/store/sync/ws-client.js),
// measured by serializing those exact shapes:
//   - cursor   `{ position: {lng,lat}|null, mapId }`               →  ~128 bytes
//   - temporal `{ state: {cursor,label,playing}, mapId }`          →  ~141 bytes
//   - selection `{ surface, featureIds[], featureMeta[], mapId }`  →  ~115 bytes per feature
// Scalars are TRUNCATED rather than rejected (a legitimate frame is never refused for a
// long name); only the unbounded axes — the selection arrays — are hard-capped.

import Joi from 'joi';

/**
 * Ceiling for the free-text scalars a presence frame carries: `mapId` (the frontend stamps
 * the map NAME via getCurrentMapNameSync), `tilesetId` and `photoName`. 255 is the app-wide
 * de-facto cap — `maps.name` is VARCHAR(255), so a longer name cannot survive sync anyway.
 */
export const MAX_PRESENCE_TEXT = 255;

/** Ceiling for a feature/marker id. Real ids are UUIDs (36) or short catalog ids. */
export const MAX_FEATURE_ID = 128;

/** Ceiling for a feature type tag. The longest real type is `coordination_measure` (20). */
export const MAX_FEATURE_TYPE = 64;

/**
 * Ceiling on the number of features one selection frame may carry (and thus retain).
 * Measured at ~115 bytes per feature on the wire (featureIds + featureMeta), so 5000 caps
 * a socket's retained selection at ~576 KB — below the 1 MiB the room already treats as
 * "too backed up to bother relaying presence to" (BACKPRESSURE_DROP_BYTES,
 * collab.rooms.js). It is also far above anything the client produces: the selection is
 * built from a rectangle-drag over the rendered viewport
 * (frontend/src/js/selection_tools/rectangle_selection_control.js), and the largest real
 * project shipped with the app holds 25 features in total.
 */
export const MAX_SELECTION_FEATURES = 5000;

/**
 * Byte ceiling on the retained temporal `state` blob. The frontend documents it as an
 * opaque blob and currently sends `{ cursor, label, playing }` (~60 bytes serialized), so
 * unknown keys are PRESERVED (a newer client must not have its awareness silently
 * stripped) but the whole blob is bounded.
 */
export const MAX_TEMPORAL_STATE_BYTES = 2048;

/**
 * Joi rule: the value must serialize to at most `maxBytes` of JSON.
 * @param {number} maxBytes
 * @returns {(value: *, helpers: Object) => *}
 */
function jsonSizeUnder(maxBytes) {
  return (value, helpers) => {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined && Buffer.byteLength(serialized) > maxBytes) {
      return helpers.error('any.invalid');
    }
    return value;
  };
}

/** Free-text scalar of a presence frame: bounded by truncation, never by rejection. */
const presenceText = Joi.string().max(MAX_PRESENCE_TEXT).truncate().allow(null, '');

/**
 * `cursor` frame. `position` is null on the map-switch frame (broadcastCurrentMap piggybacks
 * the active map on a positionless cursor), and lng is NOT range-checked: MapLibre does not
 * clamp longitude when panning past the antimeridian, so a real cursor legitimately reports
 * lng > 180.
 */
export const cursorPresenceSchema = Joi.object({
  position: Joi.object({
    lng: Joi.number().required(),
    lat: Joi.number().required(),
  })
    .allow(null)
    .default(null),
  mapId: presenceText,
});

/** `temporal` frame (caso E): opaque-but-bounded viewing state + active map. */
export const temporalPresenceSchema = Joi.object({
  state: Joi.object({
    cursor: Joi.number().allow(null),
    label: Joi.string().max(MAX_PRESENCE_TEXT).truncate().allow(null, ''),
    playing: Joi.boolean(),
  })
    .unknown(true)
    .custom(jsonSizeUnder(MAX_TEMPORAL_STATE_BYTES), 'temporal state size cap')
    .allow(null)
    .default(null)
    .messages({ 'any.invalid': `"state" exceeds ${MAX_TEMPORAL_STATE_BYTES} bytes` }),
  mapId: presenceText,
});

/** One `featureMeta` entry: the per-feature type a 2D peer uses to pick the highlight box. */
const featureMetaSchema = Joi.object({
  id: Joi.string().max(MAX_FEATURE_ID),
  type: Joi.string().max(MAX_FEATURE_TYPE).allow(null, ''),
});

/** `selection` frame (caso F) across the 2D / 3D / 360 surfaces. */
export const selectionPresenceSchema = Joi.object({
  surface: Joi.string().valid('2d', '3d', '360').default('2d'),
  featureIds: Joi.array()
    .items(Joi.string().max(MAX_FEATURE_ID))
    .max(MAX_SELECTION_FEATURES)
    .default([]),
  featureMeta: Joi.array().items(featureMetaSchema).max(MAX_SELECTION_FEATURES),
  mapId: presenceText,
  tilesetId: presenceText,
  photoName: presenceText,
});

/**
 * Validates a presence frame, dropping every key the contract does not define so that
 * nothing unbounded is retained on the socket.
 * @param {Joi.Schema} schema
 * @param {Object} data - Raw parsed frame.
 * @returns {{ error: (Joi.ValidationError|undefined), value: Object }}
 */
export function validatePresenceFrame(schema, data) {
  return schema.validate(data, { stripUnknown: true, convert: true, abortEarly: true });
}
