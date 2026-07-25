// Path: src/modules/sharing/sharing.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as sharingService from './sharing.service.js';
import { broadcastToRoom } from '../collab/collab.rooms.js';
import { toFrontendRole } from '../../utils/roles.js';

// Who may receive a `sharing_updated` frame that NAMES a member.
//
// `GET /atlas/:id/sharing` is gated at `manage` (sharing.routes.js) precisely because the atlas
// composition — member UUIDs and each one's level — is management information. The broadcast used
// to go to the whole room, so a Visualizador, a Comentarista, an Editor and even an anonymous
// public-link visitor read over the socket exactly what the REST route answers them with 403.
// (The presence roster already exposes the UUID and name of CONNECTED members; what leaked here on
// top of that is the PERMISSION LEVEL, and the UUID of a member who never connected.)
//
// `{ skipReadOnly: true }` does NOT fix it: it still delivers to `comment` and `write`, both below
// `manage`. Delivery is therefore directed by LEVEL, plus the affected user's own sockets — that
// exception is load-bearing, since the affected peer re-gates its UI live from the `role` field
// (sync-engine.js `sharingUpdated`, which ignores frames naming anybody else). A promoted viewer
// that stopped receiving its own frame would stay stuck in the safe view until reconnect.
//
// The two `public_*` frames below carry no identity — they say only that the atlas was
// published/unpublished — so they stay open to the room on purpose: a viewer needs them.
const MEMBER_FRAME_GATE = 'manage';

export const getSharingConfig = asyncHandler(async (req, res) => {
  const config = await sharingService.getSharingConfig(req.atlasId);
  res.json({ data: config });
});

export const enablePublicSharing = asyncHandler(async (req, res) => {
  const result = await sharingService.enablePublicSharing(req.atlasId, req.user?.id ?? null, req);
  broadcastToRoom(req.atlasId, { type: 'sharing_updated', action: 'public_enabled' });
  res.json({ data: result });
});

export const disablePublicSharing = asyncHandler(async (req, res) => {
  await sharingService.disablePublicSharing(req.atlasId, req.user?.id ?? null, req);
  broadcastToRoom(req.atlasId, { type: 'sharing_updated', action: 'public_disabled' });
  res.status(204).send();
});

export const addUserShare = asyncHandler(async (req, res) => {
  const share = await sharingService.addUserShare(
    req.atlasId,
    req.body.userId,
    req.body.permission,
    req.user.id,
    req
  );
  broadcastToRoom(req.atlasId, {
    type: 'sharing_updated',
    action: 'user_added',
    userId: req.body.userId,
    permission: req.body.permission,
    // Frontend role for the affected user, so a connected peer re-gates its UI live (per-atlas only;
    // a global admin keeps full access and ignores this on the client).
    role: toFrontendRole(req.body.permission),
  }, null, { minPermission: MEMBER_FRAME_GATE, alsoUserIds: [req.body.userId] });
  res.status(201).json({ data: share });
});

export const updateUserShare = asyncHandler(async (req, res) => {
  const share = await sharingService.updateUserShare(
    req.atlasId,
    req.params.userId,
    req.body.permission,
    req.user?.id ?? null,
    req
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
  }, null, { minPermission: MEMBER_FRAME_GATE, alsoUserIds: [req.params.userId] });
  res.json({ data: share });
});

export const removeUserShare = asyncHandler(async (req, res) => {
  await sharingService.removeUserShare(req.atlasId, req.params.userId, req.user?.id ?? null, req);
  broadcastToRoom(req.atlasId, {
    type: 'sharing_updated',
    action: 'user_removed',
    userId: req.params.userId,
  }, null, { minPermission: MEMBER_FRAME_GATE, alsoUserIds: [req.params.userId] });
  res.status(204).send();
});
