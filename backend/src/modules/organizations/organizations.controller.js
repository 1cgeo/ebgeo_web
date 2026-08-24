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
  // O ator viaja para o serviço porque a guarda de auto-bloqueio é DELE: o corpo deste PUT
  // aceita `is_active: false`, que é a mesma desativação da rota abaixo.
  const org = await orgService.updateOrganization(req.params.id, req.body, req.user.id);
  await createAudit(req, {
    action: 'ORG_UPDATE', actorId: req.user.id, targetType: 'ORG', targetId: org.id, targetName: org.nome,
  });
  res.json({ data: org });
});

export const deleteOrganization = asyncHandler(async (req, res) => {
  await orgService.deactivateOrganization(req.params.id, req.user.id);
  await createAudit(req, {
    action: 'ORG_DELETE', actorId: req.user.id, targetType: 'ORG', targetId: req.params.id,
  });
  res.status(204).send();
});

// GET /organizations/:id/deactivation-impact — as três contagens que a confirmação mostra.
// Leitura de administrador; nada aqui autoriza a desativação, que tem guarda própria no
// serviço.
export const getDeactivationImpact = asyncHandler(async (req, res) => {
  res.json({ data: await orgService.getDeactivationImpact(req.params.id, req.user.id) });
});
