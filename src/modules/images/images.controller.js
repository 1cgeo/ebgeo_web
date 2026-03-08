// Path: src/modules/images/images.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as imagesService from './images.service.js';

export const uploadImage = asyncHandler(async (req, res) => {
  const image = await imagesService.uploadImage(req.atlasId, req.file, req.user.id);
  res.status(201).json({ data: image });
});

export const getImage = asyncHandler(async (req, res) => {
  const { stream, mimeType, filename } = await imagesService.getImageStream(
    req.atlasId,
    req.params.imageId
  );

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  stream.pipe(res);
});

export const deleteImage = asyncHandler(async (req, res) => {
  await imagesService.deleteImage(req.atlasId, req.params.imageId);
  res.status(204).send();
});

export const listImages = asyncHandler(async (req, res) => {
  const images = await imagesService.listImages(req.atlasId);
  res.json({ data: images });
});

/**
 * Bulk upload images from base64 data.
 * Used for importing images from offline/IndexedDB storage.
 * Returns mapping of localId -> serverId for updating feature references.
 */
export const bulkUploadImages = asyncHandler(async (req, res) => {
  const result = await imagesService.bulkUploadImages(
    req.atlasId,
    req.body.images,
    req.user.id
  );
  res.status(201).json({ data: result });
});
