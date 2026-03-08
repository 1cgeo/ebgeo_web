// Path: src/utils/async-handler.js

/**
 * Wraps an async Express handler to forward rejected promises to error middleware.
 * @param {Function} fn - Async route handler
 * @returns {Function} Wrapped handler
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
