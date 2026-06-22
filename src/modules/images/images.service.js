// Path: src/modules/images/images.service.js
import { mkdir, unlink, writeFile, stat } from 'fs/promises';
import { join, resolve } from 'path';
import crypto from 'crypto';
import { fileTypeFromFile, fileTypeFromBuffer } from 'file-type';
import { query } from '../../database/index.js';
import { NotFoundError, BadRequestError } from '../../utils/errors.js';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import * as Q from './images.queries.js';

// SVG removed: it is a stored-XSS vector when served, and the frontend does
// not rely on it for features. Reintroduce only with explicit sanitization.
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

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
  const { rows } = await query(Q.INSERT_IMAGE, [
    atlasId,
    file.originalname,
    file.mimetype,
    file.size,
    file.path,
    userId,
  ]);

  return rows[0];
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
  return rows;
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

      const ext = image.filename.split('.').pop() || 'bin';
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
      }

      // Write the blob AFTER the row inserts, so a failed INSERT (e.g. a cross-atlas global-PK
      // collision when re-saving the same local atlas) never leaves an orphan file on disk.
      await writeFile(storagePath, buffer);

      results.uploaded.push({
        localId: image.localId,
        serverId: serverImage.id,
        filename: serverImage.filename,
        size: serverImage.size_bytes,
      });
      results.mapping[image.localId] = serverImage.id;

    } catch (err) {
      results.failed.push({
        localId: image.localId,
        error: err.message || 'Unknown error',
      });
    }
  }

  return results;
}
