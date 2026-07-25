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

// 204 UNCONDITIONALLY, including when the revocation matched no row — and that is a
// decision, not the leftover of not reading the result.
//
// The three misses (a token belonging to another account, one already revoked, one
// never issued) are exactly the three facts an attacker would want to learn, and a
// distinct status would answer all of them. `/auth/logout` carries no rate limiter
// (only login/refresh/register do) and, unlike `/auth/refresh`, does not consume the
// token it is handed, so a 403/404 here would be an unlimited, non-destructive oracle
// for "is this refresh token live, and is it mine?". 204 for every outcome answers
// nothing.
//
// It is also the honest answer semantically: logout states an intent about a session,
// and after any of the three misses the intended end state ("this token cannot rotate,
// and I hold no session for it") already holds. Nothing failed for the caller.
//
// The cost is that the status no longer distinguishes anything — so the guarantees are
// asserted against `refresh_tokens` in tests/integration/auth-logout-revocation.test.js,
// which is where they are observable at all. The service still RETURNS whether it
// revoked, so a future caller that needs to tell the cases apart can.
export const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  await authService.logout(refreshToken, req.user.id);
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

/**
 * Self-registration. Answers the SAME 201 and the SAME body whether an account was created or the
 * username/e-mail was already taken — see the oracle note on `authService.register`. The created
 * user is deliberately NOT returned: echoing it back would distinguish the two branches just as
 * plainly as the 409 this replaced. Anything a caller needs about the new account it either already
 * knows (it typed it) or learns by logging in.
 */
export const register = asyncHandler(async (req, res) => {
  await authService.register(req.body, requestOrigin(req));
  res.status(201).json({ data: { success: true } });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const result = await authService.verifyEmail(req.body.token);
  res.json({ data: result });
});

export const resendVerification = asyncHandler(async (req, res) => {
  const result = await authService.resendVerification(req.body.email, requestOrigin(req));
  res.json({ data: result });
});
