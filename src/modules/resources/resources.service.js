// Path: src/modules/resources/resources.service.js
import { query, oneOrNone, one } from '../../database/index.js';
import { NotFoundError, ConflictError } from '../../utils/errors.js';
import * as Q from './resources.queries.js';

/**
 * Lists all active resources, optionally filtered by category.
 */
export async function listResources(category = null) {
  if (category) {
    const { rows } = await query(Q.LIST_BY_CATEGORY, [category]);
    return rows;
  }
  const { rows } = await query(Q.LIST_ALL);
  return rows;
}

/**
 * Gets a single resource by ID.
 */
export async function getResource(id) {
  const resource = await oneOrNone(Q.FIND_BY_ID, [id]);
  if (!resource) {
    throw new NotFoundError('Resource');
  }
  return resource;
}

/**
 * Creates a new resource.
 */
export async function createResource(data) {
  // Check if ID already exists
  const existing = await oneOrNone(Q.FIND_BY_ID, [data.id]);
  if (existing) {
    throw new ConflictError('Resource with this ID already exists');
  }

  return one(Q.INSERT, [
    data.id,
    data.category,
    data.name,
    data.description || null,
    JSON.stringify(data.config || {}),
    data.sort_order || 0,
  ]);
}

/**
 * Updates an existing resource.
 */
export async function updateResource(id, data) {
  const resource = await oneOrNone(Q.UPDATE, [
    id,
    data.name || null,
    data.description !== undefined ? data.description : null,
    data.config ? JSON.stringify(data.config) : null,
    data.sort_order !== undefined ? data.sort_order : null,
  ]);

  if (!resource) {
    throw new NotFoundError('Resource');
  }

  return resource;
}

/**
 * Soft-deletes a resource (sets active = false).
 */
export async function deleteResource(id) {
  const resource = await oneOrNone(Q.SOFT_DELETE, [id]);
  if (!resource) {
    throw new NotFoundError('Resource');
  }
  return true;
}
