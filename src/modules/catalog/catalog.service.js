// Path: src/modules/catalog/catalog.service.js
// Generic CRUD over the per-type catalog tables (basemaps / data_layers / analysis_layers /
// tilesets / streetview_markers). The `table` arg is whitelisted (assertTable) before interpolation.
import { query, oneOrNone, one } from '../../database/index.js';
import { NotFoundError, ConflictError, BadRequestError } from '../../utils/errors.js';
import { validateMapLibreStyle } from '../../utils/maplibre-style-validate.js';
import { assertTable } from './catalog.tables.js';

const COLS = 'id, name, description, config, active, sort_order, created_at, updated_at';

/**
 * Rejects an invalid MapLibre `config.style` (basemap style override) before it is persisted and
 * later served verbatim in the public GET /config basemapStyles.
 */
function assertValidStyle(config) {
  if (config && config.style !== undefined) {
    const result = validateMapLibreStyle(config.style);
    if (!result.ok) {
      throw new BadRequestError(`Invalid MapLibre style: ${result.errors.join(' ')}`);
    }
  }
}

/** Lists active items of a catalog table. */
export async function listCatalog(table) {
  const t = assertTable(table);
  const { rows } = await query(`SELECT ${COLS} FROM ${t} WHERE active = true ORDER BY sort_order, name`);
  return rows;
}

export async function getCatalogItem(table, id) {
  const t = assertTable(table);
  // L12 — `active = true`, matching listCatalogItems. Without it a soft-deleted
  // item stayed readable by direct id: gone from every listing, yet still served
  // (and still editable, since updateCatalogItem does not filter either).
  const row = await oneOrNone(`SELECT ${COLS} FROM ${t} WHERE id = $1 AND active = true`, [id]);
  if (!row) throw new NotFoundError('Catalog item');
  return row;
}

export async function createCatalogItem(table, data) {
  const t = assertTable(table);
  const existing = await oneOrNone(`SELECT id FROM ${t} WHERE id = $1`, [data.id]);
  if (existing) throw new ConflictError('Já existe um item de catálogo com este ID.');
  assertValidStyle(data.config);
  return one(
    `INSERT INTO ${t} (id, name, description, config, sort_order)
     VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING ${COLS}`,
    [data.id, data.name, data.description || null, JSON.stringify(data.config || {}), data.sort_order || 0],
  );
}

export async function updateCatalogItem(table, id, data) {
  const t = assertTable(table);
  assertValidStyle(data.config);
  // L12 — only the soft-delete filter is added here: a deleted item must not be
  // editable back into visibility through this route.
  //
  // The `description` COALESCE is left ALONE on purpose. The scan flagged it as
  // "impossible to clear", but that is not quite right: passing `''` does clear
  // it, and only a literal SQL NULL is unreachable. The null-vs-empty asymmetry
  // is deliberate as-built behaviour, pinned by `images-gaps.test.js` res-02.
  const row = await oneOrNone(
    `UPDATE ${t} SET
       name = COALESCE($2, name),
       description = COALESCE($3, description),
       config = COALESCE($4::jsonb, config),
       sort_order = COALESCE($5, sort_order),
       updated_at = NOW()
     WHERE id = $1 AND active = true RETURNING ${COLS}`,
    [
      id,
      data.name || null,
      data.description !== undefined ? data.description : null,
      data.config ? JSON.stringify(data.config) : null,
      data.sort_order !== undefined ? data.sort_order : null,
    ],
  );
  if (!row) throw new NotFoundError('Catalog item');
  return row;
}

/** Soft-deletes (active = false) a catalog item. */
export async function deleteCatalogItem(table, id) {
  const t = assertTable(table);
  const row = await oneOrNone(`UPDATE ${t} SET active = false, updated_at = NOW() WHERE id = $1 RETURNING id`, [id]);
  if (!row) throw new NotFoundError('Catalog item');
  return true;
}
