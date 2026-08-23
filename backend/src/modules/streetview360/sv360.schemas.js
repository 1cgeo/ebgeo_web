// Path: src/modules/streetview360/sv360.schemas.js
// Joi schemas for the StreetView 360 module (Fase 9, stage 1, read-only).
// Validation errors are translated to the frozen { error: '...' } envelope by
// the router-level sv360ErrorHandler (Joi → 422).
import Joi from 'joi';

// Image quality selector (?quality=full|preview, default full). `unknown(true)`
// keeps any extra query params from being rejected (forward-compat).
export const imageQuerySchema = Joi.object({
  quality: Joi.string().valid('full', 'preview').default('full'),
  // O atlas em foco. Mesmo campo, mesma regra e mesmo gate do `atlasScopeQuerySchema`;
  // ele se repete porque esta rota já tinha schema de query próprio.
  atlasId: Joi.string().trim().guid(),
}).unknown(true);

// ?atlasId= — o ATLAS EM FOCO, para o braço de EMPRÉSTIMO do predicado de leitura.
//
// OPCIONAL de propósito: "sem atlas em foco" é o estado normal de quem abre o 360
// direto pela URL, e cobrar o parâmetro ali fecharia o caminho anônimo. Quando ele
// VEM, `requireAtlasScopeWhenPresent` exige que o chamador alcance aquele atlas —
// declará-lo aqui é o que garante que um valor malformado morra em 422 na borda, e
// não num cast `::uuid` lá dentro (22P02, que volta como um 400 sem relação aparente
// com a causa).
//
// `.unknown(true)` como as irmãs: `stripUnknown` está ligado no `validate`, e sem
// isso todo parâmetro que o cliente já mande seria descartado em silêncio.
export const atlasScopeQuerySchema = Joi.object({
  atlasId: Joi.string().trim().guid(),
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

// :uuid/:level/:x/:y de um TILE da pirâmide da panorâmica.
//
// NÃO existe schema de QUERYSTRING para essa rota, e a ausência é decisão: o descritor
// publica um token de geração (`?v=<total_bytes>`) para quebrar cache de CDN, e um
// `Joi.object()` com `additionalProperties: false` responderia 400 para o próprio token
// que este servidor emitiu.
//
// Os três inteiros são conferidos contra a ESCADA GRAVADA no controller, não aqui: um
// teto fixo em Joi seria um segundo lugar dizendo o tamanho da pirâmide, e o número que
// vale está na tabela.
export const tileParamSchema = Joi.object({
  uuid: Joi.string()
    .trim()
    .guid({ version: ['uuidv4', 'uuidv5'] })
    .required(),
  level: Joi.number().integer().min(0).max(32).required(),
  x: Joi.number().integer().min(0).required(),
  y: Joi.number().integer().min(0).required(),
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
    .required()
    .messages({
      'string.pattern.base': 'Identificador do projeto aceita apenas letras minúsculas, números, hífen e sublinhado.',
    }),
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
  // O atlas em foco, igual ao `atlasScopeQuerySchema` (esta rota já tinha schema
  // de query próprio, então o campo entra aqui em vez de um segundo `validate`).
  atlasId: Joi.string().trim().guid(),
}).unknown(true);

// --- stage 2b ---------------------------------------------------------------

// ?include_hidden=true on GET /photos/:uuid — ask for the HIDDEN links too.
//
// Default false, so every existing caller keeps the visible-only array it has
// always received and the frozen shape does not move. Only the calibration
// workspace asks for the hidden ones, because hiding a link is reversible and an
// operator cannot un-hide what the API refuses to show.
export const photoQuerySchema = Joi.object({
  include_hidden: Joi.boolean().default(false),
  // O atlas em foco. Mesmo campo, mesma regra e mesmo gate do `atlasScopeQuerySchema`;
  // ele se repete porque esta rota já tinha schema de query próprio.
  atlasId: Joi.string().trim().guid(),
}).unknown(true);

// ?lon=&lat= on GET /photos/nearest — the point the user clicked.
//
// Both REQUIRED and range-checked, so a malformed coordinate is a clean 422 that
// never reaches PostGIS. 404 is reserved for a well-formed point with no photo
// near it, which is a different answer and the client treats it differently.
export const nearestQuerySchema = Joi.object({
  lon: Joi.number().min(-180).max(180).required(),
  lat: Joi.number().min(-90).max(90).required(),
  // O atlas em foco. Mesmo campo, mesma regra e mesmo gate do `atlasScopeQuerySchema`;
  // ele se repete porque esta rota já tinha schema de query próprio.
  atlasId: Joi.string().trim().guid(),
}).unknown(true);

// ?radius=&floor= on GET /photos/:uuid/nearby.
//
// NEITHER IS BOUNDED HERE, on purpose. The origin CLAMPS the radius into
// [1, 1000] m instead of rejecting it (ebgeo_360 src/routes/calibration.js), so a
// schema bound would 422 a value the endpoint has always accepted — the exact
// contract break the header of sv360.write.schemas.js warns about. The clamp
// lives in the service, where the origin put it. Joi only asserts the TYPE, which
// is what keeps a non-numeric string out of the SQL.
//
// `floor` is either the literal 'all' (drop the floor filter) or an integer level
// (fix one level). Absent means "the source photo's own floor", which is the
// pre-floors behaviour and cannot be expressed as a value here.
export const nearbyPhotosQuerySchema = Joi.object({
  radius: Joi.number(),
  floor: Joi.alternatives().try(Joi.string().valid('all'), Joi.number().integer()),
  // O atlas em foco. Mesmo campo, mesma regra e mesmo gate do `atlasScopeQuerySchema`;
  // ele se repete porque esta rota já tinha schema de query próprio.
  atlasId: Joi.string().trim().guid(),
}).unknown(true);
