// Path: src/modules/catalog/catalog.controller.js
// Controllers are curried by `table` so one set serves every per-type router.
import { asyncHandler } from '../../utils/async-handler.js';
import { principalUserId } from '../../utils/principal.js';
import { TYPE_BY_TABLE } from '../resource-access/resource-access.types.js';
import * as svc from './catalog.service.js';

/**
 * O principal desta requisição, na forma que o predicado de acesso espera.
 *
 * `atlasId` sai da QUERY porque estas rotas não têm o atlas no caminho: o painel
 * pede `GET /api/v1/tilesets?atlasId=...` quando quer ver também o que o atlas em
 * foco empresta. Ausente significa "sem atlas em foco", que é um estado legítimo.
 *
 * Tabelas sem tipo de recurso (`basemaps`, `streetview_markers`) não participam do
 * eixo: elas carregam a coluna por paridade de schema e nunca a consultam, então
 * recebem `null` e caem no ramo público-por-padrão.
 */
function visibleTo(req, table) {
  const resourceType = TYPE_BY_TABLE[table];
  if (!resourceType) return null;
  return {
    userId: principalUserId(req.user),
    atlasId: req.query?.atlasId ?? null,
    resourceType,
  };
}

export const list = (table) => asyncHandler(async (req, res) => {
  res.json({ data: await svc.listCatalog(table, visibleTo(req, table)) });
});

export const get = (table) => asyncHandler(async (req, res) => {
  res.json({ data: await svc.getCatalogItem(table, req.params.id, visibleTo(req, table)) });
});

export const create = (table) => asyncHandler(async (req, res) => {
  res.status(201).json({ data: await svc.createCatalogItem(table, req.body) });
});

export const update = (table) => asyncHandler(async (req, res) => {
  res.json({ data: await svc.updateCatalogItem(table, req.params.id, req.body) });
});

export const remove = (table) => asyncHandler(async (req, res) => {
  await svc.deleteCatalogItem(table, req.params.id);
  res.status(204).send();
});
