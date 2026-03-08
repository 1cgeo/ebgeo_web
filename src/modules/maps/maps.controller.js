// Path: src/modules/maps/maps.controller.js
// Read-only module. All write operations are managed via sync API (POST /atlas/:id/sync).
import { asyncHandler } from '../../utils/async-handler.js';
import * as mapsService from './maps.service.js';

export const listMaps = asyncHandler(async (req, res) => {
  const maps = await mapsService.listMaps(req.atlasId);
  res.json({ data: maps });
});

export const getMap = asyncHandler(async (req, res) => {
  const map = await mapsService.getMapById(req.atlasId, req.params.mapId);
  res.json({ data: map });
});
