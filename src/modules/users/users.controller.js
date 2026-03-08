// Path: src/modules/users/users.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as usersService from './users.service.js';

export const getProfile = asyncHandler(async (req, res) => {
  const user = await usersService.getProfile(req.user.id);
  res.json({ data: user });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await usersService.updateProfile(req.user.id, req.body);
  res.json({ data: user });
});

export const updatePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  await usersService.updatePassword(req.user.id, currentPassword, newPassword);
  res.json({ data: { success: true } });
});

export const searchUsers = asyncHandler(async (req, res) => {
  const users = await usersService.searchUsers(req.query.q);
  res.json({ data: users });
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

export const createUser = asyncHandler(async (req, res) => {
  const user = await usersService.createUser(req.body);
  res.status(201).json({ data: user });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await usersService.updateUser(req.params.userId, req.body);
  res.json({ data: user });
});

export const resetPassword = asyncHandler(async (req, res) => {
  await usersService.resetPassword(req.params.userId, req.body.newPassword);
  res.json({ data: { success: true } });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const result = await usersService.deleteUser(
    req.params.userId,
    req.user.id,
    req.query.transferTo
  );
  res.json({ data: result });
});

export const reactivateUser = asyncHandler(async (req, res) => {
  const user = await usersService.reactivateUser(req.params.userId);
  res.json({ data: user });
});
