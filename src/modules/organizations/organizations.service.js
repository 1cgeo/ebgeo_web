// Path: src/modules/organizations/organizations.service.js
import { query } from '../../database/index.js';
import { NotFoundError, ConflictError } from '../../utils/errors.js';
import * as Q from './organizations.queries.js';

export async function listOrganizations() {
  const { rows } = await query(Q.LIST_ORGANIZATIONS);
  return rows;
}

export async function getOrganization(id) {
  const { rows } = await query(Q.FIND_ORGANIZATION, [id]);
  if (rows.length === 0) throw new NotFoundError('Organization');
  return rows[0];
}

export async function createOrganization(data) {
  const { rows: existing } = await query(Q.CHECK_SLUG, [data.slug]);
  if (existing.length > 0) throw new ConflictError('Já existe uma organização com este identificador (slug).');
  const { rows } = await query(Q.INSERT_ORGANIZATION, [data.nome, data.slug, data.sigla || null]);
  return rows[0];
}

export async function updateOrganization(id, data) {
  const { rows } = await query(Q.UPDATE_ORGANIZATION, [
    id,
    data.nome ?? null,
    data.sigla ?? null,
    data.is_active ?? null,
  ]);
  if (rows.length === 0) throw new NotFoundError('Organization');
  return rows[0];
}

export async function deactivateOrganization(id) {
  const { rows } = await query(Q.DEACTIVATE_ORGANIZATION, [id]);
  if (rows.length === 0) throw new NotFoundError('Organization');
  return { success: true };
}
