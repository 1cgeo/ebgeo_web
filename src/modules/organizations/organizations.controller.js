// Path: src/modules/organizations/organizations.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import { createAudit } from '../../utils/audit.js';
import * as orgService from './organizations.service.js';

export const listOrganizations = asyncHandler(async (req, res) => {
  res.json({ data: await orgService.listOrganizations() });
});

export const getOrganization = asyncHandler(async (req, res) => {
  res.json({ data: await orgService.getOrganization(req.params.id) });
});

export const createOrganization = asyncHandler(async (req, res) => {
  const org = await orgService.createOrganization(req.body);
  await createAudit(req, {
    action: 'ORG_CREATE', actorId: req.user.id, targetType: 'ORG', targetId: org.id, targetName: org.nome,
  });
  res.status(201).json({ data: org });
});

export const updateOrganization = asyncHandler(async (req, res) => {
  const org = await orgService.updateOrganization(req.params.id, req.body);
  await createAudit(req, {
    action: 'ORG_UPDATE', actorId: req.user.id, targetType: 'ORG', targetId: org.id, targetName: org.nome,
  });
  res.json({ data: org });
});

export const deleteOrganization = asyncHandler(async (req, res) => {
  await orgService.deactivateOrganization(req.params.id);
  await createAudit(req, {
    action: 'ORG_DELETE', actorId: req.user.id, targetType: 'ORG', targetId: req.params.id,
  });
  res.status(204).send();
});
