// Path: src/modules/auth/auth.service.js
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { query } from '../../database/index.js';
import { UnauthorizedError, ConflictError } from '../../utils/errors.js';
import * as Q from './auth.queries.js';

const SALT_ROUNDS = 12;

// A valid bcrypt hash of a throwaway password, computed once at load.
// Compared against when the username does NOT exist, so login spends the same
// CPU time whether or not the user is real — eliminating the timing oracle.
const DUMMY_HASH = bcrypt.hashSync('timing-safe-dummy-password', SALT_ROUNDS);

/**
 * Parses a duration string like "15m" or "7d" into milliseconds.
 */
function parseDuration(duration) {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return 0;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}

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
    throw new UnauthorizedError('Invalid credentials');
  }

  if (!user.is_active) {
    throw new UnauthorizedError('Account is deactivated');
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

  // Look up the token INCLUDING revoked ones, to distinguish "never existed"
  // from "existed and was revoked" (reuse of a revoked token = possible theft).
  const { rows } = await query(Q.FIND_REFRESH_TOKEN_ANY, [hash]);

  if (rows.length === 0) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  const storedToken = rows[0];

  // Reuse detection: a revoked token reappearing means the rotation chain was
  // compromised. Revoke the whole family, forcing a fresh login.
  if (storedToken.revoked_at) {
    logger.warn({ userId: storedToken.user_id }, 'Refresh token reuse detected');
    await query(Q.REVOKE_ALL_USER_TOKENS, [storedToken.user_id]);
    throw new UnauthorizedError('Invalid refresh token');
  }

  // Check expiry
  if (new Date(storedToken.expires_at) < new Date()) {
    throw new UnauthorizedError('Refresh token expired');
  }

  // Revoke old token (rotation)
  await query(Q.REVOKE_REFRESH_TOKEN, [hash]);

  // Get user data
  const userResult = await query(Q.FIND_USER_BY_ID, [storedToken.user_id]);
  if (userResult.rows.length === 0) {
    throw new UnauthorizedError('User not found');
  }

  const user = userResult.rows[0];

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
    throw new UnauthorizedError('User not found');
  }

  return rows[0];
}

/**
 * Registers a new user (self-registration).
 */
export async function register(data) {
  // Check if username already exists
  const { rows: existing } = await query(Q.CHECK_USERNAME_EXISTS, [data.username]);
  if (existing.length > 0) {
    throw new ConflictError('Username already exists');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

  // Create user (role is always 'user' for self-registration; org defaults).
  const { rows } = await query(Q.INSERT_USER, [
    data.username,
    passwordHash,
    data.nome,
    data.posto_graduacao || null,
    data.organizacao_militar || null,
    'user',
    data.organization_id || null, // COALESCE -> default org in SQL
  ]);

  return rows[0];
}
