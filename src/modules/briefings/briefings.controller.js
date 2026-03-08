// Path: src/modules/briefings/briefings.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as briefingsService from './briefings.service.js';

export const listBriefings = asyncHandler(async (req, res) => {
  const briefings = await briefingsService.listBriefings(req.atlasId);
  res.json({ data: briefings });
});

export const createBriefing = asyncHandler(async (req, res) => {
  const briefing = await briefingsService.createBriefing(req.atlasId, req.body);
  res.status(201).json({ data: briefing });
});

export const getBriefing = asyncHandler(async (req, res) => {
  const briefing = await briefingsService.getBriefingById(req.atlasId, req.params.briefingId);
  res.json({ data: briefing });
});

export const updateBriefing = asyncHandler(async (req, res) => {
  const briefing = await briefingsService.updateBriefing(
    req.atlasId,
    req.params.briefingId,
    req.body
  );
  res.json({ data: briefing });
});

export const deleteBriefing = asyncHandler(async (req, res) => {
  await briefingsService.deleteBriefing(req.atlasId, req.params.briefingId);
  res.status(204).send();
});

export const createSlide = asyncHandler(async (req, res) => {
  const slide = await briefingsService.createSlide(
    req.atlasId,
    req.params.briefingId,
    req.body
  );
  res.status(201).json({ data: slide });
});

export const updateSlide = asyncHandler(async (req, res) => {
  const slide = await briefingsService.updateSlide(
    req.atlasId,
    req.params.briefingId,
    req.params.slideId,
    req.body
  );
  res.json({ data: slide });
});

export const deleteSlide = asyncHandler(async (req, res) => {
  await briefingsService.deleteSlide(req.atlasId, req.params.briefingId, req.params.slideId);
  res.status(204).send();
});

export const reorderSlides = asyncHandler(async (req, res) => {
  const briefing = await briefingsService.reorderSlides(
    req.atlasId,
    req.params.briefingId,
    req.body.slideOrder
  );
  res.json({ data: briefing });
});
