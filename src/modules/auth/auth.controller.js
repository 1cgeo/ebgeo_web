// Path: src/modules/auth/auth.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as authService from './auth.service.js';

export const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const result = await authService.login(username, password);
  res.json({ data: result });
});

export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const result = await authService.refresh(refreshToken);
  res.json({ data: result });
});

export const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  await authService.logout(refreshToken);
  res.status(204).send();
});

export const getMe = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user.id);
  res.json({ data: user });
});

/** Request origin for building the verification link: Origin header, else scheme+Host. */
function requestOrigin(req) {
  return req.headers.origin || `${req.protocol}://${req.get('host') || ''}`;
}

export const register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body, requestOrigin(req));
  res.status(201).json({ data: user });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const result = await authService.verifyEmail(req.body.token);
  res.json({ data: result });
});

export const resendVerification = asyncHandler(async (req, res) => {
  const result = await authService.resendVerification(req.body.email, requestOrigin(req));
  res.json({ data: result });
});
