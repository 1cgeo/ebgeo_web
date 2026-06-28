// Path: src/modules/ranks/ranks.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as ranksService from './ranks.service.js';

export const listRanks = asyncHandler(async (req, res) => {
  res.json({ data: await ranksService.listRanks() });
});

export const getRank = asyncHandler(async (req, res) => {
  res.json({ data: await ranksService.getRank(req.params.id) });
});

export const createRank = asyncHandler(async (req, res) => {
  res.status(201).json({ data: await ranksService.createRank(req.body) });
});

export const updateRank = asyncHandler(async (req, res) => {
  res.json({ data: await ranksService.updateRank(req.params.id, req.body) });
});

export const deleteRank = asyncHandler(async (req, res) => {
  await ranksService.deactivateRank(req.params.id);
  res.status(204).send();
});
