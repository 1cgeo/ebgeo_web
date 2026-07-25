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
//
// `comments` joined the list on 2026-07-25 (bugs-backend #84, owner's decision). It has the
// same shape as the others (map_id NOT NULL REFERENCES maps + version + updated_at +
// deleted_at) and was simply never added, so a merge separated a spatial comment from the
// feature it annotates: the pin stayed on the emptied source map while its feature moved,
// and the annotation vanished from the destination view. maps-merge-orphans.test.js pinned
// that as CHARACTERIZATION ("not endorsed as correct") — the pin was doing its job; the
// decision it was waiting for has now been taken, and the test states it.
const MAP_CHILD_TABLES = [
  'features',
  'groups',
  'layers',
  'cesium3d_data',
  'streetview360_data',
  'catalog_layers',
  'comments',
];

// Rows the SNAPSHOT keys by a VALUE instead of by row id (bugs-backend #83).
//
// `transformCesium3dToFrontend` writes `cameraPositions[tileset_id]` and
// `transformStreetview360ToFrontend` writes `orientations[photo_name]` (sync.service.js).
// For those two shapes a map holds AT MOST ONE row per key: two live rows sharing the key
// are not two items, they are one item whose value depends on row order. Every other
// data_type lands in an ARRAY keyed by row id, so it never collides and must never be
// deduplicated here — that would delete user data.
//
// The plain `UPDATE ... SET map_id` only re-parents, so merging a source that defines
// camera position for tileset X into a destination that also defines it produced exactly
// that pair. The client then showed whichever row the unordered snapshot query happened to
// return last, and could show the OTHER one after any UPDATE that changed the physical row
// order — a value that "comes back on its own" much later, far from the merge.
//
// A NULL key is excluded on purpose: the camera-position transform falls back to the row id
// (unique, no collision) and the orientation transform drops the row entirely.
const KEYED_SINGLETONS = [
  { table: 'cesium3d_data', dataType: 'camera_position', keyColumn: 'tileset_id' },
  { table: 'streetview360_data', dataType: 'orientation', keyColumn: 'photo_name' },
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
 * Atomically moves the sub-entities of one or more source maps into a destination map.
 * All maps must belong to the same atlas (no cross-atlas leak). Source maps are NOT
 * deleted (only their contents move).
 *
 * "Moves the sub-entities" is true of MAP_CHILD_TABLES and of nothing else, and the
 * exceptions are deliberate, not pending: `group_features` carries no map_id and follows
 * both of its ends; `slides.map_id` keeps pointing at the (now empty) source map;
 * `images` are atlas-scoped, not map-scoped. What DOES move is pinned table by table in
 * maps-merge-orphans.test.js.
 *
 * Two rows that share a snapshot key (KEYED_SINGLETONS) cannot both survive in the
 * destination, so the losers are soft-deleted BEFORE the move — see `deduped`.
 *
 * @returns {{ destMapId, sourceMapIds, moved, deduped }} per-table moved counts, plus the
 *   per-table count of key collisions resolved by soft-delete
 */
export async function mergeMaps(atlasId, destMapId, sourceMapIds, actingUserId = null) {
  return tx(async (t) => {
    const dest = await t.oneOrNone(Q.FIND_MAP_BY_ID, [destMapId, atlasId]);
    if (!dest) throw new NotFoundError('Map');

    // Every source must belong to this atlas (and exist). Exclude the dest.
    //
    // DEDUPED before the length comparison below. Without the Set, `[src, src]` gave
    // 2 sources while `WHERE id = ANY($1)` returns one row per DISTINCT id, so the
    // check `valid.length !== sources.length` fired and the caller was told
    // NotFoundError('Source map') about a map that exists and that they can read.
    // A repeated id is a client-side duplicate, not a missing map, and the two must
    // not be reported the same way. mergeMapsSchema has no `.unique()`, so the
    // normalization belongs here.
    const sources = [...new Set(sourceMapIds.filter((id) => id !== destMapId))];
    if (sources.length === 0) {
      return { destMapId, sourceMapIds: [], moved: {}, deduped: {} };
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

    // Resolve key collisions BEFORE moving anything (bugs-backend #83).
    //
    // The ranking is one rule covering both collision shapes, destination-vs-source and
    // source-vs-source (merging three maps at once is ordinary): the DESTINATION's own row
    // wins — it is the map that survives the merge, and a merge that silently overwrote the
    // destination's own camera view would be the more surprising of the two losses — and
    // among sources the most recently updated wins, with `id` as a total-order tiebreak so
    // the outcome never depends on physical row order.
    //
    // Soft-delete, not hard-delete: these rows are sync entities and their tombstone is what
    // makes the removal converge on every peer (and it is the project's rule for a main
    // entity). The loser keeps its map_id — the move loop below filters `deleted_at IS NULL`,
    // so a soft-deleted row simply stays behind, already dead.
    //
    // REJECTED alternative: merging the two payloads into one row. `data` is opaque JSONB
    // owned by the frontend (heading/pitch/zoom, camera matrices); a server-side deep merge
    // of two camera views produces a third view that neither user ever saved.
    const deduped = {};
    for (const { table, dataType, keyColumn } of KEYED_SINGLETONS) {
      const r = await t.result(
        `WITH ranked AS (
           SELECT id, row_number() OVER (
             PARTITION BY ${keyColumn}
             ORDER BY (map_id = $1::uuid) DESC, updated_at DESC, id
           ) AS rn
           FROM ${table}
           WHERE map_id = ANY($2::uuid[]) AND deleted_at IS NULL
             AND data_type = $3 AND ${keyColumn} IS NOT NULL
         )
         UPDATE ${table} tgt
         SET deleted_at = NOW(), updated_at = NOW(), version = version + 1
         FROM ranked r
         WHERE tgt.id = r.id AND r.rn > 1`,
        [destMapId, [destMapId, ...sources], dataType]
      );
      deduped[table] = r.rowCount;
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
      JSON.stringify({ destMapId, sourceMapIds: sources, moved, deduped }),
      Date.now(),
      MERGE_CLIENT_ID,
      actingUserId ?? null,
      randomUUID(),
      null,
    ]);

    return { destMapId, sourceMapIds: sources, moved, deduped };
  });
}
