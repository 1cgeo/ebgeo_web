// Path: src/modules/resource-access/resource-access.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as svc from './resource-access.service.js';

export const setVisibility = asyncHandler(async (req, res) => {
  const data = await svc.setResourceVisibility({
    type: req.params.type,
    resourceId: req.params.id,
    accessLevel: req.body.accessLevel,
    actor: req.user,
    req,
  });
  res.json({ data });
});
