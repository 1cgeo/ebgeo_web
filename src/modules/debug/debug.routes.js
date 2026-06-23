// Path: src/modules/debug/debug.routes.js

/**
 * SyncLedger debug-trace endpoint. Mounted ONLY when the tracer is enabled
 * (EBGEO_TRACE=1 / NODE_ENV=test) AND we are NOT in production — never in production
 * (the mount guard in app.js double-checks this). Exposes the server-side ring so the
 * Playwright `collectLedger` merger can join the server spans with each browser's
 * `window.__ebgeoSyncTrace` by opId/traceId.
 *
 * Per-atlas authorization (NOT just `auth`): the trace ring is per-atlas, so reading or
 * wiping it is a per-atlas action and MUST be gated like the sync routes — otherwise any
 * token holder could read/wipe ANY atlas's ring (cross-atlas IDOR). atlasId arrives as a
 * QUERY param here (the sync routes use a route param), so `liftAtlasIdToParams` bridges it
 * into req.params (rejecting 400 when absent) before `requireAtlasPermission` runs.
 */

import { Router } from 'express';
import { auth } from '../../middleware/auth.js';
import { requireAtlasPermission } from '../../middleware/permissions.js';
import { BadRequestError } from '../../utils/errors.js';
import { getTrace, clearTrace, isTraceEnabled } from '../../utils/sync-trace.js';

const router = Router();

/**
 * Lifts the `atlasId` query param into req.params so the param-based
 * `requireAtlasPermission` gate can resolve it. Rejects 400 when omitted — without an
 * atlasId there is nothing to authorize, and the previous DELETE fallback ("clear ALL
 * rings") was a cross-atlas wipe by an unauthorized token holder.
 */
function liftAtlasIdToParams(req, res, next) {
  const atlasId = req.query.atlasId;
  if (!atlasId) {
    return next(new BadRequestError('atlasId is required'));
  }
  req.params.atlasId = atlasId;
  next();
}

/**
 * GET /api/v1/debug/trace?atlasId=&opId=&traceId=
 * Returns the server-side spans for an atlas (optionally filtered by op/trace id).
 * Gate: read access on THIS atlas (same level the sync pull route requires).
 */
router.get('/trace', auth, liftAtlasIdToParams, requireAtlasPermission('read'), (req, res) => {
  const { atlasId, opId, traceId } = req.query;
  res.json({ data: { spans: getTrace(atlasId, { opId, traceId }), enabled: isTraceEnabled() } });
});

/**
 * DELETE /api/v1/debug/trace?atlasId= — clears ONE atlas ring (never all). Wiping the
 * trace ring is destructive, so it takes a stronger gate than read: `manage` (co-Gestor),
 * which owner/admin satisfy too (admin is owner-level, owner is the top level).
 */
router.delete('/trace', auth, liftAtlasIdToParams, requireAtlasPermission('manage'), (req, res) => {
  clearTrace(req.query.atlasId);
  res.json({ data: { cleared: true } });
});

export { router as debugRoutes };
