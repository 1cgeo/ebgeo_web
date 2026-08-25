// Path: src/modules/atlas/atlas.service.js
import crypto from 'crypto';
import { mkdir, copyFile } from 'fs/promises';
import { join, extname, dirname } from 'path';
import jwt from 'jsonwebtoken';
import { query, tx, pgp } from '../../database/index.js';
import { NotFoundError, BadRequestError, ConflictError } from '../../utils/errors.js';
import { createAudit } from '../../utils/audit.js';
import config from '../../config.js';
import logger from '../../utils/logger.js';
// The live room registry (in memory, per process). Read-only here: `listUserAtlasPresence` turns
// "who has a socket open" into a field of the project card. No cycle — collab never imports atlas.
import { getRoomUsers } from '../collab/collab.rooms.js';
import * as Q from './atlas.queries.js';
import { MAP_COLUMNS } from '../maps/maps.queries.js';
// A PODA DE COPIA (clone e import). O predicado NAO e reimplementado aqui: quem decide e
// `classifyResourceRefs`, que chama `fn_can_see_resource` uma vez para o atlas inteiro.
import { ResourcePruner, refsFromCollectedRows, refsFromImportPayload } from './atlas-resource-prune.js';
import { classifyResourceRefs } from '../resource-access/resource-access.service.js';
import { ATLAS_SEARCH_MIN_TERM, ATLAS_SEARCH_MAX_LIMIT } from './atlas.schemas.js';

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
      'locked', jsonb('grid_style'), jsonb('temporal_config')],
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
 * Rows for the dedicated `catalog_layers` table, from the two shapes a whole-entity writer can
 * hold them in.
 *
 * `arrayForm` is the IMPORT PAYLOAD's `map.catalog_layers`, which is a frozen key of the
 * `.ebgeo`/upload contract and is still accepted (`atlas.schemas.js`) even though no column of
 * that name exists any more. It is materialised straight into the table, which is what the
 * snapshot reads. Clone and duplicate pass null: they have only the table.
 *
 * Live rows win over the array for the same id — the row carries version/updated_at/deleted_at
 * and is the one the snapshot has been serving.
 *
 * (History: import/clone/duplicate used to write ONLY the legacy column while the snapshot built
 * `map.catalogLayers` ONLY from the table, so the layers survived in Postgres where no reader
 * could reach them and the snapshot's empty array then overwrote the client's local state —
 * silent loss, no error, L42.)
 *
 * @param {string} mapId - Target map id
 * @param {Array<Object>|null} arrayForm - Array-shaped entries (import payload), or null
 * @param {Array<Object>} tableRows - Live rows of the dedicated table (id, data)
 * @returns {Array<Object>} Rows ready for CS.catalogLayers
 */
function catalogLayerRows(mapId, arrayForm, tableRows) {
  const byId = new Map();
  for (const item of Array.isArray(arrayForm) ? arrayForm : []) {
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
 * A BUSCA DE ATLAS DO ADMINISTRADOR: os atlas VIVOS de qualquer dono que casem com um termo.
 *
 * O CONTRATO É "NÃO EXISTE CHAMADA QUE DEVOLVA TUDO", e ele é reafirmado AQUI, não só no Joi da
 * rota: borda protege a ROTA, e esta função pode ganhar um segundo chamador amanhã. Termo curto
 * demais é `BadRequestError`, nunca "sem filtro" — argumento que falta tem de degradar para
 * MENOS dado, jamais para o acervo inteiro.
 *
 * O ESCAPE DE `%` E `_` NÃO É HIGIENE, É O MESMO CONTRATO. Um termo de dois caracteres (`%%`)
 * passa no piso e, sem escape, vira o padrão que casa com todo nome do banco: o despejo que a
 * decisão recusa, entrando pela porta da busca. O caractere de escape é a contrabarra, default de
 * `LIKE`/`ILIKE` no Postgres, e o valor viaja como PARÂMETRO — a contrabarra chega como dado e é
 * lida pelo operador, nunca pelo parser de literais.
 *
 * QUEM GATEIA O PODER É A ROTA (`requireAdmin`), e não esta função. O papel global é lido do
 * banco pelo middleware `auth` a cada requisição, e reperguntá-lo aqui seria a segunda resposta
 * para a mesma pergunta dentro de uma requisição só. A contrapartida honesta: a consulta não tem
 * eixo de acesso NENHUM, então um chamador novo que a alcance sem aquele gate entrega o acervo
 * vivo inteiro (em fatias de `limit`) a quem não é administrador.
 *
 * `truncated` VEM DE UMA LINHA A MAIS, nunca de `length === limit`: com o teto exato, "bateu o
 * teto" e "bateu o teto e há mais" são indistinguíveis, e a tela pediria para refinar uma busca
 * que já estava completa.
 *
 * @param {string} term - Casa contra nome do atlas, nome e login do dono, e id EXATO.
 * @param {number} limit - Teto de linhas devolvidas.
 * @returns {Promise<{results: Object[], truncated: boolean}>}
 */
export async function searchAllAtlas(term, limit) {
  const alvo = String(term ?? '').trim();
  if (alvo.length < ATLAS_SEARCH_MIN_TERM) {
    throw new BadRequestError(
      `A busca de atlas exige um termo de ao menos ${ATLAS_SEARCH_MIN_TERM} caracteres.`,
    );
  }
  const teto = Math.min(Math.max(Number.parseInt(limit, 10) || 1, 1), ATLAS_SEARCH_MAX_LIMIT);
  const padrao = `%${alvo.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const { rows } = await query(Q.SEARCH_ALL_ATLAS, [padrao, alvo, teto + 1]);
  return { results: rows.slice(0, teto), truncated: rows.length > teto };
}

/**
 * The card-level extras of every atlas the user reaches: who takes part, how many, and whether
 * there is a cover. One row per atlas, keyed by id.
 *
 * SEPARATE FROM `listUserAtlas` on purpose — see the comment on LIST_USER_ATLAS_MEMBERS: the plain
 * listing is on the hot path of four client surfaces, and only this page draws members.
 *
 * Cada item de `members` traz `{ id, nome, posto_graduacao, permission }`, e `permission` é o nível
 * EFETIVO (a escada de cinco, `owner` inclusive), não a coluna de `atlas_shares`. Ver o comentário
 * de LIST_USER_ATLAS_MEMBERS: o campo entrou em 2026-08-23 e é o que torna "quem tem acesso e com
 * que nível" respondível abaixo de `manage`.
 *
 * @param {string} userId
 * @returns {Promise<Object[]>} `{ id, member_count, members, has_cover, cover_updated_at }`.
 */
export async function listUserAtlasMembers(userId) {
  const { rows } = await query(Q.LIST_USER_ATLAS_MEMBERS, [userId]);
  return rows;
}

/**
 * Who is CONNECTED right now to each atlas the user reaches.
 *
 * The source is the in-memory room registry, not the database: a collaborator is "online" for
 * exactly as long as their socket is in the room, and no table records that. Two consequences the
 * caller must not forget — the answer is per PROCESS (a multi-process deployment would under-report
 * without a shared registry), and it is a snapshot with no subscription, so a page that wants it
 * fresh polls.
 *
 * DEDUPED BY USER, unlike the room itself: two tabs of the same person are two sockets and one
 * collaborator, and a card that said "2 online" for one person would be lying. `away` (the grace
 * window after an abnormal close) counts as present, which is what the map's roster already shows.
 *
 * The scope is the caller's own atlases, resolved from the database FIRST: reading a room by id
 * without that check would answer "who is in this project" to anybody holding a token.
 *
 * @param {string} userId
 * @returns {Promise<Object<string, Array<{id: string, nome: string, posto_graduacao: string|null,
 *   status: string}>>>} Atlas id → connected users. Atlases with nobody online are omitted.
 */
export async function listUserAtlasPresence(userId) {
  const { rows } = await query(Q.LIST_USER_ATLAS, [userId]);
  const presence = {};
  for (const atlas of rows) {
    const byUser = new Map();
    for (const client of getRoomUsers(atlas.id)) {
      if (!client?.id) continue;
      const previous = byUser.get(String(client.id));
      // 'online' wins over 'away': one live tab makes the person present.
      if (previous && previous.status === 'online') continue;
      byUser.set(String(client.id), {
        id: String(client.id),
        nome: client.nome || '',
        posto_graduacao: client.posto_graduacao || null,
        status: client.status === 'away' ? 'away' : 'online',
      });
    }
    if (byUser.size > 0) presence[atlas.id] = [...byUser.values()];
  }
  return presence;
}

/**
 * The covers of every atlas the user reaches, as data URIs keyed by atlas id.
 *
 * ONE REQUEST FOR THE WHOLE GRID, and a data URI rather than a URL, because the alternative does
 * not work here: the page authenticates with a Bearer header, and an `<img src>` sends no header,
 * so a per-atlas image route would need either a cookie or a fetch-into-object-URL per card. The
 * thumbnails are capped at {@link COVER_MAX_BYTES} each by the write path.
 *
 * @param {string} userId
 * @returns {Promise<Object<string, string>>} Atlas id → `data:image/webp;base64,...`.
 */
export async function listUserAtlasCovers(userId) {
  const { rows } = await query(Q.LIST_USER_ATLAS_COVERS, [userId]);
  const covers = {};
  for (const row of rows) {
    covers[row.atlas_id] = `data:${row.mime_type};base64,${row.bytes.toString('base64')}`;
  }
  return covers;
}

/** Ceiling for a stored cover, in decoded bytes. The client downscales well below it. */
export const COVER_MAX_BYTES = 512 * 1024;

/**
 * The magic numbers of the three formats the product accepts anywhere (`images.routes.js` allows
 * exactly these, and deliberately NOT svg, which is a script container).
 */
const COVER_SIGNATURES = Object.freeze({
  'image/png': (b) => b.length > 8 && b.toString('binary', 0, 8) === '\x89PNG\r\n\x1a\n',
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF'
    && b.toString('ascii', 8, 12) === 'WEBP',
});

/**
 * Stores (or replaces) an atlas cover from a data URI.
 *
 * THE DECLARED TYPE IS NOT TRUSTED. The Joi schema only proves the string has the SHAPE of a data
 * URI; what actually lands in the column is checked against the format's magic number here, the
 * same rule the file-upload route enforces with multer's `fileFilter`. Without it, `image/webp` is
 * a label anybody can type over any bytes at all.
 *
 * @param {string} atlasId
 * @param {{image: string, width?: number, height?: number}} payload
 * @param {string} userId - Who set it (audit trail on the row).
 * @returns {Promise<Object>} The stored row's metadata (never the bytes).
 * @throws {BadRequestError} On a payload whose bytes do not match the declared image type.
 */
export async function setAtlasCover(atlasId, payload, userId) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(payload.image);
  if (!match) throw new BadRequestError('Cover must be a base64 data URI (png, jpeg or webp)');

  const [, mimeType, base64] = match;
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) throw new BadRequestError('Cover image is empty');
  if (bytes.length > COVER_MAX_BYTES) {
    throw new BadRequestError(`Cover image too large (max ${Math.round(COVER_MAX_BYTES / 1024)} kB)`);
  }
  if (!COVER_SIGNATURES[mimeType](bytes)) {
    throw new BadRequestError(`Cover image is not a valid ${mimeType} file`);
  }

  const { rows } = await query(Q.UPSERT_ATLAS_COVER, [
    atlasId,
    mimeType,
    bytes,
    Number.isInteger(payload.width) ? payload.width : null,
    Number.isInteger(payload.height) ? payload.height : null,
    userId,
  ]);
  return rows[0];
}

/**
 * Removes an atlas cover. Idempotent: removing an absent cover is a success, because the caller
 * asked for a state ("no cover"), not for a row to disappear.
 * @param {string} atlasId
 * @returns {Promise<boolean>} True when a row was actually deleted.
 */
export async function deleteAtlasCover(atlasId) {
  const { rows } = await query(Q.DELETE_ATLAS_COVER, [atlasId]);
  return rows.length > 0;
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
 *
 * DEVOLVE A LINHA (`id, name, owner_id`) e não `true`: `ATLAS_DELETE` estava
 * declarado no CHECK de `audit_trail.action` (`002_auditoria.sql`) desde sempre e nunca teve
 * emissor, e o booleano era exatamente o que faltava para o emissor ter um
 * `target_name`. Quem só precisa do sucesso continua servido — a função lança em
 * vez de devolver falso.
 * @returns {Promise<{id: string, name: string, owner_id: string}>}
 */
export async function deleteAtlas(atlasId) {
  const { rows } = await query(Q.SOFT_DELETE_ATLAS, [atlasId]);

  if (rows.length === 0) {
    throw new NotFoundError('Atlas');
  }

  return rows[0];
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
 * @param {Object|null} [pruner] - A poda POR DESTINATARIO das referencias de recurso de
 *   catalogo (`ResourcePruner`). NULO em `duplicateMap`, e o nulo e a decisao: duplicar um
 *   mapa nao cruza fronteira nenhuma (mesmo atlas, mesmo dono, mesmo predicado a cada
 *   leitura), entao podar ali tiraria do proprio usuario o acervo dele.
 * @returns {Promise<{layerIdMapping: Object, groupIdMapping: Object, featureIdMapping: Object}>}
 */
async function cloneMapSubEntities(t, mapPairs, imageIdMap = {}, pruner = null) {
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
  await insertMany(t, CS.cesium3d, cesium3dData
    .filter((c3d) => !pruner || pruner.manterCesium3d(c3d))
    .map((c3d) => ({
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
  await insertMany(t, CS.streetview360, sv360Data
    .filter((sv) => !pruner || pruner.manterSv360(sv))
    .map((sv) => ({
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
  for (const row of catalogRows) {
    if (pruner && !pruner.manterCatalogLayer(row)) continue;
    catalogBySourceMap.get(row.map_id)?.push(row);
  }
  await insertMany(
    t,
    CS.catalogLayers,
    mapPairs.flatMap((pair) =>
      catalogLayerRows(pair.newId, null, catalogBySourceMap.get(pair.sourceId) || []))
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
function mapRow(id, atlasId, name, map, pruner = null) {
  return {
    id,
    atlas_id: atlasId,
    name,
    base_layer: pruner ? pruner.baseLayer(map.base_layer) : map.base_layer,
    center_lat: map.center_lat,
    center_long: map.center_long,
    zoom: map.zoom,
    bearing: map.bearing,
    pitch: map.pitch,
    notes_title: map.notes_title,
    notes_description: map.notes_description,
    analysis_layers: JSON.stringify(map.analysis_layers || {}),
    locked: map.locked || false,
    grid_style: JSON.stringify(map.grid_style || {}),
    temporal_config: JSON.stringify(map.temporal_config || {}),
  };
}

/**
 * Clones an atlas to a new owner.
 *
 * A COPIA E PODADA POR DESTINATARIO. O clone FICA no servidor, onde o predicado continua
 * valendo a cada leitura, entao a pergunta e "o novo dono ve este recurso?" e quem a responde
 * e o SQL. Uma unica classificacao, para o atlas inteiro, dentro da MESMA transacao das
 * escritas: classificar fora e escrever dentro deixaria uma janela em que uma revogacao
 * concorrente produziria uma copia com o recurso que ela acabou de tirar.
 *
 * O ATLAS EM FOCO DA CLASSIFICACAO E NULO, nao o de origem, e isso e decisao de projeto: o
 * clone nao copia `atlas_resources`, entao o que a ORIGEM emprestava nao viaja. Classificar
 * com o atlas de origem faria a copia nascer enxergando o emprestado e deixar de enxergar
 * depois, sem ninguem ter revogado nada.
 *
 * @returns {Promise<Object>} O atlas criado, com `pruneReport` (contagem POR SUPERFICIE, nunca
 *   ids nem nomes) quando alguma referencia caiu.
 */
export async function cloneAtlas(atlasId, newOwnerId, options = {}) {
  // The atlas id is minted here (not read back) so the copied `images` rows — and the
  // rewritten references to them in atlas.settings — can be built before the first write.
  const newAtlasId = crypto.randomUUID();
  const copyJobs = [];
  let pruner = null;

  await tx(async (t) => {
    const source = await t.oneOrNone(Q.FIND_ATLAS_BY_ID, [atlasId]);
    if (!source) {
      throw new NotFoundError('Atlas');
    }

    // As referencias do atlas INTEIRO numa consulta, classificadas numa segunda: duas
    // instrucoes constantes, nunca uma por linha (`atlas-clone-import-n1.repro.test.js`).
    const refRows = await t.any(Q.COLLECT_ATLAS_RESOURCE_REFS, [atlasId]);
    pruner = new ResourcePruner(await classifyResourceRefs({
      userId: newOwnerId, refs: refsFromCollectedRows(refRows), t,
    }));

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
        // DUAS reescritas sobre o mesmo documento, e a ordem entre elas nao importa
        // (uma toca `customIcons`, a outra toca as seis listas de catalogo). O que importa
        // e que a SEGUNDA exista: `settings` carrega `basemaps`, `default_basemap` e os
        // quatro `available_*`, todos ids de recurso de catalogo, e ate esta onda eles
        // viajavam verbatim para um destinatario sem concessao nenhuma — no mesmo objeto
        // em que `pruneReport` dizia que nada tinha sido podado.
        JSON.stringify(pruner.settings(rewriteSettingsIcons(source.settings, imageIdMap))),
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
      source: map,
    }));
    const mapIdMapping = Object.fromEntries(mapPairs.map((p) => [p.sourceId, p.newId]));

    await insertMany(t, CS.maps,
      mapPairs.map((p) => mapRow(p.newId, newAtlasId, p.source.name, p.source, pruner)));
    await cloneMapSubEntities(t, mapPairs, imageIdMap, pruner);

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
      map_id: slide.map_id ? (mapIdMapping[slide.map_id] || null) : null,
      ...pruner.slide(slide),
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
  const clonado = await getAtlasById(newAtlasId);
  return pruner && !pruner.vazio ? { ...clonado, pruneReport: pruner.report } : clonado;
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
      [{ sourceId: mapId, newId: newMapId }],
      imageIdMap
    );

    // Append to atlas map_order
    await t.none(
      `UPDATE atlas SET map_order = array_append(map_order, $1::uuid) WHERE id = $2`,
      [newMapId, atlasId]
    );

    // Explicit column list: this row IS the response body of
    // `POST /atlas/:atlasId/maps/:mapId/duplicate`, gated at `write`. Same reason as the two
    // read routes in `maps.queries.js`, whose list this reuses.
    newMapResult = await t.one(`SELECT ${MAP_COLUMNS} FROM maps WHERE id = $1`, [newMapId]);
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
 * A TRILHA ENTRA NA MESMA TRANSAÇÃO, e é obrigatório que entre: a corrida acima
 * termina em ConflictError e ROLLBACK, então uma auditoria emitida fora registraria
 * uma transferência que não aconteceu. É o caso literal de "auditoria fora da
 * transação sobrevive ao rollback e mente".
 *
 * O `from` auditado é `currentOwnerId`, NUNCA `req.user`: quem age pode ser um
 * administrador global mexendo em atlas alheio, e gravar o ator no lugar do dono
 * anterior apagaria da trilha justamente quem perdeu a posse.
 *
 * @param {string} atlasId
 * @param {string} currentOwnerId - The atlas's current owner (req.atlasOwnerId)
 * @param {string} newOwnerId
 * @param {object} [req] - Express req, para ip/user-agent e o ator da trilha.
 * @returns {Promise<Object>} The updated atlas (with maps summary)
 * @throws {ConflictError} When ownership no longer matches `currentOwnerId` — i.e. another
 *   transfer won the race. Losing here is a full rollback, never a partial transfer.
 */
export async function transferOwnership(atlasId, currentOwnerId, newOwnerId, req = null) {
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
    //
    // A POSSE EXIGE SHARE DIRETO, e o `s.user_id IS NOT NULL` diz isso em voz alta desde que
    // `atlas_shares` aceita o alvo de GRUPO (003_atlas.sql). Hoje o `JOIN
    // users u ON u.id = s.user_id` já descartaria a linha coletiva por acidente; a linha
    // explícita existe para que um futuro `LEFT JOIN` não abra o caso calado. A regra: posse é
    // nominal por construção (`atlas.owner_id` é uma coluna, não um coletivo), e transferi-la a
    // quem só alcança o atlas por grupo trocaria uma autoridade revogável por uma irrevogável.
    //
    // Consequência que vale saber antes de "corrigir" a mensagem de erro: para quem entra só por
    // grupo, "precisa ser um membro ativo do atlas" soa errado, porque ele É membro. Se isso
    // incomodar, o conserto é a frase, não a regra.
    const member = await t.oneOrNone(
      `SELECT s.user_id FROM atlas_shares s
       JOIN users u ON u.id = s.user_id
       WHERE s.atlas_id = $1 AND s.user_id = $2 AND s.user_id IS NOT NULL AND u.is_active = true`,
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

    await createAudit(req, {
      action: 'ATLAS_TRANSFER',
      actorId: req?.user?.id ?? currentOwnerId,
      targetType: 'ATLAS',
      targetId: atlasId,
      targetName: atlas.name,
      details: { from: currentOwnerId, to: newOwnerId },
    }, t);
  });

  return getAtlasById(atlasId);
}

// ---------------------------------------------------------------------------
// A COLISAO DE ID NA IMPORTACAO (2026-08-25).
//
// `maps.id`, `layers.id`, `groups.id`, `features.id`, `briefings.id`, `slides.id` e as duas
// tabelas de 3D/360 sao CHAVE PRIMARIA GLOBAL, sem escopo de atlas. O empacotador do cliente
// (`frontend/src/js/import_export/local-atlas-to-server.js`, `makeIdMapper`) PRESERVA o id
// local quando ele ja e um UUID valido, e essa preservacao e DELIBERADA: o guarda de
// navegador `frontend/tests/e2e-ui/browser-save-local-to-server.spec.js` acha no servidor,
// pelo mesmo id do cliente, a feicao que a pessoa desenhou.
//
// As duas propriedades brigam no REENVIO. Mandar o mesmo atlas local ao servidor uma segunda
// vez repetia os ids, o Postgres recusava por unicidade (23505) e a tela imprimia "Resource
// already exists", em ingles e sem dizer o que fazer.
//
// MEDIDO por API antes deste conserto: o id de feicao vindo de atlas NA LIXEIRA recusa, o id
// vindo de atlas VIVO recusa igual, e o id inedito passa. Logo a lixeira NAO e a causa, e so
// onde o defeito apareceu. Dois usuarios que enviam copias do mesmo arquivo colidem entre si
// do mesmo jeito, e purgar a lixeira (proibido pela clausula 7.4 da CONSTITUICAO, que exige
// a lixeira restauravel COM conteudo) so adiaria o caso do atlas vivo.
//
// A REGRA ESCOLHIDA: preserva o id quando ele esta LIVRE, cunha um id novo quando esta
// OCUPADO. So o SERVIDOR sabe o que esta ocupado, entao a decisao mora aqui e nao no cliente.
// O caminho sem colisao, que e o do primeiro envio e o normal, nao muda em nada. O guarda
// de navegador continua verde pelo motivo certo.
//
// A JANELA QUE FICA: dois imports simultaneos do mesmo arquivo podem ambos ver o id livre, e
// o perdedor volta a cair em 23505 e rollback. E corrida estreita, e o desfecho e o de hoje.
// ---------------------------------------------------------------------------

/** Superficie do payload -> tabela de chave primaria GLOBAL que ela ocupa. */
const TABELA_POR_SUPERFICIE = {
  maps: 'maps',
  layers: 'layers',
  groups: 'groups',
  features: 'features',
  briefings: 'briefings',
  slides: 'slides',
  cesium3d: 'cesium3d_data',
  streetview360: 'streetview360_data',
};

/**
 * Os ids que o payload quer ocupar, por superficie.
 *
 * Um id REPETIDO dentro do proprio arquivo nao e colisao com o banco, e sim arquivo
 * inconsistente: duas linhas disputam a mesma identidade e nenhuma escolha do servidor seria
 * a certa. Isso e recusa LEGITIMA, e ela carrega frase propria em portugues. Antes deste
 * conserto o mesmo caso caia no 23505.
 * @param {Array<Object>} mapList
 * @param {Array<Object>} briefingList
 * @returns {Object} `{ superficie: Set<string> }`
 */
function idsDoPayload(mapList, briefingList) {
  const porSuperficie = {};
  for (const superficie of Object.keys(TABELA_POR_SUPERFICIE)) {
    porSuperficie[superficie] = new Set();
  }
  const cadastrar = (superficie, id) => {
    if (id == null) return;
    if (porSuperficie[superficie].has(id)) {
      throw new BadRequestError(
        `O arquivo repete o id de ${ROTULO_DA_SUPERFICIE[superficie]}. ` +
        'Cada item precisa de id único no arquivo. Exporte o atlas de novo e reenvie.'
      );
    }
    porSuperficie[superficie].add(id);
  };

  for (const map of mapList) {
    cadastrar('maps', map.id);
    for (const layer of map.layers || []) cadastrar('layers', layer.id);
    for (const group of map.groups || []) cadastrar('groups', group.id);
    for (const feature of map.features || []) cadastrar('features', feature.id);
    for (const item of map.cesium3dData || []) cadastrar('cesium3d', item.id);
    for (const item of map.streetview360Data || []) cadastrar('streetview360', item.id);
  }
  for (const briefing of briefingList) {
    cadastrar('briefings', briefing.id);
    for (const slide of briefing.slides || []) cadastrar('slides', slide.id);
  }
  return porSuperficie;
}

/** O nome que a recusa usa, porque "features" nao e palavra que o usuario reconheca. */
const ROTULO_DA_SUPERFICIE = {
  maps: 'um mapa', layers: 'uma camada', groups: 'um grupo', features: 'uma feição',
  briefings: 'um briefing', slides: 'um slide',
  cesium3d: 'um item 3D', streetview360: 'um item 360',
};

/**
 * Descobre quais ids do payload JA existem no banco e cunha um id novo para cada um.
 *
 * `deleted_at` NAO entra no filtro de proposito: uma linha na lixeira continua ocupando a
 * chave primaria, e e justamente ela que o chefe encontrou.
 *
 * UMA consulta para as oito superficies. O custo do import nao pode crescer com o numero de
 * linhas, invariante que `atlas-clone-import-n1.repro.test.js` prende com teto absoluto.
 * @param {Object} t - Contexto de transacao
 * @param {Object} porSuperficie - `{ superficie: Set<string> }`
 * @returns {Promise<Object>} `{ superficie: Map<idAntigo, idNovo> }`, so os ocupados
 */
async function cunharIdsOcupados(t, porSuperficie) {
  const remap = {};
  const partes = [];
  const valores = [];
  for (const [superficie, tabela] of Object.entries(TABELA_POR_SUPERFICIE)) {
    remap[superficie] = new Map();
    const ids = [...porSuperficie[superficie]];
    if (ids.length === 0) continue;
    valores.push(ids);
    // O rotulo e a tabela vem das constantes acima, nunca do payload: nada de entrada do
    // usuario e interpolado nesta string.
    partes.push(
      `SELECT '${superficie}' AS superficie, id::text AS id FROM ${tabela} ` +
      `WHERE id IN ($${valores.length}:csv)`
    );
  }
  if (partes.length === 0) return remap;

  const linhas = await t.any(partes.join(' UNION ALL '), valores);
  for (const linha of linhas) remap[linha.superficie].set(linha.id, crypto.randomUUID());
  return remap;
}

/**
 * O id que vai para o banco: o novo se houve colisao, o do payload se nao houve.
 * @param {Map<string, string>} mapa
 * @param {string|null} id
 * @returns {string|null}
 */
function idFinal(mapa, id) {
  if (id == null) return id;
  return mapa.get(id) || id;
}

/**
 * `properties.id` e `properties.layerId` ESPELHAM as colunas homonimas: a tela le a feicao
 * pelos dois caminhos, e o guarda de navegador le justamente por `properties.id`. Quando a
 * coluna foi recunhada, o espelho tem de acompanhar.
 *
 * Reescreve so o que DE FATO mudou e so quando o campo de fato espelhava, para que o caminho
 * sem colisao continue gravando `properties` identico ao de hoje.
 * @param {Object} feature - Linha do payload
 * @param {string} id - Id gravado
 * @param {string|null} layerId - `layer_id` gravado
 * @returns {Object}
 */
function propriedadesRealinhadas(feature, id, layerId) {
  const props = feature.properties || {};
  const saida = { ...props };
  if (id !== feature.id && props.id === feature.id) saida.id = id;
  if (layerId !== feature.layer_id && props.layerId === feature.layer_id) saida.layerId = layerId;
  return saida;
}

/**
 * Imports a complete atlas from offline storage (IndexedDB).
 * Creates atlas with all maps, features, layers, groups, briefings, and slides.
 * IDs from the client are preserved WHEN FREE. See the block above for the collision rule.
 */
export async function importAtlas(userId, data) {
  const { atlas, maps, briefings } = data;

  return tx(async (t) => {
    // 0. A PODA DA ENTRADA. Com a poda na saida o `.ebgeo` que ESTE app produz ja vem limpo,
    // mas `.ebgeo` e ARQUIVO: circula por e-mail, pode vir de uma versao anterior e pode ter
    // sido escrito a mao. Esta rota grava `tileset_id`, `photo_name` e as duas referencias de
    // slide VERBATIM e deliberadamente nao tem gate de atlas (ela CRIA um), e o que ela grava
    // volta a sair no snapshot, servido a `read` — nivel que um visitante de link publico
    // segura. Nao e 4xx: recusar o arquivo inteiro por uma referencia morta tornaria todo
    // `.ebgeo` antigo inimportavel, e a poda ja produz um resultado correto.
    const pruner = new ResourcePruner(await classifyResourceRefs({
      userId, refs: refsFromImportPayload(data), t,
    }));
    // 1. Create atlas.
    //
    // `settings` is MERGED over the column DEFAULT (`settings || $4::jsonb`), not
    // written over it. The import used to pass the payload verbatim — and '{}' when
    // the payload had none — while createAtlas omits the column and inherits the full
    // default document (003_atlas.sql: features/basemaps/min_zoom/available_*). An
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
      // O payload e ARQUIVO: as seis listas de catalogo de `settings` entram pela mesma
      // poda das outras superficies. Sem isto, um `.ebgeo` escrito a mao replantaria a
      // identidade de recurso privado num atlas novo, servida depois por
      // `GET /atlas/:id/settings` a qualquer um com `read`.
      Object.assign(newAtlas, await t.one(
        `UPDATE atlas SET settings = settings || $2::jsonb WHERE id = $1 RETURNING *`,
        [newAtlas.id, JSON.stringify(pruner.settings(atlas.settings))]
      ));
    }

    const atlasId = newAtlas.id;
    const mapList = maps || [];
    const briefingList = briefings || [];
    const mapIds = mapList.map((map) => map.id);

    // 1.1 A COLISAO DE ID: preserva quando livre, cunha quando ocupado. O bloco de comentario
    // antes de `TABELA_POR_SUPERFICIE` explica por que a decisao mora no servidor.
    const remap = await cunharIdsOcupados(t, idsDoPayload(mapList, briefingList));
    const novoMapa = (id) => idFinal(remap.maps, id);
    const novaCamada = (id) => idFinal(remap.layers, id);
    const novoGrupo = (id) => idFinal(remap.groups, id);
    const novaFeicao = (id) => idFinal(remap.features, id);
    const novoBriefing = (id) => idFinal(remap.briefings, id);
    const novoSlide = (id) => idFinal(remap.slides, id);

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
      id: novoMapa(map.id),
      atlas_id: atlasId,
      name: map.name,
      base_layer: pruner.baseLayer(map.base_layer),
      center_lat: map.center_lat,
      center_long: map.center_long,
      zoom: map.zoom,
      bearing: map.bearing || 0,
      pitch: map.pitch || 0,
      notes_title: map.notes_title || null,
      notes_description: map.notes_description || null,
      analysis_layers: JSON.stringify(map.analysis_layers || {}),
      locked: map.locked === true,
      grid_style: JSON.stringify(map.grid_style || {}),
      temporal_config: JSON.stringify(map.temporal_config || {}),
    })));

    // 2.1 Layers (before features, to allow layer_id references)
    const layerRows = mapList.flatMap((map) => (map.layers || []).map((layer) => ({
      id: novaCamada(layer.id),
      map_id: novoMapa(map.id),
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
      id: novoGrupo(group.id),
      map_id: novoMapa(map.id),
      name: group.name,
      visible: group.visible !== false,
      locked: group.locked === true,
      style: JSON.stringify(group.style || {}),
      parent_id: importedGroupIds.has(group.parent_id) ? novoGrupo(group.parent_id) : null,
    })));
    await insertMany(t, CS.groups, groupRows);

    // 2.3 Features
    const featureRows = mapList.flatMap((map) => (map.features || []).map((feature) => {
      const id = novaFeicao(feature.id);
      const layerId = importedLayerIds.has(feature.layer_id) ? novaCamada(feature.layer_id) : null;
      return {
        id,
        map_id: novoMapa(map.id),
        feature_type: feature.feature_type,
        geometry: JSON.stringify(feature.geometry),
        properties: JSON.stringify(propriedadesRealinhadas(feature, id, layerId)),
        layer_id: layerId,
      };
    }));
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
        .map((gf) => ({
          group_id: novoGrupo(gf.group_id), feature_id: novaFeicao(gf.feature_id),
        }))),
      ' ON CONFLICT DO NOTHING'
    );

    // 2.5 Cesium 3D data
    const cesium3dRows = mapList.flatMap((map) => (map.cesium3dData || [])
      .filter((cesium3d) => pruner.manterCesium3d(cesium3d))
      .map((cesium3d) => ({
        id: idFinal(remap.cesium3d, cesium3d.id),
        map_id: novoMapa(map.id),
        data_type: cesium3d.data_type,
        tileset_id: cesium3d.tileset_id || null,
        data: JSON.stringify(cesium3d.data || {}),
      })));
    await insertMany(t, CS.cesium3d, cesium3dRows);

    // 2.6 StreetView 360 data
    const sv360Rows = mapList.flatMap((map) => (map.streetview360Data || [])
      .filter((sv360) => pruner.manterSv360(sv360))
      .map((sv360) => ({
        id: idFinal(remap.streetview360, sv360.id),
        map_id: novoMapa(map.id),
        data_type: sv360.data_type,
        photo_name: sv360.photo_name || null,
        data: JSON.stringify(sv360.data || {}),
      })));
    await insertMany(t, CS.streetview360, sv360Rows);

    // 2.7 Catalog layers. The payload carries them as an ARRAY under `map.catalog_layers` (a
    // frozen key of the import contract, kept in the Joi schema), and the snapshot reads
    // exclusively from the dedicated table — so they are materialised into it. There is no
    // column of that name any more; the payload key is the only survivor.
    await insertMany(
      t,
      CS.catalogLayers,
      mapList.flatMap((map) => catalogLayerRows(
        novoMapa(map.id),
        (map.catalog_layers || []).filter((c) => pruner.manterCatalogLayer(c)), []
      ))
    );

    // 3. Update map_order
    if (mapIds.length > 0) {
      await t.none(
        `UPDATE atlas SET map_order = $2::uuid[] WHERE id = $1`,
        [atlasId, mapIds.map(novoMapa)]
      );
    }

    // 4. Briefings + slides
    await insertMany(t, CS.briefings, briefingList.map((briefing) => ({
      id: novoBriefing(briefing.id),
      atlas_id: atlasId,
      name: briefing.name,
      description: briefing.description || null,
      settings: JSON.stringify(briefing.settings || {}),
      slide_order: (briefing.slides || []).map((s) => novoSlide(s.id)),
    })));

    const slideRows = briefingList.flatMap((briefing) => (briefing.slides || []).map((slide) => ({
      id: novoSlide(slide.id),
      briefing_id: novoBriefing(briefing.id),
      title: slide.title || null,
      content: slide.content || null,
      map_id: importedMapIds.has(slide.map_id) ? novoMapa(slide.map_id) : null,
      ...pruner.slide(slide),
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
    // CONTAGEM POR SUPERFICIE, nunca ids nem nomes: o resumo volta ao cliente e vai para a
    // trilha, e o nome de um recurso privado e metadado do recurso.
    if (!pruner.vazio) summary.prunedResourceRefs = pruner.report;

    // Quantos ids do arquivo ja estavam ocupados e foram recunhados. CONTAGEM, pela mesma
    // razao da linha acima: o resumo vai para a trilha de auditoria, e um mapa de milhares
    // de pares de id nao e registro, e ruido.
    const idsRecunhados = Object.values(remap).reduce((total, m) => total + m.size, 0);
    if (idsRecunhados > 0) summary.remappedIds = idsRecunhados;

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
