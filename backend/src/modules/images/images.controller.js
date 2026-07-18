// Path: src/modules/images/images.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as imagesService from './images.service.js';

export const uploadImage = asyncHandler(async (req, res) => {
  const image = await imagesService.uploadImage(req.atlasId, req.file, req.user.id);
  res.status(201).json({ data: image });
});

export const getImage = asyncHandler(async (req, res, next) => {
  const { path, mimeType, filename } = await imagesService.getImageFile(
    req.atlasId,
    req.params.imageId
  );

  // Serve as an attachment (never inline — avoids any rendered-content XSS).
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // Images are immutable once uploaded; cache privately (access-controlled).
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');

  // res.sendFile handles ETag, conditional 304, Range/206 and Last-Modified.
  res.sendFile(path, {
    acceptRanges: true,
    lastModified: true,
    etag: true,
    cacheControl: false, // we set Cache-Control above (private)
  }, (err) => {
    if (err) next(err);
  });
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
