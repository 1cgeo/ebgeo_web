// Path: src/modules/maps/maps.service.js
// Mostly read-only — writes go via sync API. EXCEPTION: mergeMaps is an atomic
// structural operation (moving sub-entities between maps in one transaction).
import { randomUUID } from 'crypto';
import { query, tx } from '../../database/index.js';
import { NotFoundError, ConflictError } from '../../utils/errors.js';
import * as Q from './maps.queries.js';
import * as SQ from '../sync/sync.queries.js';

// Entity type of the marker operation written when a merge re-parents rows in bulk.
// Shared contract with the frontend (STRUCTURAL_RESYNC_OPS in sync-engine.js): a peer
// receiving it takes a snapshot rather than trying to apply a per-entity change.
export const MAP_MERGE_ENTITY_TYPE = 'map_merge';

// `client_id` is NOT NULL and identifies the origin of an op. The merge has no client
// behind it (it is a REST call, not a queued client op), so it gets a stable server
// sentinel — which also lets a peer recognise it as not-its-own-echo.
const MERGE_CLIENT_ID = 'server-merge';

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
export async function mergeMaps(atlasId, destMapId, sourceMapIds, actingUserId = null) {
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

    // A locked map refuses child mutations on the sync path (sync.service.js
    // MAP_LOCK_GUARDED targets) and only the owner may set the flag. This route
    // never consulted it, so a merge was a way to empty — over REST — a map the
    // owner had deliberately locked, which is the one thing locking exists to stop.
    //
    // Checked for BOTH ends and for ALL sources before any UPDATE runs: a partial
    // merge is the worst outcome available, since the caller sees an error while
    // some maps are already emptied and nothing records what moved.
    const locked = await t.any(
      `SELECT id, name FROM maps
       WHERE id = ANY($1::uuid[]) AND atlas_id = $2 AND deleted_at IS NULL AND locked = true`,
      [[destMapId, ...sources], atlasId]
    );
    if (locked.length > 0) {
      throw new ConflictError(
        `Mapa bloqueado: ${locked.map((m) => m.name).join(', ')}. Desbloqueie antes de mesclar.`
      );
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

    // Record the merge in the operation log, in the SAME transaction.
    //
    // Without this, the change existed only as the ephemeral `maps_merged` broadcast
    // (maps.controller.js), which reaches sockets connected at that instant and
    // nobody else. A peer that was offline during the merge reconnects with
    // `sync_request {lastVersion: N}`; since no operation was written, N was still
    // atlas.current_version, `pullOperations` took the incremental branch and
    // answered `{operations: []}`. The peer concluded it was up to date and kept
    // showing the features under the OLD map indefinitely — only an F5 (pull from
    // version 0) fixed it. The replay was empty by construction.
    //
    // This is a MARKER op, not a per-entity one: the rows moved in bulk and there is
    // no per-entity op that describes the move. Peers treat it as "take a snapshot"
    // (see STRUCTURAL_RESYNC_OPS in the frontend sync-engine), which is the same
    // resolution the live `maps_merged` broadcast already triggers. Inserting it also
    // advances atlas.current_version through the existing trigger, so the version
    // stops claiming nothing happened.
    // oneOrNone, not none: INSERT_OPERATION carries `RETURNING *` (and an
    // ON CONFLICT DO NOTHING that can yield zero rows), and pg-promise's `none`
    // rejects as soon as a row comes back.
    await t.oneOrNone(SQ.INSERT_OPERATION, [
      atlasId,
      'update',
      MAP_MERGE_ENTITY_TYPE,
      destMapId,
      destMapId,
      null,
      JSON.stringify({ destMapId, sourceMapIds: sources, moved }),
      Date.now(),
      MERGE_CLIENT_ID,
      actingUserId ?? null,
      randomUUID(),
      null,
    ]);

    return { destMapId, sourceMapIds: sources, moved };
  });
}
