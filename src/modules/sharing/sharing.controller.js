// Path: src/modules/sharing/sharing.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as sharingService from './sharing.service.js';

export const getSharingConfig = asyncHandler(async (req, res) => {
  const config = await sharingService.getSharingConfig(req.atlasId);
  res.json({ data: config });
});

export const enablePublicSharing = asyncHandler(async (req, res) => {
  const result = await sharingService.enablePublicSharing(req.atlasId);
  res.json({ data: result });
});

export const disablePublicSharing = asyncHandler(async (req, res) => {
  await sharingService.disablePublicSharing(req.atlasId);
  res.status(204).send();
});

export const addUserShare = asyncHandler(async (req, res) => {
  const share = await sharingService.addUserShare(
    req.atlasId,
    req.body.userId,
    req.body.permission,
    req.user.id
  );
  res.status(201).json({ data: share });
});

export const updateUserShare = asyncHandler(async (req, res) => {
  const share = await sharingService.updateUserShare(
    req.atlasId,
    req.params.userId,
    req.body.permission
  );
  res.json({ data: share });
});

export const removeUserShare = asyncHandler(async (req, res) => {
  await sharingService.removeUserShare(req.atlasId, req.params.userId);
  res.status(204).send();
});
