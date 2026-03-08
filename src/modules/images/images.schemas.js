// Path: src/modules/images/images.schemas.js
import Joi from 'joi';

export const uploadQuerySchema = Joi.object({
  filename: Joi.string().max(255),
});

// Schema for bulk image upload (base64 encoded images)
const bulkImageItemSchema = Joi.object({
  localId: Joi.string().uuid().required(), // Client-side ID for mapping
  filename: Joi.string().max(255).required(),
  mimeType: Joi.string().valid('image/png', 'image/jpeg', 'image/svg+xml', 'image/webp').required(),
  data: Joi.string().required(), // Base64 encoded image data
});

export const bulkUploadSchema = Joi.object({
  images: Joi.array().items(bulkImageItemSchema).min(1).max(50).required(),
});
