// Path: src/utils/redact-url.js
// Masks credential-bearing query parameters before a URL is written to logs.
// `api_key` is a supported, non-expiring M2M credential transport
// (flexibleAuth reads ?api_key=); `token` is the cookie/refresh value. Neither
// must ever land in plaintext in pino output.
const SENSITIVE_QUERY_KEYS = new Set(['api_key', 'token', 'access_token', 'refresh_token']);

/**
 * Returns `url` with the values of sensitive query params replaced by `REDACTED`.
 * Path and non-sensitive params are preserved. Never throws — a malformed URL is
 * returned with its whole query string stripped rather than logged raw.
 * @param {string} url - a request URL/path, possibly with a query string.
 * @returns {string}
 */
export function redactUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return url;
  const qIndex = url.indexOf('?');
  if (qIndex === -1) return url;

  const path = url.slice(0, qIndex);
  const queryStr = url.slice(qIndex + 1);

  try {
    const params = new URLSearchParams(queryStr);
    let mutated = false;
    for (const key of params.keys()) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        params.set(key, 'REDACTED');
        mutated = true;
      }
    }
    if (!mutated) return url;
    return `${path}?${params.toString()}`;
  } catch {
    // Unparseable query — drop it entirely rather than risk logging a secret.
    return path;
  }
}
