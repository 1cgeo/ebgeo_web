// Path: src/modules/images/images.service.js
import { mkdir, unlink, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { createReadStream } from 'fs';
import crypto from 'crypto';
import { query } from '../../database/index.js';
import { NotFoundError, BadRequestError } from '../../utils/errors.js';
import config from '../../config.js';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

const INSERT_IMAGE = `
  INSERT INTO images (atlas_id, filename, mime_type, size_bytes, storage_path, uploaded_by)
  VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING *
`;

const FIND_IMAGE_BY_ID = `
  SELECT * FROM images WHERE id = $1 AND atlas_id = $2
`;

const DELETE_IMAGE = `
  DELETE FROM images WHERE id = $1 AND atlas_id = $2 RETURNING storage_path
`;

const LIST_IMAGES_BY_ATLAS = `
  SELECT * FROM images WHERE atlas_id = $1 ORDER BY created_at DESC
`;

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

  // Move file (multer already saved it to temp location)
  // In production, you might want to use a stream copy instead
  // For now, multer.diskStorage will handle the storage

  const { rows } = await query(INSERT_IMAGE, [
    atlasId,
    file.originalname,
    file.mimetype,
    file.size,
    file.path, // multer's storage path
    userId,
  ]);

  return rows[0];
}

export async function getImageById(atlasId, imageId) {
  const { rows } = await query(FIND_IMAGE_BY_ID, [imageId, atlasId]);

  if (rows.length === 0) {
    throw new NotFoundError('Image');
  }

  return rows[0];
}

export async function getImageStream(atlasId, imageId) {
  const image = await getImageById(atlasId, imageId);

  // Verify file exists
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
  const { rows } = await query(DELETE_IMAGE, [imageId, atlasId]);

  if (rows.length === 0) {
    throw new NotFoundError('Image');
  }

  // Delete file from disk
  try {
    await unlink(rows[0].storage_path);
  } catch (err) {
    // Log but don't fail if file is already gone
    console.warn(`Failed to delete image file: ${rows[0].storage_path}`, err.message);
  }

  return true;
}

export async function listImages(atlasId) {
  const { rows } = await query(LIST_IMAGES_BY_ATLAS, [atlasId]);
  return rows;
}

/**
 * Uploads multiple images from base64 data.
 * Used for bulk import from offline/IndexedDB storage.
 * Returns a mapping of localId -> serverId for each image.
 *
 * @param {string} atlasId - Atlas ID
 * @param {Array} images - Array of { localId, filename, mimeType, data (base64) }
 * @param {string} userId - User ID performing the upload
 * @returns {Object} - { uploaded: [...], failed: [...], mapping: { localId: serverId } }
 */
export async function bulkUploadImages(atlasId, images, userId) {
  const results = {
    uploaded: [],
    failed: [],
    mapping: {}, // localId -> serverId
  };

  // Ensure atlas directory exists
  const atlasDir = join(config.images.dir, atlasId);
  await mkdir(atlasDir, { recursive: true });

  const maxBytes = config.images.maxSizeMb * 1024 * 1024;

  for (const image of images) {
    try {
      // Validate mime type
      if (!ALLOWED_MIME_TYPES.includes(image.mimeType)) {
        results.failed.push({
          localId: image.localId,
          error: `Invalid file type: ${image.mimeType}`,
        });
        continue;
      }

      // Decode base64 data
      let buffer;
      try {
        // Remove data URL prefix if present (e.g., "data:image/png;base64,")
        const base64Data = image.data.includes(',')
          ? image.data.split(',')[1]
          : image.data;
        buffer = Buffer.from(base64Data, 'base64');
      } catch (err) {
        results.failed.push({
          localId: image.localId,
          error: 'Invalid base64 data',
        });
        continue;
      }

      // Check file size
      if (buffer.length > maxBytes) {
        results.failed.push({
          localId: image.localId,
          error: `File too large: ${Math.round(buffer.length / 1024 / 1024)}MB (max: ${config.images.maxSizeMb}MB)`,
        });
        continue;
      }

      // Generate storage path
      const ext = image.filename.split('.').pop() || 'bin';
      const uniqueId = crypto.randomUUID();
      const storagePath = join(atlasDir, `${uniqueId}.${ext}`);

      // Write file to disk
      const { writeFile } = await import('fs/promises');
      await writeFile(storagePath, buffer);

      // Insert into database
      const { rows } = await query(INSERT_IMAGE, [
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
