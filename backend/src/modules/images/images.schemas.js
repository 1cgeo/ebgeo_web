// Path: src/modules/images/images.schemas.js
import Joi from 'joi';

// Border validation for the multipart single upload (POST /atlas/:atlasId/images).
// It was the only write route with no payload check: `file.originalname` went
// verbatim into `filename VARCHAR(255) NOT NULL`, so a longer name raised SQLSTATE
// 22001 — absent from PG_ERROR_MAP — and surfaced as a 500 with the blob multer had
// already written left orphaned on disk. Applied from multer's `fileFilter`, i.e.
// BEFORE any byte is written, so a rejected upload leaves nothing behind.
//
// Deliberately permissive about the CHARACTERS: the browser sends the filename as
// raw UTF-8 bytes that busboy decodes as latin1, so legitimate pt-BR names arrive
// mojibaked ('coordenaÃ§Ã£o.png'). Length is the property that must hold; the
// download header now encodes whatever is stored (RFC 6266) and the on-disk name is
// derived from a sanitized extension, never from this string.
export const uploadFileSchema = Joi.object({
  originalname: Joi.string().trim().min(1).max(255).required(),
}).unknown(true);

// Schema for bulk image upload (base64 encoded images)
const bulkImageItemSchema = Joi.object({
  localId: Joi.string().uuid().required(), // Client-side ID for mapping
  filename: Joi.string().max(255).required(),
  mimeType: Joi.string().valid('image/png', 'image/jpeg', 'image/webp').required(),
  data: Joi.string().required(), // Base64 encoded image data
});

export const bulkUploadSchema = Joi.object({
  images: Joi.array().items(bulkImageItemSchema).min(1).max(50).required(),
});
