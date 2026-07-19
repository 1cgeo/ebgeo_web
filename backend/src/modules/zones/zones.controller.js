// Path: src/modules/zones/zones.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as zonesService from './zones.service.js';

export const listZones = asyncHandler(async (req, res) => {
  res.json({ data: await zonesService.listZones() });
});

export const getZone = asyncHandler(async (req, res) => {
  res.json({ data: await zonesService.getZone(req.params.id) });
});

export const createZone = asyncHandler(async (req, res) => {
  const zone = await zonesService.createZone(req.body, req.user.id, req);
  res.status(201).json({ data: zone });
});

export const updateZone = asyncHandler(async (req, res) => {
  res.json({ data: await zonesService.updateZone(req.params.id, req.body, req.user?.id ?? null, req) });
});

export const deleteZone = asyncHandler(async (req, res) => {
  await zonesService.deleteZone(req.params.id, req.user?.id ?? null, req);
  res.status(204).send();
});

export const getZonePermissions = asyncHandler(async (req, res) => {
  res.json({ data: await zonesService.getZonePermissions(req.params.id) });
});

export const setZonePermissions = asyncHandler(async (req, res) => {
  const result = await zonesService.setZonePermissions(req, req.params.id, req.body);
  res.json({ data: result });
});
