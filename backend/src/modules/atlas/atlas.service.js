// Path: src/modules/atlas/atlas.service.js
import crypto from 'crypto';
import { mkdir, copyFile } from 'fs/promises';
import { join, extname, dirname } from 'path';
import jwt from 'jsonwebtoken';
import { query, tx, pgp } from '../../database/index.js';
import { NotFoundError, BadRequestError, ConflictError } from '../../utils/errors.js';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import * as Q from './atlas.queries.js';

// ---------------------------------------------------------------------------
// Batch INSERT plumbing (L67).
//
// Clone, duplicate-map and import used to emit ONE STATEMENT PER ROW inside a single tx().
// The data came out right, but the transaction — and the pool connection behind it (poolMax
// defaults to 10) — stayed open for a time proportional to the size of the atlas. The clone
// volume is unbounded (it is read from the database and gated only by 'read'), so a few
// concurrent clones starved /auth/login and /health: the same pool-exhaustion mode that
// sync.service.js:650-655 already documents for pushOperations.
//
// Every collection below is now written with ONE multi-row INSERT, so the statement count is
// a function of the entity TYPES involved, never of the row count. New ids are generated in
// Node (crypto.randomUUID) instead of being read back with RETURNING: the id mappings the
// clone needs (layer → feature, group → group_feature, map → slide) are then known BEFORE the
// write, which is also what makes the single-statement insert possible at all — and it avoids
// relying on RETURNING preserving input order, which Postgres does not promise.
// ---------------------------------------------------------------------------

/** jsonb column shorthand — values are pre-stringified by the row builders. */
const jsonb = (name) => ({ name, cast: 'jsonb' });

const CS = {
  images: new pgp.helpers.ColumnSet(
    ['id', 'atlas_id', 'filename', 'mime_type', 'size_bytes', 'storage_path', 'uploaded_by'],
    { table: 'images' }
  ),
  maps: new pgp.helpers.ColumnSet(
    ['id', 'atlas_id', 'name', 'base_layer', 'center_lat', 'center_long', 'zoom', 'bearing',
      'pitch', 'notes_title', 'notes_description', jsonb('analysis_layers'),
      jsonb('catalog_layers'), 'locked', jsonb('grid_style'), jsonb('temporal_config')],
    { table: 'maps' }
  ),
  layers: new pgp.helpers.ColumnSet(
    ['id', 'map_id', 'name', 'visible', 'locked', 'opacity', 'sort_order', jsonb('style')],
    { table: 'layers' }
  ),
  groups: new pgp.helpers.ColumnSet(
    ['id', 'map_id', 'name', 'visible', 'locked', jsonb('style'), 'parent_id'],
    { table: 'groups' }
  ),
  features: new pgp.helpers.ColumnSet(
    ['id', 'map_id', 'feature_type', jsonb('geometry'), jsonb('properties'), 'layer_id'],
    { table: 'features' }
  ),
  groupFeatures: new pgp.helpers.ColumnSet(['group_id', 'feature_id'], { table: 'group_features' }),
  cesium3d: new pgp.helpers.ColumnSet(
    ['id', 'map_id', 'data_type', 'tileset_id', jsonb('data')],
    { table: 'cesium3d_data' }
  ),
  streetview360: new pgp.helpers.ColumnSet(
    ['id', 'map_id', 'data_type', 'photo_name', jsonb('data')],
    { table: 'streetview360_data' }
  ),
  catalogLayers: new pgp.helpers.ColumnSet(
    ['id', 'map_id', jsonb('data')],
    { table: 'catalog_layers' }
  ),
  briefings: new pgp.helpers.ColumnSet(
    ['id', 'atlas_id', 'name', 'description', jsonb('settings'),
      { name: 'slide_order', cast: 'uuid[]' }],
    { table: 'briefings' }
  ),
  slides: new pgp.helpers.ColumnSet(
    ['id', 'briefing_id', 'title', 'content', 'mode', 'map_id', 'model_id', 'photo_id',
      jsonb('position'), jsonb('orientation')],
    { table: 'slides' }
  ),
};

/**
 * One multi-row INSERT for the whole collection. No-op on an empty array (helpers.insert
 * rejects one, and an empty collection has nothing to write anyway).
 * @param {Object} t - Transaction context
 * @param {Object} columnSet - pg-promise ColumnSet
 * @param {Array<Object>} rows
 * @param {string} [suffix] - Appended to the generated statement (e.g. ON CONFLICT)
 */
async function insertMany(t, columnSet, rows, suffix = '') {
  if (!rows.length) return;
  await t.none(pgp.helpers.insert(rows, columnSet) + suffix);
}

// ---------------------------------------------------------------------------
// Image-reference rewriting (L32).
//
// `images` rows are atlas-scoped (images.atlas_id NOT NULL) and their blobs live in a
// per-atlas directory, while the id is a GLOBAL primary key — so a copy cannot keep the
// source id and must be re-pointed. The read is scoped to the pair (id, atlas_id) and the
// client always asks for the ACTIVE atlas, so a clone carrying the source atlas's image ids
// answered 404 forever, degrading silently to "no image" (fetchImageBlob swallows the error).
//
// The places an image id can appear are the ones local-atlas-to-server.js already rewrites
// when it uploads a local atlas — this is the same map, applied server-side.
// ---------------------------------------------------------------------------

/** Rewrites an entity's `images[]` (3D/360 items): plain ids or `{ id }` objects. */
function rewriteItemImages(item, imageIdMap) {
  if (!Array.isArray(item?.images) || item.images.length === 0) return item;
  return {
    ...item,
    images: item.images.map((img) => {
      if (typeof img === 'string') return imageIdMap[img] || img;
      if (img?.id && imageIdMap[img.id]) return { ...img, id: imageIdMap[img.id] };
      return img;
    }),
  };
}

/** Rewrites the custom-icon registry stored in atlas.settings.customIcons. */
function rewriteSettingsIcons(settings, imageIdMap) {
  const icons = settings?.customIcons;
  if (!Array.isArray(icons) || icons.length === 0) return settings || {};
  return {
    ...settings,
    customIcons: icons.map((icon) =>
      icon?.id && imageIdMap[icon.id] ? { ...icon, id: imageIdMap[icon.id] } : icon
    ),
  };
}

/**
 * Rewrites a cloned feature's properties.
 * - An IMAGE feature's blob ref IS its id (the snapshot forces properties.id = the row id),
 *   so the copy must carry the copied blob's id.
 * - A custom point icon travels as `markerSymbol = 'custom:<imageId>'`.
 * @param {Object} properties - Source properties
 * @param {string} newFeatureId
 * @param {boolean} isImageFeature
 * @param {Object} imageIdMap - { sourceImageId: newImageId }
 * @returns {Object}
 */
function rewriteFeatureProperties(properties, newFeatureId, isImageFeature, imageIdMap) {
  const props = { ...(properties || {}) };
  if (isImageFeature && props.id !== undefined) props.id = newFeatureId;
  if (typeof props.markerSymbol === 'string' && props.markerSymbol.startsWith('custom:')) {
    const iconId = props.markerSymbol.slice('custom:'.length);
    if (imageIdMap[iconId]) props.markerSymbol = `custom:${imageIdMap[iconId]}`;
  }
  return props;
}

/**
 * Plans the copy of `images` rows into another atlas: mints the new ids and per-atlas storage
 * paths and returns both the id mapping and the rows to insert. PURE (no I/O) on purpose — the
 * mapping is needed to rewrite atlas.settings BEFORE the atlas row is written, and the rows
 * cannot be inserted until it exists (images.atlas_id FK).
 *
 * The blob copies are not done here either: they are pushed onto `copyJobs` and run after the
 * transaction commits, so a multi-megabyte file copy never holds the transaction (and its pool
 * connection) open — the very cost L67 is about. A copy that fails leaves the row pointing at a
 * missing file, which is exactly how a blob missing from disk already behaves (getImageFile →
 * 404 'Image file'), and is logged.
 *
 * @param {Array<Object>} sourceImages - Rows from `images`
 * @param {string} targetAtlasId
 * @param {Array<{from: string, to: string}>} copyJobs - Mutated; run after commit
 * @returns {{imageIdMap: Object, rows: Array<Object>}}
 */
function planImageCopies(sourceImages, targetAtlasId, copyJobs) {
  const imageIdMap = {};
  const dir = join(config.images.dir, targetAtlasId);

  const rows = sourceImages.map((img) => {
    const newId = crypto.randomUUID();
    const storagePath = join(dir, `${newId}${extname(img.storage_path) || ''}`);
    imageIdMap[img.id] = newId;
    copyJobs.push({ from: img.storage_path, to: storagePath });
    return {
      id: newId,
      atlas_id: targetAtlasId,
      filename: img.filename,
      mime_type: img.mime_type,
      size_bytes: img.size_bytes,
      storage_path: storagePath,
      uploaded_by: img.uploaded_by,
    };
  });

  return { imageIdMap, rows };
}

/** Runs the deferred blob copies. Best-effort: a missing source must not undo a committed clone. */
async function runImageCopyJobs(copyJobs) {
  for (const dir of new Set(copyJobs.map((job) => dirname(job.to)))) {
    await mkdir(dir, { recursive: true }).catch((err) => {
      logger.warn({ dir, error: err.message }, 'Failed to create cloned image directory');
    });
  }
  for (const job of copyJobs) {
    try {
      await copyFile(job.from, job.to);
    } catch (err) {
      logger.warn({ from: job.from, to: job.to, error: err.message }, 'Failed to copy cloned image blob');
    }
  }
}

/**
 * Merges the two homes of a map's catalog layers into rows for the dedicated table (L42).
 *
 * The schema keeps a legacy array column (`maps.catalog_layers`, whose comment claims it is
 * there "p/ clone/import") next to the dedicated `catalog_layers` table, and the writers and
 * the reader had drifted apart: import/clone/duplicate wrote ONLY the column, while the
 * snapshot builds `map.catalogLayers` ONLY from the table. The layers survived in Postgres
 * where no reader could reach them, and the snapshot's empty array then overwrote the client's
 * local state — silent loss, no error. The table is canonical, so every whole-entity writer
 * materialises into it; live rows win over the legacy array for the same id.
 *
 * @param {string} mapId - Target map id
 * @param {Array<Object>} legacyArray - The `maps.catalog_layers` array
 * @param {Array<Object>} tableRows - Live rows of the dedicated table (id, data)
 * @returns {Array<Object>} Rows ready for CS.catalogLayers
 */
function catalogLayerRows(mapId, legacyArray, tableRows) {
  const byId = new Map();
  for (const item of Array.isArray(legacyArray) ? legacyArray : []) {
    if (item && item.id != null) byId.set(String(item.id), item);
  }
  for (const row of tableRows) byId.set(String(row.id), row.data);

  return [...byId.entries()].map(([id, data]) => ({
    id,
    map_id: mapId,
    data: JSON.stringify(data || {}),
  }));
}

/**
 * Appends the "(cópia)" suffix without overflowing the VARCHAR(255) that both
 * `atlas.name` and `maps.name` declare.
 *
 * A 255-char name is reachable through ordinary use (createAtlasSchema caps at exactly
 * 255 and atlas-gaps.test.js proves the boundary is accepted), and the suffix adds 8
 * characters. The overflow raises SQLSTATE 22001, which PG_ERROR_MAP does not list, so
 * it fell through to the generic branch and answered 500 INTERNAL_ERROR for a
 * perfectly valid atlas. Truncating the BASE keeps the suffix visible — dropping the
 * "(cópia)" instead would produce a copy indistinguishable from its source.
 *
 * @param {string} name - Source name
 * @returns {string} At most 255 characters, always ending in the suffix
 */
const COPY_SUFFIX = ' (cópia)';
const NAME_MAX = 255;
function withCopySuffix(name) {
  const base = String(name ?? '');
  const room = NAME_MAX - COPY_SUFFIX.length;
  return `${base.length > room ? base.slice(0, room) : base}${COPY_SUFFIX}`;
}

/**
 * Creates a new atlas owned by the specified user.
 */
export async function createAtlas(userId, data) {
  const { rows } = await query(Q.INSERT_ATLAS, [
    data.name,
    data.description || null,
    userId,
  ]);
  return rows[0];
}

/**
 * Lists all atlas accessible by a user (owned or shared).
 */
export async function listUserAtlas(userId) {
  const { rows } = await query(Q.LIST_USER_ATLAS, [userId]);
  return rows;
}

/**
 * Gets a single atlas by ID with maps summary.
 */
export async function getAtlasById(atlasId) {
  const { rows } = await query(Q.FIND_ATLAS_BY_ID, [atlasId]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  const atlas = rows[0];

  // Get maps summary
  const mapsResult = await query(Q.GET_ATLAS_MAPS_SUMMARY, [atlasId]);
  atlas.maps = mapsResult.rows;

  return atlas;
}

/**
 * Updates atlas metadata.
 */
export async function updateAtlas(atlasId, data) {
  const { rows } = await query(Q.UPDATE_ATLAS, [
    atlasId,
    data.name || null,
    // [value, provided?]: an explicit null/'' CLEARS the column, an omitted field
    // leaves it alone. COALESCE could not tell those apart.
    data.description === '' ? null : (data.description ?? null),
    data.map_order || null,
    data.description !== undefined,
  ]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  return rows[0];
}

/**
 * Soft-deletes an atlas.
 */
export async function deleteAtlas(atlasId) {
  const { rows } = await query(Q.SOFT_DELETE_ATLAS, [atlasId]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  return true;
}

/**
 * Lists the caller's own trashed (soft-deleted) atlases — or EVERY trashed atlas for a global
 * admin, who is the only one who can reach an atlas trashed by a since-deactivated owner
 * (bugs-backend #95).
 * @param {string} userId
 * @param {boolean} [isAdmin=false] - Caller's live global role is 'admin'
 */
export async function listDeletedUserAtlas(userId, isAdmin = false) {
  const { rows } = isAdmin
    ? await query(Q.LIST_ALL_DELETED_ATLAS)
    : await query(Q.LIST_DELETED_USER_ATLAS, [userId]);
  return rows;
}

/**
 * Restores a trashed atlas the caller owns. The query is scoped to (id, owner, deleted), so a
 * non-owner / non-deleted / absent atlas matches nothing → 404. That scope is the ENTIRE access
 * control of the route (it has no `requireAtlasPermission`), so the admin case is a different
 * statement rather than a relaxed argument to this one.
 *
 * @param {string} atlasId
 * @param {string} userId
 * @param {boolean} [isAdmin=false] - Caller's live global role is 'admin'; restores regardless of
 *   ownership, which is what unsticks an atlas whose owner was deactivated while it was in the bin.
 */
export async function restoreAtlas(atlasId, userId, isAdmin = false) {
  const { rows } = isAdmin
    ? await query(Q.RESTORE_ATLAS_ADMIN, [atlasId])
    : await query(Q.RESTORE_ATLAS, [atlasId, userId]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  return rows[0];
}

/**
 * Gets atlas settings.
 */
export async function getAtlasSettings(atlasId) {
  const { rows } = await query(Q.FIND_ATLAS_BY_ID, [atlasId]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  return rows[0].settings;
}

/**
 * Updates atlas settings. The merge is SHALLOW, one level only: `UPDATE_ATLAS_SETTINGS`
 * is `settings || $2::jsonb`, so sending `{ features: { map_3d: true } }` REPLACES the
 * whole `features` object and drops every sibling key. This JSDoc said "partial merge"
 * until 2026-07-25, which read as deep and is not what the SQL does.
 *
 * The shallow behaviour is deliberate and pinned by `atlas-09` in
 * `backend/tests/integration/atlas-gaps.test.js`, so the contract is on the CALLER:
 * always send the complete nested object.
 *
 * Why it is not cosmetic: the frontend overlay is default-open, reading
 * `features.X !== false` (`intersectAvailability`,
 * `frontend/src/js/store/sync/atlas-settings.service.js:82-89`). A partial `features`
 * write therefore RE-ENABLES 360, terrain, data layers and analysis for the entire
 * atlas, silently, because the dropped keys read back as "not disabled". The built-in
 * modal is safe (it rebuilds all five keys from `FEATURE_FIELDS` on every save,
 * `frontend/src/js/modals/atlas-settings.modal.js:327-329`); any other client is what
 * bites.
 */
export async function updateAtlasSettings(atlasId, settings) {
  const { rows } = await query(Q.UPDATE_ATLAS_SETTINGS, [
    atlasId,
    JSON.stringify(settings),
  ]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  return rows[0];
}

/**
 * Gets atlas by public link and generates a temporary read-only token for WebSocket access.
 */
export async function getAtlasByPublicLink(publicLink) {
  const { rows } = await query(Q.FIND_ATLAS_BY_PUBLIC_LINK, [publicLink]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  const atlas = rows[0];

  // Generate temporary public token for WebSocket access (read-only, 1 hour expiry)
  const publicUserId = `public-${crypto.randomUUID()}`;
  const publicToken = jwt.sign(
    {
      sub: publicUserId,
      atlasId: atlas.id,
      isPublic: true,
      permission: 'read',
      nome: 'Visitante',
    },
    config.jwt.secret,
    { expiresIn: '1h' }
  );

  atlas.publicToken = publicToken;

  return atlas;
}

/**
 * Clones the sub-entities of one or more maps, one multi-row INSERT per entity type for the
 * WHOLE batch — the statement count is independent of both the number of maps and the number
 * of rows (L67). Shared by cloneAtlas and duplicateMap.
 *
 * @param {Object} t - Transaction context
 * @param {Array<{sourceId: string, newId: string, legacyCatalogLayers: Array}>} mapPairs
 * @param {Object} [imageIdMap] - { sourceImageId: newImageId }; an image feature's id IS its
 *   blob ref, so a copied image feature adopts the copied blob's id (L32).
 * @returns {Promise<{layerIdMapping: Object, groupIdMapping: Object, featureIdMapping: Object}>}
 */
async function cloneMapSubEntities(t, mapPairs, imageIdMap = {}) {
  const layerIdMapping = {};
  const groupIdMapping = {};
  const featureIdMapping = {};
  if (mapPairs.length === 0) return { layerIdMapping, groupIdMapping, featureIdMapping };

  const sourceMapIds = mapPairs.map((p) => p.sourceId);
  const newMapIdOf = Object.fromEntries(mapPairs.map((p) => [p.sourceId, p.newId]));

  // Layers first (features reference layer_id).
  const layers = await t.any(
    `SELECT * FROM layers WHERE map_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [sourceMapIds]
  );
  await insertMany(t, CS.layers, layers.map((layer) => {
    const id = crypto.randomUUID();
    layerIdMapping[layer.id] = id;
    return {
      id,
      map_id: newMapIdOf[layer.map_id],
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      sort_order: layer.sort_order,
      style: JSON.stringify(layer.style || {}),
    };
  }));

  // Groups. The ids are known before the write, so `parent_id` is resolved in the same
  // statement (the FK check runs at the end of the statement, so an intra-batch parent is
  // fine) instead of the old insert-then-UPDATE second pass.
  const groups = await t.any(
    `SELECT * FROM groups WHERE map_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [sourceMapIds]
  );
  for (const group of groups) groupIdMapping[group.id] = crypto.randomUUID();
  await insertMany(t, CS.groups, groups.map((group) => ({
    id: groupIdMapping[group.id],
    map_id: newMapIdOf[group.map_id],
    name: group.name,
    visible: group.visible,
    locked: group.locked,
    style: JSON.stringify(group.style || {}),
    parent_id: group.parent_id ? (groupIdMapping[group.parent_id] || null) : null,
  })));

  // Features, with remapped layer_id and rewritten image references.
  const features = await t.any(
    `SELECT * FROM features WHERE map_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [sourceMapIds]
  );
  await insertMany(t, CS.features, features.map((feature) => {
    const isImage = feature.feature_type === 'image';
    // An image feature adopts the id of the blob copy, keeping the invariant the client and
    // the snapshot rely on (feature id === image id). Everything else gets a fresh id.
    const id = (isImage && imageIdMap[feature.id]) || crypto.randomUUID();
    featureIdMapping[feature.id] = id;
    return {
      id,
      map_id: newMapIdOf[feature.map_id],
      feature_type: feature.feature_type,
      geometry: JSON.stringify(feature.geometry),
      properties: JSON.stringify(rewriteFeatureProperties(feature.properties, id, isImage, imageIdMap)),
      layer_id: feature.layer_id ? (layerIdMapping[feature.layer_id] || null) : null,
    };
  }));

  // group_features associations with remapped ids.
  const groupFeatures = await t.any(
    `SELECT gf.* FROM group_features gf
     JOIN groups g ON g.id = gf.group_id
     JOIN features f ON f.id = gf.feature_id
     WHERE g.map_id = ANY($1::uuid[]) AND g.deleted_at IS NULL AND f.deleted_at IS NULL`,
    [sourceMapIds]
  );
  await insertMany(
    t,
    CS.groupFeatures,
    groupFeatures
      .filter((gf) => groupIdMapping[gf.group_id] && featureIdMapping[gf.feature_id])
      .map((gf) => ({
        group_id: groupIdMapping[gf.group_id],
        feature_id: featureIdMapping[gf.feature_id],
      })),
    ' ON CONFLICT DO NOTHING'
  );

  // Cesium 3D data (its items can carry attached photos in `data.images[]`).
  const cesium3dData = await t.any(
    `SELECT * FROM cesium3d_data WHERE map_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [sourceMapIds]
  );
  await insertMany(t, CS.cesium3d, cesium3dData.map((c3d) => ({
    id: crypto.randomUUID(),
    map_id: newMapIdOf[c3d.map_id],
    data_type: c3d.data_type,
    tileset_id: c3d.tileset_id,
    data: JSON.stringify(rewriteItemImages(c3d.data || {}, imageIdMap)),
  })));

  // StreetView 360 data (same `data.images[]` shape).
  const sv360Data = await t.any(
    `SELECT * FROM streetview360_data WHERE map_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [sourceMapIds]
  );
  await insertMany(t, CS.streetview360, sv360Data.map((sv) => ({
    id: crypto.randomUUID(),
    map_id: newMapIdOf[sv.map_id],
    data_type: sv.data_type,
    photo_name: sv.photo_name,
    data: JSON.stringify(rewriteItemImages(sv.data || {}, imageIdMap)),
  })));

  // Catalog layers: the dedicated table (canonical) UNION the legacy array column (L42).
  const catalogRows = await t.any(
    `SELECT id, map_id, data FROM catalog_layers WHERE map_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [sourceMapIds]
  );
  const catalogBySourceMap = new Map(sourceMapIds.map((id) => [id, []]));
  for (const row of catalogRows) catalogBySourceMap.get(row.map_id)?.push(row);
  await insertMany(
    t,
    CS.catalogLayers,
    mapPairs.flatMap((pair) =>
      catalogLayerRows(pair.newId, pair.legacyCatalogLayers, catalogBySourceMap.get(pair.sourceId) || []))
  );

  return { layerIdMapping, groupIdMapping, featureIdMapping };
}

/**
 * Builds the `maps` insert row from a source map row.
 *
 * grid_style and temporal_config are part of a map's identity (the UTM grid and the whole
 * temporal module: window, mode, unit, origin). They were added to the table and to the sync
 * snapshot, but the clone/duplicate column lists were never updated, so a cloned atlas silently
 * lost its grid and its timeline. The import path already carries them.
 */
function mapRow(id, atlasId, name, map) {
  return {
    id,
    atlas_id: atlasId,
    name,
    base_layer: map.base_layer,
    center_lat: map.center_lat,
    center_long: map.center_long,
    zoom: map.zoom,
    bearing: map.bearing,
    pitch: map.pitch,
    notes_title: map.notes_title,
    notes_description: map.notes_description,
    analysis_layers: JSON.stringify(map.analysis_layers || {}),
    // The legacy array column keeps being written for array-shaped clients; the dedicated
    // catalog_layers table (written by cloneMapSubEntities) is the canonical home (L42).
    catalog_layers: JSON.stringify(map.catalog_layers || []),
    locked: map.locked || false,
    grid_style: JSON.stringify(map.grid_style || {}),
    temporal_config: JSON.stringify(map.temporal_config || {}),
  };
}

/**
 * Clones an atlas to a new owner.
 */
export async function cloneAtlas(atlasId, newOwnerId, options = {}) {
  // The atlas id is minted here (not read back) so the copied `images` rows — and the
  // rewritten references to them in atlas.settings — can be built before the first write.
  const newAtlasId = crypto.randomUUID();
  const copyJobs = [];

  await tx(async (t) => {
    const source = await t.oneOrNone(Q.FIND_ATLAS_BY_ID, [atlasId]);
    if (!source) {
      throw new NotFoundError('Atlas');
    }

    // Images are atlas-scoped and their ids are global: the clone needs its own rows (L32).
    const sourceImages = await t.any(`SELECT * FROM images WHERE atlas_id = $1`, [atlasId]);
    const { imageIdMap, rows: imageRows } = planImageCopies(sourceImages, newAtlasId, copyJobs);

    await t.none(
      `INSERT INTO atlas (id, name, description, owner_id, settings)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        newAtlasId,
        options.name || withCopySuffix(source.name),
        source.description,
        newOwnerId,
        // The custom-icon registry lives in settings and points at image ids.
        JSON.stringify(rewriteSettingsIcons(source.settings, imageIdMap)),
      ]
    );
    // After the atlas row: images.atlas_id is an FK.
    await insertMany(t, CS.images, imageRows);

    const maps = await t.any(
      `SELECT * FROM maps WHERE atlas_id = $1 AND deleted_at IS NULL`,
      [atlasId]
    );
    const mapPairs = maps.map((map) => ({
      sourceId: map.id,
      newId: crypto.randomUUID(),
      legacyCatalogLayers: map.catalog_layers,
      source: map,
    }));
    const mapIdMapping = Object.fromEntries(mapPairs.map((p) => [p.sourceId, p.newId]));

    await insertMany(t, CS.maps, mapPairs.map((p) => mapRow(p.newId, newAtlasId, p.source.name, p.source)));
    await cloneMapSubEntities(t, mapPairs, imageIdMap);

    await t.none(
      `UPDATE atlas SET map_order = $2::uuid[] WHERE id = $1`,
      [newAtlasId, mapPairs.map((p) => p.newId)]
    );

    // Briefings + slides: ids are minted up front, so slide_order travels in the briefing
    // INSERT instead of a per-briefing UPDATE, and all slides go in one statement.
    const briefings = await t.any(
      `SELECT * FROM briefings WHERE atlas_id = $1 AND deleted_at IS NULL`,
      [atlasId]
    );
    const slides = briefings.length
      ? await t.any(
        `SELECT * FROM slides WHERE briefing_id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [briefings.map((b) => b.id)]
      )
      : [];

    const briefingIdMapping = Object.fromEntries(briefings.map((b) => [b.id, crypto.randomUUID()]));
    const slideRows = slides.map((slide) => ({
      id: crypto.randomUUID(),
      briefing_id: briefingIdMapping[slide.briefing_id],
      title: slide.title,
      content: slide.content,
      mode: slide.mode,
      map_id: slide.map_id ? (mapIdMapping[slide.map_id] || null) : null,
      model_id: slide.model_id,
      photo_id: slide.photo_id,
      position: JSON.stringify(slide.position || {}),
      orientation: JSON.stringify(slide.orientation || {}),
      // Not a column: the ColumnSet only reads the columns it declares. Kept on the row so
      // slide_order can be grouped per briefing below without a second lookup.
      sourceBriefingId: slide.briefing_id,
    }));

    await insertMany(t, CS.briefings, briefings.map((briefing) => ({
      id: briefingIdMapping[briefing.id],
      atlas_id: newAtlasId,
      name: briefing.name,
      description: briefing.description,
      settings: JSON.stringify(briefing.settings || {}),
      slide_order: slideRows.filter((s) => s.sourceBriefingId === briefing.id).map((s) => s.id),
    })));
    await insertMany(t, CS.slides, slideRows);
  });

  await runImageCopyJobs(copyJobs);

  // Return cloned atlas with maps (outside transaction)
  return getAtlasById(newAtlasId);
}

/**
 * Duplicates a single map within the same atlas.
 * Clones all sub-entities (layers, groups, features, group_features, cesium3d, streetview360,
 * catalog layers) and the blobs of its image features.
 */
export async function duplicateMap(atlasId, mapId) {
  let newMapResult;
  const copyJobs = [];

  await tx(async (t) => {
    const map = await t.oneOrNone(
      `SELECT * FROM maps WHERE id = $1 AND atlas_id = $2 AND deleted_at IS NULL`,
      [mapId, atlasId]
    );
    if (!map) {
      throw new NotFoundError('Map');
    }

    // The copied features get fresh ids, and an image feature's id IS its blob ref — so the
    // blobs of THIS map's image features need copies too, even though the atlas is the same
    // (L32). Custom icons and 3D/360 attachments are untouched: they stay valid because the
    // atlas (and therefore the images scope) does not change.
    const sourceImages = await t.any(
      `SELECT i.* FROM images i
       WHERE i.atlas_id = $1
         AND i.id IN (SELECT f.id FROM features f
                      WHERE f.map_id = $2 AND f.feature_type = 'image' AND f.deleted_at IS NULL)`,
      [atlasId, mapId]
    );
    const { imageIdMap, rows: imageRows } = planImageCopies(sourceImages, atlasId, copyJobs);
    await insertMany(t, CS.images, imageRows);

    const newMapId = crypto.randomUUID();
    await insertMany(t, CS.maps, [mapRow(newMapId, atlasId, withCopySuffix(map.name), map)]);

    await cloneMapSubEntities(
      t,
      [{ sourceId: mapId, newId: newMapId, legacyCatalogLayers: map.catalog_layers }],
      imageIdMap
    );

    // Append to atlas map_order
    await t.none(
      `UPDATE atlas SET map_order = array_append(map_order, $1::uuid) WHERE id = $2`,
      [newMapId, atlasId]
    );

    newMapResult = await t.one(`SELECT * FROM maps WHERE id = $1`, [newMapId]);
  });

  await runImageCopyJobs(copyJobs);

  return newMapResult;
}

/**
 * Generates a unique public link for an atlas.
 */
function generatePublicLink() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Enables public sharing for an atlas.
 */
export async function enablePublicSharing(atlasId) {
  const publicLink = generatePublicLink();
  const { rows } = await query(Q.UPDATE_PUBLIC_LINK, [atlasId, true, publicLink]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  return { publicLink };
}

/**
 * Disables public sharing for an atlas.
 */
export async function disablePublicSharing(atlasId) {
  const { rows } = await query(Q.UPDATE_PUBLIC_LINK, [atlasId, false, null]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  return true;
}

/**
 * Transfers atlas ownership to another user (owner-only — enforced at the route).
 *
 * The new owner MUST already be a member (atlas_shares row). In one transaction: set
 * atlas.owner_id, drop the new owner's share row (ownership comes from owner_id, not a share),
 * and demote the previous owner to a 'manage' co-Gestor — so the ex-owner keeps full
 * management access and never silently loses the project. Rejects self-transfer and
 * non-member targets.
 *
 * @param {string} atlasId
 * @param {string} currentOwnerId - The atlas's current owner (req.atlasOwnerId)
 * @param {string} newOwnerId
 * @returns {Promise<Object>} The updated atlas (with maps summary)
 * @throws {ConflictError} When ownership no longer matches `currentOwnerId` — i.e. another
 *   transfer won the race. Losing here is a full rollback, never a partial transfer.
 */
export async function transferOwnership(atlasId, currentOwnerId, newOwnerId) {
  if (newOwnerId === currentOwnerId) {
    throw new BadRequestError('O novo dono já é o dono atual do atlas.');
  }

  await tx(async (t) => {
    const atlas = await t.oneOrNone(Q.FIND_ATLAS_BY_ID, [atlasId]);
    if (!atlas) {
      throw new NotFoundError('Atlas');
    }

    // The new owner must be an ACTIVE user AND a current member of the atlas — never hand
    // ownership to a deactivated account (which could no longer delete/transfer it, orphaning it).
    const member = await t.oneOrNone(
      `SELECT s.user_id FROM atlas_shares s
       JOIN users u ON u.id = s.user_id
       WHERE s.atlas_id = $1 AND s.user_id = $2 AND u.is_active = true`,
      [atlasId, newOwnerId]
    );
    if (!member) {
      throw new BadRequestError('O novo dono precisa ser um membro ativo do atlas.');
    }

    // Hand over ownership — SCOPED BY THE OWNER THE CALLER WAS AUTHORIZED AGAINST.
    //
    // `currentOwnerId` is read by the middleware, one query and one transaction earlier, and
    // the UPDATE used to be scoped only by id: two callers legitimately authorized against the
    // SAME owner (the owner themself and a global admin, who gets owner-level on every atlas)
    // could each transfer the atlas to a different member. Both answered 200; the first
    // recipient ended up neither owner (overwritten by the second) nor member (their share row
    // had been deleted as redundant), and nothing said so.
    //
    // Comparing the `atlas` row read above against `currentOwnerId` — the cheaper fix — does
    // NOT close this. Under READ COMMITTED both transactions read the pre-transfer owner before
    // either writes, so both comparisons pass; the second UPDATE then blocks on the row lock and,
    // on release, re-evaluates its WHERE against the COMMITTED row. That re-evaluation is the
    // whole mechanism (tests/helpers/concurrency.js documents it), and it only helps if
    // `owner_id` is IN the WHERE. A read-then-write pair is not mutual exclusion.
    const handover = await t.result(
      `UPDATE atlas SET owner_id = $2, updated_at = NOW(), version = version + 1
       WHERE id = $1 AND owner_id = $3 AND deleted_at IS NULL`,
      [atlasId, newOwnerId, currentOwnerId]
    );
    if (handover.rowCount === 0) {
      throw new ConflictError(
        'A posse do atlas mudou desde o início desta operação. Recarregue e tente novamente.'
      );
    }

    // The new owner is no longer a share (ownership comes from owner_id).
    await t.none(
      `DELETE FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2`,
      [atlasId, newOwnerId]
    );

    // The previous owner becomes a co-Gestor (keeps full management access).
    await t.none(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by)
       VALUES ($1, $2, 'manage', $3)
       ON CONFLICT (atlas_id, user_id) DO UPDATE SET permission = 'manage'`,
      [atlasId, currentOwnerId, newOwnerId]
    );
  });

  return getAtlasById(atlasId);
}

/**
 * Imports a complete atlas from offline storage (IndexedDB).
 * Creates atlas with all maps, features, layers, groups, briefings, and slides.
 * IDs from the client are preserved.
 */
export async function importAtlas(userId, data) {
  const { atlas, maps, briefings } = data;

  return tx(async (t) => {
    // 1. Create atlas.
    //
    // `settings` is MERGED over the column DEFAULT (`settings || $4::jsonb`), not
    // written over it. The import used to pass the payload verbatim — and '{}' when
    // the payload had none — while createAtlas omits the column and inherits the full
    // default document (002_atlas.sql: features/basemaps/min_zoom/available_*). An
    // atlas that arrived through "save my local atlas to the server" therefore
    // answered GET /settings with a DIFFERENT shape from one created on the server,
    // and settings is exactly the overlay the frontend reads to gate 3D/360/layers per
    // atlas: a missing `features` key is not "default on", it is an undefined lookup.
    // `||` is the same shallow merge PATCH /settings already uses, so the two writers
    // agree.
    // The column is left OUT of the INSERT so the DEFAULT applies, then merged in
    // place — there is no expression form that reads a column's own default.
    const newAtlas = await t.one(
      `INSERT INTO atlas (name, description, owner_id) VALUES ($1, $2, $3) RETURNING *`,
      [atlas.name, atlas.description || null, userId]
    );
    if (atlas.settings) {
      Object.assign(newAtlas, await t.one(
        `UPDATE atlas SET settings = settings || $2::jsonb WHERE id = $1 RETURNING *`,
        [newAtlas.id, JSON.stringify(atlas.settings)]
      ));
    }

    const atlasId = newAtlas.id;
    const mapList = maps || [];
    const briefingList = briefings || [];
    const mapIds = mapList.map((map) => map.id);

    // Every foreign key in the payload must resolve to an entity created BY THIS
    // IMPORT. The loops below used to insert client-supplied ids verbatim, and the FK
    // constraint only requires the referenced row to EXIST — not to be yours. So a
    // payload could name a group and a feature belonging to somebody else's atlas and
    // link them there: the write showed up in the VICTIM's snapshot, because
    // GET_GROUP_FEATURES joins through `groups.map_id`. Any user with plain 'read' on
    // a shared or public atlas already knows those UUIDs from the snapshot they are
    // entitled to.
    //
    // The route deliberately has no `requireAtlasPermission` (it creates a NEW atlas),
    // which is exactly why the payload's references must be constrained to the payload
    // itself: there is no atlas-scoped gate to fall back on. `cloneMapSubEntities`
    // already does this via its id mappings; the import path never got the guard.
    //
    // The sets are now collected across the WHOLE payload before any insert (they used to
    // be filled map by map), which is what lets each entity type travel as ONE multi-row
    // INSERT (L67) — and it makes the guard uniform instead of order-dependent: a parent or
    // a group/feature pair declared in a later map used to resolve or not purely by
    // position in the array.
    const importedMapIds = new Set(mapIds);
    const importedGroupIds = new Set(mapList.flatMap((m) => (m.groups || []).map((g) => g.id)));
    const importedFeatureIds = new Set(mapList.flatMap((m) => (m.features || []).map((f) => f.id)));
    // features.layer_id was the ONE reference left travelling verbatim after the
    // group/parent/slide references were constrained. features.layer_id is an FK to
    // layers(id) with no atlas scope, so a payload could point an imported feature at
    // a layer of somebody else's atlas: the victim then owns a layer whose soft-delete
    // cascade (sync layer cascade) reaches rows in an atlas they cannot see.
    const importedLayerIds = new Set(mapList.flatMap((m) => (m.layers || []).map((l) => l.id)));

    // 2. Maps
    await insertMany(t, CS.maps, mapList.map((map) => ({
      id: map.id,
      atlas_id: atlasId,
      name: map.name,
      base_layer: map.base_layer || 'carta-topografica',
      center_lat: map.center_lat,
      center_long: map.center_long,
      zoom: map.zoom,
      bearing: map.bearing || 0,
      pitch: map.pitch || 0,
      notes_title: map.notes_title || null,
      notes_description: map.notes_description || null,
      analysis_layers: JSON.stringify(map.analysis_layers || {}),
      catalog_layers: JSON.stringify(map.catalog_layers || []),
      locked: map.locked === true,
      grid_style: JSON.stringify(map.grid_style || {}),
      temporal_config: JSON.stringify(map.temporal_config || {}),
    })));

    // 2.1 Layers (before features, to allow layer_id references)
    const layerRows = mapList.flatMap((map) => (map.layers || []).map((layer) => ({
      id: layer.id,
      map_id: map.id,
      name: layer.name,
      visible: layer.visible !== false,
      locked: layer.locked === true,
      opacity: layer.opacity ?? 1,
      sort_order: layer.sort_order ?? 0,
      style: JSON.stringify(layer.style || {}),
    })));
    await insertMany(t, CS.layers, layerRows);

    // 2.2 Groups (parent_id only resolves within the payload)
    const groupRows = mapList.flatMap((map) => (map.groups || []).map((group) => ({
      id: group.id,
      map_id: map.id,
      name: group.name,
      visible: group.visible !== false,
      locked: group.locked === true,
      style: JSON.stringify(group.style || {}),
      parent_id: importedGroupIds.has(group.parent_id) ? group.parent_id : null,
    })));
    await insertMany(t, CS.groups, groupRows);

    // 2.3 Features
    const featureRows = mapList.flatMap((map) => (map.features || []).map((feature) => ({
      id: feature.id,
      map_id: map.id,
      feature_type: feature.feature_type,
      geometry: JSON.stringify(feature.geometry),
      properties: JSON.stringify(feature.properties || {}),
      layer_id: importedLayerIds.has(feature.layer_id) ? feature.layer_id : null,
    })));
    await insertMany(t, CS.features, featureRows);

    // 2.4 Group-feature associations. Both ends must have been created by this import; a
    // pair naming anything else is silently skipped rather than failing the whole import,
    // since a partially-foreign payload is the attack shape, not a user error worth
    // reporting back.
    await insertMany(
      t,
      CS.groupFeatures,
      mapList.flatMap((map) => (map.groupFeatures || [])
        .filter((gf) => importedGroupIds.has(gf.group_id) && importedFeatureIds.has(gf.feature_id))
        .map((gf) => ({ group_id: gf.group_id, feature_id: gf.feature_id }))),
      ' ON CONFLICT DO NOTHING'
    );

    // 2.5 Cesium 3D data
    const cesium3dRows = mapList.flatMap((map) => (map.cesium3dData || []).map((cesium3d) => ({
      id: cesium3d.id,
      map_id: map.id,
      data_type: cesium3d.data_type,
      tileset_id: cesium3d.tileset_id || null,
      data: JSON.stringify(cesium3d.data || {}),
    })));
    await insertMany(t, CS.cesium3d, cesium3dRows);

    // 2.6 StreetView 360 data
    const sv360Rows = mapList.flatMap((map) => (map.streetview360Data || []).map((sv360) => ({
      id: sv360.id,
      map_id: map.id,
      data_type: sv360.data_type,
      photo_name: sv360.photo_name || null,
      data: JSON.stringify(sv360.data || {}),
    })));
    await insertMany(t, CS.streetview360, sv360Rows);

    // 2.7 Catalog layers. The payload only carries the legacy ARRAY (`map.catalog_layers`,
    // written above), but the snapshot reads exclusively from the dedicated table — so an
    // import that wrote only the column came back with `catalogLayers: []` and the client
    // applied that empty array over its own state (L42). Materialise both.
    await insertMany(
      t,
      CS.catalogLayers,
      mapList.flatMap((map) => catalogLayerRows(map.id, map.catalog_layers, []))
    );

    // 3. Update map_order
    if (mapIds.length > 0) {
      await t.none(`UPDATE atlas SET map_order = $2::uuid[] WHERE id = $1`, [atlasId, mapIds]);
    }

    // 4. Briefings + slides
    await insertMany(t, CS.briefings, briefingList.map((briefing) => ({
      id: briefing.id,
      atlas_id: atlasId,
      name: briefing.name,
      description: briefing.description || null,
      settings: JSON.stringify(briefing.settings || {}),
      slide_order: (briefing.slides || []).map((s) => s.id),
    })));

    const slideRows = briefingList.flatMap((briefing) => (briefing.slides || []).map((slide) => ({
      id: slide.id,
      briefing_id: briefing.id,
      title: slide.title || null,
      content: slide.content || null,
      mode: slide.mode || '2d',
      map_id: importedMapIds.has(slide.map_id) ? slide.map_id : null,
      model_id: slide.model_id || null,
      photo_id: slide.photo_id || null,
      position: JSON.stringify(slide.position || {}),
      orientation: JSON.stringify(slide.orientation || {}),
    })));
    await insertMany(t, CS.slides, slideRows);

    const summary = {
      mapsImported: mapList.length,
      featuresImported: featureRows.length,
      layersImported: layerRows.length,
      groupsImported: groupRows.length,
      cesium3dImported: cesium3dRows.length,
      streetview360Imported: sv360Rows.length,
      briefingsImported: briefingList.length,
      slidesImported: slideRows.length,
    };

    // 5. Return created atlas with summary
    const result = await t.one(
      `SELECT id, name, description, settings, map_order, version, current_version, created_at
       FROM atlas WHERE id = $1`,
      [atlasId]
    );

    return {
      ...result,
      summary,
    };
  });
}
