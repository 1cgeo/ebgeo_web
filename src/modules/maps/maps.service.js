// Path: src/modules/maps/maps.service.js
// Mostly read-only — writes go via sync API. EXCEPTION: mergeMaps is an atomic
// structural operation (moving sub-entities between maps in one transaction).
import { query, tx } from '../../database/index.js';
import { NotFoundError } from '../../utils/errors.js';
import * as Q from './maps.queries.js';

// Sub-entity tables scoped by map_id (LITERAL whitelist — never from input).
const MAP_CHILD_TABLES = [
  'features',
  'groups',
  'layers',
  'cesium3d_data',
  'streetview360_data',
  'catalog_layers',
];

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

/**
 * Atomically moves the sub-entities of one or more source maps into a
 * destination map. All maps must belong to the same atlas (no cross-atlas
 * leak). Source maps are NOT deleted (only their contents move).
 * @returns {{ destMapId, sourceMapIds, moved }} per-table moved counts
 */
export async function mergeMaps(atlasId, destMapId, sourceMapIds) {
  return tx(async (t) => {
    const dest = await t.oneOrNone(Q.FIND_MAP_BY_ID, [destMapId, atlasId]);
    if (!dest) throw new NotFoundError('Map');

    // Every source must belong to this atlas (and exist). Exclude the dest.
    const sources = sourceMapIds.filter((id) => id !== destMapId);
    if (sources.length === 0) {
      return { destMapId, sourceMapIds: [], moved: {} };
    }
    const valid = await t.any(
      `SELECT id FROM maps WHERE id = ANY($1::uuid[]) AND atlas_id = $2 AND deleted_at IS NULL`,
      [sources, atlasId]
    );
    if (valid.length !== sources.length) {
      throw new NotFoundError('Source map');
    }

    const moved = {};
    for (const table of MAP_CHILD_TABLES) {
      const r = await t.result(
        `UPDATE ${table} SET map_id = $1, updated_at = NOW(), version = version + 1
         WHERE map_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
        [destMapId, sources]
      );
      moved[table] = r.rowCount;
    }

    return { destMapId, sourceMapIds: sources, moved };
  });
}
