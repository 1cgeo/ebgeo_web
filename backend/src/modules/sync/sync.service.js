// Path: src/modules/sync/sync.service.js
import { query, tx, task } from '../../database/index.js';
import { ForbiddenError, ServiceUnavailableError } from '../../utils/errors.js';
import * as Q from './sync.queries.js';
import { recordSpan, isTraceEnabled, TraceStage, TraceOutcome } from '../../utils/sync-trace.js';
import logger from '../../utils/logger.js';
import { PERMISSION_LEVELS } from '../../middleware/permissions.js';

/**
 * Whitelisted `setting` op keys whose value is a KEYED OBJECT that must be
 * deep-merged (one level) into its own sub-object inside atlas.settings, so a
 * per-map write accumulates instead of clobbering sibling maps:
 *  - mapBadgeColors: { [mapName]: color }     (datamodel-13)
 *  - colorUsage:     { [mapName]: { color: count } }  (datamodel-13)
 * Plain/scalar keys (terrainExaggeration) and list keys (customIcons) are
 * replaced wholesale via the top-level shallow merge instead.
 */
const SETTING_OBJECT_KEYS = ['mapBadgeColors', 'colorUsage'];

/**
 * Maps frontend-specific entity types to backend generic types.
 * Frontend uses specific types like 'marker3d', 'measurement3d', etc.
 * Backend uses generic 'cesium3d' and 'streetview360' with data_type field.
 */
const ENTITY_TYPE_MAP = {
  marker3d: { target: 'cesium3d', dataType: 'marker' },
  measurement3d: { target: 'cesium3d', dataType: 'measurement' },
  viewshed3d: { target: 'cesium3d', dataType: 'viewshed' },
  cameraPosition3d: { target: 'cesium3d', dataType: 'camera_position' },
  orientation360: { target: 'streetview360', dataType: 'orientation' },
  marker360: { target: 'streetview360', dataType: 'marker' },
  mapPosition: { target: 'map', subType: 'position' },
  baseLayer: { target: 'map', subType: 'baseLayer' },
  mapNotes: { target: 'map', subType: 'notes' },
  gridStyle: { target: 'map', subType: 'grid' },
  mapTemporal: { target: 'map', subType: 'temporal' },
  // catalogLayer is now its own entity (per-layer). The handler also accepts the
  // legacy whole-array form (data.catalog_layers) and writes maps.catalog_layers.
  catalogLayer: { target: 'catalog_layer' },
};

/**
 * Reverse map: converts backend data_type back to frontend entity type.
 */
const REVERSE_ENTITY_TYPE_MAP = {
  cesium3d: {
    marker: 'marker3d',
    measurement: 'measurement3d',
    viewshed: 'viewshed3d',
    camera_position: 'cameraPosition3d',
  },
  streetview360: {
    orientation: 'orientation360',
    marker: 'marker360',
  },
};

/**
 * Builds a sync metadata object from a database row.
 * Centralizes the repeated pattern of creating sync objects for snapshot responses.
 */
function buildSyncMetadata(row, ownerId = null) {
  return {
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    version: row.version,
    ownerId,
    dirty: false,
    deleted: false,
  };
}

/**
 * Builds a dynamic UPDATE query from a field specification and changes object.
 * Eliminates the repeated pattern of building SET clauses field by field.
 *
 * @param {string} table - Table name
 * @param {Object} changes - Changes object from the operation
 * @param {Array<{column: string, source?: string, jsonb?: boolean}>} fields - Field specs
 * @param {Array} whereValues - Values for WHERE clause (placed before SET values)
 * @param {string} whereClause - WHERE clause (e.g. "id = $1 AND map_id = $2")
 * @returns {{ sql: string, values: Array } | null} - Query object or null if no changes
 */
function buildDynamicUpdate(table, changes, fields, whereValues, whereClause) {
  const setClauses = [];
  const values = [...whereValues];
  let paramIndex = whereValues.length + 1;

  for (const field of fields) {
    const sourceKey = field.source ?? field.column;
    if (changes[sourceKey] === undefined) continue;

    const value = field.jsonb
      ? JSON.stringify(changes[sourceKey])
      : changes[sourceKey];

    const cast = field.cast || (field.jsonb ? '::jsonb' : '');
    setClauses.push(`${field.column} = $${paramIndex}${cast}`);
    values.push(value);
    paramIndex++;
  }

  if (setClauses.length === 0) return null;

  setClauses.push('updated_at = NOW()', 'version = version + 1');
  return {
    sql: `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${whereClause}`,
    values,
  };
}

// Meta keys that live as their OWN columns and are NOT part of the cesium3d/
// streetview360 JSONB `data` payload. Everything else on a flat entity is `data`.
const ENTITY_3D360_META = ['id', 'sync', 'data_type', 'tilesetId', 'tileset_id', 'photoName', 'photo_name', 'data'];

/**
 * Reshapes a cesium3d/streetview360 payload into the backend envelope
 * `{ data_type, tileset_id|photo_name, data: {...rest} }`.
 *
 * Accepts BOTH shapes (frozen-contract tolerance):
 *  - FLAT (what the real frontend emits): `{ id, tilesetId|photoName, position,
 *    properties, style, sync, ... }` — camelCase, fields at the top level.
 *  - NESTED (legacy/tests): `{ data_type, tileset_id, data: {...} }` — passes through.
 * The snapshot OUT transform spreads `...item.data`, so the inner object must hold
 * everything except the id/tileset_id/photo_name/sync meta (round-trip symmetric).
 */
function reshape3d360Payload(rawData, mapping) {
  if (!rawData || typeof rawData !== 'object') {
    return { data_type: mapping.dataType };
  }
  const isNested = rawData.data && typeof rawData.data === 'object' && !Array.isArray(rawData.data);
  const inner = isNested
    ? rawData.data
    : Object.fromEntries(Object.entries(rawData).filter(([k]) => !ENTITY_3D360_META.includes(k)));

  const out = { data_type: rawData.data_type || mapping.dataType, data: inner };
  if (mapping.target === 'cesium3d') {
    const tid = rawData.tileset_id ?? rawData.tilesetId;
    if (tid !== undefined) out.tileset_id = tid;
  } else if (mapping.target === 'streetview360') {
    const pn = rawData.photo_name ?? rawData.photoName;
    if (pn !== undefined) out.photo_name = pn;
  }
  return out;
}

/**
 * Builds the payload that goes into the operations LOG for a cesium3d/streetview360 op:
 * the FLAT camelCase entity the frontend speaks, tagged with `data_type`.
 *
 * Why the log and the entity table disagree on shape. The two delivery paths of ONE operation
 * used to hand a peer two different payloads:
 *  - live broadcast echoes the client's op verbatim (flat camelCase);
 *  - incremental pull / `sync_request` replay echoed `operations.data`, which held the backend
 *    envelope `{ data_type, tileset_id, data:{…} }` because `normalizeOperation` reshaped the
 *    payload BEFORE the insert.
 * The peer only speaks flat (remote-operation-handler.js gates on `data.tilesetId` /
 * `data.photoName` and matches array entities by `data.id`), so the replayed op was either
 * dropped or stored as an unmatchable, unrenderable item.
 *
 * The envelope stays the write shape for the ENTITY tables (their columns are data_type /
 * tileset_id / photo_name / data, and the snapshot transform spreads `item.data`). The LOG keeps
 * the client's payload instead, which is the only value that round-trips EXACTLY to what the
 * broadcast delivered — including `sync`, which `reshape3d360Payload` strips and which is
 * load-bearing on the client: every 3D/360 read path filters by `isActive(item.sync)`, and
 * `isActive(undefined)` is falsy, so an entity delivered without it is invisible.
 *
 * `data_type` rides along because the log has no column for it and `toFrontendOperation` needs it
 * to map `cesium3d`/`streetview360` back to the specific frontend entity type. It is stripped again
 * on the way out.
 *
 * @param {Object|null} rawData - Payload as sent by the client (flat, or the nested legacy form).
 * @param {{target: string, dataType: string}} mapping - ENTITY_TYPE_MAP entry.
 * @returns {Object} Flat payload + `data_type`.
 */
function flatten3d360Payload(rawData, mapping) {
  const keyName = mapping.target === 'cesium3d' ? 'tilesetId' : 'photoName';
  if (!rawData || typeof rawData !== 'object') {
    return { data_type: mapping.dataType };
  }

  const isNested = rawData.data && typeof rawData.data === 'object' && !Array.isArray(rawData.data);
  let flat;
  if (isNested) {
    flat = { ...rawData.data };
    if (rawData.id !== undefined) flat.id = rawData.id;
    const key = mapping.target === 'cesium3d'
      ? (rawData.tileset_id ?? rawData.tilesetId)
      : (rawData.photo_name ?? rawData.photoName);
    if (key !== undefined) flat[keyName] = key;
    if (rawData.sync !== undefined) flat.sync = rawData.sync;
  } else {
    flat = { ...rawData };
    // A flat payload may still spell the key snake_case (older clients / tests): normalize to
    // the camelCase the frontend reads, so both dialects replay identically.
    const snakeKey = mapping.target === 'cesium3d' ? 'tileset_id' : 'photo_name';
    if (flat[snakeKey] !== undefined) {
      if (flat[keyName] === undefined) flat[keyName] = flat[snakeKey];
      delete flat[snakeKey];
    }
  }

  flat.data_type = rawData.data_type || mapping.dataType;
  return flat;
}

/**
 * Inverse of {@link flatten3d360Payload}: turns a stored log payload back into the flat entity the
 * frontend applies. Handles both shapes:
 *  - FLAT + `data_type` (written since the fix) — strip the discriminator and echo it;
 *  - the NESTED backend envelope (rows written before it, which the log keeps for up to
 *    `cleanupOldOperations`'s retention) — hoist `data`, restore the camelCase key, and rebuild
 *    the `id`/`sync` that the reshape had discarded, exactly as the snapshot does.
 *
 * @param {Object|null} payload - `operations.data` / `operations.changes` as stored.
 * @param {Object} row - The operations row (for `entity_id` / `client_timestamp`).
 * @returns {Object|null} Flat payload, or null when the op carries none (delete).
 */
function unflatten3d360LogPayload(payload, row) {
  if (!payload || typeof payload !== 'object') return payload ?? null;

  let flat;
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    flat = { ...payload.data };
    if (payload.tileset_id !== undefined) flat.tilesetId = payload.tileset_id;
    if (payload.photo_name !== undefined) flat.photoName = payload.photo_name;
  } else {
    flat = { ...payload };
  }
  delete flat.data_type;

  // A delete carries no entity payload; the live broadcast delivers `data: null`, so does this.
  if (Object.keys(flat).length === 0) return null;

  if (flat.id === undefined) flat.id = row.entity_id;
  if (flat.sync === undefined) {
    // Same shape as buildSyncMetadata (the snapshot's), timestamped from the op itself. Only ever
    // used for legacy rows, whose client `sync` was dropped at write time: without one, the peer's
    // `isActive()` filter hides the entity everywhere.
    const ts = parseInt(row.client_timestamp, 10);
    const at = Number.isFinite(ts) ? ts : new Date(row.created_at).getTime();
    flat.sync = { createdAt: at, updatedAt: at, version: 1, ownerId: null, dirty: false, deleted: false };
  }
  return flat;
}

/**
 * The frontend stores a feature as a GeoJSON Feature whose TYPE lives in
 * `properties.source` and whose layer lives in `properties.layerId`. The backend
 * persists `feature_type`/`layer_id` as columns. Derive the flat columns from the
 * properties when the top-level fields are absent (so the raw GeoJSON `data` works).
 */
const FEATURE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Namespace for the per-atlas advisory lock taken by pushOperations (P2). The
// two-argument form of pg_advisory_xact_lock keys locks by (namespace, key), so
// this constant keeps sync's lock space from colliding with any other advisory
// lock the app may take later. Value is ASCII 'SYNC' read as int32.
const SYNC_PUSH_LOCK_NAMESPACE = 0x53594e43;

function deriveFeatureColumns(rawData) {
  if (!rawData || typeof rawData !== 'object' || !rawData.properties || typeof rawData.properties !== 'object') {
    return rawData;
  }
  const props = rawData.properties;
  const patch = {};
  if (rawData.feature_type === undefined && props.source !== undefined) patch.feature_type = props.source;

  // features.layer_id is a UUID FK. The frontend's implicit "default" layer (and any
  // non-UUID sentinel) is not a real layer row, so a value like 'default' would fail
  // the UUID cast (22P02) and reject the whole push. Coerce a non-UUID layer id to
  // null (= "no layer"); the original layerId stays verbatim inside the properties
  // JSONB, so the round-trip back to the client is unchanged.
  const rawLayer = rawData.layer_id !== undefined ? rawData.layer_id : props.layerId;
  if (rawLayer !== undefined) {
    patch.layer_id = (typeof rawLayer === 'string' && FEATURE_UUID_RE.test(rawLayer)) ? rawLayer : null;
  }

  return Object.keys(patch).length ? { ...rawData, ...patch } : rawData;
}

/**
 * Reconciles the slide payload the real client emits with the columns the server stores.
 *
 * The client builds a slide with `createEmptySlide()` (camelCase: `mapId`, `modelId`,
 * `photoId`, `temporalCursor`) and logs it with the PARENT BRIEFING id in the envelope's
 * `mapId` slot — `logOperation(SLIDE, CREATE, slide.id, briefingId, slide)` — so the
 * payload never carries a `briefing_id` at all. Without this normalization the insert's
 * `WHERE EXISTS (... briefings WHERE id = $2 ...)` matched nothing: zero rows written and
 * the op still acked as SUCCESS, so the slide lived on the client and never existed on the
 * server. Live peers hid it, because the parent briefing op relays the whole slides array
 * over the WS; the loss only surfaced after a reload rebuilt the briefing from the empty
 * slides table.
 *
 * Server dialect wins wherever both are present, so the 20+ suites that speak snake_case
 * (and any queued op already in that shape) are untouched. Same tolerance the layer insert
 * applies with `data.sort_order ?? data.order`.
 *
 * Runs for create AND update: `normalizeOperation` falls `changes` back to `data`, so an
 * un-normalized update would silently drop every camelCase-only field. `briefing_id` is
 * harmless in an update payload since `UPDATE_FIELDS.slide` does not list it.
 *
 * @param {Object} rawData - Slide payload as sent by the client
 * @param {string|null} envelopeMapId - `op.mapId`, which for a slide op carries the briefing id
 */
function normalizeSlidePayload(rawData, envelopeMapId) {
  if (!rawData || typeof rawData !== 'object') return rawData;

  const patch = {};
  const fill = (snake, camel) => {
    if (rawData[snake] === undefined && rawData[camel] !== undefined) patch[snake] = rawData[camel];
  };

  fill('map_id', 'mapId');
  fill('model_id', 'modelId');
  fill('photo_id', 'photoId');
  fill('temporal_cursor', 'temporalCursor');

  // `slides.map_id` is `UUID REFERENCES maps(id)`, but the frontend's `slide.mapId`
  // holds the map's DISPLAY NAME, not its id (briefing-editor.control.js sets it from
  // getCurrentMapNameSync(), from mapNames[0], and from an <option value=name>).
  //
  // Feeding a name to a UUID column raises 22P02, which aborts the transaction around
  // the ENTIRE push batch. The client only re-queues on a non-2xx, so it would replay
  // the poisoned batch forever — that user's sync stops permanently and silently, and
  // the editor sets the field by itself, with autosave, so no deliberate action is
  // needed to trigger it.
  //
  // Dropping an unusable value to null loses the slide↔map association, which is
  // exactly the behaviour that existed before slides persisted at all, and is the same
  // guard applied to comment authorId (asUuidOrNull) and feature layer_id
  // (FEATURE_UUID_RE). Carrying the real UUID is a client-side change; until then,
  // losing an association beats freezing a user's sync.
  // A non-UUID value is the map's NAME. It is moved aside rather than discarded, so
  // the apply path can resolve it against this atlas's maps (see resolveSlideMapId).
  // Resolution cannot happen here: this function is synchronous and has no database.
  const mapIdValue = patch.map_id !== undefined ? patch.map_id : rawData.map_id;
  if (mapIdValue !== undefined && mapIdValue !== null
      && !(typeof mapIdValue === 'string' && FEATURE_UUID_RE.test(mapIdValue))) {
    patch.map_id = null;
    if (typeof mapIdValue === 'string' && mapIdValue.trim() !== '') {
      patch._mapName = mapIdValue;
    }
  }

  if (rawData.briefing_id === undefined) {
    const parent = rawData.briefingId ?? envelopeMapId ?? undefined;
    if (parent !== undefined) patch.briefing_id = parent;
  }

  return Object.keys(patch).length ? { ...rawData, ...patch } : rawData;
}

/**
 * Derives `briefings.slide_order` from the slides array the client actually sends.
 *
 * The server treats `slide_order` (uuid[]) as the canonical ordering — the snapshot
 * reports each slide's `order` as `slide_order.indexOf(slide.id)`. The client has no
 * such concept: `slide_order` appears nowhere in the frontend, which instead keeps an
 * `order` integer on each slide inside the briefing's `slides` array. So the column was
 * always written empty and every slide round-tripped with order -1, leaving a briefing's
 * slides in arbitrary sequence after any reload.
 *
 * Deriving it here keeps ONE canonical representation on the server instead of teaching
 * the client a second one, and repairs briefings whose ops are already queued.
 *
 * Ids are filtered to UUIDs: `slide_order` is cast `::uuid[]`, and a single malformed id
 * would raise 22P02 and reject the ENTIRE push batch, not just this op.
 *
 * @param {Object} rawData - Briefing payload as sent by the client
 */
/**
 * Resolves a slide's map reference, which the two packages spell differently.
 *
 * The frontend's `slide.mapId` is the map's DISPLAY NAME (briefing-editor.control.js
 * fills it from getCurrentMapNameSync(), from mapNames[0], and from an
 * `<option value=name>`), while `slides.map_id` is `UUID REFERENCES maps(id)`. The two
 * never met: the association simply never round-tripped, and feeding the name straight
 * into the column poisons the whole push batch with a 22P02.
 *
 * The server is the only place that holds both, so it translates. On the way in, a
 * name becomes the UUID of the same-named map IN THIS ATLAS; on the way out,
 * getAtlasSnapshot maps the UUID back to the name.
 *
 * AMBIGUITY, stated rather than hidden: map names are not unique per atlas (no
 * constraint), so two maps can share one. The tie-break is the oldest, which is
 * deterministic and stable across replays — and the client is already ambiguous in
 * exactly the same way, since its whole model selects maps by name.
 *
 * An unresolvable name yields null: the association is lost, which is precisely the
 * behaviour that existed before slides persisted at all, and is infinitely preferable
 * to freezing that user's sync forever.
 *
 * @param {Object} t - Transaction context
 * @param {string} atlasId
 * @param {Object} data - Normalized slide payload (may carry the `_mapName` hint)
 * @returns {Promise<string|null>} The map UUID, or null.
 */
async function resolveSlideMapId(t, atlasId, data) {
  if (data.map_id) return data.map_id;
  if (!data._mapName) return null;

  const row = await t.oneOrNone(
    `SELECT id FROM maps
     WHERE atlas_id = $1 AND name = $2 AND deleted_at IS NULL
     ORDER BY created_at ASC
     LIMIT 1`,
    [atlasId, data._mapName]
  );
  return row ? row.id : null;
}

function normalizeBriefingPayload(rawData) {
  if (!rawData || typeof rawData !== 'object') return rawData;
  if (rawData.slide_order !== undefined || !Array.isArray(rawData.slides)) return rawData;

  const slide_order = rawData.slides
    .filter((s) => s && typeof s.id === 'string' && FEATURE_UUID_RE.test(s.id))
    // `order` is the client's ordering field; fall back to array position when absent
    // so a payload without it keeps the sequence it arrived in rather than collapsing.
    .map((s, i) => ({ id: s.id, order: Number.isFinite(s.order) ? s.order : i }))
    .sort((a, b) => a.order - b.order)
    .map((s) => s.id);

  return { ...rawData, slide_order };
}

/**
 * Normalizes operation field names from frontend format to internal format.
 * Frontend uses: entityType, operationType, entityId
 * Internal uses: target, type, targetId (for DB compatibility)
 * This function accepts BOTH formats for compatibility.
 * Also maps specific 3D/360 entity types to generic backend types and reconciles
 * the payload shapes the real frontend emits (flat 3D/360 entity, GeoJSON feature,
 * and update payload carried in `data` instead of `changes`).
 */
function normalizeOperation(op) {
  // Get raw entity type from frontend or backend format
  const rawEntityType = op.entityType || op.target;
  const mapping = ENTITY_TYPE_MAP[rawEntityType];
  const type = op.operationType || op.type;

  // If it's a mapped type (like marker3d), convert to generic type and reshape data
  let target = rawEntityType;
  let data = op.data;
  let subType = null;
  // Payload recorded in the operations LOG when it must differ from the one written to the
  // entity tables (3D/360 only — see flatten3d360Payload). Null means "log `data`/`changes`".
  let logData = null;
  let logChanges = null;

  if (mapping) {
    target = mapping.target;
    subType = mapping.subType || null;

    // cesium3d/streetview360: reshape FLAT/nested entity into the backend envelope.
    if (mapping.dataType) {
      logData = flatten3d360Payload(data, mapping);
      data = reshape3d360Payload(data, mapping);
    }
  } else if (rawEntityType === 'feature') {
    // Feature ops carry a raw GeoJSON Feature; derive the flat type/layer columns.
    data = deriveFeatureColumns(data);
  } else if (rawEntityType === 'slide') {
    // Slide ops arrive camelCase with the parent briefing id in the envelope's mapId slot.
    data = normalizeSlidePayload(data, op.mapId);
  } else if (rawEntityType === 'briefing') {
    // Briefing ops carry a slides array but no slide_order, which is what the server orders by.
    data = normalizeBriefingPayload(data);
  }

  // The frontend's shared create/update factory ALWAYS puts the payload in `data`
  // (it never produces a `changes` key). For updates, fall back to `data` so the
  // update apply path (which reads `changes`) is not a silent no-op / data loss.
  let changes = op.changes;
  if (type === 'update' && (changes === undefined || changes === null) && data != null) {
    changes = data;
    // The update payload came from `data`, so the log must record the same flat form for it.
    logChanges = logData;
  }

  return {
    ...op,
    // Use normalized target (mapped if needed)
    target,
    type,
    targetId: op.entityId || op.targetId,
    data,
    changes,
    // What the operations LOG stores (see flatten3d360Payload); null = same as data/changes.
    _logData: logData,
    _logChanges: logChanges,
    // Sub-type for map field updates (mapPosition, baseLayer, etc.)
    _subType: subType,
    // Keep original frontend entity type for responses
    _originalEntityType: rawEntityType,
    entityType: rawEntityType,
    operationType: type,
    entityId: op.entityId || op.targetId,
  };
}

/**
 * Converts internal operation format back to frontend format for responses.
 * Converts generic types (cesium3d, streetview360) back to specific frontend types.
 */
function toFrontendOperation(op) {
  let entityType = op.entity_type;
  let data = op.data;
  let changes = op.changes;

  // Convert generic backend types back to specific frontend types, and undo the storage shape:
  // an op must reach a peer as the SAME payload whether it arrived live or on a replay.
  const reverseMap = REVERSE_ENTITY_TYPE_MAP[op.entity_type];
  if (reverseMap) {
    const dataType = op.data?.data_type ?? op.changes?.data_type;
    const specificType = dataType ? reverseMap[dataType] : null;
    if (specificType) {
      entityType = specificType;
    }
    data = unflatten3d360LogPayload(op.data, op);
    changes = unflatten3d360LogPayload(op.changes, op);
  }

  return {
    // A IDENTIDADE DA OPERAÇÃO É O `op_id` DO CLIENTE, nos dois caminhos.
    //
    // Isto devolvia `op.id`, o PK da linha em `operations`, enquanto o broadcast WS
    // ecoa o `op.id` que o cliente gerou: a MESMA operação chegava ao par com dois ids
    // conforme tivesse vindo do socket ou do pull incremental. Era a última sobrevivente
    // da assimetria que o fix L3 já havia eliminado para `entityId`, e quebrava duas
    // coisas que juntam por esse id — a deduplicação inbound e o `apply.persist` do
    // SyncLedger (spans do caminho de pull nunca casavam com os do autor).
    //
    // `op.id` continua como reserva porque a coluna `op_id` é NULLable (o schema a
    // declara TEXT sem NOT NULL, e uma linha escrita sem ela precisa de ALGUM id único).
    id: op.op_id ?? op.id,
    entityType,
    operationType: op.op_type,
    entityId: op.entity_id,
    mapId: op.map_id,
    data,
    changes,
    timestamp: parseInt(op.client_timestamp, 10),
    // Echo the logical clock so the puller can advance its Lamport clock. Omitted
    // (undefined) for legacy ops inserted before the column existed.
    lamportTimestamp: op.lamport_timestamp != null ? parseInt(op.lamport_timestamp, 10) : undefined,
    clientId: op.client_id,
    serverVersion: parseInt(op.server_version, 10),
  };
}

/**
 * Transforms flat cesium3d_data array to frontend hierarchical structure.
 * Backend: [{ id, data_type, tileset_id, data }, ...]
 * Frontend: { cameraPositions: {}, markers: [], measurements: [], viewsheds: [] }
 */
function transformCesium3dToFrontend(cesium3dData) {
  const result = {
    cameraPositions: {},
    markers: [],
    measurements: [],
    viewsheds: [],
  };

  for (const item of cesium3dData) {
    const entry = {
      id: item.id,
      tilesetId: item.tileset_id,
      ...item.data,
      sync: buildSyncMetadata(item),
    };

    switch (item.data_type) {
      case 'camera_position':
        // Key by tilesetId (the normal app path always sets it); fall back to the row id so a
        // persisted camera position is never SILENTLY dropped from the snapshot.
        result.cameraPositions[item.tileset_id || item.id] = entry;
        break;
      case 'marker':
        result.markers.push(entry);
        break;
      case 'measurement':
        result.measurements.push(entry);
        break;
      case 'viewshed':
        result.viewsheds.push(entry);
        break;
    }
  }

  return result;
}

/**
 * Transforms flat streetview360_data array to frontend hierarchical structure.
 * Backend: [{ id, data_type, photo_name, data }, ...]
 * Frontend: { orientations: {}, markers: [] }
 */
function transformStreetview360ToFrontend(streetview360Data) {
  const result = {
    orientations: {},
    markers: [],
  };

  for (const item of streetview360Data) {
    const entry = {
      id: item.id,
      photoName: item.photo_name,
      ...item.data,
      sync: buildSyncMetadata(item),
    };

    switch (item.data_type) {
      case 'orientation':
        // Orientations are keyed by photoName — a saved camera view for ONE specific panorama. An
        // orientation WITHOUT a photoName is meaningless to the frontend (which only ever looks them
        // up by photoName), so it is dropped rather than polluting the map under a row id (which no
        // lookup would hit) or the literal 'undefined' key.
        if (item.photo_name) {
          result.orientations[item.photo_name] = entry;
        }
        break;
      case 'marker':
        result.markers.push(entry);
        break;
    }
  }

  return result;
}

/**
 * Transforms flat features array to frontend structure organized by type.
 * Backend: [{ id, feature_type, geometry, properties }, ...]
 * Frontend: { points: [], lines: [], polygons: [], ... }
 */
function transformFeaturesToFrontend(features) {
  const result = {
    points: [],
    lines: [],
    polygons: [],
    texts: [],
    images: [],
    circles: [],
    rectangles: [],
    ellipses: [],
    brushes: [],
    setores: [],
    arrows: [],
    boundarys: [],
    occupied_fronts: [],
    military_symbols: [],
    coordination_measures: [],
    magnetic_declinations: [],
    los: [],
    visibility: [],
    processed_los: [],
    processed_visibility: [],
  };

  // Map backend feature_type to frontend collection name
  const typeToCollection = {
    point: 'points',
    line: 'lines',
    polygon: 'polygons',
    text: 'texts',
    image: 'images',
    circle: 'circles',
    rectangle: 'rectangles',
    ellipse: 'ellipses',
    brush: 'brushes',
    sector: 'setores',
    arrow: 'arrows',
    boundary: 'boundarys',
    occupied_front: 'occupied_fronts',
    military_symbol: 'military_symbols',
    coordination_measure: 'coordination_measures',
    magnetic_declination: 'magnetic_declinations',
    los: 'los',
    visibility: 'visibility',
    processed_los: 'processed_los',
    processed_visibility: 'processed_visibility',
  };

  for (const feature of features) {
    const collection = typeToCollection[feature.feature_type];
    if (collection && result[collection]) {
      // Convert to GeoJSON Feature format expected by frontend
      result[collection].push({
        type: 'Feature',
        geometry: feature.geometry,
        properties: {
          ...feature.properties,
          id: feature.id,
          source: feature.feature_type,
          createdAt: new Date(feature.created_at).getTime(),
          updatedAt: new Date(feature.updated_at).getTime(),
          version: feature.version,
        },
      });
    }
  }

  return result;
}

/**
 * Gets atlas sync info (min_version and current_version).
 */
export async function getAtlasSyncInfo(atlasId) {
  const result = await query(Q.GET_ATLAS_SYNC_INFO, [atlasId]);
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

/**
 * Generates a full snapshot of the atlas state.
 * Used when client requests version 0 or version < min_version.
 */
export async function getAtlasSnapshot(atlasId, permission = 'owner') {
  return task(async (t) => {
    // Get atlas metadata
    const atlasResult = await t.query(Q.GET_ATLAS_METADATA, [atlasId]);
    if (atlasResult.length === 0) {
      return null;
    }
    const atlas = atlasResult[0];

    // Get all maps
    const maps = await t.query(Q.GET_ATLAS_MAPS, [atlasId]);

    // Spatial comments are hidden from read-only viewers (Visualizador / public visitor): a
    // 'read'-level snapshot omits them. Fetched ONCE for the whole atlas (not per-map) and grouped
    // by map_id, to avoid an extra per-map query for every (often empty) map.
    const commentsByMap = {};
    if (permission !== 'read') {
      const rawComments = await t.query(Q.GET_ATLAS_COMMENTS, [atlasId]);
      for (const c of rawComments) {
        if (!commentsByMap[c.map_id]) commentsByMap[c.map_id] = [];
        commentsByMap[c.map_id].push({
          id: c.id,
          ...c.data,
          mapId: c.map_id,
          parentId: c.parent_id,
          status: c.status,
          // The AUTHORITATIVE author, from the column, placed AFTER the `...c.data`
          // spread so it wins over whatever `authorId` the client wrote into the
          // JSONB. Since 2026-07-19 the column is stamped from the authenticated
          // principal, but the JSONB copy is still client-supplied — and the client's
          // edit gate reads `comment.authorId` (comment-overlay.js `_canModify`) while
          // the server checks the column. Leaving them to disagree means a forged id
          // shows an Edit button that then fails silently on push.
          authorId: c.author_id ?? null,
          sync: buildSyncMetadata(c),
        });
      }
    }

    // Cada coleção é buscada UMA VEZ para o atlas inteiro e agrupada por map_id,
    // que é o padrão que os comentários acima já usavam. Antes eram SETE
    // round-trips POR MAPA, todos dentro deste mesmo `task()` — que retém uma
    // conexão do pool (poolMax default 10) durante a série inteira. E isto está
    // no caminho quente: `pullOperations` chama o snapshot em todo connect e em
    // todo pull atrasado, não num relatório administrativo.
    const agrupar = (linhas, chave = 'map_id') => {
      const por = new Map();
      for (const linha of linhas) {
        const k = linha[chave];
        if (!por.has(k)) por.set(k, []);
        por.get(k).push(linha);
      }
      return por;
    };

    const featuresByMap = agrupar(await t.query(Q.GET_ATLAS_FEATURES, [atlasId]));
    const cesium3dByMap = agrupar(await t.query(Q.GET_ATLAS_CESIUM3D, [atlasId]));
    const streetview360ByMap = agrupar(await t.query(Q.GET_ATLAS_STREETVIEW360, [atlasId]));
    const catalogLayersByMap = agrupar(await t.query(Q.GET_ATLAS_CATALOG_LAYERS, [atlasId]));
    const layersByMap = agrupar(await t.query(Q.GET_ATLAS_LAYERS, [atlasId]));
    const groupsByMap = agrupar(await t.query(Q.GET_ATLAS_GROUPS, [atlasId]));
    const groupFeaturesByMap = agrupar(await t.query(Q.GET_ATLAS_GROUP_FEATURES, [atlasId]));

    // Transform to frontend format
    for (const map of maps) {
      const rawFeatures = featuresByMap.get(map.id) || [];
      const rawCesium3d = cesium3dByMap.get(map.id) || [];
      const rawStreetview360 = streetview360ByMap.get(map.id) || [];
      const rawCatalogLayers = catalogLayersByMap.get(map.id) || [];

      // Transform to frontend structure
      map.features = transformFeaturesToFrontend(rawFeatures);
      map.cesium3d = transformCesium3dToFrontend(rawCesium3d);
      map.streetview360 = transformStreetview360ToFrontend(rawStreetview360);
      // Per-layer catalog layers (new). The legacy `catalog_layers` column is
      // still returned by GET_ATLAS_MAPS for backward compatibility.
      map.catalogLayers = rawCatalogLayers.map((c) => ({
        id: c.id,
        ...c.data,
        sync: buildSyncMetadata(c),
      }));

      // Spatial comments (prefetched once above, grouped by map_id); empty for read-only viewers.
      map.comments = commentsByMap[map.id] || [];

      // Transform layers: rename sort_order -> order for frontend compatibility
      const rawLayers = layersByMap.get(map.id) || [];
      map.layers = rawLayers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        locked: layer.locked,
        opacity: layer.opacity,
        order: layer.sort_order, // Frontend expects 'order', not 'sort_order'
        style: layer.style,
        createdAt: new Date(layer.created_at).getTime(),
        updatedAt: new Date(layer.updated_at).getTime(),
        version: layer.version,
      }));

      // Get groups and group_features, then populate group.features array for frontend
      const rawGroups = groupsByMap.get(map.id) || [];
      const groupFeatures = groupFeaturesByMap.get(map.id) || [];

      // Build a map of feature_id -> feature_type for group.features population
      const featureTypeById = {};
      for (const feature of rawFeatures) {
        featureTypeById[feature.id] = feature.feature_type;
      }

      // Transform groups: populate features array from group_features join table
      map.groups = rawGroups.map((group) => {
        // Find all features belonging to this group
        const groupFeatureRefs = groupFeatures
          .filter((gf) => gf.group_id === group.id)
          .map((gf) => ({
            type: featureTypeById[gf.feature_id] || null,
            id: gf.feature_id,
          }))
          .filter((ref) => ref.type !== null); // Filter out orphaned references

        return {
          id: group.id,
          name: group.name,
          visible: group.visible,
          locked: group.locked,
          style: group.style,
          parent_id: group.parent_id,
          features: groupFeatureRefs,
          sync: buildSyncMetadata(group),
        };
      });

      // Keep groupFeatures for backwards compatibility (optional)
      map.groupFeatures = groupFeatures;

      map.sync = buildSyncMetadata(map);
    }

    // Get all briefings with slides.
    //
    // `mapId` is emitted as the map's NAME, not its UUID, because that is what the
    // field means on the client: the briefing editor matches it against an
    // `<option value=name>` and the presenter compares it to the active map's name
    // (`currentMap === slide.mapId`). Returning the raw UUID here would round-trip a
    // value the client cannot use — the dropdown would never match and a 2D slide
    // would silently stop switching to its map during a presentation. The write path
    // performs the inverse translation (resolveSlideMapId).
    const mapNameById = new Map(maps.map((m) => [m.id, m.name]));

    const briefings = await t.query(Q.GET_ATLAS_BRIEFINGS, [atlasId]);
    // Slides também vêm de uma vez só, agrupados por briefing_id — era mais um
    // round-trip por briefing na mesma conexão retida.
    const slidesByBriefing = agrupar(await t.query(Q.GET_ATLAS_SLIDES, [atlasId]), 'briefing_id');
    for (const briefing of briefings) {
      // Cópia: o `sort` abaixo muta o array, e o agrupamento é compartilhado.
      const rawSlides = [...(slidesByBriefing.get(briefing.id) || [])];
      // slide_order (UUID[]) is the canonical ordering; surface `order` (index), the
      // camelCase aliases the frontend slide model uses, and per-slide sync metadata.
      //
      // The snake_case columns are kept alongside so nothing that already reads them
      // breaks. The camelCase half is not cosmetic: applyRemoteSnapshot saves each
      // briefing VERBATIM into IndexedDB, and the frontend slide model is camelCase
      // (createEmptySlide: mapId/modelId/photoId/temporalCursor). Returning only
      // snake_case would restore every slide stripped of its map, model and photo.
      // Only `temporalCursor` was aliased here before, because until slides actually
      // began persisting this branch never ran on a non-empty result.
      // The ARRAY order is load-bearing, not just the `order` field: the briefing
      // editor and the presenter index `briefing.slides[i]` directly
      // (briefing-editor.control.js, briefing-presenter.control.js). GET_BRIEFING_SLIDES
      // has no ORDER BY, so Postgres returns them in whatever order it likes — which
      // did not matter while slides never persisted at all, and became a real
      // "presentation plays out of sequence" bug the moment they did. Slides missing
      // from slide_order (indexOf -> -1) sort last instead of first, and ties keep
      // their relative position.
      const order = Array.isArray(briefing.slide_order) ? briefing.slide_order : [];
      const rank = (id) => {
        const i = order.indexOf(id);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      };
      rawSlides.sort((a, b) => rank(a.id) - rank(b.id));

      briefing.slides = rawSlides.map((slide) => ({
        ...slide,
        // The NAME, per the note above — the client's `mapId` is a display name.
        mapId: mapNameById.get(slide.map_id) ?? null,
        modelId: slide.model_id ?? null,
        photoId: slide.photo_id ?? null,
        temporalCursor: slide.temporal_cursor ?? null,
        order: order.indexOf(slide.id),
        sync: buildSyncMetadata(slide),
      }));
      briefing.sync = buildSyncMetadata(briefing);
    }

    return {
      atlas: {
        id: atlas.id,
        name: atlas.name,
        description: atlas.description,
        settings: atlas.settings,
        mapOrder: atlas.map_order,
        isPublic: atlas.is_public,
        sync: buildSyncMetadata(atlas, atlas.owner_id),
      },
      maps,
      briefings,
      currentVersion: parseInt(atlas.current_version, 10),
    };
  });
}

/**
 * Targets whose mutations are blocked while their parent map is locked.
 */
const LOCKABLE_CHILD_TARGETS = new Set([
  'feature', 'group', 'layer', 'cesium3d', 'streetview360', 'catalog_layer', 'group_feature',
]);

/**
 * Authorization gate for a single operation (multiuser spec):
 *  - 'read'    → no writes at all (defensive; the route/WS gate already blocks it).
 *  - 'comment' → may ONLY write spatial comments (target 'comment').
 *  - map-delete and map lock/unlock are reserved for the atlas owner.
 *  - everything else passes (write / manage / owner).
 * Throws ForbiddenError when denied.
 * @param {Object} op - Normalized operation (target/type/_subType/changes/data).
 * @param {'owner'|'manage'|'write'|'comment'|'read'} permission - Resolved atlas permission.
 */
function assertOperationAllowed(op, permission) {
  // Read-only never writes (defensive — the route/WS gate already blocks it).
  if (permission === 'read') {
    throw new ForbiddenError('Read-only users cannot send operations');
  }
  // Comentarista (comment tier) may only create/edit/delete spatial comments.
  if (permission === 'comment' && op.target !== 'comment') {
    throw new ForbiddenError('Comentaristas só podem criar ou editar comentários');
  }
}

/**
 * Per-operation POLICY denial, as opposed to the tier denial above. Returns a reason
 * string when the operation must not be applied, or null when it may proceed.
 *
 * Why this is separate from assertOperationAllowed: a tier violation (a read-only or
 * comment-tier principal pushing writes) means the whole batch is untrustworthy, so it
 * still throws and 403s the push. A policy denial is different: the principal is a
 * legitimate writer whose SINGLE operation is not permitted. Throwing for that aborted
 * the surrounding tx() and rolled back the ENTIRE batch, and because the client only
 * re-queues on a non-2xx response, every later edit of that user piled up behind the
 * rejected op and never reached the server again. One refused map delete froze that
 * client's sync permanently, with no message in the UI.
 *
 * Returning a reason instead lets the batch continue and the op be acked as rejected,
 * which the client dequeues (retrying a policy denial can never succeed).
 * @returns {string|null}
 */
function operationDenialReason(op, permission) {
  if (op.target !== 'map') return null;
  // Gate by HIERARCHY, never by equality. `permission !== 'owner'` silently excluded
  // `manage` (the co-Gestor), which is the closed-list trap the constitution forbids
  // in two places for having caused real bugs twice. Deleting a map is a management
  // action: manage and above, editor and below refused.
  if (op.type === 'delete' && PERMISSION_LEVELS[permission] < PERMISSION_LEVELS.manage) {
    return 'Apenas o dono ou um co-Gestor do atlas pode excluir um mapa';
  }
  if (op.type === 'update' && !op._subType) {
    const merged = { ...op.changes, ...op.data };
    // Lock/unlock stays owner-only (deliberately narrower than delete): it is a
    // coordination override, not a management action.
    if (merged.locked !== undefined && permission !== 'owner') {
      return 'Apenas o dono do atlas pode bloquear ou desbloquear um mapa';
    }
  }
  return null;
}

/**
 * The other half of {@link operationDenialReason}, for the refusal that needs the database:
 * a LOCKED map blocks mutations of its child entities (the spec's "disable editing").
 *
 * This used to `throw new ConflictError('Map is locked')` from inside applyOperation — inside the
 * tx() that wraps the whole batch — so ONE op aimed at a map that got locked while it sat in the
 * offline queue rolled back every sibling op and answered 409. The client does not dequeue a batch
 * the server refused (sync-engine.js flush: "A rejected batch is NOT dequeued"), so it replayed the
 * poisoned batch every 1.5 s forever: that user stopped syncing entirely, for EVERY map, with only
 * a console.warn. A lock is a policy refusal like any other in this file, not an integrity failure,
 * so it is refused per operation and the batch survives.
 *
 * Map-level ops (lock/unlock/delete) are NOT gated here — that is what lets the owner unlock.
 *
 * @param {Object} t - Transaction context.
 * @param {Object} op - Normalized operation.
 * @returns {Promise<string|null>} Refusal reason, or null when the write may proceed.
 */
async function lockedMapDenialReason(t, op) {
  if (!LOCKABLE_CHILD_TARGETS.has(op.target) || !op.mapId) return null;
  const m = await t.oneOrNone(
    'SELECT locked FROM maps WHERE id = $1 AND deleted_at IS NULL',
    [op.mapId]
  );
  return m && m.locked ? 'O mapa está bloqueado e não aceita edições' : null;
}

/**
 * SQLSTATE → motivo de recusa, em pt-BR e GENÉRICO.
 *
 * O texto do driver não pode chegar ao cliente: ele carrega nome de constraint e de
 * índice (`images_pkey`, `layers_opacity_range`), a linha ofensora inteira em
 * `err.detail`, e é traduzido conforme o locale do servidor — três coisas que viram
 * vazamento de schema e mensagem imprevisível na UI. O erro cru vai para o log
 * (logger.warn), que é onde o operador precisa dele.
 */
const PG_INTEGRITY_REASONS = Object.freeze({
  '22P02': 'Alteração descartada: identificador ou valor com formato inválido.',
  '22001': 'Alteração descartada: texto acima do tamanho permitido.',
  '22003': 'Alteração descartada: valor numérico fora do intervalo permitido.',
  '23502': 'Alteração descartada: campo obrigatório ausente.',
  '23503': 'Alteração descartada: referencia um item que não existe mais.',
  '23505': 'Alteração descartada: já existe um item com esse identificador.',
  '23514': 'Alteração descartada: valor fora do permitido para este campo.',
});

/**
 * Classifies a thrown error as a PER-OPERATION data violation (permanently poisonous:
 * the SAME bytes will fail forever) or as something else.
 *
 * Só as classes SQLSTATE **22** (data exception) e **23** (integrity constraint
 * violation) contam. Elas são função determinística do payload da op: retentar é
 * garantia de falhar de novo, então a única saída que preserva a vivacidade da fila é
 * recusar ESTA op e seguir.
 *
 * Tudo o mais volta a envenenar o lote DE PROPÓSITO, e a assimetria é o ponto:
 * 40001 (serialization), 55P03 (lock timeout), 53300 (pool), queda de conexão e
 * qualquer `AppError`/bug de JS podem ter sucesso na próxima tentativa. Descartar uma
 * op boa é perda de dado silenciosa — pior que a fila travada, que ao menos é
 * recuperável. Na dúvida, o lote falha e o cliente retenta.
 *
 * @param {unknown} err
 * @returns {string|null} Motivo sanitizado, ou null quando o erro NÃO é per-op.
 */
function integrityRejectionReason(err) {
  const code = err && typeof err.code === 'string' ? err.code : null;
  if (!code || code.length !== 5) return null;
  const klass = code.slice(0, 2);
  if (klass !== '22' && klass !== '23') return null;
  return PG_INTEGRITY_REASONS[code]
    ?? 'Alteração descartada: o servidor recusou os dados desta operação.';
}

/**
 * Pushes a batch of operations to the server.
 * Operations are applied and recorded in the operations log.
 * Accepts both frontend format (entityType, operationType, entityId) and
 * legacy format (target, type, targetId).
 * @param {'owner'|'manage'|'write'|'comment'|'read'} [permission='owner'] - Resolved atlas
 *   permission (passed by the HTTP route / WS handler; defaults to owner for trusted internal calls).
 */
export async function pushOperations(atlasId, operations, userId, permission = 'owner') {
  const acks = [];

  await tx(async (t) => {
    // P2 — serialize pushes per atlas.
    //
    // `server_version` is assigned by `nextval('atlas_version_seq')` at INSERT time,
    // but visibility is decided at COMMIT time. Without this lock two concurrent
    // pushes can interleave so that version order diverges from commit order:
    //
    //   tx A inserts (v100) ─────────────────────── commits
    //   tx B inserts (v101) ── commits
    //   puller sees v101, stores lastVersion=101
    //   …A commits; its v100 op is now < 101 and the incremental pull
    //     (`WHERE server_version > $lastVersion`) NEVER returns it → op lost for good.
    //
    // Taking the lock before the first INSERT makes nextval order == commit order for
    // a given atlas, so `server_version` is a sound incremental-pull cursor. The lock
    // is transaction-scoped (released on COMMIT/ROLLBACK, no leak on error) and keyed
    // per atlas, so pushes to different atlases still run fully in parallel.
    // `lock_timeout` ANTES de esperar: a conexão do pool já está retida enquanto
    // bloqueamos, então uma espera ilimitada converte contenção num atlas em
    // ESGOTAMENTO DO POOL — com poolMax=10, dez pushes concorrentes no mesmo atlas
    // travam o processo inteiro, inclusive /auth/login e o /health (que usa o
    // mesmo pool e ficaria pendurado na fila em vez de responder 503).
    // Falhar em 5s vira um 503 retentável em vez de uma parada global.
    await t.none("SET LOCAL lock_timeout = '5s'");
    try {
      await t.one('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
        SYNC_PUSH_LOCK_NAMESPACE,
        atlasId,
      ]);
    } catch (err) {
      // 55P03 = lock_not_available (o lock_timeout acima disparou).
      if (err && err.code === '55P03') {
        throw new ServiceUnavailableError(
          'Servidor ocupado processando outra sincronização deste atlas. Tente novamente.'
        );
      }
      throw err;
    }

    for (const rawOp of operations) {
      // Normalize operation to internal format (accepts both frontend and legacy names)
      const op = normalizeOperation(rawOp);

      // Tier authorization: a read-only / comment-tier principal pushing writes
      // invalidates the whole batch (403).
      assertOperationAllowed(op, permission);

      // Per-op policy (map delete, map lock/unlock, write into a locked map): refuse THIS
      // operation without aborting the transaction, so one denied op cannot freeze the
      // client's queue.
      const denialReason = operationDenialReason(op, permission)
        ?? await lockedMapDenialReason(t, op);
      if (denialReason) {
        acks.push({
          opId: rawOp.id,
          serverVersion: null,
          idempotent: false,
          rejected: true,
          reason: denialReason,
        });
        if (isTraceEnabled()) {
          recordSpan(atlasId, TraceStage.SERVER_APPLIED, {
            opId: rawOp.id, traceId: rawOp.traceId, entityType: op.entityType, operationType: op.type,
            entityId: op.entityId, mapId: op.mapId, rowsAffected: 0,
            outcome: TraceOutcome.NO_EFFECT, reason: denialReason,
          });
        }
        continue;
      }

      // ── SAVEPOINT por operação ────────────────────────────────────────────────
      // O log e o efeito desta op correm num sub-escopo próprio (pg-promise: tx
      // aninhada = SAVEPOINT). Uma violação de integridade (CHECK, FK, 22P02) abortava
      // o `tx()` do lote INTEIRO e devolvia um 400 genérico; como o cliente não faz
      // dequeue de não-2xx e a resposta não dizia QUAL op ofendeu, ele reenviava o mesmo
      // lote a cada 1,5 s para sempre — o sync daquele usuário parava, em silêncio.
      // Com o savepoint, o rollback alcança só a op ofensora (log e efeito juntos, sem
      // op logada sem efeito), e ela é acusada por operação exatamente como a recusa de
      // política, que o cliente já sabe descartar.
      //
      // Custo: dois comandos extras (SAVEPOINT/RELEASE) por op. No regime normal o lote
      // tem poucas ops a cada flush de 1,5 s; no lote cheio (100) é ~10-20% de comandos
      // a mais. Vivacidade da fila vale mais que isso.
      let applied;
      try {
        applied = await t.tx(async (sp) => {
          // Insert operation into log (idempotent: ON CONFLICT (atlas_id, op_id) DO NOTHING).
          const inserted = await sp.oneOrNone(Q.INSERT_OPERATION, [
            atlasId,
            op.type,
            op.target,
            // The operations LOG has entity_id UUID NOT NULL. Atlas-level ops (settings such as
            // colorUsage / mapBadgeColors / terrainExaggeration) carry a non-UUID sentinel targetId
            // ('atlas'), which fails the UUID cast (22P02) and 400s the whole push. Record those against
            // the atlas's OWN id — the entity these ops target — so the log insert succeeds. UUID-keyed
            // ops (features/layers/maps/etc.) are recorded under their real id, unchanged.
            FEATURE_UUID_RE.test(op.targetId) ? op.targetId : atlasId,
            op.mapId || null,
            // 3D/360 ops log the CLIENT's flat payload (_logChanges/_logData) instead of the entity-
            // table envelope, so a replay hands the peer exactly what the broadcast did. Everything
            // else logs what it writes.
            (op._logChanges ?? op.changes) ? JSON.stringify(op._logChanges ?? op.changes) : null,
            (op._logData ?? op.data) ? JSON.stringify(op._logData ?? op.data) : null,
            op.timestamp,
            op.clientId,
            userId,
            rawOp.id ?? null,
            op.lamportTimestamp ?? null,
          ]);

          if (!inserted) {
            const prev = await sp.oneOrNone(Q.GET_OPERATION_BY_OP_ID, [atlasId, rawOp.id]);
            return { idempotent: true, prev };
          }

          // Apply operation to entity tables based on normalized op
          const rowsAffected = await applyOperation(sp, atlasId, op, userId, permission);
          return { idempotent: false, inserted, rowsAffected };
        });
      } catch (err) {
        const reason = integrityRejectionReason(err);
        // Não classificado como violação de dado → segue envenenando o lote (ver
        // integrityRejectionReason): pode dar certo na retentativa, e descartar uma op
        // boa é irreversível.
        if (!reason) throw err;
        // O erro CRU fica no log do servidor — é o único lugar onde o nome da
        // constraint pode aparecer.
        logger.warn(
          { err, atlasId, opId: rawOp.id, entityType: op.entityType, operationType: op.type },
          'sync: operação recusada por violação de integridade'
        );
        acks.push({
          opId: rawOp.id,
          serverVersion: null,
          idempotent: false,
          rejected: true,
          reason,
        });
        if (isTraceEnabled()) {
          recordSpan(atlasId, TraceStage.SERVER_APPLIED, {
            opId: rawOp.id, traceId: rawOp.traceId, entityType: op.entityType, operationType: op.type,
            entityId: op.entityId, mapId: op.mapId, rowsAffected: 0,
            // FAILED (e não NO_EFFECT, o da recusa de política): no ledger as duas
            // recusas precisam ser distinguíveis.
            outcome: TraceOutcome.FAILED, reason,
          });
        }
        continue;
      }

      if (applied.idempotent) {
        // Operation already applied (same op_id). Ack with the recorded version
        // and skip re-applying the effect — this is the idempotency guarantee.
        const prev = applied.prev;
        acks.push({
          opId: rawOp.id,
          serverVersion: prev ? prev.server_version : null,
          idempotent: true,
          entityId: prev ? prev.entity_id : null,
        });
        // SyncLedger: an idempotent re-arrival — the LWW arrival-order truth already
        // exists; record it so a peer's echo/replay is distinguishable from a fresh op.
        // Guarded so the hot path allocates/calls nothing when tracing is off.
        if (isTraceEnabled()) {
          recordSpan(atlasId, TraceStage.SERVER_INSERTED, {
            opId: rawOp.id, traceId: rawOp.traceId, entityType: op.entityType, operationType: op.type,
            entityId: op.entityId, mapId: op.mapId, clientId: op.clientId,
            serverVersion: prev ? parseInt(prev.server_version, 10) : null,
            idempotent: true, outcome: TraceOutcome.IDEMPOTENT,
          });
        }
        continue;
      }

      const { inserted, rowsAffected } = applied;

      acks.push({
        opId: rawOp.id,
        serverVersion: inserted.server_version,
        idempotent: false,
        // L3 — the entity id AS RECORDED. Atlas-level ops arrive with the
        // non-UUID sentinel 'atlas' and are logged against the atlas's own UUID
        // (entity_id is UUID NOT NULL), so echoing the raw op on the broadcast
        // gave peers a different entityId depending on whether they received it
        // live or via incremental pull. The controller stamps this back so both
        // paths agree.
        entityId: inserted.entity_id,
      });

      // SyncLedger: the op.id ↔ server_version binding (LWW arrival-order truth).
      // Guarded so the hot path allocates/calls nothing when tracing is off.
      if (isTraceEnabled()) {
        recordSpan(atlasId, TraceStage.SERVER_INSERTED, {
          opId: rawOp.id, traceId: rawOp.traceId, entityType: op.entityType, operationType: op.type,
          entityId: op.entityId, mapId: op.mapId, clientId: op.clientId,
          serverVersion: parseInt(inserted.server_version, 10), idempotent: false, outcome: TraceOutcome.OK,
        });
      }

      // SyncLedger: the flagship "acked but no effect" guard (invariant I2). An
      // update/delete that matched zero rows (foreign mapId, EXISTS guard) is surfaced
      // — historically indistinguishable from a real write because applyOperation used
      // t.none (no rowCount). Guarded so the hot path is zero-cost when tracing is off.
      if (isTraceEnabled()) {
        recordSpan(atlasId, TraceStage.SERVER_APPLIED, {
          opId: rawOp.id, traceId: rawOp.traceId, entityType: op.entityType, operationType: op.type,
          entityId: op.entityId, mapId: op.mapId,
          rowsAffected: rowsAffected ?? null,
          outcome: rowsAffected === 0 ? TraceOutcome.NO_EFFECT : TraceOutcome.OK,
        });
      }
    }
  });

  // Get current version (outside transaction)
  const versionResult = await query(Q.GET_CURRENT_VERSION, [atlasId]);
  const serverVersion = parseInt(versionResult.rows[0].current_version, 10);

  // Per-operation ack contract (for confident offline dequeue). `acks` is kept
  // as a backward-compatible alias of the same data.
  const results = acks.map((a) => ({
    // `false` para op recusada — por POLÍTICA (operationDenialReason /
    // lockedMapDenialReason) ou por VIOLAÇÃO DE DADO (integrityRejectionReason). As duas
    // compartilham a mesma forma de propósito: as duas são permanentes, e o cliente já
    // sabe descartar `rejected` e mostrar `reason`. Tudo que chegou ao apply segue
    // reportado como sucesso.
    success: a.rejected !== true,
    operationId: a.opId,
    idempotent: a.idempotent === true,
    currentVersion: a.serverVersion != null ? parseInt(a.serverVersion, 10) : serverVersion,
    ...(a.rejected === true ? { rejected: true, reason: a.reason } : {}),
  }));

  return { results, acks, serverVersion };
}

/**
 * Pulls operations since a given version.
 * Uses hybrid approach:
 * - If sinceVersion == 0 or sinceVersion < min_version → returns full snapshot
 * - Otherwise → returns incremental operations
 */
export async function pullOperations(atlasId, sinceVersion, permission = 'owner') {
  // Get sync info to check min_version
  const syncInfo = await getAtlasSyncInfo(atlasId);
  if (!syncInfo) {
    return { operations: [], currentVersion: 0, isSnapshot: false };
  }

  const minVersion = parseInt(syncInfo.min_version, 10);
  const currentVersion = parseInt(syncInfo.current_version, 10);

  // If client is too far behind or starting fresh, return snapshot (comments filtered by tier).
  if (sinceVersion === 0 || sinceVersion < minVersion) {
    const snapshot = await getAtlasSnapshot(atlasId, permission);
    if (!snapshot) {
      return { operations: [], currentVersion: 0, isSnapshot: false };
    }
    return {
      snapshot,
      currentVersion: snapshot.currentVersion,
      isSnapshot: true,
    };
  }

  // Otherwise return incremental operations (converted to frontend format). Read-only viewers
  // never receive comment ops (visibility rule).
  const opsResult = await query(Q.GET_OPERATIONS_SINCE_VERSION, [atlasId, sinceVersion]);
  let operations = opsResult.rows.map(toFrontendOperation);
  if (permission === 'read') {
    operations = operations.filter((o) => o.entityType !== 'comment');
  }

  return {
    operations,
    currentVersion,
    isSnapshot: false,
  };
}

/**
 * Cleans up old operations for an atlas.
 * Deletes operations older than the specified version and updates min_version.
 * @param {string} atlasId - Atlas ID
 * @param {number} keepFromVersion - Keep operations from this version onwards (optional)
 * @param {number} keepDays - Keep operations from the last N days (default: 7)
 * @returns {Object} - { deletedCount, newMinVersion }
 */
export async function cleanupOldOperations(atlasId, { keepFromVersion, keepDays = 7 } = {}) {
  return tx(async (t) => {
    let deleteBeforeVersion;

    if (keepFromVersion !== undefined) {
      // Delete operations before specified version
      deleteBeforeVersion = keepFromVersion;
    } else {
      // Calculate version to keep based on days
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - keepDays);

      // Find the oldest operation version to keep (created after cutoff)
      const result = await t.oneOrNone(`
        SELECT MIN(server_version) as min_keep_version
        FROM operations
        WHERE atlas_id = $1 AND created_at >= $2
      `, [atlasId, cutoffDate]);

      if (!result || !result.min_keep_version) {
        // No operations newer than cutoff, keep all
        return { deletedCount: 0, newMinVersion: 0 };
      }

      deleteBeforeVersion = parseInt(result.min_keep_version, 10);
    }

    if (deleteBeforeVersion <= 0) {
      return { deletedCount: 0, newMinVersion: 0 };
    }

    // Delete old operations
    const deleted = await t.result(Q.DELETE_OLD_OPERATIONS, [atlasId, deleteBeforeVersion]);
    const deletedCount = deleted.rowCount;

    // Update min_version on atlas
    await t.none(Q.UPDATE_ATLAS_MIN_VERSION, [atlasId, deleteBeforeVersion]);

    return { deletedCount, newMinVersion: deleteBeforeVersion };
  });
}

/**
 * Gets cleanup statistics for an atlas.
 */
export async function getCleanupStats(atlasId) {
  const [syncInfo, oldestResult, countResult] = await Promise.all([
    query(Q.GET_ATLAS_SYNC_INFO, [atlasId]),
    query(Q.GET_OLDEST_OPERATION_VERSION, [atlasId]),
    query('SELECT COUNT(*) as total FROM operations WHERE atlas_id = $1', [atlasId]),
  ]);

  if (!syncInfo.rows[0]) {
    return null;
  }

  return {
    atlasId,
    minVersion: parseInt(syncInfo.rows[0].min_version, 10),
    currentVersion: parseInt(syncInfo.rows[0].current_version, 10),
    oldestOperationVersion: oldestResult.rows[0]?.oldest_version ? parseInt(oldestResult.rows[0].oldest_version, 10) : null,
    totalOperations: parseInt(countResult.rows[0].total, 10),
  };
}

/**
 * Field specs for each updatable entity type.
 * Each entry defines: { column, source? (defaults to column), jsonb? }
 */
const UPDATE_FIELDS = {
  feature: [
    { column: 'geometry', jsonb: true },
    { column: 'properties', jsonb: true },
    { column: 'layer_id' },
    { column: 'feature_type' },
    { column: 'map_id' },
  ],
  group: [
    { column: 'name' },
    { column: 'visible' },
    { column: 'locked' },
    { column: 'style', jsonb: true },
    { column: 'parent_id' },
  ],
  layer: [
    { column: 'name' },
    { column: 'visible' },
    { column: 'locked' },
    { column: 'opacity' },
    { column: 'sort_order' },
    { column: 'style', jsonb: true },
  ],
  briefing: [
    { column: 'name' },
    { column: 'description' },
    { column: 'settings', jsonb: true },
    { column: 'slide_order', cast: '::uuid[]' },
  ],
  slide: [
    { column: 'title' },
    { column: 'content' },
    { column: 'mode' },
    { column: 'map_id' },
    { column: 'model_id' },
    { column: 'photo_id' },
    { column: 'position', jsonb: true },
    { column: 'orientation', jsonb: true },
    { column: 'temporal_cursor', jsonb: true },
    { column: 'is_broken' },
    { column: 'broken_reason' },
  ],
  cesium3d: [
    { column: 'data_type' },
    { column: 'tileset_id' },
    { column: 'data', jsonb: true },
  ],
  streetview360: [
    { column: 'data_type' },
    { column: 'photo_name' },
    { column: 'data', jsonb: true },
  ],
};

/**
 * Map update fields are special: they accept both frontend and backend field names,
 * and handle sub-entity updates (mapPosition, baseLayer, mapNotes, etc.).
 */
const MAP_UPDATE_FIELDS = [
  { column: 'name' },
  { column: 'base_layer' },
  { column: 'center_lat' },
  { column: 'center_long' },
  { column: 'zoom' },
  { column: 'bearing' },
  { column: 'pitch' },
  { column: 'notes_title' },
  { column: 'notes_description' },
  { column: 'analysis_layers', jsonb: true },
  { column: 'catalog_layers', jsonb: true },
  { column: 'grid_style', jsonb: true },
  { column: 'temporal_config', jsonb: true },
  { column: 'locked' },
];

/**
 * Column whitelist PER map sub-type (mapPosition/baseLayer/mapNotes/gridStyle/
 * mapTemporal). A sub-typed update may ONLY touch its own column(s): this prevents
 * a sibling column smuggled in the payload (e.g. a `name` riding alongside a
 * temporal_config) from overwriting unrelated map state. Keys match ENTITY_TYPE_MAP
 * subType values.
 */
const MAP_SUBTYPE_FIELDS = {
  position: [
    { column: 'center_lat' },
    { column: 'center_long' },
    { column: 'zoom' },
    { column: 'bearing' },
    { column: 'pitch' },
  ],
  baseLayer: [{ column: 'base_layer' }],
  notes: [{ column: 'notes_title' }, { column: 'notes_description' }],
  // grid_style is the current contract; analysis_layers is the grid-domain field
  // legacy clients write through gridStyle (both are grid state, never a sensitive
  // sibling like name/base_layer/locked).
  grid: [{ column: 'grid_style', jsonb: true }, { column: 'analysis_layers', jsonb: true }],
  temporal: [{ column: 'temporal_config', jsonb: true }],
};

/**
 * Normalizes map changes by resolving frontend/backend field name aliases.
 * Uses nullish coalescing (??) to correctly handle empty string values.
 */
function normalizeMapChanges(changes, subType = null) {
  const normalized = { ...changes };

  // base_layer / baseLayer
  if (normalized.base_layer === undefined && normalized.baseLayer !== undefined) {
    normalized.base_layer = normalized.baseLayer;
  }

  // notes_title / title
  if (normalized.notes_title === undefined && normalized.title !== undefined) {
    normalized.notes_title = normalized.title;
  }

  // notes_description / description (only for map context, not briefing)
  if (normalized.notes_description === undefined && normalized.description !== undefined) {
    normalized.notes_description = normalized.description;
  }

  // gridStyle: the {format,visible} payload IS the grid_style object. Only write
  // when grid fields are present (older clients smuggle data via analysis_layers).
  if (subType === 'grid' && normalized.grid_style === undefined &&
      (changes.format !== undefined || changes.visible !== undefined)) {
    normalized.grid_style = { format: changes.format, visible: changes.visible };
  }

  // mapTemporal: assemble temporal_config from the known keys present.
  if (subType === 'temporal' && normalized.temporal_config === undefined) {
    const t = {};
    for (const k of ['ativo', 'unidade', 'inicio', 'fim', 'modo', 'origem']) {
      if (changes[k] !== undefined) t[k] = changes[k];
    }
    if (Object.keys(t).length > 0) normalized.temporal_config = t;
  }

  return normalized;
}

/**
 * Normalizes layer changes by resolving the order/sort_order alias.
 */
function normalizeLayerChanges(changes) {
  const normalized = { ...changes };
  if (normalized.sort_order === undefined && normalized.order !== undefined) {
    normalized.sort_order = normalized.order;
  }
  return normalized;
}

/**
 * Builds the UPDATE query for a given target and operation.
 * Returns null if no changes apply.
 */
function buildUpdateQuery(target, op, atlasId) {
  // Map-scoped entities are also pinned to the ROUTE atlas: the EXISTS clause
  // rejects an op whose mapId belongs to a DIFFERENT atlas, so a writer on atlas A
  // cannot mutate atlas B's data by supplying B's mapId (cross-atlas IDOR).
  const inAtlas = 'EXISTS (SELECT 1 FROM maps m WHERE m.id = $2 AND m.atlas_id = $3)';

  if (target === 'feature' && op.changes && op.mapId) {
    return buildDynamicUpdate(
      'features', op.changes, UPDATE_FIELDS.feature,
      [op.targetId, op.mapId, atlasId], `id = $1 AND map_id = $2 AND ${inAtlas}`,
    );
  }

  if (target === 'group' && op.changes && op.mapId) {
    return buildDynamicUpdate(
      'groups', op.changes, UPDATE_FIELDS.group,
      [op.targetId, op.mapId, atlasId], `id = $1 AND map_id = $2 AND ${inAtlas}`,
    );
  }

  if (target === 'layer' && op.changes && op.mapId) {
    const changes = normalizeLayerChanges(op.changes);
    return buildDynamicUpdate(
      'layers', changes, UPDATE_FIELDS.layer,
      [op.targetId, op.mapId, atlasId], `id = $1 AND map_id = $2 AND ${inAtlas}`,
    );
  }

  if (target === 'map' && (op.changes || op.data)) {
    // Sub-entity updates target the map via mapId; regular updates use targetId
    const mapId = op._subType ? op.mapId : op.targetId;
    if (!mapId) return null;

    // Merge changes and data, then normalize frontend field aliases
    const merged = { ...op.changes, ...op.data };
    const changes = normalizeMapChanges(merged, op._subType);
    // A sub-typed update is narrowed to its own column(s) (anti sibling-column
    // smuggling); a plain `map` update may touch the full set.
    const fields = op._subType ? (MAP_SUBTYPE_FIELDS[op._subType] || []) : MAP_UPDATE_FIELDS;
    if (fields.length === 0) return null;
    return buildDynamicUpdate(
      'maps', changes, fields,
      [mapId, atlasId], 'id = $1 AND atlas_id = $2',
    );
  }

  if (target === 'briefing' && op.changes) {
    return buildDynamicUpdate(
      'briefings', op.changes, UPDATE_FIELDS.briefing,
      [op.targetId, atlasId], 'id = $1 AND atlas_id = $2',
    );
  }

  if (target === 'slide' && op.changes) {
    // Scope by atlas via the parent briefing: a write to atlas A must not touch a
    // slide of atlas B even if its UUID is known (the FK only guarantees the slide
    // exists, not that it belongs to this atlas).
    return buildDynamicUpdate(
      'slides', op.changes, UPDATE_FIELDS.slide,
      [op.targetId, atlasId],
      'id = $1 AND briefing_id IN (SELECT id FROM briefings WHERE atlas_id = $2)',
    );
  }

  if (target === 'cesium3d' && op.changes && op.mapId) {
    return buildDynamicUpdate(
      'cesium3d_data', op.changes, UPDATE_FIELDS.cesium3d,
      [op.targetId, op.mapId, atlasId], `id = $1 AND map_id = $2 AND ${inAtlas}`,
    );
  }

  if (target === 'streetview360' && op.changes && op.mapId) {
    return buildDynamicUpdate(
      'streetview360_data', op.changes, UPDATE_FIELDS.streetview360,
      [op.targetId, op.mapId, atlasId], `id = $1 AND map_id = $2 AND ${inAtlas}`,
    );
  }

  return null;
}

/**
 * Builds a soft-delete query for the given target entity.
 * Returns null if the target does not support deletion or required fields are missing.
 */
function buildSoftDeleteQuery(table, target, op, atlasId) {
  const SOFT_DELETE = 'SET deleted_at = NOW(), updated_at = NOW(), version = version + 1';

  // Entities scoped by map_id — and pinned to the ROUTE atlas via the map, so a
  // writer on atlas A cannot soft-delete atlas B's data with B's mapId.
  if (['feature', 'group', 'layer', 'cesium3d', 'streetview360'].includes(target) && op.mapId) {
    return {
      sql: `UPDATE ${table} ${SOFT_DELETE} WHERE id = $1 AND map_id = $2
            AND EXISTS (SELECT 1 FROM maps m WHERE m.id = $2 AND m.atlas_id = $3)`,
      values: [op.targetId, op.mapId, atlasId],
    };
  }

  // Entities scoped by atlas_id
  if (target === 'map' || target === 'briefing') {
    return {
      sql: `UPDATE ${table} ${SOFT_DELETE} WHERE id = $1 AND atlas_id = $2`,
      values: [op.targetId, atlasId],
    };
  }

  // Slide: scoped by atlas through its parent briefing (prevents cross-atlas delete).
  if (target === 'slide') {
    return {
      sql: `UPDATE ${table} ${SOFT_DELETE} WHERE id = $1 AND briefing_id IN (SELECT id FROM briefings WHERE atlas_id = $2)`,
      values: [op.targetId, atlasId],
    };
  }

  return null;
}

/**
 * Applies a catalogLayer operation. Dual-mode:
 *  - Legacy whole-array form (`data`/`changes`.catalog_layers is an array):
 *    writes the array to the `maps.catalog_layers` column (backward compatible).
 *  - Per-layer form: upsert/update/soft-delete a row in the `catalog_layers`
 *    table keyed by the layer id (op.targetId), scoped to the map.
 * @param {Object} t - Transaction context
 */
async function applyCatalogLayerOp(t, atlasId, op, type) {
  if (!op.mapId) return;

  const arrayPayload =
    (op.data && Array.isArray(op.data.catalog_layers) && op.data.catalog_layers) ||
    (op.changes && Array.isArray(op.changes.catalog_layers) && op.changes.catalog_layers);

  if (arrayPayload) {
    await t.none(
      `UPDATE maps SET catalog_layers = $1::jsonb, updated_at = NOW(), version = version + 1
       WHERE id = $2 AND atlas_id = $3`,
      [JSON.stringify(arrayPayload), op.mapId, atlasId]
    );
    return;
  }

  // Per-layer rows are pinned to a map of THIS atlas (cross-atlas IDOR guard).
  if (type === 'create') {
    await t.none(
      // The conflict target is (map_id, id), not (id): the client's layer id is a
      // catalog-wide constant ('hillshade'), so the same id legitimately exists in
      // many maps. Keyed by id alone, the second map to add a layer was a silent
      // no-op. Resurrect on conflict for the same reason create does elsewhere:
      // re-adding a previously removed catalog layer must bring it back.
      `INSERT INTO catalog_layers (id, map_id, data)
       SELECT $1, $2, $3::jsonb
       WHERE EXISTS (SELECT 1 FROM maps WHERE id = $2 AND atlas_id = $4)
       ON CONFLICT (map_id, id) DO UPDATE
         SET data       = EXCLUDED.data,
             deleted_at = NULL,
             updated_at = NOW(),
             version    = catalog_layers.version + 1
         WHERE catalog_layers.deleted_at IS NOT NULL`,
      [op.targetId, op.mapId, JSON.stringify(op.data || {}), atlasId]
    );
  } else if (type === 'update') {
    const payload = op.changes ?? op.data ?? {};
    await t.none(
      `UPDATE catalog_layers SET data = $1::jsonb, updated_at = NOW(), version = version + 1
       WHERE id = $2 AND map_id = $3 AND deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM maps WHERE id = $3 AND atlas_id = $4)`,
      [JSON.stringify(payload), op.targetId, op.mapId, atlasId]
    );
  } else if (type === 'delete') {
    await t.none(
      `UPDATE catalog_layers SET deleted_at = NOW(), updated_at = NOW(), version = version + 1
       WHERE id = $1 AND map_id = $2
         AND EXISTS (SELECT 1 FROM maps WHERE id = $2 AND atlas_id = $3)`,
      [op.targetId, op.mapId, atlasId]
    );
  }
}

/**
 * Applies a spatial-comment op (create/update/delete). Comments are a dedicated entity (root +
 * replies via parent_id; replies are separate rows so concurrent replies don't clobber — P10).
 * IDOR-safe: a create is pinned to a map of THIS atlas; update/delete are scoped by atlas_id.
 * @param {Object} t - Transaction context from pg-promise
 */
const COMMENT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {*} v @returns {string|null} v if it's a UUID string, else null. */
function asUuidOrNull(v) {
  return typeof v === 'string' && COMMENT_UUID_RE.test(v) ? v : null;
}

async function applyCommentOp(t, atlasId, op, type, userId, permission) {
  const data = op.changes ?? op.data ?? {};
  // Editors and above may act on ANY comment; a Comentarista only on their OWN (authorship gate).
  const isEditor = permission === 'write' || permission === 'manage' || permission === 'owner';

  if (type === 'create') {
    // Robustness: a non-UUID authorId/parentId is dropped to NULL — otherwise Postgres 22P02
    // (invalid uuid) would abort the whole flush batch (the poison-pill class already guarded for
    // mapId in the frontend dispatcher). A reply whose parent no longer exists soft-fails (inserts
    // zero rows via the EXISTS guard) instead of raising a 23503 FK violation.
    // Authorship comes from the AUTHENTICATED principal, never from the payload.
    //
    // This used to be `asUuidOrNull(data.authorId)` — the UUID the client put in its
    // own operation — while `userId` (the real `req.user.id`, threaded down from
    // pushOperations) sat unused two parameters away. Anyone able to push could
    // therefore post a spatial comment attributed to someone else, and the same
    // `data` JSONB still carries the display identity (authorName/Initials/Color)
    // verbatim, so the forgery renders convincingly in the UI.
    //
    // It also silently disarmed the ownership gate that update/delete rely on
    // (`author_id = $6`): a comment stamped with a foreign id becomes uneditable by
    // its actual writer.
    //
    // The display fields inside `data` are left as sent — they are cosmetic and the
    // client owns its own rendering — but `author_id`, the column every authorization
    // check reads, is now the server's word.
    const authorId = asUuidOrNull(userId);
    const parentId = asUuidOrNull(data.parentId);
    await t.none(`
      INSERT INTO comments (id, atlas_id, map_id, parent_id, author_id, lng, lat, status, data)
      SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb
      WHERE EXISTS (SELECT 1 FROM maps WHERE id = $3 AND atlas_id = $2)
        AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM comments WHERE id = $4::uuid AND atlas_id = $2))
      ON CONFLICT (id) DO NOTHING
    `, [
      op.targetId,
      atlasId,
      op.mapId,
      parentId,
      authorId,
      data.lng ?? null,
      data.lat ?? null,
      data.status === 'resolved' ? 'resolved' : 'open',
      JSON.stringify(data),
    ]);
  } else if (type === 'update') {
    // Keep the existing status when the payload doesn't carry a valid one (a text-only edit must
    // not silently reopen a resolved comment). Author gate: own comment, or editor+.
    const status = data.status === 'resolved' || data.status === 'open' ? data.status : null;
    await t.none(`
      UPDATE comments SET data = $1::jsonb, status = COALESCE($2, status), updated_at = NOW(), version = version + 1
      WHERE id = $3 AND atlas_id = $4 AND deleted_at IS NULL AND ($5 OR author_id = $6)
    `, [
      JSON.stringify(data),
      status,
      op.targetId,
      atlasId,
      isEditor,
      userId,
    ]);
  } else if (type === 'delete') {
    // Soft-delete the target AND, for a root, its replies (cascade), authorized by the TARGET's
    // author (or editor+). Replies of an authorized root delete are removed regardless of their
    // own author — deleting a thread deletes the thread.
    await t.none(`
      UPDATE comments SET deleted_at = NOW(), updated_at = NOW(), version = version + 1
      WHERE atlas_id = $2 AND deleted_at IS NULL AND (id = $1 OR parent_id = $1)
        AND ($3 OR EXISTS (SELECT 1 FROM comments WHERE id = $1 AND author_id = $4))
    `, [op.targetId, atlasId, isEditor, userId]);
  }
}

/**
 * Applies an operation to the appropriate entity table.
 * @param {Object} t - Transaction context from pg-promise
 */
async function applyOperation(t, atlasId, op, userId, permission) {
  const target = op.target;
  const type = op.type;
  // Rows touched by the main entity write, for the SyncLedger server.applied span
  // (the "acked but no effect" guard, I2). Undefined for paths we don't measure
  // (setting/catalog/comment/group_feature-create and unmeasured creates).
  let rowsAffected;

  // Lock enforcement runs BEFORE this function, as a per-op refusal
  // (lockedMapDenialReason in pushOperations): a locked map must not abort the batch.

  // Reject a malformed streetview360 orientation that lacks a photoName at the write boundary: an
  // orientation is a saved camera view for ONE specific panorama, so without a photoName the row is
  // meaningless to the frontend (which only ever looks orientations up by photoName) and would have no
  // valid key in the snapshot. It is kept in the append-only operations log (history) but NEVER
  // materialized into streetview360_data, so the invalid orientation can never become real data.
  // (The snapshot reshape also drops any such row defensively, for legacy data predating this guard.)
  if (target === 'streetview360' && type === 'create'
      && op.data?.data_type === 'orientation' && !op.data?.photo_name) {
    return 0; // no rows materialized
  }

  // §24.8 atlas-level setting (e.g. terrainExaggeration): merge a WHITELISTED patch
  // into atlas.settings (JSONB shallow merge), scoped to the route atlas. Only known
  // app-preference keys are accepted — never the resource-availability keys — so a
  // write user cannot rewrite which basemaps/layers the atlas exposes. (Previously a
  // `setting`/`atlas_meta` op was a silent no-op that still acked success.)
  if (target === 'setting' && type === 'update') {
    const patch = op.changes || op.data || {};
    const safe = {};
    if (patch.terrainExaggeration !== undefined) safe.terrainExaggeration = patch.terrainExaggeration;
    // datamodel-13/14: app-level preference state that is local-only today, synced
    // through the SAME whitelist mechanism as terrainExaggeration. customIcons is the
    // icon REGISTRY (metadata list under the frontend key `custom_icons`; the blobs
    // sync via the images endpoint, not here) — a list, replaced wholesale on each
    // write. mapBadgeColors (map-name→color) and colorUsage (per-map color counts,
    // frontend key `color_usage`, nested as { [mapName]: counts }) are keyed objects:
    // they are shallow-merged into their OWN sub-object (see SETTING_OBJECT_KEYS) so a
    // per-map write accumulates instead of clobbering sibling maps. None of these is a
    // resource-availability key (features/basemaps/etc.), which stay rejected so a
    // write user cannot rewrite what the atlas exposes.
    if (patch.customIcons !== undefined) safe.customIcons = patch.customIcons;
    // mapOrder (array of map names) — the maps-list ordering; a plain array replaced
    // wholesale. Not a resource-availability key, so a write user may reorder the list.
    if (patch.mapOrder !== undefined) safe.mapOrder = patch.mapOrder;
    // Object-valued keys are merged per-key below; collect their incoming patches.
    const objectPatches = {};
    for (const key of SETTING_OBJECT_KEYS) {
      if (patch[key] !== undefined && patch[key] !== null && typeof patch[key] === 'object') {
        objectPatches[key] = patch[key];
      }
    }
    if (Object.keys(safe).length > 0 || Object.keys(objectPatches).length > 0) {
      // Build the merged settings expression: a top-level shallow merge for the plain
      // keys (`safe`), plus a deep one-level merge for each object key so concurrent
      // per-map writes don't drop each other (`COALESCE(settings->key,'{}') || incoming`).
      const setParts = ['settings || $1::jsonb'];
      const values = [JSON.stringify(safe)];
      let idx = 2;
      const objectAssignments = [];
      for (const [key, value] of Object.entries(objectPatches)) {
        objectAssignments.push(
          `jsonb_build_object('${key}', COALESCE(settings->'${key}', '{}'::jsonb) || $${idx}::jsonb)`
        );
        values.push(JSON.stringify(value));
        idx++;
      }
      // Apply object-key deep merges on top of the shallow base.
      let expr = setParts[0];
      for (const assignment of objectAssignments) {
        expr = `(${expr}) || ${assignment}`;
      }
      values.push(atlasId);
      await t.none(
        `UPDATE atlas SET settings = ${expr}, updated_at = NOW()
         WHERE id = $${idx} AND deleted_at IS NULL`,
        values
      );
    }
    return;
  }

  // Map target to table name
  const tableMap = {
    feature: 'features',
    group: 'groups',
    layer: 'layers',
    map: 'maps',
    map_meta: 'maps',
    atlas_meta: 'atlas',
    briefing: 'briefings',
    slide: 'slides',
    cesium3d: 'cesium3d_data',
    streetview360: 'streetview360_data',
    group_feature: 'group_features',
    catalog_layer: 'catalog_layers',
    comment: 'comments',
  };

  const table = tableMap[target];
  if (!table) {
    return; // Unknown target, skip
  }

  // catalogLayer has dual-mode handling (legacy whole-array vs per-layer table).
  if (target === 'catalog_layer') {
    await applyCatalogLayerOp(t, atlasId, op, type);
    return;
  }

  // Spatial comments have their own column shape (parent_id, lng/lat, status).
  if (target === 'comment') {
    await applyCommentOp(t, atlasId, op, type, userId, permission);
    return;
  }

  switch (type) {
    case 'create': {
      // RESURRECT-ON-CREATE (decided 2026-07-19, reverses the earlier tombstone-is-final
      // behavior). The client's undo of a delete replays the ORIGINAL entity, keeping its
      // original id (store-state-manager.js:616, `case 'remove': addFeature(action.feature)`),
      // so a Ctrl+Z after a delete arrives here as a create whose targetId is a tombstone.
      // With the previous `ON CONFLICT (id) DO NOTHING` that was a silent no-op still acked
      // as success, so the entity stayed alive on the client, dead on the server, and was
      // killed locally by the next snapshot: permanent data loss in the most common gesture
      // of the product.
      //
      // The `WHERE <table>.deleted_at IS NOT NULL` guard is load-bearing: it keeps the old
      // DO NOTHING semantics for rows that are still ALIVE, so a replayed/stale create can
      // never clobber newer data on a live row. Only tombstones are revived.
      // Handle create operations for different targets
      if (target === 'feature' && op.data && op.mapId) {
        const data = op.data;
        // INSERT...SELECT...WHERE EXISTS pins the row to a map of THIS atlas: a
        // create with a foreign atlas's mapId inserts zero rows (cross-atlas IDOR).
        const r = await t.result(`
          INSERT INTO features (id, map_id, feature_type, geometry, properties, layer_id)
          SELECT $1, $2, $3, $4::jsonb, $5::jsonb, $6
          WHERE EXISTS (SELECT 1 FROM maps WHERE id = $2 AND atlas_id = $7)
          ON CONFLICT (id) DO UPDATE
            SET geometry   = EXCLUDED.geometry,
                properties = EXCLUDED.properties,
                layer_id   = EXCLUDED.layer_id,
                deleted_at = NULL,
                updated_at = NOW(),
                version    = features.version + 1
            WHERE features.deleted_at IS NOT NULL
        `, [
          op.targetId,
          op.mapId,
          data.feature_type,
          JSON.stringify(data.geometry || {}),
          JSON.stringify(data.properties || {}),
          data.layer_id || null,
          atlasId,
        ]);
        rowsAffected = r.rowCount;
      } else if (target === 'group' && op.data && op.mapId) {
        const data = op.data;
        await t.none(`
          INSERT INTO groups (id, map_id, name, visible, locked, style, parent_id)
          SELECT $1, $2, $3, $4, $5, $6::jsonb, $7
          WHERE EXISTS (SELECT 1 FROM maps WHERE id = $2 AND atlas_id = $8)
          ON CONFLICT (id) DO UPDATE
            SET name       = EXCLUDED.name,
                visible    = EXCLUDED.visible,
                locked     = EXCLUDED.locked,
                style      = EXCLUDED.style,
                parent_id  = EXCLUDED.parent_id,
                deleted_at = NULL,
                updated_at = NOW(),
                version    = groups.version + 1
            WHERE groups.deleted_at IS NOT NULL
        `, [
          op.targetId,
          op.mapId,
          data.name,
          data.visible !== false,
          data.locked === true,
          JSON.stringify(data.style || {}),
          data.parent_id || null,
          atlasId,
        ]);
      } else if (target === 'layer' && op.data && op.mapId) {
        const data = op.data;
        await t.none(`
          INSERT INTO layers (id, map_id, name, visible, locked, opacity, sort_order, style)
          SELECT $1, $2, $3, $4, $5, $6, $7, $8::jsonb
          WHERE EXISTS (SELECT 1 FROM maps WHERE id = $2 AND atlas_id = $9)
          ON CONFLICT (id) DO UPDATE
            SET name       = EXCLUDED.name,
                visible    = EXCLUDED.visible,
                locked     = EXCLUDED.locked,
                opacity    = EXCLUDED.opacity,
                sort_order = EXCLUDED.sort_order,
                style      = EXCLUDED.style,
                deleted_at = NULL,
                updated_at = NOW(),
                version    = layers.version + 1
            WHERE layers.deleted_at IS NOT NULL
        `, [
          op.targetId,
          op.mapId,
          data.name,
          data.visible !== false,
          data.locked === true,
          data.opacity ?? 1,
          data.sort_order ?? data.order ?? 0, // Accept both 'order' (frontend) and 'sort_order' (backend)
          JSON.stringify(data.style || {}),
          atlasId,
        ]);
      } else if (target === 'group_feature' && op.data) {
        const data = op.data;
        // Both the group and the feature must live in a map of this atlas, else a
        // write to atlas A could link entities of atlas B. EXISTS gates the insert.
        await t.none(`
          INSERT INTO group_features (group_id, feature_id)
          SELECT $1, $2
          WHERE EXISTS (SELECT 1 FROM groups g JOIN maps m ON m.id = g.map_id WHERE g.id = $1 AND m.atlas_id = $3)
            AND EXISTS (SELECT 1 FROM features f JOIN maps m ON m.id = f.map_id WHERE f.id = $2 AND m.atlas_id = $3)
          ON CONFLICT DO NOTHING
        `, [data.group_id, data.feature_id, atlasId]);
      } else if (target === 'map' && op.data) {
        const data = op.data;
        await t.none(`
          INSERT INTO maps (id, atlas_id, name, base_layer, center_lat, center_long, zoom, bearing, pitch, notes_title, notes_description, analysis_layers, catalog_layers, grid_style, temporal_config, locked)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16)
          ON CONFLICT (id) DO UPDATE
            SET name               = EXCLUDED.name,
                base_layer         = EXCLUDED.base_layer,
                center_lat         = EXCLUDED.center_lat,
                center_long        = EXCLUDED.center_long,
                zoom               = EXCLUDED.zoom,
                bearing            = EXCLUDED.bearing,
                pitch              = EXCLUDED.pitch,
                notes_title        = EXCLUDED.notes_title,
                notes_description  = EXCLUDED.notes_description,
                analysis_layers    = EXCLUDED.analysis_layers,
                catalog_layers     = EXCLUDED.catalog_layers,
                grid_style         = EXCLUDED.grid_style,
                temporal_config    = EXCLUDED.temporal_config,
                locked             = EXCLUDED.locked,
                deleted_at         = NULL,
                updated_at         = NOW(),
                version            = maps.version + 1
            WHERE maps.deleted_at IS NOT NULL
        `, [
          op.targetId,
          atlasId,
          data.name,
          data.base_layer || 'carta-topografica',
          data.center_lat || null,
          data.center_long || null,
          data.zoom || null,
          data.bearing ?? 0,
          data.pitch ?? 0,
          data.notes_title || null,
          data.notes_description || null,
          JSON.stringify(data.analysis_layers || {}),
          JSON.stringify(data.catalog_layers || []),
          JSON.stringify(data.grid_style || {}),
          JSON.stringify(data.temporal_config || {}),
          data.locked === true,
        ]);
      } else if (target === 'briefing' && op.data) {
        const data = op.data;
        await t.none(`
          INSERT INTO briefings (id, atlas_id, name, description, settings, slide_order)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::uuid[])
          ON CONFLICT (id) DO UPDATE
            SET name        = EXCLUDED.name,
                description = EXCLUDED.description,
                settings    = EXCLUDED.settings,
                slide_order = EXCLUDED.slide_order,
                deleted_at  = NULL,
                updated_at  = NOW(),
                version     = briefings.version + 1
            WHERE briefings.deleted_at IS NOT NULL
        `, [
          op.targetId,
          atlasId,
          data.name,
          data.description || null,
          JSON.stringify(data.settings || {}),
          data.slide_order || [],
        ]);
      } else if (target === 'slide' && op.data) {
        const data = op.data;
        // The client sends the map's NAME in `mapId`; the column is a UUID. Translate
        // here, where the transaction is available. See resolveSlideMapId.
        data.map_id = await resolveSlideMapId(t, atlasId, data);
        // Guard the insert: only attach the slide when its briefing belongs to the
        // route's atlas. A cross-atlas briefing_id yields zero inserted rows.
        await t.none(`
          INSERT INTO slides (id, briefing_id, title, content, mode, map_id, model_id, photo_id, position, orientation, temporal_cursor)
          SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb
          WHERE EXISTS (SELECT 1 FROM briefings WHERE id = $2 AND atlas_id = $12)
          ON CONFLICT (id) DO UPDATE
            SET briefing_id      = EXCLUDED.briefing_id,
                title            = EXCLUDED.title,
                content          = EXCLUDED.content,
                mode             = EXCLUDED.mode,
                map_id           = EXCLUDED.map_id,
                model_id         = EXCLUDED.model_id,
                photo_id         = EXCLUDED.photo_id,
                position         = EXCLUDED.position,
                orientation      = EXCLUDED.orientation,
                temporal_cursor  = EXCLUDED.temporal_cursor,
                deleted_at       = NULL,
                updated_at       = NOW(),
                version          = slides.version + 1
            WHERE slides.deleted_at IS NOT NULL
        `, [
          op.targetId,
          data.briefing_id,
          data.title || null,
          data.content || null,
          data.mode || '2d',
          data.map_id || null,
          data.model_id || null,
          data.photo_id || null,
          JSON.stringify(data.position || {}),
          JSON.stringify(data.orientation || {}),
          data.temporal_cursor != null ? JSON.stringify(data.temporal_cursor) : null,
          atlasId,
        ]);
      } else if (target === 'cesium3d' && op.data && op.mapId) {
        const data = op.data;
        await t.none(`
          INSERT INTO cesium3d_data (id, map_id, data_type, tileset_id, data)
          SELECT $1, $2, $3, $4, $5::jsonb
          WHERE EXISTS (SELECT 1 FROM maps WHERE id = $2 AND atlas_id = $6)
          ON CONFLICT (id) DO NOTHING
        `, [
          op.targetId,
          op.mapId,
          data.data_type,
          data.tileset_id || null,
          JSON.stringify(data.data || {}),
          atlasId,
        ]);
      } else if (target === 'streetview360' && op.data && op.mapId) {
        const data = op.data;
        await t.none(`
          INSERT INTO streetview360_data (id, map_id, data_type, photo_name, data)
          SELECT $1, $2, $3, $4, $5::jsonb
          WHERE EXISTS (SELECT 1 FROM maps WHERE id = $2 AND atlas_id = $6)
          ON CONFLICT (id) DO NOTHING
        `, [
          op.targetId,
          op.mapId,
          data.data_type,
          data.photo_name || null,
          JSON.stringify(data.data || {}),
          atlasId,
        ]);
      }
      break;
    }

    case 'update': {
      // Same NAME→UUID translation as the create path: an edited slide carries the
      // map's display name, and buildUpdateQuery is synchronous, so the lookup has to
      // happen here while the transaction is in scope. Done BEFORE the cross-atlas
      // check below, so the resolved id is what gets validated.
      if (target === 'slide' && op.changes) {
        op.changes.map_id = await resolveSlideMapId(t, atlasId, op.changes);
      }

      // A feature/slide carries a settable map_id; moving it to a map of ANOTHER
      // atlas would inject/exfiltrate across tenants. Require the destination map
      // to belong to THIS atlas (null map_id = clearing the ref, always allowed).
      if ((target === 'feature' || target === 'slide') && op.changes && op.changes.map_id) {
        const dest = await t.oneOrNone(
          'SELECT 1 FROM maps WHERE id = $1 AND atlas_id = $2',
          [op.changes.map_id, atlasId]
        );
        if (!dest) throw new ForbiddenError('Cross-atlas map reference denied');
      }
      const updateQuery = buildUpdateQuery(target, op, atlasId);
      if (updateQuery) {
        const r = await t.result(updateQuery.sql, updateQuery.values);
        rowsAffected = r.rowCount;
      }
      break;
    }

    case 'delete': {
      // group_feature is a hard delete (join table, no soft-delete), scoped to the
      // atlas via the group's map so atlas A can't unlink atlas B's associations.
      if (target === 'group_feature' && op.data) {
        const r = await t.result(
          `DELETE FROM group_features
           WHERE group_id = $1 AND feature_id = $2
             AND group_id IN (SELECT g.id FROM groups g JOIN maps m ON m.id = g.map_id WHERE m.atlas_id = $3)`,
          [op.data.group_id, op.data.feature_id, atlasId]
        );
        rowsAffected = r.rowCount;
        break;
      }

      // All other entities use soft-delete with the same pattern
      const deleteQuery = buildSoftDeleteQuery(table, target, op, atlasId);
      if (deleteQuery) {
        const r = await t.result(deleteQuery.sql, deleteQuery.values);
        rowsAffected = r.rowCount;
      }

      // §2.2 cascade: deleting a LAYER soft-deletes all its features in the same
      // transaction ("deletar camada e todas as feições"). Scoped to a map of THIS
      // atlas (cross-atlas IDOR guard) and only rows not already deleted.
      if (target === 'layer' && op.mapId) {
        await t.none(
          `UPDATE features SET deleted_at = NOW(), updated_at = NOW(), version = version + 1
           WHERE layer_id = $1 AND map_id = $2 AND deleted_at IS NULL
             AND EXISTS (SELECT 1 FROM maps m WHERE m.id = $2 AND m.atlas_id = $3)`,
          [op.targetId, op.mapId, atlasId]
        );
      }
      break;
    }
  }

  return rowsAffected;
}
