// Path: src/modules/sync/entity-canonical.js
/**
 * @fileoverview The SERVER's own reading of one collaborative entity, in the shape the client
 * already receives in a snapshot. One serializer per entity, and nothing else in this file.
 *
 * WHY IT HAD TO EXIST BEFORE ANYTHING ELSE IN THIS BLOC. Until 2026-09-13 a refusal by entity
 * conflict answered with a version and `serverData: null`, and the comment that left it null said
 * exactly why: publishing a canonical without a serializer would be handing the SENDER's document
 * back with the server's endorsement stamped on it. The panel then had half a pair to draw (it
 * could show what the author wrote and not what the server holds), and the narrowing of B5.4 was
 * unsafe for the same reason: a write narrowed to the units it claims leaves the broadcast
 * describing columns the server did not take, and the peer that blind-replaces its document with
 * that broadcast ends up holding a row that exists nowhere. Both are the same missing piece: a
 * document that comes out of the LIVE ROW and from nowhere else.
 *
 * THE SHAPE IS THE SNAPSHOT'S, PER ENTITY, and that is a decision and not a coincidence. The
 * client already has exactly one reader for each of these shapes (`applyRemoteSnapshot` and the
 * `reshape*` helpers in `frontend/src/js/store/sync/remote-operation-handler.js`), so serving a
 * second shape here would mean a second reader over there, and the second reader is the one that
 * rots. Concretely: snake_case columns for `map`, `group`, `briefing`, `slide` and `comment`
 * exactly as their snapshot collections emit them, `order` instead of `sort_order` for a layer,
 * the flat `{id, tilesetId|photoName, ...data}` entry for 3D and 360, and a `sync` block on every
 * one of them.
 *
 * WHAT IT LEAVES OUT, DELIBERATELY: THE CHILDREN. A map is its own columns, not its features,
 * layers, groups and comments; a briefing is its own columns plus `slide_order`, not its slides.
 * A conflict is about the row whose units were disputed, the refusal path runs inside a per-op
 * savepoint under the atlas write lock, and dragging a map's feature collection through it would
 * put the cost of a snapshot on every refusal. The ONE child that IS carried is a group's
 * `features`, and it is carried because leaving it out would be actively wrong rather than merely
 * partial: `applyRemoteGroupOp` replaces the group document wholesale, so a canonical group with
 * no membership would empty the group on every peer that applied it.
 *
 * IT NEVER FILTERS BY `deleted_at`. The snapshot's queries do, because a snapshot describes what
 * exists; this describes what the server holds about a row the caller just lost to, and half the
 * reasons to lose are "the item was deleted on the server". The tombstone travels in
 * `sync.deleted`, which is the field the client's own metadata already carries.
 *
 * THE CATALOG DEFINITION IS NOT REHYDRATED HERE, and that is safe by construction rather than by
 * care: a `catalog_layer` entry is served with the `data` the row holds, and every JSON body this
 * server writes passes `pruneResourcePayload` (`middleware/prune-resource-payload.js` for HTTP,
 * `collab.send.js` for the socket), which strips any catalog definition that was not marked
 * authorized for THIS principal. So an entry whose stored copy names a private layer arrives with
 * the reference and the per-atlas state and without the URL, which is the same outcome
 * `rehydrateCatalogLayer` produces for a caller who may not see it. Rehydrating here would need
 * the visible-definitions query on the refusal path to buy nothing the boundary does not already
 * give. Guarda: `tests/integration/recibo-canonico-por-entidade.test.js`.
 */

/**
 * Builds the sync metadata block of a row, shared with the snapshot.
 *
 * `deleted` READS THE COLUMN when the caller selected it. The snapshot's queries never do (they
 * filter tombstones out in SQL), so it keeps answering false there; the canonical readers below
 * always select it, which is what lets one block serve both.
 *
 * @param {Object} row - A database row carrying created_at/updated_at/version.
 * @param {string|null} [ownerId] - Owner, for the entities that have one.
 * @returns {{createdAt: number, updatedAt: number, version: *, ownerId: string|null,
 *   dirty: boolean, deleted: boolean}}
 */
export function buildSyncMetadata(row, ownerId = null) {
  return {
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    version: row.version,
    ownerId,
    dirty: false,
    deleted: Boolean(row.deleted_at),
  };
}

/** Same shape as `UUID_RE` in `entity-conflicts.js`; kept local so this file imports nothing. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {*} value @returns {boolean} */
function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * The row a sub-typed `map` op addresses is named by `mapId`; every other op names its own
 * `targetId`. Same split `revisionKeyOf` makes, and it has to be the same one.
 * @param {Object} op - Normalized operation.
 * @returns {string|null}
 */
function mapKeyOf(op) {
  return (op.target === 'map' && op._subType ? op.mapId : op.targetId) ?? null;
}

/**
 * A copy of the row without `deleted_at`. The tombstone travels in `sync.deleted` and nowhere
 * else: the client's own metadata block already carries that fact, and a second copy of it beside
 * the columns is one the reshape would have to learn to ignore.
 * @param {Object} row - A database row.
 * @returns {Object} The same fields minus `deleted_at`.
 */
function semTumulo(row) {
  const campos = { ...row };
  delete campos.deleted_at;
  return campos;
}

async function canonicalMap(t, atlasId, op) {
  const id = mapKeyOf(op);
  if (!isUuid(id)) return null;
  const row = await t.oneOrNone(`SELECT id, name, base_layer, center_lat, center_long, zoom,
      bearing, pitch, notes_title, notes_description, analysis_layers, grid_style, temporal_config,
      locked, created_at, updated_at, deleted_at, version
    FROM maps WHERE id = $1 AND atlas_id = $2`, [id, atlasId]);
  if (!row) return null;
  return { ...semTumulo(row), sync: buildSyncMetadata(row) };
}

async function canonicalLayer(t, atlasId, op) {
  if (!isUuid(op.targetId) || !isUuid(op.mapId)) return null;
  const row = await t.oneOrNone(`SELECT l.id, l.name, l.visible, l.locked, l.opacity, l.sort_order,
      l.style, l.created_at, l.updated_at, l.deleted_at, l.version
    FROM layers l JOIN maps m ON m.id = l.map_id
    WHERE l.id = $1 AND l.map_id = $2 AND m.atlas_id = $3`, [op.targetId, op.mapId, atlasId]);
  if (!row) return null;
  // `order`, never `sort_order`: the snapshot renames it here and the client reads only `order`.
  return {
    id: row.id, name: row.name, visible: row.visible, locked: row.locked, opacity: row.opacity,
    order: row.sort_order, style: row.style,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    version: row.version,
  };
}

async function canonicalGroup(t, atlasId, op) {
  if (!isUuid(op.targetId) || !isUuid(op.mapId)) return null;
  const row = await t.oneOrNone(`SELECT g.id, g.name, g.visible, g.locked, g.style, g.parent_id,
      g.created_at, g.updated_at, g.deleted_at, g.version
    FROM groups g JOIN maps m ON m.id = g.map_id
    WHERE g.id = $1 AND g.map_id = $2 AND m.atlas_id = $3`, [op.targetId, op.mapId, atlasId]);
  if (!row) return null;
  // MEMBERSHIP IS CARRIED, unlike every other child: see the header. The join table is the only
  // home of it (`groups` has no members column), and `feature_type` is what the client's ref
  // shape needs; an orphaned reference is dropped exactly as the snapshot drops it.
  const members = await t.query(`SELECT gf.feature_id, f.feature_type
    FROM group_features gf JOIN features f ON f.id = gf.feature_id
    WHERE gf.group_id = $1 AND f.deleted_at IS NULL`, [op.targetId]);
  return {
    id: row.id, name: row.name, visible: row.visible, locked: row.locked, style: row.style,
    parent_id: row.parent_id,
    features: members.map((m) => ({ type: m.feature_type, id: m.feature_id })),
    sync: buildSyncMetadata(row),
  };
}

async function canonicalBriefing(t, atlasId, op) {
  if (!isUuid(op.targetId)) return null;
  const row = await t.oneOrNone(`SELECT id, name, description, settings, slide_order,
      created_at, updated_at, deleted_at, version
    FROM briefings WHERE id = $1 AND atlas_id = $2`, [op.targetId, atlasId]);
  if (!row) return null;
  return { ...semTumulo(row), sync: buildSyncMetadata(row) };
}

async function canonicalSlide(t, atlasId, op) {
  if (!isUuid(op.targetId)) return null;
  const row = await t.oneOrNone(`SELECT s.id, s.briefing_id, s.title, s.content, s.mode, s.map_id,
      s.model_id, s.photo_id, s.position, s.orientation, s.temporal_cursor, s.is_broken,
      s.broken_reason, s.created_at, s.updated_at, s.deleted_at, s.version, b.slide_order
    FROM slides s JOIN briefings b ON b.id = s.briefing_id
    WHERE s.id = $1 AND b.atlas_id = $2`, [op.targetId, atlasId]);
  if (!row) return null;
  // `mapId` IS THE MAP'S NAME on the client, never its UUID: the briefing editor matches it
  // against an `<option value=name>` and the presenter compares it to the active map's name. The
  // snapshot performs this same translation and `resolveSlideMapId` performs the inverse on write.
  const parent = row.map_id
    ? await t.oneOrNone('SELECT name FROM maps WHERE id = $1 AND atlas_id = $2', [row.map_id, atlasId])
    : null;
  const order = Array.isArray(row.slide_order) ? row.slide_order : [];
  const campos = semTumulo(row);
  // `slide_order` belongs to the BRIEFING and was joined in only to compute `order`; leaving it on
  // the slide would publish a briefing column as if it were one of the slide's own.
  delete campos.slide_order;
  return {
    ...campos,
    mapId: parent?.name ?? null,
    modelId: row.model_id ?? null,
    photoId: row.photo_id ?? null,
    temporalCursor: row.temporal_cursor ?? null,
    order: order.indexOf(row.id),
    sync: buildSyncMetadata(row),
  };
}

async function canonicalComment(t, atlasId, op) {
  if (!isUuid(op.targetId)) return null;
  const row = await t.oneOrNone(`SELECT id, map_id, parent_id, author_id, status, data,
      created_at, updated_at, deleted_at, version
    FROM comments WHERE id = $1 AND atlas_id = $2`, [op.targetId, atlasId]);
  if (!row) return null;
  // The AUTHORITATIVE author comes from the column and is placed AFTER the `...data` spread, so it
  // wins over whatever `authorId` a client wrote into the JSONB. Same order the snapshot uses, and
  // for the same reason: the client's edit gate reads this field while the server checks the column.
  return {
    id: row.id,
    ...row.data,
    mapId: row.map_id,
    parentId: row.parent_id,
    status: row.status,
    authorId: row.author_id ?? null,
    sync: buildSyncMetadata(row),
  };
}

async function canonicalCatalogLayer(t, atlasId, op) {
  if (typeof op.targetId !== 'string' || !op.targetId || !isUuid(op.mapId)) return null;
  const row = await t.oneOrNone(`SELECT c.id, c.data, c.created_at, c.updated_at, c.deleted_at,
      c.version
    FROM catalog_layers c JOIN maps m ON m.id = c.map_id
    WHERE c.id = $1 AND c.map_id = $2 AND m.atlas_id = $3`, [op.targetId, op.mapId, atlasId]);
  if (!row) return null;
  return { id: row.id, ...row.data, sync: buildSyncMetadata(row) };
}

/**
 * The 3D and 360 side-stores share one shape: the row id, the row's own key column, the stored
 * document spread flat, and `sync`. The bucket a peer files it under comes from `data_type`, which
 * the client already knows from the operation's entity type, so it is not repeated here.
 */
function sideStoreReader(table, keyColumn, keyAlias) {
  return async (t, atlasId, op) => {
    if (!isUuid(op.targetId) || !isUuid(op.mapId)) return null;
    const row = await t.oneOrNone(`SELECT e.id, e.${keyColumn}, e.data, e.created_at, e.updated_at,
        e.deleted_at, e.version
      FROM ${table} e JOIN maps m ON m.id = e.map_id
      WHERE e.id = $1 AND e.map_id = $2 AND m.atlas_id = $3`, [op.targetId, op.mapId, atlasId]);
    if (!row) return null;
    return { id: row.id, [keyAlias]: row[keyColumn], ...row.data, sync: buildSyncMetadata(row) };
  };
}

/**
 * One reader per target. A target absent from this table has no canonical serializer, and the
 * caller must treat that as "the server cannot say", never as "there is nothing": `feature` is
 * absent because `canonicalFeature` (`feature-conflicts.js`) already owns the GeoJSON projection,
 * and `group_feature` and `setting` are absent because neither is a row with a document.
 *
 * The table names are literals of this module and never client input, which is what makes the
 * interpolation in `sideStoreReader` safe.
 */
const CANONICAL_READERS = {
  map: canonicalMap,
  layer: canonicalLayer,
  group: canonicalGroup,
  briefing: canonicalBriefing,
  slide: canonicalSlide,
  comment: canonicalComment,
  catalog_layer: canonicalCatalogLayer,
  cesium3d: sideStoreReader('cesium3d_data', 'tileset_id', 'tilesetId'),
  streetview360: sideStoreReader('streetview360_data', 'photo_name', 'photoName'),
};

/** @param {string} target @returns {boolean} Is there a canonical serializer for this target? */
export function hasCanonicalSerializer(target) {
  return Object.hasOwn(CANONICAL_READERS, target);
}

/**
 * The server's document for the entity an operation names, read from the live row.
 *
 * WHAT KEEPS IT OFF THE POISON-PILL PATH IS THE ID GUARD, NOT THE `catch`, and the distinction is
 * worth stating because the `catch` looks like the safety net and is not one. It runs on the
 * REFUSAL path, inside the per-op savepoint, and a query that FAILS there (a non-UUID id cast,
 * 22P02) aborts the savepoint at the Postgres level: catching it in JavaScript does not un-abort
 * it, and the next statement fails anyway. So every reader tests its ids before it asks, exactly
 * as `readEntityRow` does, and a shape this lookup cannot ask about answers null without touching
 * the database. The `catch` covers only what is left, a reader-level failure with no statement
 * behind it, and turns it into "the server cannot say" instead of losing the named refusal.
 *
 * @param {Object} t - Transaction context.
 * @param {string} atlasId
 * @param {Object} op - Normalized operation.
 * @returns {Promise<Object|null>} The client-shaped document, or null.
 */
export async function canonicalEntityData(t, atlasId, op) {
  const reader = CANONICAL_READERS[op?.target];
  if (!reader) return null;
  try {
    return await reader(t, atlasId, op);
  } catch {
    return null;
  }
}
