// Path: src/modules/config/config.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as configService from './config.service.js';

export const getConfig = asyncHandler(async (req, res) => {
  const data = await configService.getAppConfig();
  // Config changes rarely but may be edited via /resources at runtime; avoid
  // aggressive caching so edits propagate promptly.
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ data });
});
