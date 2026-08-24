// Path: src/modules/ranks/ranks.service.js
// The ranks table is served to the ANONYMOUS GET /api/config (`postos`, for the signup
// dropdowns), so every write here drops the memoized payload — see config.cache.js.
import { query } from '../../database/index.js';
import { NotFoundError } from '../../utils/errors.js';
import { invalidateAppConfigCache } from '../config/config.cache.js';
import * as Q from './ranks.queries.js';

export async function listRanks() {
  const { rows } = await query(Q.LIST_RANKS);
  return rows;
}

export async function getRank(id) {
  const { rows } = await query(Q.FIND_RANK, [id]);
  if (rows.length === 0) throw new NotFoundError('Rank');
  return rows[0];
}

export async function createRank(data) {
  const { rows } = await query(Q.INSERT_RANK, [
    data.nome,
    data.nome_abrev || null,
    data.sort_order ?? 0,
  ]);
  invalidateAppConfigCache();
  return rows[0];
}

export async function updateRank(id, data) {
  const { rows } = await query(Q.UPDATE_RANK, [
    id,
    data.nome ?? null,
    data.nome_abrev === '' ? null : (data.nome_abrev ?? null),
    data.sort_order ?? null,
    data.is_active ?? null,
    data.nome_abrev !== undefined, // provided? — lets an explicit null clear the column
  ]);
  if (rows.length === 0) throw new NotFoundError('Rank');
  invalidateAppConfigCache();
  return rows[0];
}

/**
 * Soft-deletes a rank and returns the deactivated ROW, not a success flag.
 *
 * The row is what the caller needs: the controller writes `RANK_DELETE` into the audit
 * trail and the trail has to NAME the rank. A `{ success: true }` forces the emitter to
 * either re-read the row (a second query for something the UPDATE already had in hand)
 * or to log a naked UUID, which is exactly the gap the sibling ORG module has.
 */
export async function deactivateRank(id) {
  const { rows } = await query(Q.DEACTIVATE_RANK, [id]);
  if (rows.length === 0) throw new NotFoundError('Rank');
  invalidateAppConfigCache();
  return rows[0];
}
