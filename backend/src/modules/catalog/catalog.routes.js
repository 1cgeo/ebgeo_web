// Path: src/modules/catalog/catalog.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireCatalogProducer } from '../../middleware/resource-access.js';
import { validate } from '../../middleware/validate.js';
import * as ctrl from './catalog.controller.js';
import * as schemas from './catalog.schemas.js';

/**
 * Builds a CRUD router for one catalog table.
 *
 * Leitura precisa de `auth` e o filtro de acesso mora no serviço. Escrita deixou de
 * ser `requireAdmin`: passa a aceitar administrador OU produtor, e QUAL linha o
 * produtor alcança é decidido no `WHERE` da escrita (cada CGEO cuida do que
 * produziu). O gate da rota só recusa cedo quem não produz nada.
 * @param {string} table - One of CATALOG_TABLES.
 * @returns {import('express').Router}
 */
export function makeCatalogRouter(table) {
  const router = Router();
  const produtor = requireCatalogProducer(table);
  router.get('/', auth, ctrl.list(table));
  router.get('/:id', auth, validate({ params: schemas.idParamsSchema }), ctrl.get(table));
  router.post('/', auth, produtor, validate({ body: schemas.createSchema }), ctrl.create(table));
  router.put('/:id', auth, produtor,
    validate({ params: schemas.idParamsSchema, body: schemas.updateSchema }), ctrl.update(table));
  router.delete('/:id', auth, produtor, validate({ params: schemas.idParamsSchema }), ctrl.remove(table));
  return router;
}
