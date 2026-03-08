// Path: src/modules/briefings/briefings.schemas.js
import Joi from 'joi';

export const createBriefingSchema = Joi.object({
  name: Joi.string().required().max(255),
  description: Joi.string().allow(null, ''),
  settings: Joi.object({
    panelPosition: Joi.string().valid('left', 'right').default('left'),
    panelWidth: Joi.number().integer().min(200).max(800).default(350),
    panelBackgroundColor: Joi.string().default('rgba(255, 255, 255, 0.95)'),
  }).default({}),
});

export const updateBriefingSchema = Joi.object({
  name: Joi.string().max(255),
  description: Joi.string().allow(null, ''),
  settings: Joi.object({
    panelPosition: Joi.string().valid('left', 'right'),
    panelWidth: Joi.number().integer().min(200).max(800),
    panelBackgroundColor: Joi.string(),
  }),
});

export const createSlideSchema = Joi.object({
  title: Joi.string().max(500).allow(null, ''),
  content: Joi.string().allow(null, ''),
  mode: Joi.string().valid('2d', '3d', '360').default('2d'),
  map_id: Joi.string().uuid().allow(null),
  model_id: Joi.string().max(100).allow(null, ''),
  photo_id: Joi.string().max(100).allow(null, ''),
  position: Joi.object({
    longitude: Joi.number().allow(null),
    latitude: Joi.number().allow(null),
    zoom: Joi.number().allow(null),
    altitude: Joi.number().allow(null),
  }).default({}),
  orientation: Joi.object({
    bearing: Joi.number().default(0),
    pitch: Joi.number().default(0),
    heading: Joi.number().allow(null),
  }).default({}),
});

export const updateSlideSchema = Joi.object({
  title: Joi.string().max(500).allow(null, ''),
  content: Joi.string().allow(null, ''),
  mode: Joi.string().valid('2d', '3d', '360'),
  map_id: Joi.string().uuid().allow(null),
  model_id: Joi.string().max(100).allow(null, ''),
  photo_id: Joi.string().max(100).allow(null, ''),
  position: Joi.object({
    longitude: Joi.number().allow(null),
    latitude: Joi.number().allow(null),
    zoom: Joi.number().allow(null),
    altitude: Joi.number().allow(null),
  }),
  orientation: Joi.object({
    bearing: Joi.number(),
    pitch: Joi.number(),
    heading: Joi.number().allow(null),
  }),
});

export const reorderSlidesSchema = Joi.object({
  slideOrder: Joi.array().items(Joi.string().uuid()).required(),
});
