// Path: src/modules/config/config.admin.schemas.js
import Joi from 'joi';

/**
 * Editable config sections for the admin "Sistema" tab. The headline fields keep their TYPE checks,
 * but each section is `.unknown(true)` so an admin can also override the advanced keys not surfaced
 * as form fields (map2d.terrainSource/hillshade/bounds, map3d.initialCamera/providers/bounds,
 * streetView360 sources, the global enabled flags, …) via the "Avançado (JSON)" editor. At least one
 * section must be present.
 *
 * Unknown TOP-LEVEL keys are rejected (422) — basemaps/tilesets/layers have their own /resources
 * CRUD and must not be injected through here. That takes `.prefs({ stripUnknown: false })`, because
 * the `validate` middleware runs every schema with `stripUnknown: true`: this comment claimed
 * rejection while the middleware quietly DELETED the offending section and answered 200. The editor
 * is free-form JSON and a mistyped section name ("map2D", "feature") is the likeliest mistake there
 * is, so the admin was told the save worked while half the payload was discarded.
 *
 * The preference is set on the TOP-LEVEL object only in effect: each section declares `.unknown(true)`
 * explicitly, which outranks `stripUnknown` in Joi, so the advanced keys inside a KNOWN section still
 * pass through untouched (verified: `{ app: { title, advKey } , bogus: {} }` errors on `bogus` while
 * keeping `advKey`).
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
    // Runtime self-registration toggle (2026-08-29). Overrides the ALLOW_SELF_REGISTRATION env
    // default; the served `features.self_registration` and the `/auth/register` gate both read
    // the merged value. `password_reset_email` is NOT here: it mirrors SMTP config, frozen at boot.
    self_registration: Joi.boolean(),
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
  // `search` não tem mais `apiUrl`: o gazetteer É este backend (GET /nomes/busca),
  // e o cliente deriva a rota da própria base da API. Ligar/desligar continua em
  // `features.apisearch`. Mantido como objeto aberto para não quebrar payloads antigos.
  search: Joi.object().unknown(true),
  streetView360: Joi.object().unknown(true),
  analysisLayers: Joi.object().unknown(true),
  dataLayers: Joi.object().unknown(true),
  assets3dBaseUrl: Joi.string().max(500).allow(''),
}).min(1).prefs({ stripUnknown: false });
