// Path: src/modules/streetview360/sv360-error.js
// Router-level error middleware for the StreetView 360 module. Mounted as the
// LAST handler inside sv360.routes.js so it intercepts errors from these routes
// before they reach the global errorHandler (which would emit the backend-wide
// { error: { code, message } } shape). The 360 contract is the FROZEN flat
// envelope { error: 'message string' }.
//
// Status codes are preserved from AppError subclasses (404/403/401/409/...).
// Joi validation errors → 422. 500s never leak internals outside dev.
import config from '../../config.js';

// The 4-arg signature (err, req, res, next) is what marks this as an Express
// error handler — `next` must stay in the signature even when only used for the
// headersSent re-throw path.
export function sv360ErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err.isJoi) {
    return res.status(422).json({ error: err.details?.[0]?.message || 'Validation failed' });
  }

  const status = err.statusCode || 500;
  const message = status >= 500 ? (config.isDev ? err.message : 'Internal error') : err.message;
  return res.status(status).json({ error: message });
}
