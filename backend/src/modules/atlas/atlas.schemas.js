// Path: src/modules/atlas/atlas.schemas.js
import Joi from 'joi';

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
// processing outputs, and the features.valid_feature_type CHECK (002_atlas.sql).
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
  geometry: Joi.object().required(),
  properties: Joi.object().default({}),
  layer_id: Joi.string().uuid().allow(null),
});

const layerSchema = Joi.object({
  id: Joi.string().uuid().required(),
  name: Joi.string().required(),
  visible: Joi.boolean().default(true),
  locked: Joi.boolean().default(false),
  opacity: Joi.number().min(0).max(1).default(1),
  sort_order: Joi.number().integer().default(0),
  style: Joi.object().default({}),
});

const groupSchema = Joi.object({
  id: Joi.string().uuid().required(),
  name: Joi.string().required(),
  visible: Joi.boolean().default(true),
  locked: Joi.boolean().default(false),
  style: Joi.object().default({}),
  parent_id: Joi.string().uuid().allow(null),
});

// Cesium 3D data types
const VALID_CESIUM3D_TYPES = ['marker', 'measurement', 'viewshed', 'camera_position'];

const cesium3dDataSchema = Joi.object({
  id: Joi.string().uuid().required(),
  data_type: Joi.string().valid(...VALID_CESIUM3D_TYPES).required(),
  tileset_id: Joi.string().allow(null),
  data: Joi.object().default({}),
});

// StreetView 360 data types
const VALID_STREETVIEW360_TYPES = ['orientation', 'marker'];

const streetview360DataSchema = Joi.object({
  id: Joi.string().uuid().required(),
  data_type: Joi.string().valid(...VALID_STREETVIEW360_TYPES).required(),
  photo_name: Joi.string().allow(null),
  data: Joi.object().default({}),
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
  analysis_layers: Joi.object().default({}),
  catalog_layers: Joi.array().default([]),
  locked: Joi.boolean().default(false),
  // Per-map temporal config + grid style (maps columns). Accepted on import so a local atlas
  // saved to the server preserves the temporal module + grid (P9: sync ⊇ .ebgeo coverage).
  grid_style: Joi.object().default({}),
  temporal_config: Joi.object().default({}),
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
  position: Joi.object().default({}),
  orientation: Joi.object().default({}),
});

const briefingSchema = Joi.object({
  id: Joi.string().uuid().required(),
  name: Joi.string().required(),
  description: Joi.string().allow(null, ''),
  settings: Joi.object().default({}),
  slides: Joi.array().items(slideSchema).default([]),
});

export const importSchema = Joi.object({
  atlas: Joi.object({
    name: Joi.string().max(255).required(),
    description: Joi.string().allow(null, ''),
    settings: Joi.object(),
  }).required(),
  maps: Joi.array().items(mapSchema).default([]),
  briefings: Joi.array().items(briefingSchema).default([]),
});
