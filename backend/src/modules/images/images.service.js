// Path: src/modules/images/images.service.js
import { mkdir, unlink, writeFile, stat } from 'fs/promises';
import { join, resolve } from 'path';
import crypto from 'crypto';
import { fileTypeFromFile, fileTypeFromBuffer } from 'file-type';
import { query } from '../../database/index.js';
import { NotFoundError, BadRequestError } from '../../utils/errors.js';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { safeErrorMessage } from '../../utils/safe-error-message.js';
import * as Q from './images.queries.js';

// SVG removed: it is a stored-XSS vector when served, and the frontend does
// not rely on it for features. Reintroduce only with explicit sanitization.
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Extension for the SERVER-generated blob name of the /bulk path, derived from the
// mime type — NOT from the client's `filename`.
//
// `filename.split('.').pop()` used to build this path component, so `'a.png/x'`
// produced `<atlasDir>/<uuid>.png/x`, whose parent directory does not exist, and the
// write failed with ENOENT. (Not traversal: the `split('.')` consumes the dots of
// `..`; the outcome is ENOENT / ENAMETOOLONG.) The multer path already had
// `safeExtension` in images.routes.js, which walks the same ground from the other
// side — it sanitizes the client string. Here the string is not needed at all: the
// mime type is already constrained by ALLOWED_MIME_TYPES above AND cross-checked
// against the decoded bytes by `fileTypeFromBuffer`, so deriving from it leaves ZERO
// client-controlled bytes in the path, which is strictly stronger than sanitizing.
// It is also exactly what the real client sends (`EXT_BY_MIME` in the frontend's
// save-local-atlas.service.js builds `filename` from the same table).
const EXT_BY_MIME = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
});

/**
 * Strips server-internal columns from an image row before it crosses the API
 * boundary. `storage_path` is an absolute filesystem path (leaks the deployment
 * layout) and must never reach a client — including read-level / public-atlas
 * viewers who can list an atlas's images.
 */
function toPublicImage(row) {
  if (!row) return row;
  // eslint-disable-next-line no-unused-vars
  const { storage_path, ...pub } = row;
  return pub;
}

export async function uploadImage(atlasId, file, userId) {
  if (!file) {
    throw new BadRequestError('No file uploaded');
  }

  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throw new BadRequestError(`Invalid file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`);
  }

  const maxBytes = config.images.maxSizeMb * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new BadRequestError(`File too large. Maximum size: ${config.images.maxSizeMb}MB`);
  }

  // Validate the actual file CONTENT (magic bytes) against the declared type.
  // Defends against e.g. an HTML/SVG payload renamed to .png.
  const detected = await fileTypeFromFile(file.path);
  if (!detected || !ALLOWED_MIME_TYPES.includes(detected.mime) || detected.mime !== file.mimetype) {
    await unlink(file.path).catch(() => {});
    throw new BadRequestError('File content does not match declared type');
  }

  // multer already wrote the file to `file.path`; persist exactly that path.
  // Any failure from here on must take the blob with it: the file exists BEFORE
  // this handler runs, so an INSERT that throws (a constraint, a dead pool) would
  // otherwise leave bytes on disk that no row points at and nothing ever collects.
  // The /bulk path avoids the problem by writing the blob after the INSERT.
  let rows;
  try {
    ({ rows } = await query(Q.INSERT_IMAGE, [
      atlasId,
      file.originalname,
      file.mimetype,
      file.size,
      file.path,
      userId,
    ]));
  } catch (err) {
    await unlink(file.path).catch(() => {});
    throw err;
  }

  return toPublicImage(rows[0]);
}

export async function getImageById(atlasId, imageId) {
  const { rows } = await query(Q.FIND_IMAGE_BY_ID, [imageId, atlasId]);

  if (rows.length === 0) {
    throw new NotFoundError('Image');
  }

  return rows[0];
}

/**
 * Resolves an image to an absolute file path + metadata for download.
 * Returns the path (not a stream) so the controller can use res.sendFile,
 * which handles ETag, conditional 304, Range/206 and caching.
 */
export async function getImageFile(atlasId, imageId) {
  const image = await getImageById(atlasId, imageId);

  const absolutePath = resolve(image.storage_path);
  try {
    await stat(absolutePath);
  } catch {
    throw new NotFoundError('Image file');
  }

  return {
    id: image.id,
    path: absolutePath,
    mimeType: image.mime_type,
    filename: image.filename,
  };
}

export async function deleteImage(atlasId, imageId) {
  const { rows } = await query(Q.DELETE_IMAGE, [imageId, atlasId]);

  if (rows.length === 0) {
    throw new NotFoundError('Image');
  }

  try {
    await unlink(rows[0].storage_path);
  } catch (err) {
    logger.warn({ path: rows[0].storage_path, error: err.message }, 'Failed to delete image file');
  }

  return true;
}

export async function listImages(atlasId) {
  const { rows } = await query(Q.LIST_IMAGES_BY_ATLAS, [atlasId]);
  return rows.map(toPublicImage);
}

/**
 * Uploads multiple images from base64 data.
 * Used for bulk import from offline/IndexedDB storage.
 * Returns a mapping of localId -> serverId for each image.
 */
export async function bulkUploadImages(atlasId, images, userId) {
  const results = {
    uploaded: [],
    failed: [],
    mapping: {},
  };

  const atlasDir = join(config.images.dir, atlasId);
  await mkdir(atlasDir, { recursive: true });

  const maxBytes = config.images.maxSizeMb * 1024 * 1024;

  // localIds already inserted in THIS batch. The first occurrence preserves the localId as the
  // server id (P11 ref validity); a duplicate localId within the same batch can't reuse the PK,
  // so it gets a fresh server id and the mapping collapses last-wins to the latest.
  const seenLocalIds = new Set();

  for (const image of images) {
    // Declared OUTSIDE the try so the catch can undo a committed INSERT (see below).
    let insertedId = null;
    let claimedLocalId = false;

    try {
      if (!ALLOWED_MIME_TYPES.includes(image.mimeType)) {
        results.failed.push({
          localId: image.localId,
          error: `Invalid file type: ${image.mimeType}`,
        });
        continue;
      }

      // Decode base64 data (strip data URL prefix if present)
      let buffer;
      try {
        const base64Data = image.data.includes(',')
          ? image.data.split(',')[1]
          : image.data;
        buffer = Buffer.from(base64Data, 'base64');
      } catch {
        results.failed.push({
          localId: image.localId,
          error: 'Invalid base64 data',
        });
        continue;
      }

      if (buffer.length > maxBytes) {
        results.failed.push({
          localId: image.localId,
          error: `File too large: ${Math.round(buffer.length / 1024 / 1024)}MB (max: ${config.images.maxSizeMb}MB)`,
        });
        continue;
      }

      // Validate decoded content (magic bytes) against the declared mime type.
      const detected = await fileTypeFromBuffer(buffer);
      if (!detected || !ALLOWED_MIME_TYPES.includes(detected.mime) || detected.mime !== image.mimeType) {
        results.failed.push({
          localId: image.localId,
          error: 'Content does not match declared type',
        });
        continue;
      }

      const ext = EXT_BY_MIME[image.mimeType];
      const uniqueId = crypto.randomUUID();
      const storagePath = join(atlasDir, `${uniqueId}.${ext}`);

      // First occurrence of this localId preserves it as the server id (so an image-feature's blob
      // ref — which equals its feature id — stays valid with no post-import rewrite). A duplicate
      // localId WITHIN the same batch can't reuse the PK, so it gets a fresh generated server id.
      let serverImage;
      if (seenLocalIds.has(image.localId)) {
        const { rows } = await query(Q.INSERT_IMAGE, [
          atlasId,
          image.filename,
          image.mimeType,
          buffer.length,
          storagePath,
          userId,
        ]);
        serverImage = rows[0];
      } else {
        const { rows } = await query(Q.INSERT_IMAGE_WITH_ID, [
          image.localId,
          atlasId,
          image.filename,
          image.mimeType,
          buffer.length,
          storagePath,
          userId,
        ]);
        serverImage = rows[0];
        seenLocalIds.add(image.localId);
        claimedLocalId = true;
      }
      insertedId = serverImage.id;

      // Write the blob AFTER the row inserts, so a failed INSERT (e.g. a cross-atlas global-PK
      // collision when re-saving the same local atlas) never leaves an orphan file on disk.
      // The row is COMMITTED at this point (`query()` is autocommit), so the reverse leak is
      // now the catch's job — see the compensating DELETE there.
      await writeFile(storagePath, buffer);

      results.uploaded.push({
        localId: image.localId,
        serverId: serverImage.id,
        filename: serverImage.filename,
        size: serverImage.size_bytes,
      });
      results.mapping[image.localId] = serverImage.id;

    } catch (err) {
      logger.warn({ err, atlasId, localId: image.localId }, 'Bulk image item failed');

      // COMPENSATE a committed row whose blob never made it to disk.
      //
      // Reaching here with `insertedId` set means the INSERT committed and
      // `writeFile` threw (ENOSPC, EACCES, a full disk). Without this DELETE the row
      // survives: `listImages` returns it and `GET /images/:id` answers a permanent
      // 404 'Image file' — the API publishing a state its OWN response called
      // `failed`. Compensation, not soft-delete: the row was never visible to any
      // client and the module hard-deletes images anyway (DELETE_IMAGE).
      //
      // Chosen over wrapping INSERT+writeFile in `tx()`, for two reasons.
      // (a) `tx()` holds a pooled connection across a multi-MB disk write for EVERY
      //     item — up to 50 per request — paying a hot-path cost on every success to
      //     fix a rare failure. This codebase has already been bitten by holding a
      //     connection while waiting (the `lock_timeout` argument in sync.service.js:
      //     retention under contention becomes pool exhaustion).
      // (b) `tx()` does not even make it atomic: the file is written BEFORE COMMIT,
      //     so a COMMIT failure leaves an orphan FILE — exactly the leak the current
      //     ordering was written to prevent. It swaps one leak for another.
      // The cost accepted here is a short window in which a concurrent GET can see
      // the phantom row, and the fact that a failing DELETE lands us back on today's
      // behaviour — no worse, and now logged.
      if (insertedId) {
        try {
          await query(Q.DELETE_IMAGE, [insertedId, atlasId]);
          // The localId no longer holds its PK, so a later duplicate in this same
          // batch must be allowed to claim it again (that is what `seenLocalIds`
          // means). Leaving it in would silently downgrade the retry to a fresh
          // server id and break the ref-validity guarantee of the WITH_ID path.
          if (claimedLocalId) seenLocalIds.delete(image.localId);
        } catch (cleanupErr) {
          logger.error(
            { err: cleanupErr, atlasId, imageId: insertedId },
            'Failed to remove orphan image row after blob write failure'
          );
        }
      }

      // NEVER `err.message`: for a pg error that is the driver's text (constraint
      // name, e.g. `images_pkey` on the global-PK collision) and for an fs error it
      // is the ABSOLUTE server path. This array ships inside a 201, so the
      // errorHandler — which refuses to forward exactly that text — never runs.
      results.failed.push({
        localId: image.localId,
        error: safeErrorMessage(err, 'Unknown error'),
      });
    }
  }

  return results;
}
