// Path: src/modules/maps/maps.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as mapsService from './maps.service.js';

export const listMaps = asyncHandler(async (req, res) => {
  const maps = await mapsService.listMaps(req.atlasId);
  res.json({ data: maps });
});

export const createMap = asyncHandler(async (req, res) => {
  const map = await mapsService.createMap(req.atlasId, req.body);
  res.status(201).json({ data: map });
});

export const getMap = asyncHandler(async (req, res) => {
  const map = await mapsService.getMapById(req.atlasId, req.params.mapId);
  res.json({ data: map });
});

export const updateMap = asyncHandler(async (req, res) => {
  const map = await mapsService.updateMap(req.atlasId, req.params.mapId, req.body);
  res.json({ data: map });
});

export const deleteMap = asyncHandler(async (req, res) => {
  await mapsService.deleteMap(req.atlasId, req.params.mapId);
  res.status(204).send();
});
