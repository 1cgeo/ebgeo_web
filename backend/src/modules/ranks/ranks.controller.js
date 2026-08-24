// Path: src/modules/ranks/ranks.controller.js
//
// THE THREE WRITES LEAVE A TRAIL, mirroring the ORG controller on purpose: a rank is an
// admin-only domain table, and until 2026-08-24 three of the FOUR known holes in
// `tests/unit/auditoria-censo.test.js` were exactly these routes.
//
// TWO THINGS THAT DIVERGE FROM THE ORG SIBLING, both deliberate:
//
//   `RANK_DELETE` CARRIES THE NAME. `ORG_DELETE` records `targetId` and no `targetName`,
//   because its DEACTIVATE only does `RETURNING id` — so the org trail reads as a naked
//   UUID. Here the soft delete returns the row and the line names the rank. Do not copy
//   the org shape back over this one.
//
//   NO `targetOrgId`. That column is the OM that OWNS the target resource, and a rank
//   owns to nobody: it is institutional vocabulary served to the anonymous
//   `GET /api/config`. Stamping the actor's own OM there would be the exact confusion
//   `utils/audit.js` warns about, and would make the per-OM filter answer with acts that
//   have nothing to do with that OM's holdings.
import { asyncHandler } from '../../utils/async-handler.js';
import { createAudit } from '../../utils/audit.js';
import * as ranksService from './ranks.service.js';

export const listRanks = asyncHandler(async (req, res) => {
  res.json({ data: await ranksService.listRanks() });
});

export const getRank = asyncHandler(async (req, res) => {
  res.json({ data: await ranksService.getRank(req.params.id) });
});

export const createRank = asyncHandler(async (req, res) => {
  const rank = await ranksService.createRank(req.body);
  await createAudit(req, {
    action: 'RANK_CREATE', actorId: req.user.id, targetType: 'RANK', targetId: rank.id, targetName: rank.nome,
  });
  res.status(201).json({ data: rank });
});

export const updateRank = asyncHandler(async (req, res) => {
  const rank = await ranksService.updateRank(req.params.id, req.body);
  // The NEW name, read from the row the UPDATE returned: `req.body.nome` is absent on a
  // PATCH that only flips `is_active`, and the trail would then name nothing.
  await createAudit(req, {
    action: 'RANK_UPDATE', actorId: req.user.id, targetType: 'RANK', targetId: rank.id, targetName: rank.nome,
  });
  res.json({ data: rank });
});

export const deleteRank = asyncHandler(async (req, res) => {
  const rank = await ranksService.deactivateRank(req.params.id);
  await createAudit(req, {
    action: 'RANK_DELETE', actorId: req.user.id, targetType: 'RANK', targetId: rank.id, targetName: rank.nome,
  });
  res.status(204).send();
});
