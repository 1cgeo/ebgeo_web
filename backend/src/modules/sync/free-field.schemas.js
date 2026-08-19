// Path: src/modules/sync/free-field.schemas.js
// THE WRITE BORDER FOR FREE-FORM JSONB. Nineteen columns of this schema are `jsonb` written by the
// client and republished to another principal; until F14 every one of them accepted an arbitrary
// object graph, which made each of them a republication channel by construction. This module is
// where an op's payload stops being "whatever the client sent" and becomes a shape.
//
// TWO REGIMES, AND THE CHOICE PER FIELD IS AN ARGUMENT, NOT A STYLE:
//
//   CLOSED   — the field has a shape measured in its WRITERS and every value KEPT in it is a JSON
//              scalar (or a list of scalars). Grid, temporal config, slide position/orientation,
//              briefing settings, layer/group style, comment payload, map notes/position/base
//              layer. A scalar cannot carry a definition, so closing these ends the question for
//              them instead of answering it. "Kept", not "written": ONE real writer puts an object
//              in a closed field, `updateMapPosition`'s `sync`, and this border drops it. That drop
//              was measured to be inert in storage, in reload and in readers before it was accepted
//              — the argument is on `SCALAR_PAYLOAD_ENTITIES` and the fact is pinned by
//              `tests/unit/borda-de-escrita-livre.test.js`. Any OTHER closed field that starts
//              losing a value is a bug, not a policy.
//   SCRUBBED — the field IS the product's domain and cannot be enumerated (feature properties and
//              geometry, 3D/360 data, atlas settings). Keys stay open; only an object shaped like
//              a catalog-resource definition is taken out, at any depth
//              (`resource-definition.scrub.js`).
//
// DISCARD, NEVER REJECT, and this is the decision the phase turns on. A 4xx on one op does not
// bounce one op: the frontend flush stops at the first failure and the outbound queue FREEZES,
// which this house has already paid for twice (`operationDenialReason` exists precisely so a
// refusal is per-op and never batch-fatal). A client running an older build that still writes a
// key we no longer accept must keep syncing everything else, so the unknown value is dropped in
// silence exactly as `stripUnknown` already drops unknown keys on every REST body. The failure
// direction is a field that quietly does not persist, never a client that can never sync again.
//
// WHAT IS NOT CLOSED HERE, stated as a ceiling rather than implied by omission:
//   - FREE TEXT. `slides.content` (Quill HTML), `maps.notes_title`/`notes_description`,
//     `atlas.description`, `features.properties.descricao`, `comments.data.text`. A URL typed into
//     any of them is republished, and no schema reaches it: the text IS the product.
//   - THE SCRUBBED REGIME ITSELF. Scrubbing removes the CANONICAL shape only (see the literal-key
//     ceiling in `catalog/resource-definition.scrub.js`), so it is defect CONTAINMENT against a
//     client that copies a definition by accident, not a barrier against a determined writer who
//     may already read the resource and renames the wrapper. Same ceiling as free text below.
//   - THE TOP-LEVEL `name`/`config` OF A CATALOG-LAYER ENTRY. They are contract (the hillshade
//     entry, and every pre-F11 document), asserted by `sync-catalog-layer.test.js` shape freeze
//     and by `frontend/tests/e2e/catalog-layer.e2e.test.js`. For an entry that CLAIMS a catalog
//     type the outbound prune removes them anyway; for an entry that claims none they are opaque
//     client state and travel. A principal who may already read a private resource can therefore
//     still copy its URL there. That is exfiltration by an entitled reader, which is an audit
//     matter, and it is the same ceiling as free text.
//   - `features.geometry`. Twenty-one GeoJSON types; closing it would silence a tool per release.
//   - `maps.analysis_layers`. It LOOKS closable (no frontend writer produces it) and it is not:
//     the contract tests freeze nested values in it, `{ los_result_123: { visible, data } }` and
//     `{ grid: { type, visible } }` (`sync-map-subentities.test.js`, `sync-frontend-format.test.js`),
//     which is the grid domain a legacy client writes through `gridStyle`. It is SCRUBBED, so a
//     definition cannot ride in it, and its own nesting survives. It also keeps a LOOP alive that
//     no border can drain: the snapshot returns it inside `...rest` and `renameMap` resends the
//     whole map document, so whatever a legacy row holds is rewritten on every rename. Emptying
//     that is a DROP COLUMN question, not a validation one.
//
// The rules are applied to `data`, `changes` and `previousData` alike: `buildUpdateQuery` merges
// the first two, `applyCatalogLayerOp` takes either, and the third is not stored but IS relayed to
// peers.

import Joi from 'joi';
import {
  scrubResourceDefinitions, carriesResourceDefinition,
} from '../catalog/resource-definition.scrub.js';
import { CATALOG_LAYER_DEFINITION_KEYS } from '../catalog/catalog-layer.ref.js';

/** Joi never coerces here: a border that rewrites `'5'` into `5` is a border that edits data. */
const NO_COERCION = { convert: false };

/** A JSON scalar. `null` included: an absent temporal bound is written as `null`, not omitted. */
const JSON_SCALAR = Joi.alternatives().try(
  Joi.string(), Joi.number(), Joi.boolean(), Joi.any().valid(null),
);

/** A scalar, or a flat list of them. */
const SCALAR_OR_LIST = Joi.alternatives().try(JSON_SCALAR, Joi.array().items(JSON_SCALAR));

/**
 * A style leaf: a scalar, or a MapLibre expression array of scalars and nested arrays. Never an
 * object, which is the only thing a definition could ever be.
 */
const LEAF_VALUE = Joi.alternatives().try(
  JSON_SCALAR,
  Joi.array().items(Joi.link('#leaf')),
).id('leaf');

/** @param {*} v @returns {boolean} Whether `v` is a non-array object. */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The CLOSED regime: an object whose own values must each satisfy `schema`. A value that does not
 * is dropped, not reported. See the header on discard-never-reject.
 *
 * @param {*} value
 * @param {import('joi').Schema} [schema=SCALAR_OR_LIST]
 * @returns {*} A new object with the surviving keys, or `value` unchanged when it is not an object.
 */
function keepMatching(value, schema = SCALAR_OR_LIST) {
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === '__proto__') continue;
    if (!schema.validate(v, NO_COERCION).error) out[key] = v;
  }
  return out;
}

/**
 * `styleOverrides` of a catalog layer: exactly two levels of object, and the leaf is a scalar or a
 * MapLibre expression ARRAY.
 *
 * Read off the only writer, `frontend/src/js/features_tab/layer-style-panel.component.js` with
 * `frontend/src/js/layers/layer-style/layer-style.schema.js`: sub-layer (`fill`/`border`/`label`/
 * `raster`) then paint property then value, where the value is either a colour/number or one of
 * the expressions `serializeCategorized`/`serializeGraduated` emit.
 *
 * NEITHER LEVEL IS KEY-CHECKED, on purpose: `frontend/tests/e2e/catalog-layer.e2e.test.js` freezes
 * a `line` sub-key that the style schema does not define, and the expression arrays embed raw
 * catalog config fragments this server has no vocabulary for. A SCALAR at level one is kept too,
 * because a stored document already has that shape (`{ alguma: 'coisa' }`,
 * `tests/integration/sync-catalog-layer-privado.test.js`). What IS checked is that no OBJECT ever
 * reaches a leaf, and no object survives below level two. That is the position the F13 review
 * planted its contraband in, and an object is the only thing a definition can be.
 *
 * @param {*} value
 * @returns {*}
 */
function styleOverrides(value) {
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [sub, props] of Object.entries(value)) {
    if (sub === '__proto__') continue;
    if (isPlainObject(props)) out[sub] = keepMatching(props, LEAF_VALUE);
    else if (!LEAF_VALUE.validate(props, NO_COERCION).error) out[sub] = props;
  }
  return out;
}

/**
 * One stored catalog-layer entry (`catalog_layers.data`, and each item of the legacy
 * `catalog_layers` array form).
 *
 * Keys stay OPEN and unknown values travel verbatim, because two contract tests exist to forbid an
 * allowlist here: `sourceId` and the pt-BR `nome` are client-invented keys the round-trip must
 * return (`sync-catalog-layer.test.js`, `atlas-catalog-layers-roundtrip.repro.test.js`). What
 * changes is that every value OTHER than the entry's own `name`/`config` is scrubbed, so a
 * definition can no longer ride inside `styleOverrides` or inside a key nobody has heard of.
 *
 * @param {*} entry
 * @returns {*}
 */
export function scrubCatalogLayerEntry(entry) {
  if (!isPlainObject(entry)) return entry;
  const out = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === '__proto__') continue;
    // The declared ceiling: see the header. An entry's OWN definition is contract.
    if (key === 'name' || key === 'config') out[key] = value;
    else if (key === 'styleOverrides') out[key] = styleOverrides(value);
    else out[key] = scrubResourceDefinitions(value);
  }
  return out;
}

/**
 * The catalog-layer payload, including the legacy whole-array form `applyCatalogLayerOp` accepts.
 * @param {*} payload
 * @returns {*}
 */
function catalogLayerPayload(payload) {
  if (!isPlainObject(payload)) return payload;
  if (Array.isArray(payload.catalog_layers)) {
    return {
      ...scrubCatalogLayerEntry(payload),
      catalog_layers: payload.catalog_layers.map(scrubCatalogLayerEntry),
    };
  }
  return scrubCatalogLayerEntry(payload);
}

/**
 * The keys under which a list of STORED CATALOG-LAYER ENTRIES can appear inside another entity's
 * payload. Renaming a map resends the whole map document, `catalogLayers` included, so an entry
 * reaches this border stamped `map` as often as stamped `catalogLayer`. It is the same entry
 * either way, and it gets the same rule either way, which is the only way the ceiling written for
 * `scrubCatalogLayerEntry` stays true no matter which envelope carried it.
 */
const CATALOG_LAYER_LIST_KEYS = new Set(['catalogLayers', 'catalog_layers']);

/**
 * The default rule for a payload value: an entry list keeps the catalog-layer contract, everything
 * else is scrubbed.
 * @param {string} key
 * @param {*} value
 * @returns {*}
 */
function scrubValue(key, value) {
  if (CATALOG_LAYER_LIST_KEYS.has(key) && Array.isArray(value)) {
    return value.map(scrubCatalogLayerEntry);
  }
  return scrubResourceDefinitions(value);
}

/**
 * Entity types whose WHOLE payload is scalar state. Each was read off its writer: notes
 * `{title, description}`, base layer `{baseLayer}`, and comment `{id, parentId, lng, lat, text,
 * status, authorId, authorInitials, authorColor, createdAt, updatedAt}` (`comment.operations.js`;
 * `text` is free text, the ceiling).
 *
 * `mapPosition` IS NOT ALL SCALAR, and saying otherwise would be the same shape of false comment
 * this phase was opened to delete. `updateMapPosition` (`map.operations.js`) writes
 * `{id, center_lat, center_long, zoom, bearing, pitch, savedAt, sync}`, and that last key is an
 * OBJECT (`createSyncMetadata`: createdAt/updatedAt/version/ownerId/dirty/deleted/deletedAt).
 * This border DROPS it. Measured, that drop is inert in both directions:
 *   - STORAGE never saw it. `MAP_SUBTYPE_FIELDS.position` is five scalar columns
 *     (center_lat/center_long/zoom/bearing/pitch); `id`, `savedAt` and `sync` were discarded by
 *     the column whitelist long before F14.
 *   - RELOAD never returned it. `GET_ATLAS_MAPS` selects those same flat columns and no
 *     `savedPosition` object, so after any reload BOTH peers already had a position without
 *     `sync`. Dropping it on the live relay makes the live path agree with the reload path.
 *   - NOTHING READS IT. `savedPosition.sync` has zero readers in `frontend/src/`; the only
 *     consumer of `savedPosition` is `applyRemoteMapSettingOp`, which copies the five scalars.
 * So the peer's next local `updateMapPosition` mints fresh metadata instead of touching inherited
 * metadata, on a sub-document whose version no server column records. If a reader for it ever
 * appears, `mapPosition` must move out of this set and get a field rule, like grid and temporal.
 *
 * `gridStyle` and `mapTemporal` are NOT here, and the omission is measured rather than an
 * oversight: their ops legitimately carry `analysis_layers` with objects inside
 * (`sync-frontend-format.test.js` pushes `{ analysis_layers: { grid: { type, visible } } }`), so
 * closing their whole payload would silence the legacy grid path. They get field rules instead.
 */
const SCALAR_PAYLOAD_ENTITIES = new Set([
  'mapPosition', 'mapNotes', 'baseLayer', 'comment',
]);

/**
 * Per-entity rules for the object-valued fields inside an otherwise ordinary payload. The column
 * names are the ones `sync.service.js` reads (`MAP_UPDATE_FIELDS`, `UPDATE_FIELDS`); the camelCase
 * twins are accepted for the same reason `normalizeMapChanges` accepts them.
 */
const GRID_AND_TEMPORAL = {
  grid_style: keepMatching,
  gridStyle: keepMatching,
  temporal_config: keepMatching,
  temporalConfig: keepMatching,
};

const FIELD_RULES = {
  map: GRID_AND_TEMPORAL,
  // A `gridStyle`/`mapTemporal` op carries its column at the top level, and a legacy one carries
  // the grid through `analysis_layers` instead, which is why neither is closed as a whole payload:
  // `analysis_layers` is the one map column whose contract has nested values in it. See the header.
  gridStyle: GRID_AND_TEMPORAL,
  mapTemporal: GRID_AND_TEMPORAL,
  layer: { style: keepMatching },
  group: { style: keepMatching },
  briefing: { settings: keepMatching },
  slide: { position: keepMatching, orientation: keepMatching },
};

/**
 * The payload a client may store for this entity type.
 *
 * @param {*} entityType - `entityType` or the legacy `target` of the operation.
 * @param {*} payload - `data`, `changes` or `previousData`.
 * @returns {*} The payload to store and to relay.
 */
export function scrubEntityPayload(entityType, payload) {
  if (payload === null || payload === undefined) return payload;
  if (entityType === 'catalogLayer' || entityType === 'catalog_layer') {
    return catalogLayerPayload(payload);
  }
  if (SCALAR_PAYLOAD_ENTITIES.has(entityType)) return keepMatching(payload);

  if (!isPlainObject(payload)) return scrubResourceDefinitions(payload);

  const rules = FIELD_RULES[entityType] || {};
  // The ROOT is judged too. No entity but `catalogLayer` has a legitimate `name`+`config` pair at
  // the top of its payload (maps, slides, briefings, layers and groups have no `config` column at
  // all), and without this the payload's own top level would be the one position the walk never
  // looked at — which is the class of hole this phase exists to close, one level up.
  const definition = carriesResourceDefinition(payload) ? CATALOG_LAYER_DEFINITION_KEYS : null;
  // Identity when nothing was taken. This runs on EVERY operation, and the overwhelming majority
  // (feature geometry, above all) have nothing in them to take.
  let changed = false;
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === '__proto__' || (definition && definition.includes(key))) { changed = true; continue; }
    const kept = rules[key] ? rules[key](value) : scrubValue(key, value);
    if (kept !== value) changed = true;
    out[key] = kept;
  }
  return changed ? out : payload;
}

// ---------------------------------------------------------------------------------------------
// THE SAME TWO REGIMES, AS JOI SCHEMAS, for the OTHER write border.
//
// `POST /atlas/import` is one of the three deliberate REST exceptions to "incremental writes are
// sync only", and it writes EVERY column listed above in one request. Tightening only the sync
// door would have left a second one wide open, in the same commit that claimed the class was
// closed, which is the shape of every finding this line of phases has produced so far.
// ---------------------------------------------------------------------------------------------

/** An object whose values are scalars or flat lists of them; anything else is dropped. */
export const scalarObjectSchema = Joi.object().custom((value) => keepMatching(value));

/** An open object with catalog-resource definitions taken out at any depth. */
export const scrubbedObjectSchema = Joi.object().custom((value) => scrubResourceDefinitions(value));

/** One stored catalog-layer entry. Keys stay open; see `scrubCatalogLayerEntry`. */
export const catalogLayerEntrySchema = Joi.object().custom((value) => scrubCatalogLayerEntry(value));

/** The three payload carriers of an operation envelope. */
const PAYLOAD_KEYS = ['data', 'changes', 'previousData'];

/**
 * Joi `custom` for the operation envelope: applies the rules above to each payload carrier.
 * Placed on the WHOLE operation because the rule depends on `entityType`, which is a sibling of
 * the payload and therefore out of reach from a per-key rule.
 *
 * @param {Object} op
 * @returns {Object} The operation with its payloads scrubbed, by identity when nothing changed.
 */
export function scrubOperationPayloads(op) {
  const entityType = op.entityType || op.target;
  let changed = false;
  const out = { ...op };
  for (const key of PAYLOAD_KEYS) {
    if (!Object.hasOwn(op, key)) continue;
    const scrubbed = scrubEntityPayload(entityType, op[key]);
    if (scrubbed !== op[key]) changed = true;
    out[key] = scrubbed;
  }
  return changed ? out : op;
}
