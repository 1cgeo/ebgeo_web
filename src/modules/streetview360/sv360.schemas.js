// Path: src/modules/streetview360/sv360.schemas.js
// Joi schemas for the StreetView 360 module (Fase 9, stage 1, read-only).
// Validation errors are translated to the frozen { error: '...' } envelope by
// the router-level sv360ErrorHandler (Joi → 422).
import Joi from 'joi';

// Image quality selector (?quality=full|preview, default full). `unknown(true)`
// keeps any extra query params from being rejected (forward-compat).
export const imageQuerySchema = Joi.object({
  quality: Joi.string().valid('full', 'preview').default('full'),
}).unknown(true);

// :slug path param — project slug (lowercase kebab token).
export const slugParamSchema = Joi.object({
  slug: Joi.string().trim().min(1).max(255).required(),
});

// :uuid path param — photo id (TEXT uuid v5 string).
export const uuidParamSchema = Joi.object({
  uuid: Joi.string()
    .trim()
    .guid({ version: ['uuidv5'] })
    .required(),
});

// :nome path param — original photo filename.
export const nomeParamSchema = Joi.object({
  nome: Joi.string().trim().min(1).max(512).required(),
});

// :slug path param for GET /thumbnails/:slug.webp — the Express route declares
// '/thumbnails/:slug.webp', so Express strips the literal '.webp' suffix and the
// param holds just the slug. Restrict to the project slug charset (lowercase
// kebab) so a traversal token never reaches the service (which also basenames it).
export const thumbnailSlugParamSchema = Joi.object({
  slug: Joi.string()
    .trim()
    .pattern(/^[a-z0-9-]+$/)
    .min(1)
    .max(255)
    .required(),
});

// Reserved for stage-2 /nearby (lat/lon/radius numerics). Defined now so the
// numeric contract is fixed; not wired into a stage-1 route.
export const nearbyQuerySchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lon: Joi.number().min(-180).max(180).required(),
  radius: Joi.number().positive().max(50000),
}).unknown(true);
