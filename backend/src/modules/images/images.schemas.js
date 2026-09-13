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

// The ATTEMPT KEY of the single upload route, read from the `X-Idempotency-Key` header.
//
// A UUID and nothing else: it is stored in `images.attempt_key` (a UUID column added by
// 013_imagens_idempotentes.sql), so anything else would reach the database as a type error, which
// is a 500 over a client mistake. Validated BEFORE multer runs, the only moment at which refusing
// costs nothing: after it the blob is already on disk and a refusal has to clean up after itself.
//
// OPTIONAL, because the key is what an updated client sends and the route has to keep answering the
// one that does not. WITHOUT IT THERE IS NO DEDUPLICATION AT ALL on this route, by decision D7 of
// 2026-09-13: identical bytes with no key write a second row and a second blob. Content cannot tell
// a retry from two features legitimately holding the same picture, and guessing wrong there hands
// back a row the caller never named, under a name it did not send.
export const attemptKeySchema = Joi.object({
  attemptKey: Joi.string().uuid().optional(),
});

// Schema for bulk image upload (base64 encoded images)
//
// `filename` forbids the two path separators and NUL. Defense in depth only — the
// service no longer derives the on-disk name from this string at all (it uses the
// validated mime type), so nothing depends on the pattern to stay safe. It is here
// because a filename CANNOT legitimately contain a separator: the value is stored in
// `images.filename` and echoed back in the download's Content-Disposition, and a
// border that accepts `../../etc/x` as a name is a border that invites the next
// consumer of that column to concatenate it into a path. Character-permissive
// otherwise, for the same reason as `uploadFileSchema` above: pt-BR names are
// legitimate. The real client sends `<uuid>.<ext>` (frontend
// save-local-atlas.service.js), so nothing in the app is rejected by this.
const bulkImageItemSchema = Joi.object({
  localId: Joi.string().uuid().required(), // Client-side ID for mapping
  filename: Joi.string().max(255).pattern(/^[^/\\\0]+$/).required()
    .messages({
      'string.pattern.base': 'Nome do arquivo não pode conter barra nem contrabarra.',
    }),
  mimeType: Joi.string().valid('image/png', 'image/jpeg', 'image/webp').required(),
  data: Joi.string().required(), // Base64 encoded image data
});

export const bulkUploadSchema = Joi.object({
  images: Joi.array().items(bulkImageItemSchema).min(1).max(50).required(),
});
