// Path: src/modules/resources/resources.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as service from './resources.service.js';

export const list = asyncHandler(async (req, res) => {
  const resources = await service.listResources(req.query.category);
  res.json({ data: resources });
});

export const get = asyncHandler(async (req, res) => {
  const resource = await service.getResource(req.params.id);
  res.json({ data: resource });
});

export const create = asyncHandler(async (req, res) => {
  const resource = await service.createResource(req.body);
  res.status(201).json({ data: resource });
});

export const update = asyncHandler(async (req, res) => {
  const resource = await service.updateResource(req.params.id, req.body);
  res.json({ data: resource });
});

export const remove = asyncHandler(async (req, res) => {
  await service.deleteResource(req.params.id);
  res.status(204).send();
});
