// Path: src/modules/auth/auth.service.js
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { query, tx } from '../../database/index.js';
import { AppError, UnauthorizedError, ConflictError, ForbiddenError, BadRequestError } from '../../utils/errors.js';
import { orgIsActive } from '../../utils/org-status.js';
import { sendVerificationEmail, buildVerificationLink } from '../../utils/mailer.js';
import { parseDuration } from '../../utils/duration.js';
import * as Q from './auth.queries.js';

const SALT_ROUNDS = 12;

// How long after a rotation a loser of the atomic claim is treated as a concurrent
// duplicate rather than as token theft. Covers a client firing several refreshes at
// once (double F5, two tabs, network retry); short enough that a replay arriving
// later still trips reuse detection. See the grace-window note in refresh().
const REFRESH_RACE_GRACE_MS = 10_000;

// A valid bcrypt hash of a throwaway password, computed once at load.
// Compared against when the username does NOT exist, so login spends the same
// CPU time whether or not the user is real — eliminating the timing oracle.
const DUMMY_HASH = bcrypt.hashSync('timing-safe-dummy-password', SALT_ROUNDS);

/**
 * Generates a JWT access token (single-issuer payload, shared by web/nomes/360).
 */
export function issueAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      nome: user.nome,
      posto: user.posto_graduacao,
      role: user.role || 'user', // global {user, admin}
      organization_id: user.organization_id ?? null, // tenant claim
      org_role: user.org_role || 'viewer', // org-scoped role
      // Aliases so the single-issuer token is consumable as-is by ebgeo_360
      // (which reads {sub, org, role, login}) without changing the 360.
      org: user.organization_id ?? null,
      login: user.username,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpiry, algorithm: 'HS256' }
  );
}

// Backwards-compatible alias used internally.
const generateAccessToken = issueAccessToken;

/**
 * Milliseconds until a decoded JWT payload expires (for sliding sessions).
 */
export function msUntilExpiry(payload) {
  return (payload?.exp ? payload.exp * 1000 : 0) - Date.now();
}

/**
 * Generates a random refresh token and its hash.
 */
function generateRefreshToken() {
  const token = crypto.randomUUID() + '-' + crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

/**
 * Authenticates a user and returns tokens.
 */
export async function login(username, password) {
  // Find user
  const { rows } = await query(Q.FIND_USER_BY_USERNAME, [username]);
  const user = rows[0];

  // Always run bcrypt — against the real hash or the dummy — so the response
  // time does not reveal whether the username exists (no timing oracle).
  const hashToCompare = user ? user.password_hash : DUMMY_HASH;
  const isValid = await bcrypt.compare(password, hashToCompare);

  if (!user || !isValid) {
    logger.warn({ username }, 'Failed login attempt');
    throw new UnauthorizedError('Usuário ou senha inválidos');
  }

  if (!user.is_active) {
    throw new UnauthorizedError('Conta desativada');
  }

  // E-mail confirmation gate: an account registered WITH an e-mail must verify it before login.
  // Accounts without an e-mail (admin-created / legacy / M2M) skip this entirely.
  if (user.email && !user.email_verified) {
    throw new AppError('Confirme seu e-mail para entrar.', 401, 'EMAIL_NOT_VERIFIED');
  }

  // O1: a member of a deactivated organization cannot start a session.
  if (!(await orgIsActive(user.organization_id))) {
    throw new ForbiddenError('Organização inativa');
  }

  // Update last login
  await query(Q.UPDATE_LAST_LOGIN, [user.id]);

  // Generate tokens
  const accessToken = generateAccessToken(user);
  const { token: refreshToken, hash: refreshHash } = generateRefreshToken();

  // Store refresh token
  const expiresAt = new Date(Date.now() + parseDuration(config.jwt.refreshExpiry));
  await query(Q.INSERT_REFRESH_TOKEN, [user.id, refreshHash, expiresAt]);

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      username: user.username,
      nome: user.nome,
      posto_graduacao: user.posto_graduacao,
      organizacao_militar: user.organizacao_militar,
      organization_id: user.organization_id ?? null,
      org_role: user.org_role || 'viewer',
      role: user.role || 'user',
    },
  };
}

/**
 * Refreshes tokens using a valid refresh token.
 * Implements token rotation: old token is revoked, new pair is issued.
 */
export async function refresh(refreshToken) {
  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  // Claim the token by revoking it, atomically. The UPDATE's `revoked_at IS NULL`
  // IS the mutual exclusion: exactly one concurrent caller can transition the row,
  // so one token can never yield two families. This replaces a read-check-then-write
  // triple (find → inspect revoked_at → revoke) whose three unsynchronized
  // round-trips let every racing caller observe an unrevoked row and pass the reuse
  // check together — defeating the very control that turns a stolen token into a
  // family-wide revocation.
  const claimed = await query(Q.CLAIM_REFRESH_TOKEN, [hash]);

  if (claimed.rows.length === 0) {
    // Nothing claimed: the token never existed, or it is expired, or it was already
    // rotated. Only the last case is evidence of anything. Read it back to tell them
    // apart, exactly as the old code did before deciding.
    const { rows } = await query(Q.FIND_REFRESH_TOKEN_ANY, [hash]);
    if (rows.length === 0) {
      throw new UnauthorizedError('Sessão inválida. Entre novamente.');
    }

    const spent = rows[0];

    // Expiry is judged BEFORE reuse. An expired token is already powerless, so
    // presenting one is not evidence of theft, and treating it as such would turn
    // every ordinary resume-after-expiry into a family-wide logout.
    if (new Date(spent.expires_at) < new Date()) {
      throw new UnauthorizedError('Sessão expirada. Entre novamente.');
    }

    // Concurrency grace window (OAuth 2.1 BCP §4.14.2). One client legitimately
    // firing several refreshes at once — double F5, two tabs, a network retry —
    // produces exactly this shape: one winner and N losers holding the token that
    // was rotated microseconds ago. Without the window every such burst reads as
    // theft and logs the user out of everything, including the winner's brand-new
    // token, which is strictly worse than the problem being guarded against.
    //
    // The cost is stated plainly: an attacker replaying INSIDE the window escapes
    // the alarm. They still get nothing — they lost the claim, so no tokens are
    // issued — but the victim's family is not proactively revoked. Outside the
    // window, which is where a stolen token realistically gets used, detection is
    // unchanged.
    const revokedAgo = Date.now() - new Date(spent.revoked_at).getTime();
    if (spent.revoked_at && revokedAgo <= REFRESH_RACE_GRACE_MS) {
      throw new UnauthorizedError('Sessão inválida. Entre novamente.');
    }

    // Reuse detection: a live token reappearing long after rotation means the chain
    // was compromised. Revoke the whole family, forcing a fresh login.
    logger.warn({ userId: spent.user_id }, 'Refresh token reuse detected');
    await query(Q.REVOKE_ALL_USER_TOKENS, [spent.user_id]);
    throw new UnauthorizedError('Sessão inválida. Entre novamente.');
  }

  const storedToken = claimed.rows[0];

  // Get user data
  const userResult = await query(Q.FIND_USER_BY_ID, [storedToken.user_id]);
  if (userResult.rows.length === 0) {
    throw new UnauthorizedError('Usuário não encontrado');
  }

  const user = userResult.rows[0];

  // O1: a member of a deactivated organization cannot renew a session.
  if (!(await orgIsActive(user.organization_id))) {
    throw new ForbiddenError('Organização inativa');
  }

  // Generate new tokens
  const accessToken = generateAccessToken(user);
  const { token: newRefreshToken, hash: newRefreshHash } = generateRefreshToken();

  // Store new refresh token
  const expiresAt = new Date(Date.now() + parseDuration(config.jwt.refreshExpiry));
  await query(Q.INSERT_REFRESH_TOKEN, [user.id, newRefreshHash, expiresAt]);

  return { accessToken, refreshToken: newRefreshToken };
}

/**
 * Revokes a refresh token (logout).
 */
export async function logout(refreshToken) {
  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await query(Q.REVOKE_REFRESH_TOKEN, [hash]);
}

/**
 * Gets the current user profile.
 */
export async function getMe(userId) {
  const { rows } = await query(Q.FIND_USER_BY_ID, [userId]);

  if (rows.length === 0) {
    throw new UnauthorizedError('Usuário não encontrado');
  }

  return rows[0];
}

/**
 * Registers a new user (self-registration). When an e-mail is provided the account is created
 * PENDING (email_verified=false) and a verification token is issued + e-mailed; without an e-mail
 * the account is immediately active (username-only).
 * @param {Object} data - Validated register payload.
 * @param {string} [origin] - Request origin, used to build the verification link when APP_BASE_URL
 *   is unset.
 */
export async function register(data, origin = '') {
  // Uniqueness checks use a SINGLE generic message for both username and e-mail collisions so the
  // public register endpoint is not an existence oracle (an attacker can't tell which field — or
  // whether a specific e-mail — is already registered).
  const { rows: existing } = await query(Q.CHECK_USERNAME_EXISTS, [data.username]);
  if (existing.length > 0) {
    throw new ConflictError('Usuário ou e-mail já cadastrado.');
  }

  const email = data.email ? data.email.trim() : null;
  if (email) {
    const { rows: emailRows } = await query(Q.CHECK_EMAIL_EXISTS, [email]);
    if (emailRows.length > 0) {
      throw new ConflictError('Usuário ou e-mail já cadastrado.');
    }
  }

  // The client picks its own organization here (the OM dropdown), and the value went
  // straight into the INSERT unchecked, so a caller could name any UUID — including a
  // soft-deactivated or nonexistent org — and become a member of it.
  //
  // SCOPE, stated plainly: this check rejects orgs that do not exist or are inactive.
  // It does NOT stop someone from self-selecting a real, active OM they do not belong
  // to; that remains possible by design, because the signup dropdown is a
  // self-declaration. Membership is not decorative — it grants read of that org's
  // unpublished (`disabled`) 360 projects via isProjectReadable — and every active
  // org's UUID is served by the anonymous GET /api/config to populate that dropdown.
  // Closing it properly needs an approval step; deliberately deferred (see
  // bugs-backend.md #33). The exposure today is limited to deployments with
  // ALLOW_SELF_REGISTRATION on, which is off in production.
  if (data.organization_id) {
    const { rows: org } = await query(Q.FIND_ACTIVE_ORGANIZATION, [data.organization_id]);
    if (org.length === 0) {
      throw new BadRequestError('Organização militar inválida ou inativa.');
    }
  }

  // Hash password
  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

  // Create user (role is always 'user' for self-registration; org defaults). email_verified starts
  // false; login only gates when email IS NOT NULL, so a null-email account is active immediately.
  const { rows } = await query(Q.INSERT_USER, [
    data.username,
    passwordHash,
    data.nome,
    data.rank_id || null,
    'user',
    data.organization_id || null, // COALESCE -> default org in SQL
    email,
    false,
  ]);
  const user = rows[0];

  // Verification is best-effort: the account row is already committed, so a token/mail failure must
  // NOT 500 the request (that would orphan a pending account the user can neither re-register nor log
  // into). On failure the account simply stays pending and the user can re-trigger via resend.
  if (email) {
    try {
      await issueAndSendVerification(user, email, origin);
    } catch (err) {
      logger.error({ err, userId: user.id }, 'Verification e-mail failed (account created; user can resend)');
    }
  }
  return user;
}

/**
 * Issues a fresh verification token for a user and e-mails (or logs) the link.
 * @param {{ id: string, nome: string }} user
 * @param {string} email
 * @param {string} origin
 * @returns {Promise<string>} The token.
 */
async function issueAndSendVerification(user, email, origin) {
  const hours = Number(config.security.verificationTtlHours);
  const ttlMs = (Number.isFinite(hours) ? hours : 48) * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);
  const { rows } = await query(Q.INSERT_VERIFICATION_TOKEN, [user.id, expiresAt]);
  const token = rows[0].token;
  const link = buildVerificationLink(token, origin);
  await sendVerificationEmail({ to: email, link, nome: user.nome });
  return token;
}

/**
 * Confirms a verification token: marks the user's e-mail verified and consumes the token.
 * @param {string} token
 * @returns {Promise<{ success: true }>}
 */
export async function verifyEmail(token) {
  // L4 — claim and verify in ONE transaction, with the claim itself doing the
  // mutual exclusion (`consumed_at IS NULL` in the WHERE). The previous
  // read-check-then-write sequence let two concurrent requests both observe an
  // unconsumed token and both succeed, so the token was not truly single-use.
  return tx(async (t) => {
    const claimed = await t.oneOrNone(Q.CLAIM_VERIFICATION_TOKEN, [token]);
    if (!claimed) {
      // Unknown token, or another request already claimed it.
      throw new BadRequestError('Token de verificação inválido.');
    }
    if (new Date(claimed.expires_at) < new Date()) {
      // Roll the claim back so an expired token is not silently burned — the
      // user can still ask for a new one and this row stays diagnosable.
      throw new BadRequestError('Token de verificação expirado.');
    }
    await t.none(Q.MARK_EMAIL_VERIFIED, [claimed.user_id]);
    return { success: true };
  });
}

/**
 * Re-issues a verification e-mail. Always resolves success (never leaks whether the e-mail exists);
 * only re-sends for a real, not-yet-verified account.
 * @param {string} email
 * @param {string} [origin]
 * @returns {Promise<{ success: true }>}
 */
export async function resendVerification(email, origin = '') {
  const { rows } = await query(Q.FIND_USER_BY_EMAIL, [email]);
  const user = rows[0];
  if (user && user.email && !user.email_verified) {
    await issueAndSendVerification(user, user.email, origin);
  }
  return { success: true };
}
