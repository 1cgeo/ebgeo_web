// Path: src/modules/access-groups/access-groups.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as svc from './access-groups.service.js';

export const listGroups = asyncHandler(async (req, res) => {
  res.json({ data: await svc.listGroups() });
});

export const createGroup = asyncHandler(async (req, res) => {
  const data = await svc.createGroup({
    name: req.body.name,
    description: req.body.description ?? null,
    actor: req.user,
    req,
  });
  res.status(201).json({ data });
});

/**
 * PATCH /:groupId
 *
 * `descriptionProvided` viaja separado do valor porque LIMPAR a descrição e NÃO MEXER
 * nela são dois pedidos diferentes que um `null` sozinho não distingue. `'description'
 * in req.body` é a única leitura que responde isso, e ela precisa acontecer aqui: o
 * serviço recebe um objeto já normalizado e não tem mais como perguntar.
 */
export const updateGroup = asyncHandler(async (req, res) => {
  const data = await svc.updateGroup({
    groupId: req.params.groupId,
    name: req.body.name ?? null,
    description: req.body.description ?? null,
    descriptionProvided: Object.hasOwn(req.body, 'description'),
    actor: req.user,
    req,
  });
  res.json({ data });
});

/**
 * DELETE /:groupId
 *
 * O CORPO DA RESPOSTA É O ALCANCE, e não um 204 vazio: apagar um grupo revoga tudo
 * o que ele concedia, e a tela precisa poder dizer quantas concessões caíram. É a
 * mesma razão de `revokeGrant` devolver a lista dos podados em vez de um 204.
 */
export const deleteGroup = asyncHandler(async (req, res) => {
  const data = await svc.deleteGroup({ groupId: req.params.groupId, actor: req.user, req });
  res.json({ data });
});

export const listMembers = asyncHandler(async (req, res) => {
  res.json({ data: await svc.listMembers(req.params.groupId) });
});

export const addMember = asyncHandler(async (req, res) => {
  const data = await svc.addMember({
    groupId: req.params.groupId,
    userId: req.body.userId,
    actor: req.user,
    req,
  });
  // 200 e não 201 mesmo quando a linha nasceu: a operação é idempotente e `added`
  // diz o que houve. Alternar entre 200 e 201 obrigaria o cliente a tratar dois
  // caminhos para o mesmo estado final.
  res.json({ data });
});

export const removeMember = asyncHandler(async (req, res) => {
  const data = await svc.removeMember({
    groupId: req.params.groupId,
    userId: req.params.userId,
    actor: req.user,
    req,
  });
  res.json({ data });
});
