// Path: src/modules/atlas/atlas.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as atlasService from './atlas.service.js';
import { broadcastToRoom, closeRoom } from '../collab/collab.rooms.js';

export const listAtlas = asyncHandler(async (req, res) => {
  const result = await atlasService.listUserAtlas(req.user.id);
  res.json({ data: result });
});

export const createAtlas = asyncHandler(async (req, res) => {
  const atlas = await atlasService.createAtlas(req.user.id, req.body);
  res.status(201).json({ data: atlas });
});

export const getAtlas = asyncHandler(async (req, res) => {
  const atlas = await atlasService.getAtlasById(req.atlasId);
  res.json({ data: atlas });
});

export const updateAtlas = asyncHandler(async (req, res) => {
  const atlas = await atlasService.updateAtlas(req.atlasId, req.body);
  broadcastToRoom(req.atlasId, { type: 'atlas_updated', data: atlas });
  res.json({ data: atlas });
});

export const deleteAtlas = asyncHandler(async (req, res) => {
  await atlasService.deleteAtlas(req.atlasId);
  closeRoom(req.atlasId, { type: 'atlas_deleted', atlasId: req.atlasId });
  res.status(204).send();
});

export const getSettings = asyncHandler(async (req, res) => {
  const settings = await atlasService.getAtlasSettings(req.atlasId);
  res.json({ data: settings });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const atlas = await atlasService.updateAtlasSettings(req.atlasId, req.body);
  broadcastToRoom(req.atlasId, { type: 'atlas_settings_updated', settings: atlas.settings });
  res.json({ data: atlas });
});

export const cloneAtlas = asyncHandler(async (req, res) => {
  const atlas = await atlasService.cloneAtlas(req.atlasId, req.user.id, req.body);
  res.status(201).json({ data: atlas });
});

export const getPublicAtlas = asyncHandler(async (req, res) => {
  const atlas = await atlasService.getAtlasByPublicLink(req.params.link);
  res.json({ data: atlas });
});

export const importAtlas = asyncHandler(async (req, res) => {
  const result = await atlasService.importAtlas(req.user.id, req.body);
  res.status(201).json({ data: result });
});

export const duplicateMap = asyncHandler(async (req, res) => {
  const newMap = await atlasService.duplicateMap(req.atlasId, req.params.mapId);
  broadcastToRoom(req.atlasId, { type: 'map_duplicated', mapId: newMap.id });
  res.status(201).json({ data: newMap });
});
