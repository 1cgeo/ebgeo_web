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

// :uuid path param — photo id.
//
// v4 AND v5, deliberately. The studio mints ids as deterministic uuidv5 (D9.6),
// so pinning the nibble to v5 read as tightening. It is not: photo ids are DATA
// carried in from the studio's index.db, and the real legacy corpus is 100% v4
// (98.690/98.690 in the production dump). Against a v5-only guard, every imported
// photo answers 422 on BOTH `GET /photos/:uuid` and `/photos/:uuid/image` — the
// whole migrated archive is unreachable while the projects list looks healthy.
// The frontend already accepts any canonical UUID for exactly this reason
// (`streetview-api.service.js` UUID_RE); this makes the backend agree.
// The version nibble is not an access check — readability is enforced in SQL.
export const uuidParamSchema = Joi.object({
  uuid: Joi.string()
    .trim()
    .guid({ version: ['uuidv4', 'uuidv5'] })
    .required(),
});

// :nome path param — original photo filename.
export const nomeParamSchema = Joi.object({
  nome: Joi.string().trim().min(1).max(512).required(),
});

// :slug path param for GET /thumbnails/:slug.webp — the Express route declares
// '/thumbnails/:slug.webp', so Express strips the literal '.webp' suffix and the
// param holds just the slug. Restricted to the project slug charset so a traversal
// token never reaches the service (which also basenames it).
//
// The charset is the one `normalizeSlug` (sv360.merge.js) defines as
// filesystem-safe — `[a-z0-9_-]`, UNDERSCORE INCLUDED. This pattern said kebab-only
// and was the outlier: real project slugs carry underscores (`27o_gac`,
// `ponta_grossa_1`, `santana_livramento` — 14 of the 28 in the production corpus),
// so half the archive answered 422 on its thumbnail. The bound that matters here is
// "no path separator, no traversal", which `_` does not weaken.
export const thumbnailSlugParamSchema = Joi.object({
  slug: Joi.string()
    .trim()
    .pattern(/^[a-z0-9_-]+$/)
    .min(1)
    .max(255)
    .required(),
});

// :z/:x/:y path params for GET /tiles/:z/:x/:y.pbf — MVT tile coordinates. z is a
// plausible web-mercator zoom (0..24); x/y must fall inside the 2^z grid for that
// zoom. A custom validator enforces the x/y < 2^z bound (cross-field) so an out-of-
// range tile is rejected with 400 (translated to the frozen { error } envelope)
// rather than reaching PostGIS. Express captures the literal '.pbf' suffix off :y.
export const tileParamsSchema = Joi.object({
  z: Joi.number().integer().min(0).max(24).required(),
  x: Joi.number().integer().min(0).required(),
  y: Joi.number().integer().min(0).required(),
}).custom((value, helpers) => {
  const max = 2 ** value.z;
  if (value.x >= max || value.y >= max) {
    return helpers.error('any.invalid', { message: 'x/y out of range for zoom z' });
  }
  return value;
}, 'tile xy range');

// Hard ceiling for GET /tiles/fotos.geojson (achado 65). The query had NO limit,
// no pagination and no spatial predicate, so one anonymous request serialized every
// readable photo into the heap and held a pool connection for the whole scan — with
// DATABASE_POOL_MAX defaulting to 10 a small burst starves GET /api/config, which
// the frontend boot is fail-fast on. The live contract is the MVT route (bbox-scoped
// by construction); this feed stays available but bounded.
export const TILES_GEOJSON_MAX_FEATURES = 5000;

// ?bbox=minLon,minLat,maxLon,maxLat (WGS84) + ?limit for GET /tiles/fotos.geojson.
// The bbox is parsed HERE into 4 finite numbers (with min < max and lon/lat in
// range), so the SQL only ever binds numbers — a malformed window is a clean 4xx
// that never reaches PostGIS. Absent bbox => no spatial filter (still capped).
export const tilesGeojsonQuerySchema = Joi.object({
  bbox: Joi.string()
    .trim()
    .custom((value, helpers) => {
      const parts = value.split(',').map((n) => Number(n.trim()));
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        return helpers.error('any.invalid', { message: 'bbox must be minLon,minLat,maxLon,maxLat' });
      }
      const [minLon, minLat, maxLon, maxLat] = parts;
      const inRange =
        minLon >= -180 && maxLon <= 180 && minLat >= -90 && maxLat <= 90 && minLon < maxLon && minLat < maxLat;
      if (!inRange) {
        return helpers.error('any.invalid', { message: 'bbox is out of range or inverted' });
      }
      return parts;
    }, 'bbox 4 numbers'),
  limit: Joi.number().integer().min(1).max(TILES_GEOJSON_MAX_FEATURES).default(TILES_GEOJSON_MAX_FEATURES),
}).unknown(true);

// Reserved for stage-2 /nearby (lat/lon/radius numerics). Defined now so the
// numeric contract is fixed; not wired into a stage-1 route.
export const nearbyQuerySchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lon: Joi.number().min(-180).max(180).required(),
  radius: Joi.number().positive().max(50000),
}).unknown(true);
