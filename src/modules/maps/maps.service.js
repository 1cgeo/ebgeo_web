// Path: src/modules/maps/maps.service.js
import { query } from '../../database/index.js';
import { NotFoundError } from '../../utils/errors.js';
import * as Q from './maps.queries.js';

/**
 * Lists all maps in an atlas.
 */
export async function listMaps(atlasId) {
  const { rows } = await query(Q.LIST_MAPS_BY_ATLAS, [atlasId]);
  return rows;
}

/**
 * Creates a new map in an atlas.
 */
export async function createMap(atlasId, data) {
  const { rows } = await query(Q.INSERT_MAP, [
    atlasId,
    data.name,
    data.base_layer || 'carta-topografica',
    data.center_lat || null,
    data.center_long || null,
    data.zoom || null,
    data.bearing || 0,
    data.pitch || 0,
    data.notes_title || null,
    data.notes_description || null,
    JSON.stringify(data.analysis_layers || {}),
    JSON.stringify(data.catalog_layers || []),
  ]);

  // Add to atlas map_order
  await query(Q.ADD_MAP_TO_ATLAS_ORDER, [atlasId, rows[0].id]);

  return rows[0];
}

/**
 * Gets a single map by ID.
 */
export async function getMapById(atlasId, mapId) {
  const { rows } = await query(Q.FIND_MAP_BY_ID, [mapId, atlasId]);

  if (rows.length === 0) {
    throw new NotFoundError('Map');
  }

  return rows[0];
}

/**
 * Updates a map.
 */
export async function updateMap(atlasId, mapId, data) {
  const { rows } = await query(Q.UPDATE_MAP, [
    mapId,
    atlasId,
    data.name || null,
    data.base_layer || null,
    data.center_lat !== undefined ? data.center_lat : null,
    data.center_long !== undefined ? data.center_long : null,
    data.zoom !== undefined ? data.zoom : null,
    data.bearing !== undefined ? data.bearing : null,
    data.pitch !== undefined ? data.pitch : null,
    data.notes_title !== undefined ? data.notes_title : null,
    data.notes_description !== undefined ? data.notes_description : null,
    data.analysis_layers ? JSON.stringify(data.analysis_layers) : null,
    data.catalog_layers ? JSON.stringify(data.catalog_layers) : null,
  ]);

  if (rows.length === 0) {
    throw new NotFoundError('Map');
  }

  return rows[0];
}

/**
 * Soft-deletes a map.
 */
export async function deleteMap(atlasId, mapId) {
  const { rows } = await query(Q.SOFT_DELETE_MAP, [mapId, atlasId]);

  if (rows.length === 0) {
    throw new NotFoundError('Map');
  }

  // Remove from atlas map_order
  await query(Q.REMOVE_MAP_FROM_ATLAS_ORDER, [atlasId, mapId]);

  return true;
}
