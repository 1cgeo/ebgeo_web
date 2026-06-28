// Path: src/modules/catalog/catalog.controller.js
// Controllers are curried by `table` so one set serves every per-type router.
import { asyncHandler } from '../../utils/async-handler.js';
import * as svc from './catalog.service.js';

export const list = (table) => asyncHandler(async (req, res) => {
  res.json({ data: await svc.listCatalog(table) });
});

export const get = (table) => asyncHandler(async (req, res) => {
  res.json({ data: await svc.getCatalogItem(table, req.params.id) });
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
