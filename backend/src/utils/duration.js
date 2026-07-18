// Path: src/utils/duration.js
// Shared parser for the `<number><unit>` duration strings used by the JWT config
// (JWT_ACCESS_EXPIRY / JWT_REFRESH_EXPIRY). The grammar is deliberately the same
// one `jsonwebtoken` accepts for `expiresIn`, so a value that signs a token also
// computes a matching cookie/DB lifetime.
//
// `validateEnvVariables` (config.js) rejects a malformed value at boot, so a
// running server never reaches the 0 fallback here.

const UNIT_MS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/**
 * Parses a duration string like "15m" or "7d" into milliseconds.
 * @param {string} duration
 * @returns {number} milliseconds, or 0 if the string does not match the grammar.
 */
export function parseDuration(duration) {
  const match = String(duration ?? '').match(/^(\d+)([smhd])$/);
  if (!match) return 0;
  return parseInt(match[1], 10) * UNIT_MS[match[2]];
}
