// Path: src/modules/config/config.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as configService from './config.service.js';

export const getConfig = asyncHandler(async (req, res) => {
  const data = await configService.getAppConfig();
  // Config changes rarely but may be edited via /resources or /config/admin at runtime; avoid
  // aggressive caching so edits propagate promptly.
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ data });
});

/** Admin-only: the effective config + the current override document (prefills the editor). */
export const getAdminConfig = asyncHandler(async (req, res) => {
  const [effective, overrides] = await Promise.all([
    configService.getAppConfig(),
    configService.getConfigOverrides(),
  ]);
  res.json({ data: { effective, overrides } });
});

/** Admin-only: persists a partial override (merged into the stored document). */
export const updateConfigOverrides = asyncHandler(async (req, res) => {
  const overrides = await configService.updateConfigOverrides(req.body, req.user.id);
  res.json({ data: { overrides } });
});

/** Admin-only: clears ALL overrides (revert to STATIC/ENV). */
export const clearConfigOverrides = asyncHandler(async (req, res) => {
  const overrides = await configService.clearConfigOverrides();
  res.json({ data: { overrides } });
});
