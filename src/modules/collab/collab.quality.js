// Path: src/modules/collab/collab.quality.js
// Adaptive connection-quality machinery. Classifies round-trip latency and
// derives transport settings the client can apply (batch interval, geometry
// precision, viewport-only). Truncation is TRANSPORT-ONLY — stored JSONB keeps
// full precision.

/**
 * Classifies a round-trip time (ms) into a quality band.
 * @param {number} rttMs
 * @returns {'excellent'|'good'|'poor'|'critical'}
 */
export function classifyConnectionQuality(rttMs) {
  if (rttMs < 100) return 'excellent';
  if (rttMs < 300) return 'good';
  if (rttMs < 800) return 'poor';
  return 'critical';
}

/**
 * Transport settings recommended for a given quality band.
 * @param {string} quality
 */
export function adaptiveSettingsFor(quality) {
  switch (quality) {
    case 'excellent':
      return { batchIntervalMs: 250, geometryPrecision: 7, viewportOnly: false };
    case 'good':
      return { batchIntervalMs: 500, geometryPrecision: 7, viewportOnly: false };
    case 'poor':
      return { batchIntervalMs: 1500, geometryPrecision: 5, viewportOnly: true };
    case 'critical':
      return { batchIntervalMs: 3000, geometryPrecision: 4, viewportOnly: true };
    default:
      return { batchIntervalMs: 500, geometryPrecision: 7, viewportOnly: false };
  }
}

/**
 * Deep-copies a value, rounding every numeric coordinate to `precision` decimal
 * places. Use for outbound geometry compression only — never before persisting.
 * @param {*} value - GeoJSON geometry (or any nested structure)
 * @param {number} precision - decimal places (default 5 ≈ 1.1 m)
 */
export function truncateCoords(value, precision = 5) {
  const round = (n) =>
    typeof n === 'number' && Number.isFinite(n) ? Number(n.toFixed(precision)) : n;

  function walk(v) {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      return out;
    }
    return round(v);
  }
  return walk(value);
}
