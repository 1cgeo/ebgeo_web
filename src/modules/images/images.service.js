// Path: src/modules/images/images.service.js
import { mkdir, unlink, writeFile, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { createReadStream } from 'fs';
import crypto from 'crypto';
import { query } from '../../database/index.js';
import { NotFoundError, BadRequestError } from '../../utils/errors.js';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import * as Q from './images.queries.js';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

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

  // Generate storage path
  const ext = file.originalname.split('.').pop() || 'bin';
  const uniqueId = crypto.randomUUID();
  const storagePath = join(config.images.dir, atlasId, `${uniqueId}.${ext}`);

  // Ensure directory exists
  await mkdir(dirname(storagePath), { recursive: true });

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

export async function getImageStream(atlasId, imageId) {
  const image = await getImageById(atlasId, imageId);

  try {
    await stat(image.storage_path);
  } catch {
    throw new NotFoundError('Image file');
  }

  return {
    stream: createReadStream(image.storage_path),
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

      const ext = image.filename.split('.').pop() || 'bin';
      const uniqueId = crypto.randomUUID();
      const storagePath = join(atlasDir, `${uniqueId}.${ext}`);

      await writeFile(storagePath, buffer);

      const { rows } = await query(Q.INSERT_IMAGE, [
        atlasId,
        image.filename,
        image.mimeType,
        buffer.length,
        storagePath,
        userId,
      ]);

      const serverImage = rows[0];
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
