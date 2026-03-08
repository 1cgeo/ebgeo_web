// Path: src/modules/briefings/briefings.controller.js
// Read-only module. All write operations are managed via sync API (POST /atlas/:id/sync).
import { asyncHandler } from '../../utils/async-handler.js';
import * as briefingsService from './briefings.service.js';

export const listBriefings = asyncHandler(async (req, res) => {
  const briefings = await briefingsService.listBriefings(req.atlasId);
  res.json({ data: briefings });
});

export const getBriefing = asyncHandler(async (req, res) => {
  const briefing = await briefingsService.getBriefingById(req.atlasId, req.params.briefingId);
  res.json({ data: briefing });
});
