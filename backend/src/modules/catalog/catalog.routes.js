// Path: src/modules/catalog/catalog.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/require-admin.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './catalog.controller.js';
import * as schemas from './catalog.schemas.js';

/**
 * Builds a CRUD router for one catalog table (reads need auth; writes need admin).
 * @param {string} table - One of CATALOG_TABLES.
 * @returns {import('express').Router}
 */
export function makeCatalogRouter(table) {
  const router = Router();
  router.get('/', auth, ctrl.list(table));
  router.get('/:id', auth, validate({ params: schemas.idParamsSchema }), ctrl.get(table));
  router.post('/', auth, requireAdmin, validate({ body: schemas.createSchema }), ctrl.create(table));
  router.put('/:id', auth, requireAdmin,
    validate({ params: schemas.idParamsSchema, body: schemas.updateSchema }), ctrl.update(table));
  router.delete('/:id', auth, requireAdmin, validate({ params: schemas.idParamsSchema }), ctrl.remove(table));
  return router;
}
