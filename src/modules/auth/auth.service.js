// Path: src/modules/auth/auth.service.js
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import config from '../../config.js';
import { query } from '../../database/index.js';
import { UnauthorizedError, ConflictError } from '../../utils/errors.js';
import * as Q from './auth.queries.js';

const SALT_ROUNDS = 12;

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
 * Generates JWT access token.
 */
function generateAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      nome: user.nome,
      posto: user.posto_graduacao,
      role: user.role || 'user',
    },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpiry }
  );
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

  if (rows.length === 0) {
    throw new UnauthorizedError('Invalid credentials');
  }

  const user = rows[0];

  if (!user.is_active) {
    throw new UnauthorizedError('Account is deactivated');
  }

  // Verify password
  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    throw new UnauthorizedError('Invalid credentials');
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

  // Find valid refresh token
  const { rows } = await query(Q.FIND_REFRESH_TOKEN, [hash]);

  if (rows.length === 0) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  const storedToken = rows[0];

  // Check expiry
  if (new Date(storedToken.expires_at) < new Date()) {
    throw new UnauthorizedError('Refresh token expired');
  }

  // Revoke old token
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
 * Hashes a password for storage.
 */
export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
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

  // Create user (role is always 'user' for self-registration)
  const { rows } = await query(Q.INSERT_USER, [
    data.username,
    passwordHash,
    data.nome,
    data.posto_graduacao || null,
    data.organizacao_militar || null,
    'user',
  ]);

  return rows[0];
}
