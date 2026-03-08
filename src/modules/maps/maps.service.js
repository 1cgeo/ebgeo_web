// Path: src/modules/maps/maps.service.js
// Read-only module. All write operations are managed via sync API (POST /atlas/:id/sync).
import { query } from '../../database/index.js';
import { NotFoundError } from '../../utils/errors.js';
import * as Q from './maps.queries.js';

export async function listMaps(atlasId) {
  const { rows } = await query(Q.LIST_MAPS_BY_ATLAS, [atlasId]);
  return rows;
}

export async function getMapById(atlasId, mapId) {
  const { rows } = await query(Q.FIND_MAP_BY_ID, [mapId, atlasId]);

  if (rows.length === 0) {
    throw new NotFoundError('Map');
  }

  return rows[0];
}
