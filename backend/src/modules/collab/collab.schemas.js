// Path: src/modules/collab/collab.schemas.js
// Joi schemas for the EPHEMERAL presence frames (cursor / selection).
//
// Presence is in-memory awareness: it never reaches the sync/CRDT path or the database.
// It is NOT free, though — `handleCursor`/`handleSelection` RETAIN the
// payload on the `ws` object, `getRoomUsers` (collab.rooms.js) reads it back, and
// `onConnection` (collab.gateway.js) re-serializes the whole roster into the `connected`
// frame of EVERY new join. Retaining the raw client value therefore made one idle socket
// able to hold up to the frame ceiling (10 MB) per slot and to tax every later join with
// that much JSON.stringify — reachable by a read-only public visitor, since the cursor
// is deliberately ungated. These schemas normalize the frame BEFORE it is
// retained, so what a socket holds (and what a joiner pays for) is bounded.
//
// HOUVE UM TERCEIRO SCHEMA AQUI, o do quadro da linha do tempo, e ele saiu em 2026-09-21 com o
// quadro inteiro, por decisão do dono: o instante de uma pessoa não se propaga. Não o reponha
// para "validar o que um cliente antigo manda" — quadro sem tratador nem retenção não precisa de
// régua, e ter a régua de volta é o primeiro passo para alguém religar o resto.
//
// The bounds are sized from the payloads the real client actually emits
// (frontend/src/js/presence/presence-bridge.js + frontend/src/js/store/sync/ws-client.js),
// measured by serializing those exact shapes:
//   - cursor   `{ position: {lng,lat}|null, mapId }`               →  ~128 bytes
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

/** Free-text scalar of a presence frame: bounded by truncation, never by rejection. */
const presenceText = Joi.string().max(MAX_PRESENCE_TEXT).truncate().allow(null, '');

/** `cursor` position on the 2D map: geographic, and the shape every client spoke before 2026-09-16. */
const cursor2dPosition = Joi.object({
  lng: Joi.number().required(),
  lat: Joi.number().required(),
});

/**
 * `cursor` position inside a panorama: where the peer is POINTING on the sphere, never a pixel.
 * Screen coordinates would land somewhere else on every peer, because each one looks from its own
 * yaw/pitch/FOV. `heading` is in DEGREES and `pitch` in RADIANS, which is the asymmetry that
 * `screenToSpherical` (frontend/src/js/street_view_tool/navigation/projector.js) already returns
 * and that the stored 360 marker already carries; converting here would put two conventions in the
 * codebase for the same pair.
 */
const cursor360Position = Joi.object({
  heading: Joi.number().required(),
  pitch: Joi.number().required(),
});

/**
 * `cursor` position inside the 3D scene: geographic plus height, resolved by the sender's pick
 * against the tileset/terrain. It is NOT the camera and NOT a pixel, for the same reason as the
 * 360: the peer renders it from its own viewpoint.
 */
const cursor3dPosition = Joi.object({
  lng: Joi.number().required(),
  lat: Joi.number().required(),
  alt: Joi.number().required(),
});

/**
 * `cursor` frame. `position` is null on the map-switch frame (broadcastCurrentMap piggybacks
 * the active map on a positionless cursor), and lng is NOT range-checked: MapLibre does not
 * clamp longitude when panning past the antimeridian, so a real cursor legitimately reports
 * lng > 180.
 *
 * SUPERFICIE, DESDE 2026-09-16, E A FORMA DA POSICAO DEPENDE DELA. O cursor passou a existir nas
 * tres superficies imersivas, como a `selection` ja existia, e carrega a mesma chave de escopo:
 * `mapId` no 2D, `tilesetId` no 3D, `photoName` no 360. Sem isso um cursor do 360 chegaria ao par
 * como cursor de mapa e seria desenhado numa coordenada que nao significa nada ali.
 *
 * A POSICAO E VALIDADA POR SUPERFICIE, e nao afrouxada para caber nas tres. Declarar um objeto
 * permissivo com cinco campos opcionais aceitaria calado um cursor 2D sem `lng`, que e exatamente
 * o que a regua existe para pegar; `Joi.when` mantem cada superficie com a regua dela.
 *
 * E o que nao esta declarado aqui e APAGADO, nao recusado (`stripUnknown` em
 * `validatePresenceFrame`): um campo novo que o emissor mande sem passar por este schema chega ao
 * par sem ele, sem erro nenhum em lugar nenhum.
 */
export const cursorPresenceSchema = Joi.object({
  surface: Joi.string().valid('2d', '3d', '360', 'fp').default('2d'),
  position: Joi.when('surface', {
    switch: [
      { is: 'fp', then: Joi.object({ x: Joi.number().required(), y: Joi.number().required(), z: Joi.number().required() }).allow(null).default(null) },
      { is: '360', then: cursor360Position.allow(null).default(null) },
      { is: '3d', then: cursor3dPosition.allow(null).default(null) },
    ],
    otherwise: cursor2dPosition.allow(null).default(null),
  }),
  mapId: presenceText,
  tilesetId: presenceText,
  photoName: presenceText,
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
