// Path: src/modules/sync/sync.service.js
import { query, tx, task } from '../../database/index.js';
import { ForbiddenError, ConflictError } from '../../utils/errors.js';
import * as Q from './sync.queries.js';
import { recordSpan, isTraceEnabled, TraceStage, TraceOutcome } from '../../utils/sync-trace.js';

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
 * The frontend stores a feature as a GeoJSON Feature whose TYPE lives in
 * `properties.source` and whose layer lives in `properties.layerId`. The backend
 * persists `feature_type`/`layer_id` as columns. Derive the flat columns from the
 * properties when the top-level fields are absent (so the raw GeoJSON `data` works).
 */
const FEATURE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  if (mapping) {
    target = mapping.target;
    subType = mapping.subType || null;

    // cesium3d/streetview360: reshape FLAT/nested entity into the backend envelope.
    if (mapping.dataType) {
      data = reshape3d360Payload(data, mapping);
    }
  } else if (rawEntityType === 'feature') {
    // Feature ops carry a raw GeoJSON Feature; derive the flat type/layer columns.
    data = deriveFeatureColumns(data);
  }

  // The frontend's shared create/update factory ALWAYS puts the payload in `data`
  // (it never produces a `changes` key). For updates, fall back to `data` so the
  // update apply path (which reads `changes`) is not a silent no-op / data loss.
  let changes = op.changes;
  if (type === 'update' && (changes === undefined || changes === null) && data != null) {
    changes = data;
  }

  return {
    ...op,
    // Use normalized target (mapped if needed)
    target,
    type,
    targetId: op.entityId || op.targetId,
    data,
    changes,
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

  // Convert generic backend types back to specific frontend types
  const reverseMap = REVERSE_ENTITY_TYPE_MAP[op.entity_type];
  if (reverseMap && op.data && op.data.data_type) {
    const specificType = reverseMap[op.data.data_type];
    if (specificType) {
      entityType = specificType;
    }
  }

  return {
    id: op.id,
    entityType,
    operationType: op.op_type,
    entityId: op.entity_id,
    mapId: op.map_id,
    data: op.data,
    changes: op.changes,
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
        // Key by photoName (always set in the normal app path); fall back to the row id so a
        // persisted orientation is never SILENTLY dropped from the snapshot.
        result.orientations[item.photo_name || item.id] = entry;
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
          sync: buildSyncMetadata(c),
        });
      }
    }

    // Get features, layers, groups, cesium3d, streetview360 for each map
    // Transform to frontend format
    for (const map of maps) {
      const rawFeatures = await t.query(Q.GET_MAP_FEATURES, [map.id]);
      const rawCesium3d = await t.query(Q.GET_MAP_CESIUM3D, [map.id]);
      const rawStreetview360 = await t.query(Q.GET_MAP_STREETVIEW360, [map.id]);
      const rawCatalogLayers = await t.query(Q.GET_MAP_CATALOG_LAYERS, [map.id]);

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
      const rawLayers = await t.query(Q.GET_MAP_LAYERS, [map.id]);
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
      const rawGroups = await t.query(Q.GET_MAP_GROUPS, [map.id]);
      const groupFeatures = await t.query(Q.GET_GROUP_FEATURES, [map.id]);

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

    // Get all briefings with slides
    const briefings = await t.query(Q.GET_ATLAS_BRIEFINGS, [atlasId]);
    for (const briefing of briefings) {
      const rawSlides = await t.query(Q.GET_BRIEFING_SLIDES, [briefing.id]);
      // slide_order (UUID[]) is the canonical ordering; surface `order` (index),
      // the camelCase `temporalCursor`, and per-slide sync metadata for the frontend.
      const order = Array.isArray(briefing.slide_order) ? briefing.slide_order : [];
      briefing.slides = rawSlides.map((slide) => ({
        ...slide,
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

  if (op.target !== 'map') return;
  if (op.type === 'delete' && permission !== 'owner') {
    throw new ForbiddenError('Only the atlas owner can delete a map');
  }
  if (op.type === 'update' && !op._subType) {
    const merged = { ...op.changes, ...op.data };
    if (merged.locked !== undefined && permission !== 'owner') {
      throw new ForbiddenError('Only the atlas owner can lock or unlock a map');
    }
  }
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
    for (const rawOp of operations) {
      // Normalize operation to internal format (accepts both frontend and legacy names)
      const op = normalizeOperation(rawOp);

      // Authorization: map-delete and map lock/unlock are owner-only (multiuser spec).
      assertOperationAllowed(op, permission);

      // Insert operation into log (idempotent: ON CONFLICT (atlas_id, op_id) DO NOTHING).
      const inserted = await t.oneOrNone(Q.INSERT_OPERATION, [
        atlasId,
        op.type,
        op.target,
        op.targetId,
        op.mapId || null,
        op.changes ? JSON.stringify(op.changes) : null,
        op.data ? JSON.stringify(op.data) : null,
        op.timestamp,
        op.clientId,
        userId,
        rawOp.id ?? null,
        op.lamportTimestamp ?? null,
      ]);

      if (!inserted) {
        // Operation already applied (same op_id). Ack with the recorded version
        // and skip re-applying the effect — this is the idempotency guarantee.
        const prev = await t.oneOrNone(Q.GET_OPERATION_BY_OP_ID, [atlasId, rawOp.id]);
        acks.push({
          opId: rawOp.id,
          serverVersion: prev ? prev.server_version : null,
          idempotent: true,
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

      acks.push({
        opId: rawOp.id,
        serverVersion: inserted.server_version,
        idempotent: false,
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

      // Apply operation to entity tables based on normalized op
      const rowsAffected = await applyOperation(t, atlasId, op, userId, permission);

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
    success: true,
    operationId: a.opId,
    idempotent: a.idempotent === true,
    currentVersion: a.serverVersion != null ? parseInt(a.serverVersion, 10) : serverVersion,
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
      `INSERT INTO catalog_layers (id, map_id, data)
       SELECT $1, $2, $3::jsonb
       WHERE EXISTS (SELECT 1 FROM maps WHERE id = $2 AND atlas_id = $4)
       ON CONFLICT (id) DO NOTHING`,
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
    const authorId = asUuidOrNull(data.authorId);
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

  // Lock enforcement: a locked map blocks mutations of its child entities (the
  // spec's "disable editing"). Map-level ops (lock/unlock/delete) are governed by
  // authorization above, so the owner can still unlock.
  if (LOCKABLE_CHILD_TARGETS.has(target) && op.mapId) {
    const m = await t.oneOrNone('SELECT locked FROM maps WHERE id = $1 AND deleted_at IS NULL', [op.mapId]);
    if (m && m.locked) {
      throw new ConflictError('Map is locked');
    }
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
      // Handle create operations for different targets
      if (target === 'feature' && op.data && op.mapId) {
        const data = op.data;
        // INSERT...SELECT...WHERE EXISTS pins the row to a map of THIS atlas: a
        // create with a foreign atlas's mapId inserts zero rows (cross-atlas IDOR).
        const r = await t.result(`
          INSERT INTO features (id, map_id, feature_type, geometry, properties, layer_id)
          SELECT $1, $2, $3, $4::jsonb, $5::jsonb, $6
          WHERE EXISTS (SELECT 1 FROM maps WHERE id = $2 AND atlas_id = $7)
          ON CONFLICT (id) DO NOTHING
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
          ON CONFLICT (id) DO NOTHING
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
          ON CONFLICT (id) DO NOTHING
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
          ON CONFLICT (id) DO NOTHING
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
          ON CONFLICT (id) DO NOTHING
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
        // Guard the insert: only attach the slide when its briefing belongs to the
        // route's atlas. A cross-atlas briefing_id yields zero inserted rows.
        await t.none(`
          INSERT INTO slides (id, briefing_id, title, content, mode, map_id, model_id, photo_id, position, orientation, temporal_cursor)
          SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb
          WHERE EXISTS (SELECT 1 FROM briefings WHERE id = $2 AND atlas_id = $12)
          ON CONFLICT (id) DO NOTHING
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
