// Path: src/modules/config/config.admin.schemas.js
import Joi from 'joi';

/**
 * Editable config sections for the admin "Sistema" tab. The headline fields keep their TYPE checks,
 * but each section is `.unknown(true)` so an admin can also override the advanced keys not surfaced
 * as form fields (map2d.terrainSource/hillshade/bounds, map3d.initialCamera/providers/bounds,
 * streetView360 sources, the global enabled flags, …) via the "Avançado (JSON)" editor. Unknown
 * TOP-LEVEL keys are still rejected — basemaps/tilesets/layers have their own /resources CRUD and
 * must not be injected through here. At least one section must be present.
 */
export const configOverridesSchema = Joi.object({
  app: Joi.object({
    title: Joi.string().max(100),
    tutorialUrl: Joi.string().max(500).allow(''),
  }).unknown(true),
  features: Joi.object({
    map_3d: Joi.boolean(),
    imagens_panoramicas: Joi.boolean(),
    grid: Joi.boolean(),
    apisearch: Joi.boolean(),
  }).unknown(true),
  map2d: Joi.object({
    minZoom: Joi.number().min(0).max(24),
    maxZoom: Joi.number().min(0).max(24),
    maxPitch: Joi.number().min(0).max(85),
    globe_projection: Joi.boolean(),
  }).unknown(true).custom((value, helpers) => {
    if (value.minZoom != null && value.maxZoom != null && value.minZoom > value.maxZoom) {
      return helpers.message('map2d.minZoom não pode ser maior que map2d.maxZoom');
    }
    return value;
  }, 'min<=max'),
  map3d: Joi.object({
    viewer: Joi.object().pattern(Joi.string(), Joi.boolean()).unknown(true),
  }).unknown(true),
  services: Joi.object({
    tileServerUrl: Joi.string().max(500).allow(''),
  }).unknown(true),
  search: Joi.object({
    apiUrl: Joi.string().max(500).allow(''),
  }).unknown(true),
  streetView360: Joi.object().unknown(true),
  analysisLayers: Joi.object().unknown(true),
  dataLayers: Joi.object().unknown(true),
  assets3dBaseUrl: Joi.string().max(500).allow(''),
}).min(1);
