// Path: src/modules/sync/sync.service.js
import { query, tx, task } from '../../database/index.js';
import * as Q from './sync.queries.js';

/**
 * Maps frontend-specific entity types to backend generic types.
 * Frontend uses specific types like 'marker3d', 'measurement3d', etc.
 * Backend uses generic 'cesium3d' and 'streetview360' with data_type field.
 */
const ENTITY_TYPE_MAP = {
  // Cesium 3D types → cesium3d
  marker3d: { target: 'cesium3d', dataType: 'marker' },
  measurement3d: { target: 'cesium3d', dataType: 'measurement' },
  viewshed3d: { target: 'cesium3d', dataType: 'viewshed' },
  cameraPosition3d: { target: 'cesium3d', dataType: 'camera_position' },
  // StreetView 360 types → streetview360
  orientation360: { target: 'streetview360', dataType: 'orientation' },
  marker360: { target: 'streetview360', dataType: 'marker' },
  // Map sub-entity types → map (these are updates to specific map fields)
  mapPosition: { target: 'map', subType: 'position' },
  baseLayer: { target: 'map', subType: 'baseLayer' },
  mapNotes: { target: 'map', subType: 'notes' },
  gridStyle: { target: 'map', subType: 'grid' },
  catalogLayer: { target: 'map', subType: 'catalog' },
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
 * Normalizes operation field names from frontend format to internal format.
 * Frontend uses: entityType, operationType, entityId
 * Internal uses: target, type, targetId (for DB compatibility)
 * This function accepts BOTH formats for compatibility.
 * Also maps specific 3D/360 entity types to generic backend types.
 */
function normalizeOperation(op) {
  // Get raw entity type from frontend or backend format
  const rawEntityType = op.entityType || op.target;
  const mapping = ENTITY_TYPE_MAP[rawEntityType];

  // If it's a mapped type (like marker3d), convert to generic type and inject data_type
  let target = rawEntityType;
  let data = op.data;
  let subType = null;

  if (mapping) {
    target = mapping.target;
    subType = mapping.subType || null;

    // Inject data_type into data object for cesium3d/streetview360
    if (mapping.dataType) {
      if (data && !data.data_type) {
        data = { ...data, data_type: mapping.dataType };
      } else if (!data) {
        data = { data_type: mapping.dataType };
      }
    }
  }

  return {
    ...op,
    // Use normalized target (mapped if needed)
    target,
    type: op.operationType || op.type,
    targetId: op.entityId || op.targetId,
    data,
    // Sub-type for map field updates (mapPosition, baseLayer, etc.)
    _subType: subType,
    // Keep original frontend entity type for responses
    _originalEntityType: rawEntityType,
    entityType: rawEntityType,
    operationType: op.operationType || op.type,
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
      sync: {
        createdAt: new Date(item.created_at).getTime(),
        updatedAt: new Date(item.updated_at).getTime(),
        version: item.version,
        ownerId: null,
        dirty: false,
        deleted: false,
      },
    };

    switch (item.data_type) {
      case 'camera_position':
        if (item.tileset_id) {
          result.cameraPositions[item.tileset_id] = entry;
        }
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
      sync: {
        createdAt: new Date(item.created_at).getTime(),
        updatedAt: new Date(item.updated_at).getTime(),
        version: item.version,
        ownerId: null,
        dirty: false,
        deleted: false,
      },
    };

    switch (item.data_type) {
      case 'orientation':
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
    arrows: [],
    boundarys: [],
    occupied_fronts: [],
    military_symbols: [],
    coordination_measures: [],
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
    arrow: 'arrows',
    boundary: 'boundarys',
    occupied_front: 'occupied_fronts',
    military_symbol: 'military_symbols',
    coordination_measure: 'coordination_measures',
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
export async function getAtlasSnapshot(atlasId) {
  return task(async (t) => {
    // Get atlas metadata
    const atlasResult = await t.query(Q.GET_ATLAS_METADATA, [atlasId]);
    if (atlasResult.length === 0) {
      return null;
    }
    const atlas = atlasResult[0];

    // Get all maps
    const maps = await t.query(Q.GET_ATLAS_MAPS, [atlasId]);

    // Get features, layers, groups, cesium3d, streetview360 for each map
    // Transform to frontend format
    for (const map of maps) {
      const rawFeatures = await t.query(Q.GET_MAP_FEATURES, [map.id]);
      const rawCesium3d = await t.query(Q.GET_MAP_CESIUM3D, [map.id]);
      const rawStreetview360 = await t.query(Q.GET_MAP_STREETVIEW360, [map.id]);

      // Transform to frontend structure
      map.features = transformFeaturesToFrontend(rawFeatures);
      map.cesium3d = transformCesium3dToFrontend(rawCesium3d);
      map.streetview360 = transformStreetview360ToFrontend(rawStreetview360);

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
          features: groupFeatureRefs, // Frontend expects embedded features array
          sync: {
            createdAt: new Date(group.created_at).getTime(),
            updatedAt: new Date(group.updated_at).getTime(),
            version: group.version,
            ownerId: null,
            dirty: false,
            deleted: false,
          },
        };
      });

      // Keep groupFeatures for backwards compatibility (optional)
      map.groupFeatures = groupFeatures;

      // Add sync metadata to map
      map.sync = {
        createdAt: new Date(map.created_at).getTime(),
        updatedAt: new Date(map.updated_at).getTime(),
        version: map.version,
        ownerId: null,
        dirty: false,
        deleted: false,
      };
    }

    // Get all briefings with slides
    const briefings = await t.query(Q.GET_ATLAS_BRIEFINGS, [atlasId]);
    for (const briefing of briefings) {
      briefing.slides = await t.query(Q.GET_BRIEFING_SLIDES, [briefing.id]);
      // Add sync metadata to briefing
      briefing.sync = {
        createdAt: new Date(briefing.created_at).getTime(),
        updatedAt: new Date(briefing.updated_at).getTime(),
        version: briefing.version,
        ownerId: null,
        dirty: false,
        deleted: false,
      };
    }

    return {
      atlas: {
        id: atlas.id,
        name: atlas.name,
        description: atlas.description,
        settings: atlas.settings,
        mapOrder: atlas.map_order,
        isPublic: atlas.is_public,
        sync: {
          createdAt: new Date(atlas.created_at).getTime(),
          updatedAt: new Date(atlas.updated_at).getTime(),
          version: atlas.version,
          ownerId: atlas.owner_id,
          dirty: false,
          deleted: false,
        },
      },
      maps,
      briefings,
      currentVersion: parseInt(atlas.current_version, 10),
    };
  });
}

/**
 * Pushes a batch of operations to the server.
 * Operations are applied and recorded in the operations log.
 * Accepts both frontend format (entityType, operationType, entityId) and
 * legacy format (target, type, targetId).
 */
export async function pushOperations(atlasId, operations, userId) {
  const acks = [];

  await tx(async (t) => {
    for (const rawOp of operations) {
      // Normalize operation to internal format (accepts both frontend and legacy names)
      const op = normalizeOperation(rawOp);

      // Insert operation into log (using internal field names)
      const inserted = await t.one(Q.INSERT_OPERATION, [
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
      ]);

      acks.push({
        opId: rawOp.id,
        serverVersion: inserted.server_version,
      });

      // Apply operation to entity tables based on normalized op
      await applyOperation(t, atlasId, op);
    }
  });

  // Get current version (outside transaction)
  const versionResult = await query(Q.GET_CURRENT_VERSION, [atlasId]);
  const serverVersion = parseInt(versionResult.rows[0].current_version, 10);

  return { acks, serverVersion };
}

/**
 * Pulls operations since a given version.
 * Uses hybrid approach:
 * - If sinceVersion == 0 or sinceVersion < min_version → returns full snapshot
 * - Otherwise → returns incremental operations
 */
export async function pullOperations(atlasId, sinceVersion) {
  // Get sync info to check min_version
  const syncInfo = await getAtlasSyncInfo(atlasId);
  if (!syncInfo) {
    return { operations: [], currentVersion: 0, isSnapshot: false };
  }

  const minVersion = parseInt(syncInfo.min_version, 10);
  const currentVersion = parseInt(syncInfo.current_version, 10);

  // If client is too far behind or starting fresh, return snapshot
  if (sinceVersion === 0 || sinceVersion < minVersion) {
    const snapshot = await getAtlasSnapshot(atlasId);
    if (!snapshot) {
      return { operations: [], currentVersion: 0, isSnapshot: false };
    }
    return {
      snapshot,
      currentVersion: snapshot.currentVersion,
      isSnapshot: true,
    };
  }

  // Otherwise return incremental operations (converted to frontend format)
  const opsResult = await query(Q.GET_OPERATIONS_SINCE_VERSION, [atlasId, sinceVersion]);

  return {
    operations: opsResult.rows.map(toFrontendOperation),
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
 * Applies an operation to the appropriate entity table.
 * @param {Object} t - Transaction context from pg-promise
 */
async function applyOperation(t, atlasId, op) {
  const target = op.target;
  const type = op.type;

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
  };

  const table = tableMap[target];
  if (!table) {
    return; // Unknown target, skip
  }

  switch (type) {
    case 'create': {
      // Handle create operations for different targets
      if (target === 'feature' && op.data && op.mapId) {
        const data = op.data;
        await t.none(`
          INSERT INTO features (id, map_id, feature_type, geometry, properties, layer_id)
          VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
          ON CONFLICT (id) DO NOTHING
        `, [
          op.targetId,
          op.mapId,
          data.feature_type,
          JSON.stringify(data.geometry || {}),
          JSON.stringify(data.properties || {}),
          data.layer_id || null,
        ]);
      } else if (target === 'group' && op.data && op.mapId) {
        const data = op.data;
        await t.none(`
          INSERT INTO groups (id, map_id, name, visible, locked, style, parent_id)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
          ON CONFLICT (id) DO NOTHING
        `, [
          op.targetId,
          op.mapId,
          data.name,
          data.visible !== false,
          data.locked === true,
          JSON.stringify(data.style || {}),
          data.parent_id || null,
        ]);
      } else if (target === 'layer' && op.data && op.mapId) {
        const data = op.data;
        await t.none(`
          INSERT INTO layers (id, map_id, name, visible, locked, opacity, sort_order, style)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
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
        ]);
      } else if (target === 'group_feature' && op.data) {
        const data = op.data;
        await t.none(`
          INSERT INTO group_features (group_id, feature_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `, [data.group_id, data.feature_id]);
      } else if (target === 'map' && op.data) {
        const data = op.data;
        await t.none(`
          INSERT INTO maps (id, atlas_id, name, base_layer, center_lat, center_long, zoom, bearing, pitch, notes_title, notes_description, analysis_layers, catalog_layers, locked)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14)
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
          data.locked === true,
        ]);
      } else if (target === 'briefing' && op.data) {
        const data = op.data;
        await t.none(`
          INSERT INTO briefings (id, atlas_id, name, description, settings, slide_order)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6)
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
        await t.none(`
          INSERT INTO slides (id, briefing_id, title, content, mode, map_id, model_id, photo_id, position, orientation)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
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
        ]);
      } else if (target === 'cesium3d' && op.data && op.mapId) {
        const data = op.data;
        await t.none(`
          INSERT INTO cesium3d_data (id, map_id, data_type, tileset_id, data)
          VALUES ($1, $2, $3, $4, $5::jsonb)
          ON CONFLICT (id) DO NOTHING
        `, [
          op.targetId,
          op.mapId,
          data.data_type,
          data.tileset_id || null,
          JSON.stringify(data.data || {}),
        ]);
      } else if (target === 'streetview360' && op.data && op.mapId) {
        const data = op.data;
        await t.none(`
          INSERT INTO streetview360_data (id, map_id, data_type, photo_name, data)
          VALUES ($1, $2, $3, $4, $5::jsonb)
          ON CONFLICT (id) DO NOTHING
        `, [
          op.targetId,
          op.mapId,
          data.data_type,
          data.photo_name || null,
          JSON.stringify(data.data || {}),
        ]);
      }
      break;
    }

    case 'update': {
      if (target === 'feature' && op.changes && op.mapId) {
        // Apply changes to feature
        const changes = op.changes;
        const setClauses = [];
        const values = [op.targetId, op.mapId];
        let paramIndex = 3;

        if (changes.geometry !== undefined) {
          setClauses.push(`geometry = $${paramIndex}::jsonb`);
          values.push(JSON.stringify(changes.geometry));
          paramIndex++;
        }
        if (changes.properties !== undefined) {
          setClauses.push(`properties = $${paramIndex}::jsonb`);
          values.push(JSON.stringify(changes.properties));
          paramIndex++;
        }
        if (changes.layer_id !== undefined) {
          setClauses.push(`layer_id = $${paramIndex}`);
          values.push(changes.layer_id);
          paramIndex++;
        }
        if (changes.feature_type !== undefined) {
          setClauses.push(`feature_type = $${paramIndex}`);
          values.push(changes.feature_type);
          paramIndex++;
        }

        if (setClauses.length > 0) {
          setClauses.push('updated_at = NOW()', 'version = version + 1');
          await t.none(
            `UPDATE features SET ${setClauses.join(', ')} WHERE id = $1 AND map_id = $2`,
            values
          );
        }
      } else if (target === 'group' && op.changes && op.mapId) {
        const changes = op.changes;
        const setClauses = [];
        const values = [op.targetId, op.mapId];
        let paramIndex = 3;

        if (changes.name !== undefined) {
          setClauses.push(`name = $${paramIndex}`);
          values.push(changes.name);
          paramIndex++;
        }
        if (changes.visible !== undefined) {
          setClauses.push(`visible = $${paramIndex}`);
          values.push(changes.visible);
          paramIndex++;
        }
        if (changes.locked !== undefined) {
          setClauses.push(`locked = $${paramIndex}`);
          values.push(changes.locked);
          paramIndex++;
        }
        if (changes.style !== undefined) {
          setClauses.push(`style = $${paramIndex}::jsonb`);
          values.push(JSON.stringify(changes.style));
          paramIndex++;
        }
        if (changes.parent_id !== undefined) {
          setClauses.push(`parent_id = $${paramIndex}`);
          values.push(changes.parent_id);
          paramIndex++;
        }

        if (setClauses.length > 0) {
          setClauses.push('updated_at = NOW()', 'version = version + 1');
          await t.none(
            `UPDATE groups SET ${setClauses.join(', ')} WHERE id = $1 AND map_id = $2`,
            values
          );
        }
      } else if (target === 'layer' && op.changes && op.mapId) {
        const changes = op.changes;
        const setClauses = [];
        const values = [op.targetId, op.mapId];
        let paramIndex = 3;

        if (changes.name !== undefined) {
          setClauses.push(`name = $${paramIndex}`);
          values.push(changes.name);
          paramIndex++;
        }
        if (changes.visible !== undefined) {
          setClauses.push(`visible = $${paramIndex}`);
          values.push(changes.visible);
          paramIndex++;
        }
        if (changes.locked !== undefined) {
          setClauses.push(`locked = $${paramIndex}`);
          values.push(changes.locked);
          paramIndex++;
        }
        if (changes.opacity !== undefined) {
          setClauses.push(`opacity = $${paramIndex}`);
          values.push(changes.opacity);
          paramIndex++;
        }
        // Accept both 'order' (frontend) and 'sort_order' (backend)
        if (changes.sort_order !== undefined || changes.order !== undefined) {
          setClauses.push(`sort_order = $${paramIndex}`);
          values.push(changes.sort_order ?? changes.order);
          paramIndex++;
        }
        if (changes.style !== undefined) {
          setClauses.push(`style = $${paramIndex}::jsonb`);
          values.push(JSON.stringify(changes.style));
          paramIndex++;
        }

        if (setClauses.length > 0) {
          setClauses.push('updated_at = NOW()', 'version = version + 1');
          await t.none(
            `UPDATE layers SET ${setClauses.join(', ')} WHERE id = $1 AND map_id = $2`,
            values
          );
        }
      } else if (target === 'map' && (op.changes || op.data)) {
        // Handle both regular map updates and sub-entity updates (mapPosition, baseLayer, etc.)
        // For sub-entity updates, the mapId is the target, for regular updates, targetId is the map
        const mapId = op._subType ? op.mapId : op.targetId;
        if (!mapId) break;

        // Merge changes and data (sub-entity updates may use data instead of changes)
        const changes = { ...op.changes, ...op.data };
        const setClauses = [];
        const values = [mapId, atlasId];
        let paramIndex = 3;

        // Regular map fields
        if (changes.name !== undefined) {
          setClauses.push(`name = $${paramIndex}`);
          values.push(changes.name);
          paramIndex++;
        }
        if (changes.base_layer !== undefined || changes.baseLayer !== undefined) {
          setClauses.push(`base_layer = $${paramIndex}`);
          values.push(changes.base_layer || changes.baseLayer);
          paramIndex++;
        }
        if (changes.center_lat !== undefined) {
          setClauses.push(`center_lat = $${paramIndex}`);
          values.push(changes.center_lat);
          paramIndex++;
        }
        if (changes.center_long !== undefined) {
          setClauses.push(`center_long = $${paramIndex}`);
          values.push(changes.center_long);
          paramIndex++;
        }
        if (changes.zoom !== undefined) {
          setClauses.push(`zoom = $${paramIndex}`);
          values.push(changes.zoom);
          paramIndex++;
        }
        if (changes.bearing !== undefined) {
          setClauses.push(`bearing = $${paramIndex}`);
          values.push(changes.bearing);
          paramIndex++;
        }
        if (changes.pitch !== undefined) {
          setClauses.push(`pitch = $${paramIndex}`);
          values.push(changes.pitch);
          paramIndex++;
        }
        // Notes fields (from mapNotes sub-entity or direct)
        if (changes.notes_title !== undefined || changes.title !== undefined) {
          setClauses.push(`notes_title = $${paramIndex}`);
          values.push(changes.notes_title || changes.title);
          paramIndex++;
        }
        if (changes.notes_description !== undefined || changes.description !== undefined) {
          setClauses.push(`notes_description = $${paramIndex}`);
          values.push(changes.notes_description || changes.description);
          paramIndex++;
        }
        if (changes.analysis_layers !== undefined) {
          setClauses.push(`analysis_layers = $${paramIndex}::jsonb`);
          values.push(JSON.stringify(changes.analysis_layers));
          paramIndex++;
        }
        if (changes.catalog_layers !== undefined) {
          setClauses.push(`catalog_layers = $${paramIndex}::jsonb`);
          values.push(JSON.stringify(changes.catalog_layers));
          paramIndex++;
        }
        if (changes.locked !== undefined) {
          setClauses.push(`locked = $${paramIndex}`);
          values.push(changes.locked);
          paramIndex++;
        }

        if (setClauses.length > 0) {
          setClauses.push('updated_at = NOW()', 'version = version + 1');
          await t.none(
            `UPDATE maps SET ${setClauses.join(', ')} WHERE id = $1 AND atlas_id = $2`,
            values
          );
        }
      } else if (target === 'briefing' && op.changes) {
        const changes = op.changes;
        const setClauses = [];
        const values = [op.targetId, atlasId];
        let paramIndex = 3;

        if (changes.name !== undefined) {
          setClauses.push(`name = $${paramIndex}`);
          values.push(changes.name);
          paramIndex++;
        }
        if (changes.description !== undefined) {
          setClauses.push(`description = $${paramIndex}`);
          values.push(changes.description);
          paramIndex++;
        }
        if (changes.settings !== undefined) {
          setClauses.push(`settings = $${paramIndex}::jsonb`);
          values.push(JSON.stringify(changes.settings));
          paramIndex++;
        }
        if (changes.slide_order !== undefined) {
          setClauses.push(`slide_order = $${paramIndex}`);
          values.push(changes.slide_order);
          paramIndex++;
        }

        if (setClauses.length > 0) {
          setClauses.push('updated_at = NOW()', 'version = version + 1');
          await t.none(
            `UPDATE briefings SET ${setClauses.join(', ')} WHERE id = $1 AND atlas_id = $2`,
            values
          );
        }
      } else if (target === 'slide' && op.changes) {
        const changes = op.changes;
        const setClauses = [];
        const values = [op.targetId];
        let paramIndex = 2;

        if (changes.title !== undefined) {
          setClauses.push(`title = $${paramIndex}`);
          values.push(changes.title);
          paramIndex++;
        }
        if (changes.content !== undefined) {
          setClauses.push(`content = $${paramIndex}`);
          values.push(changes.content);
          paramIndex++;
        }
        if (changes.mode !== undefined) {
          setClauses.push(`mode = $${paramIndex}`);
          values.push(changes.mode);
          paramIndex++;
        }
        if (changes.map_id !== undefined) {
          setClauses.push(`map_id = $${paramIndex}`);
          values.push(changes.map_id);
          paramIndex++;
        }
        if (changes.model_id !== undefined) {
          setClauses.push(`model_id = $${paramIndex}`);
          values.push(changes.model_id);
          paramIndex++;
        }
        if (changes.photo_id !== undefined) {
          setClauses.push(`photo_id = $${paramIndex}`);
          values.push(changes.photo_id);
          paramIndex++;
        }
        if (changes.position !== undefined) {
          setClauses.push(`position = $${paramIndex}::jsonb`);
          values.push(JSON.stringify(changes.position));
          paramIndex++;
        }
        if (changes.orientation !== undefined) {
          setClauses.push(`orientation = $${paramIndex}::jsonb`);
          values.push(JSON.stringify(changes.orientation));
          paramIndex++;
        }
        if (changes.is_broken !== undefined) {
          setClauses.push(`is_broken = $${paramIndex}`);
          values.push(changes.is_broken);
          paramIndex++;
        }
        if (changes.broken_reason !== undefined) {
          setClauses.push(`broken_reason = $${paramIndex}`);
          values.push(changes.broken_reason);
          paramIndex++;
        }

        if (setClauses.length > 0) {
          setClauses.push('updated_at = NOW()', 'version = version + 1');
          await t.none(
            `UPDATE slides SET ${setClauses.join(', ')} WHERE id = $1`,
            values
          );
        }
      } else if (target === 'cesium3d' && op.changes && op.mapId) {
        const changes = op.changes;
        const setClauses = [];
        const values = [op.targetId, op.mapId];
        let paramIndex = 3;

        if (changes.data_type !== undefined) {
          setClauses.push(`data_type = $${paramIndex}`);
          values.push(changes.data_type);
          paramIndex++;
        }
        if (changes.tileset_id !== undefined) {
          setClauses.push(`tileset_id = $${paramIndex}`);
          values.push(changes.tileset_id);
          paramIndex++;
        }
        if (changes.data !== undefined) {
          setClauses.push(`data = $${paramIndex}::jsonb`);
          values.push(JSON.stringify(changes.data));
          paramIndex++;
        }

        if (setClauses.length > 0) {
          setClauses.push('updated_at = NOW()', 'version = version + 1');
          await t.none(
            `UPDATE cesium3d_data SET ${setClauses.join(', ')} WHERE id = $1 AND map_id = $2`,
            values
          );
        }
      } else if (target === 'streetview360' && op.changes && op.mapId) {
        const changes = op.changes;
        const setClauses = [];
        const values = [op.targetId, op.mapId];
        let paramIndex = 3;

        if (changes.data_type !== undefined) {
          setClauses.push(`data_type = $${paramIndex}`);
          values.push(changes.data_type);
          paramIndex++;
        }
        if (changes.photo_name !== undefined) {
          setClauses.push(`photo_name = $${paramIndex}`);
          values.push(changes.photo_name);
          paramIndex++;
        }
        if (changes.data !== undefined) {
          setClauses.push(`data = $${paramIndex}::jsonb`);
          values.push(JSON.stringify(changes.data));
          paramIndex++;
        }

        if (setClauses.length > 0) {
          setClauses.push('updated_at = NOW()', 'version = version + 1');
          await t.none(
            `UPDATE streetview360_data SET ${setClauses.join(', ')} WHERE id = $1 AND map_id = $2`,
            values
          );
        }
      }
      break;
    }

    case 'delete': {
      if (target === 'feature' && op.mapId) {
        await t.none(
          `UPDATE features SET deleted_at = NOW(), updated_at = NOW(), version = version + 1 WHERE id = $1 AND map_id = $2`,
          [op.targetId, op.mapId]
        );
      } else if (target === 'group' && op.mapId) {
        await t.none(
          `UPDATE groups SET deleted_at = NOW(), updated_at = NOW(), version = version + 1 WHERE id = $1 AND map_id = $2`,
          [op.targetId, op.mapId]
        );
      } else if (target === 'layer' && op.mapId) {
        await t.none(
          `UPDATE layers SET deleted_at = NOW(), updated_at = NOW(), version = version + 1 WHERE id = $1 AND map_id = $2`,
          [op.targetId, op.mapId]
        );
      } else if (target === 'group_feature' && op.data) {
        const data = op.data;
        await t.none(
          `DELETE FROM group_features WHERE group_id = $1 AND feature_id = $2`,
          [data.group_id, data.feature_id]
        );
      } else if (target === 'map') {
        await t.none(
          `UPDATE maps SET deleted_at = NOW(), updated_at = NOW(), version = version + 1 WHERE id = $1 AND atlas_id = $2`,
          [op.targetId, atlasId]
        );
      } else if (target === 'briefing') {
        await t.none(
          `UPDATE briefings SET deleted_at = NOW(), updated_at = NOW(), version = version + 1 WHERE id = $1 AND atlas_id = $2`,
          [op.targetId, atlasId]
        );
      } else if (target === 'slide') {
        await t.none(
          `UPDATE slides SET deleted_at = NOW(), updated_at = NOW(), version = version + 1 WHERE id = $1`,
          [op.targetId]
        );
      } else if (target === 'cesium3d' && op.mapId) {
        await t.none(
          `UPDATE cesium3d_data SET deleted_at = NOW(), updated_at = NOW(), version = version + 1 WHERE id = $1 AND map_id = $2`,
          [op.targetId, op.mapId]
        );
      } else if (target === 'streetview360' && op.mapId) {
        await t.none(
          `UPDATE streetview360_data SET deleted_at = NOW(), updated_at = NOW(), version = version + 1 WHERE id = $1 AND map_id = $2`,
          [op.targetId, op.mapId]
        );
      }
      break;
    }
  }
}
