// Path: src/modules/maps/maps.controller.js
// Mostly read-only — writes go via sync API. EXCEPTION: mergeMaps (structural).
import { asyncHandler } from '../../utils/async-handler.js';
import { broadcastToRoom } from '../collab/collab.rooms.js';
import * as mapsService from './maps.service.js';

export const listMaps = asyncHandler(async (req, res) => {
  const maps = await mapsService.listMaps(req.atlasId);
  res.json({ data: maps });
});

export const getMap = asyncHandler(async (req, res) => {
  const map = await mapsService.getMapById(req.atlasId, req.params.mapId);
  res.json({ data: map });
});

export const mergeMaps = asyncHandler(async (req, res) => {
  const result = await mapsService.mergeMaps(
    req.atlasId, req.params.mapId, req.body.sourceMapIds, req.user?.id ?? null
  );
  broadcastToRoom(req.atlasId, {
    type: 'maps_merged',
    destMapId: req.params.mapId,
    sourceMapIds: result.sourceMapIds,
  });
  res.json({ data: result });
});
