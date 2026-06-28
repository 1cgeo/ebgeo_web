// Path: src/modules/ranks/ranks.service.js
import { query } from '../../database/index.js';
import { NotFoundError } from '../../utils/errors.js';
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
  return rows[0];
}

export async function updateRank(id, data) {
  const { rows } = await query(Q.UPDATE_RANK, [
    id,
    data.nome ?? null,
    data.nome_abrev ?? null,
    data.sort_order ?? null,
    data.is_active ?? null,
  ]);
  if (rows.length === 0) throw new NotFoundError('Rank');
  return rows[0];
}

export async function deactivateRank(id) {
  const { rows } = await query(Q.DEACTIVATE_RANK, [id]);
  if (rows.length === 0) throw new NotFoundError('Rank');
  return { success: true };
}
