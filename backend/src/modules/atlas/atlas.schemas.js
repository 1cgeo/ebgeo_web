// Path: src/modules/atlas/atlas.schemas.js
import Joi from 'joi';
import { RESOURCE_TYPES } from '../resource-access/resource-access.types.js';
import {
  scalarObjectSchema, scrubbedObjectSchema, catalogLayerEntrySchema,
} from '../sync/free-field.schemas.js';

export const createAtlasSchema = Joi.object({
  name: Joi.string().required().max(255),
  description: Joi.string().max(5000).allow(null, ''),
});

export const updateAtlasSchema = Joi.object({
  name: Joi.string().max(255),
  description: Joi.string().max(5000).allow(null, ''),
  map_order: Joi.array().items(Joi.string().uuid()),
});

// Settings schema for PATCH /atlas/:id/settings
const coordinatePair = Joi.array().items(Joi.number()).length(2);
const boundsSchema = Joi.array().items(coordinatePair).length(2);

export const atlasSettingsSchema = Joi.object({
  features: Joi.object({
    map_3d: Joi.boolean(),
    panoramic_images: Joi.boolean(),
    terrain_3d: Joi.boolean(),
    data_layers: Joi.boolean(),
    analysis_layers: Joi.boolean(),
  }),
  basemaps: Joi.array().items(Joi.string()),
  default_basemap: Joi.string().allow(null),
  bounds_2d: boundsSchema.allow(null),
  min_zoom: Joi.number().min(0).max(22).allow(null),
  max_zoom: Joi.number().min(0).max(22).allow(null),
  available_analysis_layers: Joi.array().items(Joi.string()),
  available_data_layers: Joi.array().items(Joi.string()),
  available_3d_models: Joi.array().items(Joi.string()),
  available_360_views: Joi.array().items(Joi.string()),
}).custom((value, helpers) => {
  // The `any.custom` template is '{{#label}} failed custom validation because
  // {{#error.message}}' — it reads the local named `error`, not one named `message`.
  // Passing `{ message }` left the sentence dangling ('"value" failed custom
  // validation because ') and the two rules below became indistinguishable to the
  // caller: a 422 that says a rule failed without saying WHICH is a validation error
  // the admin panel cannot render into an actionable message.
  const reject = (message) => helpers.error('any.custom', { error: new Error(message) });

  // Custom validation: min_zoom < max_zoom
  if (value.min_zoom != null && value.max_zoom != null && value.min_zoom > value.max_zoom) {
    return reject('min_zoom must be less than or equal to max_zoom');
  }
  // default_basemap must be in basemaps list
  if (value.default_basemap && value.basemaps && value.basemaps.length > 0) {
    if (!value.basemaps.includes(value.default_basemap)) {
      return reject('default_basemap must be one of the basemaps');
    }
  }
  return value;
}, 'settings validation');

/**
 * O PISO DE TAMANHO DO TERMO DE BUSCA, e o TETO de linhas devolvidas.
 *
 * Os dois números SÃO a decisão de 2026-08-24, não afinação: a enumeração do acervo nasce sob
 * controle explícito, e um termo de UM caractere devolveria a fatia mais recente do acervo
 * inteiro ordenada por `updated_at` — uma lista aberta com cara de busca. Dois caracteres já
 * exigem que quem pergunta saiba alguma coisa sobre o que procura.
 *
 * Eles são EXPORTADOS porque o serviço os reafirma: o Joi é a borda, e borda protege a ROTA, não
 * a função. Um segundo chamador do serviço (um script, outra rota) passaria por baixo dela, e a
 * propriedade "não existe caminho que devolva tudo" tem de valer para a função, não para o
 * middleware que hoje a precede.
 */
export const ATLAS_SEARCH_MIN_TERM = 2;
export const ATLAS_SEARCH_MAX_LIMIT = 50;
export const ATLAS_SEARCH_DEFAULT_LIMIT = 20;

/**
 * `GET /atlas/admin/search?q=&limit=`.
 *
 * `q` É `required()`, e essa palavra é o gate: sem ela a rota responderia 200 com o acervo
 * inteiro na primeira vez que alguém abrisse a tela sem digitar nada, que é exatamente o
 * despejo que a decisão recusa. 422 sem termo é a resposta certa, e a tela não chama a rota
 * antes de haver o que buscar.
 */
export const adminAtlasSearchSchema = Joi.object({
  q: Joi.string().trim().min(ATLAS_SEARCH_MIN_TERM).max(255)
    .required(),
  limit: Joi.number().integer().min(1).max(ATLAS_SEARCH_MAX_LIMIT)
    .default(ATLAS_SEARCH_DEFAULT_LIMIT),
});

export const cloneAtlasSchema = Joi.object({
  name: Joi.string().max(255),
});

// Ownership transfer: the new owner is picked among current members (validated in the service).
export const transferOwnershipSchema = Joi.object({
  newOwnerId: Joi.string().uuid().required(),
});

export const atlasIdParamsSchema = Joi.object({
  atlasId: Joi.string().uuid().required(),
});

// Capa do atlas (PUT /atlas/:id/cover). O `max` é do TEXTO base64: 700.000 caracteres decodificam
// para ~512 kB, que é o teto real conferido em `setAtlasCover`. Os dois existem e cobrem coisas
// diferentes: este barra o corpo gigante ANTES de decodificar, aquele barra o payload que passou
// aqui por pouco. O regex prova só o FORMATO; quem confere se os bytes são mesmo um PNG/JPEG/WebP
// é o número mágico no serviço, porque o mime declarado é texto que o cliente escolhe.
export const atlasCoverSchema = Joi.object({
  image: Joi.string().required().max(700000)
    .pattern(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
    .messages({
      'string.pattern.base': 'Imagem deve ser uma data URI base64 de PNG, JPEG ou WebP.',
    }),
  // Dimensões da miniatura, guardadas para quem for desenhá-la sem decodificar os bytes.
  width: Joi.number().integer().min(1).max(4096),
  height: Joi.number().integer().min(1).max(4096),
});

export const idParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

// ============================================
// Import Schema - Bulk import de atlas offline
// ============================================

// Valid feature types — must match the frontend SOURCE_TYPES (store.constants.js) + the
// processing outputs, and the features.valid_feature_type CHECK (003_atlas.sql).
const VALID_FEATURE_TYPES = [
  // Basic
  'point', 'line', 'polygon', 'text', 'image',
  // Shapes
  'circle', 'rectangle', 'ellipse', 'brush', 'sector',
  // Military
  'arrow', 'boundary', 'occupied_front', 'military_symbol', 'coordination_measure',
  'magnetic_declination',
  // Analysis
  'los', 'visibility', 'processed_los', 'processed_visibility',
];

const featureSchema = Joi.object({
  id: Joi.string().uuid().required(),
  feature_type: Joi.string().valid(...VALID_FEATURE_TYPES).required(),
  // SCRUBBED, not closed: 21 geometry types and ~90 measured property keys are the product's own
  // domain, so only a catalog-resource definition is taken out. See `free-field.schemas.js`.
  geometry: scrubbedObjectSchema.required(),
  properties: scrubbedObjectSchema.default({}),
  layer_id: Joi.string().uuid().allow(null),
});

const layerSchema = Joi.object({
  id: Joi.string().uuid().required(),
  name: Joi.string().required(),
  visible: Joi.boolean().default(true),
  locked: Joi.boolean().default(false),
  opacity: Joi.number().min(0).max(1).default(1),
  sort_order: Joi.number().integer().default(0),
  // No frontend writer at all (the `Layer` typedef has no `style`), and the two fixtures that do
  // write it write scalars. CLOSED.
  style: scalarObjectSchema.default({}),
});

const groupSchema = Joi.object({
  id: Joi.string().uuid().required(),
  name: Joi.string().required(),
  visible: Joi.boolean().default(true),
  locked: Joi.boolean().default(false),
  // Same as `layers.style`: no writer, scalars only. CLOSED.
  style: scalarObjectSchema.default({}),
  parent_id: Joi.string().uuid().allow(null),
});

// Cesium 3D data types
const VALID_CESIUM3D_TYPES = ['marker', 'measurement', 'viewshed', 'camera_position'];

const cesium3dDataSchema = Joi.object({
  id: Joi.string().uuid().required(),
  data_type: Joi.string().valid(...VALID_CESIUM3D_TYPES).required(),
  tileset_id: Joi.string().allow(null),
  data: scrubbedObjectSchema.default({}),
});

// StreetView 360 data types
const VALID_STREETVIEW360_TYPES = ['orientation', 'marker'];

const streetview360DataSchema = Joi.object({
  id: Joi.string().uuid().required(),
  data_type: Joi.string().valid(...VALID_STREETVIEW360_TYPES).required(),
  photo_name: Joi.string().allow(null),
  data: scrubbedObjectSchema.default({}),
});

const groupFeatureSchema = Joi.object({
  group_id: Joi.string().uuid().required(),
  feature_id: Joi.string().uuid().required(),
});

const mapSchema = Joi.object({
  id: Joi.string().uuid().required(),
  name: Joi.string().required(),
  base_layer: Joi.string().default('carta-topografica'),
  center_lat: Joi.number().allow(null),
  center_long: Joi.number().allow(null),
  zoom: Joi.number().allow(null),
  bearing: Joi.number().default(0),
  pitch: Joi.number().default(0),
  notes_title: Joi.string().allow(null, ''),
  notes_description: Joi.string().allow(null, ''),
  // The grid-domain sibling. SCRUBBED and not closed: its contract carries nested values
  // (`{ los_result_123: { visible, data } }`, `{ grid: { type, visible } }`), so only a
  // resource definition is taken out of it. See `free-field.schemas.js`.
  analysis_layers: scrubbedObjectSchema.default({}),
  // DISCARD, NEVER REJECT, which is the doctrine `free-field.schemas.js` states for the sync
  // door and which this door has to obey too. A non-object item used to reject the WHOLE .ebgeo
  // with 422, so one malformed entry cost the user the entire import; the two write doors
  // disagreed on the rule the module declares. Filtering first keeps the failure direction
  // right: an entry that quietly does not come back, never an import that can never run.
  catalog_layers: Joi.array()
    .custom((v) => (Array.isArray(v) ? v.filter((e) => e && typeof e === 'object' && !Array.isArray(e)) : v))
    .items(catalogLayerEntrySchema)
    .default([]),
  locked: Joi.boolean().default(false),
  // Per-map temporal config + grid style (maps columns). Accepted on import so a local atlas
  // saved to the server preserves the temporal module + grid (P9: sync ⊇ .ebgeo coverage).
  grid_style: scalarObjectSchema.default({}),
  temporal_config: scalarObjectSchema.default({}),
  features: Joi.array().items(featureSchema).default([]),
  layers: Joi.array().items(layerSchema).default([]),
  groups: Joi.array().items(groupSchema).default([]),
  groupFeatures: Joi.array().items(groupFeatureSchema).default([]),
  cesium3dData: Joi.array().items(cesium3dDataSchema).default([]),
  streetview360Data: Joi.array().items(streetview360DataSchema).default([]),
});

const slideSchema = Joi.object({
  id: Joi.string().uuid().required(),
  title: Joi.string().allow(null, ''),
  content: Joi.string().allow(null, ''),
  mode: Joi.string().valid('2d', '3d', '360').default('2d'),
  map_id: Joi.string().uuid().allow(null),
  model_id: Joi.string().uuid().allow(null),
  photo_id: Joi.string().uuid().allow(null),
  position: scalarObjectSchema.default({}),
  orientation: scalarObjectSchema.default({}),
});

const briefingSchema = Joi.object({
  id: Joi.string().uuid().required(),
  name: Joi.string().required(),
  description: Joi.string().allow(null, ''),
  settings: scalarObjectSchema.default({}),
  slides: Joi.array().items(slideSchema).default([]),
});

export const importSchema = Joi.object({
  atlas: Joi.object({
    name: Joi.string().max(255).required(),
    description: Joi.string().allow(null, ''),
    settings: scrubbedObjectSchema,
  }).required(),
  maps: Joi.array().items(mapSchema).default([]),
  briefings: Joi.array().items(briefingSchema).default([]),
});

/**
 * Corpo do anexo de recurso ao atlas (POST /atlas/:atlasId/resources).
 *
 * `resourceType` é validado na BORDA porque ele escolhe nome de tabela mais
 * adiante. A lista vem de `resource-access.types.js`, e não é recopiada aqui: uma
 * segunda cópia dos quatro tipos só espera o quinto para ficar errada.
 */
export const atlasResourceSchema = Joi.object({
  resourceType: Joi.string().valid(...RESOURCE_TYPES).required(),
  resourceId: Joi.string().min(1).max(255).required(),
});

/** `:atlasId/resources/:type/:id` da remoção. */
export const atlasResourceParamsSchema = Joi.object({
  atlasId: Joi.string().uuid().required(),
  type: Joi.string().valid(...RESOURCE_TYPES).required(),
  id: Joi.string().min(1).max(255).required(),
});
