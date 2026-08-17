// Path: src/modules/catalog/catalog.service.js
// Generic CRUD over the per-type catalog tables (basemaps / data_layers / analysis_layers /
// tilesets / streetview_markers). The `table` arg is whitelisted (assertTable) before interpolation.
//
// Every write here drops the memoized GET /api/config payload (config.cache.js). Four of the
// five tables feed that payload; `streetview_markers` does not, and is invalidated anyway
// because the alternative — a per-table condition — is the kind of partial invalidation that
// makes an admin watch an edit vanish and blame the database. Invalidating one extra table
// costs one rebuild of a document that is rebuilt on every write regardless.
import { query, oneOrNone, one } from '../../database/index.js';
import { NotFoundError, ConflictError, BadRequestError } from '../../utils/errors.js';
import { validateMapLibreStyle } from '../../utils/maplibre-style-validate.js';
import { invalidateAppConfigCache } from '../config/config.cache.js';
import { assertTable } from './catalog.tables.js';

const COLS = 'id, name, description, config, active, sort_order, created_at, updated_at';

// `access_level` fica FORA de COLS de propósito, numa segunda constante. A string
// COLS é amarrada ao schema por `catalog-tabelas-paridade.test.js`, que afirma
// literalmente que ela lista OITO colunas; esticá-la reprova aquele teste, e
// afrouxar o teste custaria a guarda que ele dá. Quem precisa do nível de acesso
// pede por aqui.
const COLS_COM_ACESSO = `${COLS}, access_level`;

/**
 * O predicado de visibilidade de recurso, na forma de fragmento de WHERE.
 *
 * FECHA POR PADRÃO, e essa é a propriedade que importa: sem principal, só o
 * público. A lista de chamadores de `listCatalog` cresce, e o esquecimento
 * provável é "não passei o principal" — que aqui degrada para MENOS dado, nunca
 * para vazamento. O contrário (default aberto, filtro opcional) é a forma que
 * transforma um esquecimento em incidente.
 *
 * Semi-join (`IN (SELECT ...)`), nunca `fn_can_see_resource` por linha: é uma
 * consulta em vez de uma por linha (R8).
 *
 * @param {{userId: string|null, atlasId: string|null}|null} visibleTo
 * @param {number} base - Índice do último parâmetro já usado.
 * @returns {{sql: string, params: Array}}
 */
function accessPredicate(visibleTo, base) {
  if (!visibleTo) return { sql: `AND t.access_level = 'public'`, params: [] };
  return {
    sql: `AND ( t.access_level = 'public'
                OR fn_has_global_data_access($${base + 1}::uuid)
                OR t.id IN (SELECT resource_id
                              FROM fn_granted_resource_ids($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::text)) )`,
    params: [visibleTo.userId ?? null, visibleTo.atlasId ?? null, visibleTo.resourceType],
  };
}

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

/**
 * Lists active items of a catalog table, filtered by ACCESS LEVEL.
 *
 * Sem `visibleTo`, devolve só o público — é o que `GET /api/config` quer, e é o
 * que mantém aquele payload igual para todo chamador (o memo de documento único
 * depende disso). Com `visibleTo`, soma o que aquele principal enxerga por papel
 * global ou concessão.
 *
 * @param {string} table - One of CATALOG_TABLES.
 * @param {{userId: string|null, atlasId: string|null, resourceType: string}} [visibleTo]
 * @returns {Promise<Array>}
 */
export async function listCatalog(table, visibleTo = null) {
  const t = assertTable(table);
  const pred = accessPredicate(visibleTo, 0);
  const { rows } = await query(
    `SELECT ${COLS_COM_ACESSO} FROM ${t} t WHERE t.active = true ${pred.sql} ORDER BY t.sort_order, t.name`,
    pred.params,
  );
  return rows;
}

/**
 * One catalog item by id, filtered by ACCESS LEVEL like the listing.
 *
 * O MESMO GATE DA LISTAGEM, e não por simetria estética: `GET /api/v1/tilesets/:id`
 * é `auth` e mais nada, exatamente como a rota de lista, então um recurso privado
 * vazava por aqui pelo id mesmo depois de sumir da listagem. Foi medido em
 * `resource-access-listagem-crua.test.js` antes de ser fechado.
 *
 * 404, não 403: um recurso que o chamador não enxerga precisa ser indistinguível
 * de um que não existe, senão o proprio 403 confirma a existência.
 *
 * @param {string} table
 * @param {string} id
 * @param {{userId: string|null, atlasId: string|null, resourceType: string}} [visibleTo]
 */
export async function getCatalogItem(table, id, visibleTo = null) {
  const t = assertTable(table);
  // L12 — `active = true`, matching listCatalogItems. Without it a soft-deleted
  // item stayed readable by direct id: gone from every listing, yet still served
  // (and still editable, since updateCatalogItem does not filter either).
  const pred = accessPredicate(visibleTo, 1);
  const row = await oneOrNone(
    `SELECT ${COLS_COM_ACESSO} FROM ${t} t WHERE t.id = $1 AND t.active = true ${pred.sql}`,
    [id, ...pred.params],
  );
  if (!row) throw new NotFoundError('Catalog item');
  return row;
}

// CREATE resurrects a soft-deleted id (L40). The three paths used to disagree about what
// "exists" means: get/update filter `active = true` (404 on a deleted item) while this
// duplicate probe did not (409 on the same id), and the module has no restore route. A
// deleted id was therefore stuck in a state with no way back — it existed for the conflict
// gate and did not exist for everything else — so DELETE /basemaps/osm took the seeded basemap
// off /api/config for everyone until somebody ran a manual UPDATE. That is the opposite of what
// soft-delete is for; the tests even recorded the dead end as a fact of life ("a soft-deleted id
// can never be recreated (permanent 409), so every test must mint its own id").
//
// A LIVE id still conflicts: that guard is what prevents a silent overwrite of a published item.
export async function createCatalogItem(table, data) {
  const t = assertTable(table);
  const existing = await oneOrNone(`SELECT id, active FROM ${t} WHERE id = $1`, [data.id]);
  if (existing && existing.active) throw new ConflictError('Já existe um item de catálogo com este ID.');
  assertValidStyle(data.config);

  const values = [
    data.id,
    data.name,
    data.description || null,
    JSON.stringify(data.config || {}),
    data.sort_order || 0,
  ];

  const row = existing
    // Resurrection is a full overwrite, not a merge: the caller sent a complete create
    // payload, so the row must end up exactly as if it had been inserted now.
    ? await one(
      `UPDATE ${t} SET name = $2, description = $3, config = $4::jsonb, sort_order = $5,
                      active = true, updated_at = NOW()
       WHERE id = $1 RETURNING ${COLS}`,
      values,
    )
    : await one(
      `INSERT INTO ${t} (id, name, description, config, sort_order)
       VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING ${COLS}`,
      values,
    );

  invalidateAppConfigCache();
  return row;
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
  invalidateAppConfigCache();
  return row;
}

/** Soft-deletes (active = false) a catalog item. */
export async function deleteCatalogItem(table, id) {
  const t = assertTable(table);
  const row = await oneOrNone(`UPDATE ${t} SET active = false, updated_at = NOW() WHERE id = $1 RETURNING id`, [id]);
  if (!row) throw new NotFoundError('Catalog item');
  invalidateAppConfigCache();
  return true;
}
