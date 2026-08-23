// Path: src/modules/users/users.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as usersService from './users.service.js';

export const getProfile = asyncHandler(async (req, res) => {
  const user = await usersService.getProfile(req.user.id);
  res.json({ data: user });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await usersService.updateProfile(req.user.id, req.body, req);
  res.json({ data: user });
});

export const updatePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await usersService.updatePassword(req.user.id, currentPassword, newPassword, req);
  res.json({ data: { success: true } });
});

export const searchUsers = asyncHandler(async (req, res) => {
  const users = await usersService.searchUsers(req.query.q);
  res.json({ data: users });
});

export const rotateMyApiKey = asyncHandler(async (req, res) => {
  const result = await usersService.rotateApiKey(req.user.id, req.user.id, req);
  res.json({ data: result });
});

// ============================================
// Admin controllers
// ============================================

export const listUsers = asyncHandler(async (req, res) => {
  const includeInactive = !!req.query.includeInactive;
  const users = await usersService.listUsers(includeInactive);
  res.json({ data: users });
});

export const getUser = asyncHandler(async (req, res) => {
  const user = await usersService.getUserById(req.params.userId);
  res.json({ data: user });
});

// `req` e o id do ator seguem para o service porque a auditoria participa da
// MESMA transação da escrita — o `req` carrega ip e user-agent da trilha.
export const createUser = asyncHandler(async (req, res) => {
  const user = await usersService.createUser(req.body, req, req.user.id);
  res.status(201).json({ data: user });
});

// `data` NAO E SO A LINHA: alem das colunas do usuario, ela carrega `grantsAffected`,
// `grantsReparented` e `fundamentoPerdido`, que sao o EFEITO da poda que este PUT pode
// disparar (ver `fundamentoDeRaizPerdido` no service). Eles vao no mesmo objeto, e nao
// num envelope irmao, porque `_request` do cliente desembrulha `data` e devolve so ele:
// um segundo campo no topo nao chegaria a tela sem mudar o cliente HTTP. Os tres viajam
// sempre, com zero quando nada foi podado.
export const updateUser = asyncHandler(async (req, res) => {
  const user = await usersService.updateUser(req.params.userId, req.body, req.user.id, req);
  res.json({ data: user });
});

export const resetPassword = asyncHandler(async (req, res) => {
  await usersService.resetPassword(req.params.userId, req.body.newPassword, req, req.user.id);
  res.json({ data: { success: true } });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const result = await usersService.deleteUser(
    req.params.userId,
    req.user.id,
    req.query.transferTo,
    req
  );
  res.json({ data: result });
});

export const reactivateUser = asyncHandler(async (req, res) => {
  const user = await usersService.reactivateUser(req.params.userId, req.user.id, req);
  res.json({ data: user });
});

export const rotateUserApiKey = asyncHandler(async (req, res) => {
  const result = await usersService.rotateApiKey(req.params.userId, req.user.id, req);
  res.json({ data: result });
});
