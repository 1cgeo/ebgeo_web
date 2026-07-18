// Path: src/modules/sharing/sharing.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as sharingService from './sharing.service.js';
import { broadcastToRoom } from '../collab/collab.rooms.js';
import { toFrontendRole } from '../../utils/roles.js';

export const getSharingConfig = asyncHandler(async (req, res) => {
  const config = await sharingService.getSharingConfig(req.atlasId);
  res.json({ data: config });
});

export const enablePublicSharing = asyncHandler(async (req, res) => {
  const result = await sharingService.enablePublicSharing(req.atlasId);
  broadcastToRoom(req.atlasId, { type: 'sharing_updated', action: 'public_enabled' });
  res.json({ data: result });
});

export const disablePublicSharing = asyncHandler(async (req, res) => {
  await sharingService.disablePublicSharing(req.atlasId);
  broadcastToRoom(req.atlasId, { type: 'sharing_updated', action: 'public_disabled' });
  res.status(204).send();
});

export const addUserShare = asyncHandler(async (req, res) => {
  const share = await sharingService.addUserShare(
    req.atlasId,
    req.body.userId,
    req.body.permission,
    req.user.id
  );
  broadcastToRoom(req.atlasId, {
    type: 'sharing_updated',
    action: 'user_added',
    userId: req.body.userId,
    permission: req.body.permission,
    // Frontend role for the affected user, so a connected peer re-gates its UI live (per-atlas only;
    // a global admin keeps full access and ignores this on the client).
    role: toFrontendRole(req.body.permission),
  });
  res.status(201).json({ data: share });
});

export const updateUserShare = asyncHandler(async (req, res) => {
  const share = await sharingService.updateUserShare(
    req.atlasId,
    req.params.userId,
    req.body.permission
  );
  broadcastToRoom(req.atlasId, {
    type: 'sharing_updated',
    action: 'user_updated',
    userId: req.params.userId,
    permission: req.body.permission,
    // Frontend role for the affected user, so a connected peer re-gates its UI live (the safe view
    // engages on a write→read downgrade; toolbars return on an upgrade). Per-atlas only — a global
    // admin keeps full access and ignores this on the client.
    role: toFrontendRole(req.body.permission),
  });
  res.json({ data: share });
});

export const removeUserShare = asyncHandler(async (req, res) => {
  await sharingService.removeUserShare(req.atlasId, req.params.userId);
  broadcastToRoom(req.atlasId, {
    type: 'sharing_updated',
    action: 'user_removed',
    userId: req.params.userId,
  });
  res.status(204).send();
});
