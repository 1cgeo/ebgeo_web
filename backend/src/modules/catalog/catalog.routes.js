// Path: src/modules/catalog/catalog.routes.js
import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import {
  requireCatalogProducer, liftOptionalAtlasId, requireAtlasScopeWhenPresent,
} from '../../middleware/resource-access.js';
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
  // O ESCOPO DE ATLAS (`?atlasId=`) E GATEADO, e nao apenas lido. O controller o repassa
  // a `fn_granted_resource_ids`, que casa `ar.atlas_id` e NAO confere participacao: sem o
  // gate, saber o UUID de um atlas entregava todo recurso privado que ele empresta, e o
  // UUID viaja em toda URL de compartilhamento. A ordem e a mesma de
  // `GET /resource-access/visible` e das leituras do 360: validate -> lift -> auth ->
  // gate. Sem `atlasId` nao ha gate, porque "sem atlas em foco" e o estado normal.
  router.get(
    '/',
    validate({ query: schemas.atlasScopeQuerySchema }),
    liftOptionalAtlasId,
    auth,
    requireAtlasScopeWhenPresent,
    ctrl.list(table),
  );
  router.get(
    '/:id',
    validate({ params: schemas.idParamsSchema, query: schemas.atlasScopeQuerySchema }),
    liftOptionalAtlasId,
    auth,
    requireAtlasScopeWhenPresent,
    ctrl.get(table),
  );
  router.post('/', auth, produtor, validate({ body: schemas.createSchema }), ctrl.create(table));
  router.put('/:id', auth, produtor,
    validate({ params: schemas.idParamsSchema, body: schemas.updateSchema }), ctrl.update(table));
  router.delete('/:id', auth, produtor, validate({ params: schemas.idParamsSchema }), ctrl.remove(table));
  return router;
}
